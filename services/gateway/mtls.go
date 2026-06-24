package main

// mtls.go — mTLS peer certificate validation middleware for BIS Go API Gateway
//
// Provides:
//   1. mTLS server configuration (require and verify client certificates)
//   2. HTTP middleware that validates the peer certificate CN/SAN against an
//      allowlist of trusted internal services
//   3. Privileged-access time-window enforcement middleware
//   4. Per-service rate-limit middleware backed by an in-memory token bucket
//
// In production, the TLS certificate pool is loaded from a mounted Kubernetes
// secret or a Vault PKI mount. In development, the middleware can be disabled
// by setting BIS_MTLS_DISABLED=true.

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── mTLS configuration ───────────────────────────────────────────────────────

// TrustedServiceCNs is the allowlist of certificate Common Names (or DNS SANs)
// that are permitted to call privileged inter-service endpoints.
var TrustedServiceCNs = []string{
	"bis-risk-engine",
	"bis-event-processor",
	"bis-aml-engine",
	"bis-case-manager",
	"bis-biometric-engine",
	"bis-payment-rails",
	"bis-fluvio-velocity",
	"bis-bff",
}

// BuildMTLSConfig returns a *tls.Config that requires and verifies client
// certificates signed by the CA bundle at caPath.
// If caPath is empty or BIS_MTLS_DISABLED=true, returns nil (mTLS disabled).
func BuildMTLSConfig(caPath string) (*tls.Config, error) {
	if os.Getenv("BIS_MTLS_DISABLED") == "true" || caPath == "" {
		return nil, nil
	}
	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("mtls: read CA bundle %q: %w", caPath, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("mtls: no valid certificates found in %q", caPath)
	}
	return &tls.Config{
		ClientAuth: tls.RequireAndVerifyClientCert,
		ClientCAs:  pool,
		MinVersion: tls.VersionTLS13,
	}, nil
}

// ─── mTLS peer-validation middleware ─────────────────────────────────────────

// MTLSMiddleware validates that the TLS peer certificate CN or DNS SANs match
// one of the trusted service names. Requests without a valid peer cert are
// rejected with 401. Pass next to chain additional handlers.
func MTLSMiddleware(next http.Handler) http.Handler {
	if os.Getenv("BIS_MTLS_DISABLED") == "true" {
		return next // disabled in dev/test
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, `{"error":"mTLS peer certificate required"}`, http.StatusUnauthorized)
			return
		}
		cert := r.TLS.PeerCertificates[0]
		if !isTrustedCert(cert) {
			http.Error(w, `{"error":"untrusted peer certificate"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isTrustedCert(cert *x509.Certificate) bool {
	// Check Common Name
	for _, trusted := range TrustedServiceCNs {
		if cert.Subject.CommonName == trusted {
			return true
		}
	}
	// Check DNS SANs
	for _, san := range cert.DNSNames {
		for _, trusted := range TrustedServiceCNs {
			if san == trusted {
				return true
			}
		}
	}
	return false
}

// ─── Privileged-access time-window middleware ─────────────────────────────────

// PrivilegedTimeWindowMiddleware blocks requests to admin/privileged endpoints
// outside the configured UTC hour window.
// Environment variables:
//   BIS_PRIV_START_HOUR  (default: 6)   — inclusive start hour (UTC)
//   BIS_PRIV_END_HOUR    (default: 22)  — exclusive end hour (UTC)
func PrivilegedTimeWindowMiddleware(next http.Handler) http.Handler {
	startHour := envInt("BIS_PRIV_START_HOUR", 6)
	endHour   := envInt("BIS_PRIV_END_HOUR", 22)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hour := time.Now().UTC().Hour()
		if hour < startHour || hour >= endHour {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = fmt.Fprintf(w,
				`{"error":"privileged access only permitted %02d:00–%02d:00 UTC","utc_hour":%d}`,
				startHour, endHour, hour,
			)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// ─── Per-service token-bucket rate limiter ────────────────────────────────────

// tokenBucket is a simple per-key token bucket.
type tokenBucket struct {
	mu       sync.Mutex
	tokens   map[string]*bucket
	capacity int
	refillPS int // tokens per second
}

type bucket struct {
	tokens    float64
	lastRefil time.Time
}

func newTokenBucket(capacity, refillPerSecond int) *tokenBucket {
	return &tokenBucket{
		tokens:   make(map[string]*bucket),
		capacity: capacity,
		refillPS: refillPerSecond,
	}
}

func (tb *tokenBucket) Allow(key string) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	b, ok := tb.tokens[key]
	if !ok {
		b = &bucket{tokens: float64(tb.capacity), lastRefil: time.Now()}
		tb.tokens[key] = b
	}

	now := time.Now()
	elapsed := now.Sub(b.lastRefil).Seconds()
	b.tokens = min64(float64(tb.capacity), b.tokens+elapsed*float64(tb.refillPS))
	b.lastRefil = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func min64(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// Global rate limiter: 100 req/s capacity, refills at 50 req/s per service CN.
var serviceRateLimiter = newTokenBucket(100, 50)

// ServiceRateLimitMiddleware applies per-service rate limiting using the
// peer certificate CN as the key. Falls back to remote IP if mTLS is disabled.
func ServiceRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "anonymous"
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			key = r.TLS.PeerCertificates[0].Subject.CommonName
		} else {
			// Use X-Forwarded-For or RemoteAddr as fallback
			key = r.Header.Get("X-Forwarded-For")
			if key == "" {
				key = strings.Split(r.RemoteAddr, ":")[0]
			}
		}

		if !serviceRateLimiter.Allow(key) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = fmt.Fprintf(w, `{"error":"rate limit exceeded","service":%q}`, key)
			return
		}
		next.ServeHTTP(w, r)
	})
}
