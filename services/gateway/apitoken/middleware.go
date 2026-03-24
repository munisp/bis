// services/gateway/apitoken/middleware.go
// Metered API token validation and rate-limiting middleware for the BIS Go gateway.
//
// Responsibilities:
//   - Validate Bearer tokens against the PostgreSQL api_tokens table (SHA-256 hash comparison)
//   - Enforce per-token per-minute rate limits using Redis sliding-window counters
//   - Publish usage events to Kafka topic "bis.api_usage" for the Rust event processor to log
//   - Attach token metadata (id, scopes, tenantId) to the request context for downstream handlers
//
// Token format: bisk_live_<8-hex-prefix>_<56-hex-suffix>
// Storage:      Only the SHA-256 hash is stored — plaintext is never persisted.

package apitoken

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	_ "github.com/lib/pq"
)

// ─── Config ──────────────────────────────────────────────────────────────────

var (
	dbURL        = os.Getenv("DATABASE_URL")
	redisAddr    = envOr("REDIS_ADDR", "localhost:6379")
	kafkaBrokers = envOr("KAFKA_BROKERS", "localhost:9092")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Context keys ─────────────────────────────────────────────────────────────

type contextKey string

const (
	CtxTokenID    contextKey = "api_token_id"
	CtxTokenScope contextKey = "api_token_scopes"
	CtxTenantID   contextKey = "api_token_tenant_id"
)

// ─── Token record (mirrors drizzle/schema.ts api_tokens) ─────────────────────

type APIToken struct {
	ID        int
	TenantID  *int
	Name      string
	Prefix    string
	Scopes    []string
	RateLimit int
	ExpiresAt *time.Time
	Active    bool
}

// ─── Kafka usage event ────────────────────────────────────────────────────────

type UsageEvent struct {
	TokenID    int    `json:"tokenId"`
	TenantID   *int   `json:"tenantId,omitempty"`
	Endpoint   string `json:"endpoint"`
	Method     string `json:"method"`
	StatusCode int    `json:"statusCode"`
	LatencyMs  int64  `json:"latencyMs"`
	IPAddress  string `json:"ipAddress"`
	Timestamp  string `json:"timestamp"`
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

type Middleware struct {
	db    *sql.DB
	redis *redis.Client
	kafka KafkaProducer
}

// KafkaProducer is a minimal interface so we can swap in the real producer.
type KafkaProducer interface {
	Publish(topic string, key string, value []byte) error
}

// NewMiddleware initialises DB, Redis, and Kafka connections.
func NewMiddleware(db *sql.DB, rdb *redis.Client, kafka KafkaProducer) *Middleware {
	return &Middleware{db: db, redis: rdb, kafka: kafka}
}

// ─── Token lookup ─────────────────────────────────────────────────────────────

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func (m *Middleware) lookupToken(ctx context.Context, tokenHash string) (*APIToken, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT id, "tenantId", name, prefix, scopes, "rateLimit", "expiresAt", active
		FROM api_tokens
		WHERE "tokenHash" = $1
	`, tokenHash)

	var t APIToken
	var scopesJSON []byte
	var tenantID sql.NullInt64
	var expiresAt sql.NullTime

	if err := row.Scan(&t.ID, &tenantID, &t.Name, &t.Prefix, &scopesJSON, &t.RateLimit, &expiresAt, &t.Active); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("token lookup: %w", err)
	}

	if tenantID.Valid {
		id := int(tenantID.Int64)
		t.TenantID = &id
	}
	if expiresAt.Valid {
		t.ExpiresAt = &expiresAt.Time
	}
	if err := json.Unmarshal(scopesJSON, &t.Scopes); err != nil {
		t.Scopes = []string{}
	}

	return &t, nil
}

// ─── Redis rate limiting (sliding window per minute) ─────────────────────────

func (m *Middleware) checkRateLimit(ctx context.Context, tokenID int, limit int) (bool, error) {
	key := fmt.Sprintf("bis:ratelimit:token:%d", tokenID)
	now := time.Now().UnixMilli()
	windowStart := now - 60_000

	pipe := m.redis.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "-inf", strconv.FormatInt(windowStart, 10))
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: strconv.FormatInt(now, 10)})
	pipe.ZCard(ctx, key)
	pipe.Expire(ctx, key, 2*time.Minute)

	results, err := pipe.Exec(ctx)
	if err != nil {
		// Fail open — if Redis is down, allow the request
		log.Printf("[apitoken] Redis error (fail open): %v", err)
		return true, nil
	}

	count := results[2].(*redis.IntCmd).Val()
	return count <= int64(limit), nil
}

// ─── Scope check ──────────────────────────────────────────────────────────────

// ScopeRequired returns a middleware that additionally checks for a required scope.
func (m *Middleware) ScopeRequired(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scopes, _ := r.Context().Value(CtxTokenScope).([]string)
			for _, s := range scopes {
				if s == scope || s == "admin:write" {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": fmt.Sprintf("Token missing required scope: %s", scope),
			})
		})
	}
}

// ─── Main middleware ──────────────────────────────────────────────────────────

// Handler wraps an http.Handler with token auth, rate limiting, and usage logging.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "Missing or invalid Authorization header. Use: Authorization: Bearer <token>",
			})
			return
		}

		rawToken := strings.TrimPrefix(authHeader, "Bearer ")
		tokenHash := hashToken(rawToken)

		token, err := m.lookupToken(r.Context(), tokenHash)
		if err != nil {
			log.Printf("[apitoken] DB lookup error: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal error"})
			return
		}
		if token == nil || !token.Active {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or revoked API token"})
			return
		}
		if token.ExpiresAt != nil && token.ExpiresAt.Before(time.Now()) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API token has expired"})
			return
		}

		// Rate limiting
		allowed, err := m.checkRateLimit(r.Context(), token.ID, token.RateLimit)
		if err != nil {
			log.Printf("[apitoken] Rate limit error: %v", err)
		}
		if !allowed {
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(token.RateLimit))
			w.Header().Set("Retry-After", "60")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error":     "Rate limit exceeded",
				"limit":     strconv.Itoa(token.RateLimit),
				"resetInMs": "60000",
			})
			return
		}

		// Inject token metadata into context
		ctx := context.WithValue(r.Context(), CtxTokenID, token.ID)
		ctx = context.WithValue(ctx, CtxTokenScope, token.Scopes)
		if token.TenantID != nil {
			ctx = context.WithValue(ctx, CtxTenantID, *token.TenantID)
		}

		// Wrap ResponseWriter to capture status code
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r.WithContext(ctx))

		// Publish usage event to Kafka (fire-and-forget)
		latencyMs := time.Since(start).Milliseconds()
		go m.publishUsageEvent(token, r, rw.statusCode, latencyMs)
	})
}

// ─── Kafka usage event publisher ─────────────────────────────────────────────

func (m *Middleware) publishUsageEvent(token *APIToken, r *http.Request, statusCode int, latencyMs int64) {
	event := UsageEvent{
		TokenID:    token.ID,
		TenantID:   token.TenantID,
		Endpoint:   r.URL.Path,
		Method:     r.Method,
		StatusCode: statusCode,
		LatencyMs:  latencyMs,
		IPAddress:  r.RemoteAddr,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
	}
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("[apitoken] Failed to marshal usage event: %v", err)
		return
	}
	key := fmt.Sprintf("token-%d", token.ID)
	if err := m.kafka.Publish("bis.api_usage", key, payload); err != nil {
		log.Printf("[apitoken] Failed to publish usage event: %v", err)
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ─── Public API v1 route registration ────────────────────────────────────────

// RegisterV1Routes mounts the /api/v1/* BIS public REST API on the given mux.
// All routes are protected by the token middleware.
// This is called from gateway main.go.
func (m *Middleware) RegisterV1Routes(mux *http.ServeMux) {
	v1 := http.NewServeMux()

	// Health
	v1.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "bis-gateway-v1"})
	})

	// Investigations (proxied to BFF tRPC)
	bffURL := envOr("BIS_BFF_URL", "http://localhost:3000")
	v1.Handle("/investigations/", m.ScopeRequired("investigations:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// KYC
	v1.Handle("/kyc/", m.ScopeRequired("kyc:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Screening
	v1.Handle("/screening/", m.ScopeRequired("screening:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Alerts
	v1.Handle("/alerts/", m.ScopeRequired("alerts:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Reports
	v1.Handle("/reports/", m.ScopeRequired("reports:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Field agents
	v1.Handle("/field-agents/", m.ScopeRequired("field_agents:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Data sources
	v1.Handle("/data-sources/", m.ScopeRequired("data_sources:read")(
		http.StripPrefix("/api/v1", proxyTo(bffURL+"/api/v1")),
	))

	// Wrap all v1 routes with token middleware
	mux.Handle("/api/v1/", m.Handler(v1))
}

// proxyTo returns a simple reverse-proxy handler to the given target base URL.
func proxyTo(target string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		url := target + r.URL.RequestURI()
		req, err := http.NewRequestWithContext(r.Context(), r.Method, url, r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Proxy error"})
			return
		}
		req.Header = r.Header.Clone()
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Upstream unavailable"})
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		buf := make([]byte, 32*1024)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
			}
			if err != nil {
				break
			}
		}
	})
}
