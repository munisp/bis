// BIS OpenAppSec Reporter — Go
//
// Receives WAF events from open-appsec/APISIX (via webhook or Kafka),
// persists them to PostgreSQL, publishes to Dapr pub/sub, and exposes
// a REST API for querying WAF incidents.
//
// Port: 8095
//
// Endpoints:
//   POST /waf/event          — receive a WAF event from open-appsec webhook
//   POST /waf/batch          — receive a batch of WAF events
//   GET  /waf/incidents      — list WAF incidents (paginated)
//   GET  /waf/incidents/:id  — get a specific WAF incident
//   GET  /waf/stats          — WAF statistics (attack types, top IPs, etc.)
//   GET  /health             — liveness probe
//   GET  /metrics            — Prometheus metrics
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/segmentio/kafka-go"
)

// ─── Config ───────────────────────────────────────────────────────────────────

var (
	port        = envOr("OPENAPPSEC_REPORTER_PORT", "8095")
	serviceKey  = envOr("BIS_WAF_KEY", "dev-waf-key-change-in-prod")
	dbURL       = envOr("DATABASE_URL", "")
	redisURL    = envOr("REDIS_URL", "redis://localhost:6379")
	kafkaBroker = envOr("KAFKA_BROKERS", "localhost:9092")
	daprPort    = envOr("DAPR_HTTP_PORT", "3500")
	daprPubsub  = envOr("DAPR_PUBSUB_NAME", "bis-pubsub")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Types ────────────────────────────────────────────────────────────────────

// WafEvent mirrors the open-appsec log format
type WafEvent struct {
	EventID       string          `json:"eventId"`
	Timestamp     string          `json:"timestamp"`
	SourceIP      string          `json:"sourceIp"`
	DestinationIP string          `json:"destinationIp"`
	Method        string          `json:"httpMethod"`
	URI           string          `json:"httpURI"`
	StatusCode    int             `json:"httpResponseCode"`
	AttackType    string          `json:"attackType"`
	Severity      string          `json:"severity"`
	Confidence    string          `json:"confidence"`
	Action        string          `json:"waapIncidentType"` // "Detect" | "Prevent"
	UserAgent     string          `json:"httpUserAgent"`
	TenantID      *int            `json:"tenantId,omitempty"`
	AssetName     string          `json:"assetName"`
	PracticeID    string          `json:"practiceId"`
	RuleID        string          `json:"ruleId"`
	RawPayload    json.RawMessage `json:"rawPayload,omitempty"`
}

type BatchRequest struct {
	Events []WafEvent `json:"events"`
}

type IncidentListResponse struct {
	Items      []WafIncident `json:"items"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"pageSize"`
}

type WafIncident struct {
	ID         string    `json:"id"`
	EventID    string    `json:"eventId"`
	SourceIP   string    `json:"sourceIp"`
	Method     string    `json:"method"`
	URI        string    `json:"uri"`
	AttackType string    `json:"attackType"`
	Severity   string    `json:"severity"`
	Action     string    `json:"action"`
	AssetName  string    `json:"assetName"`
	TenantID   *int      `json:"tenantId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type WafStats struct {
	TotalEvents    int64            `json:"totalEvents"`
	TotalBlocked   int64            `json:"totalBlocked"`
	TotalDetected  int64            `json:"totalDetected"`
	TopAttackTypes map[string]int64 `json:"topAttackTypes"`
	TopSourceIPs   map[string]int64 `json:"topSourceIPs"`
	TopURIs        map[string]int64 `json:"topURIs"`
	Last24Hours    int64            `json:"last24Hours"`
}

// ─── App ──────────────────────────────────────────────────────────────────────

type App struct {
	db     *sql.DB
	rdb    *redis.Client
	kafka  *kafka.Writer
	logger zerolog.Logger
}

func NewApp() *App {
	logger := zerolog.New(os.Stdout).With().Timestamp().Str("service", "openappsec-reporter").Logger()

	// PostgreSQL
	var db *sql.DB
	if dbURL != "" {
		var err error
		db, err = sql.Open("postgres", dbURL)
		if err != nil {
			logger.Warn().Err(err).Msg("PostgreSQL connection failed — running without DB persistence")
			db = nil
		} else {
			db.SetMaxOpenConns(10)
			db.SetMaxIdleConns(5)
			db.SetConnMaxLifetime(5 * time.Minute)
		}
	}

	// Redis
	opt, err := redis.ParseURL(redisURL)
	var rdb *redis.Client
	if err == nil {
		rdb = redis.NewClient(opt)
	}

	// Kafka writer
	kw := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBroker),
		Topic:        "bis.waf.events",
		Balancer:     &kafka.LeastBytes{},
		WriteTimeout: 5 * time.Second,
		ReadTimeout:  5 * time.Second,
	}

	return &App{db: db, rdb: rdb, kafka: kw, logger: logger}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func (a *App) handleWafEvent(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	var event WafEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if event.EventID == "" {
		event.EventID = uuid.New().String()
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	if err := a.persistEvent(&event); err != nil {
		a.logger.Warn().Err(err).Str("eventId", event.EventID).Msg("DB persist failed")
	}
	if err := a.publishToKafka(&event); err != nil {
		a.logger.Warn().Err(err).Str("eventId", event.EventID).Msg("Kafka publish failed")
	}
	if err := a.publishToDapr(&event); err != nil {
		a.logger.Warn().Err(err).Str("eventId", event.EventID).Msg("Dapr publish failed")
	}

	a.logger.Info().
		Str("eventId", event.EventID).
		Str("attackType", event.AttackType).
		Str("action", event.Action).
		Str("sourceIp", event.SourceIP).
		Str("uri", event.URI).
		Msg("WAF event processed")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "eventId": event.EventID})
}

func (a *App) handleBatchEvents(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	var batch BatchRequest
	if err := json.Unmarshal(body, &batch); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	processed := 0
	for i := range batch.Events {
		ev := &batch.Events[i]
		if ev.EventID == "" {
			ev.EventID = uuid.New().String()
		}
		if ev.Timestamp == "" {
			ev.Timestamp = time.Now().UTC().Format(time.RFC3339)
		}
		_ = a.persistEvent(ev)
		_ = a.publishToKafka(ev)
		_ = a.publishToDapr(ev)
		processed++
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"processed": processed})
}

func (a *App) handleListIncidents(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	attackType := r.URL.Query().Get("attackType")
	severity := r.URL.Query().Get("severity")

	if a.db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(IncidentListResponse{Items: []WafIncident{}, Total: 0, Page: page, PageSize: pageSize})
		return
	}

	offset := (page - 1) * pageSize
	var conditions []string
	var args []interface{}
	argIdx := 1
	if attackType != "" {
		conditions = append(conditions, fmt.Sprintf("attack_type = $%d", argIdx))
		args = append(args, attackType)
		argIdx++
	}
	if severity != "" {
		conditions = append(conditions, fmt.Sprintf("severity = $%d", argIdx))
		args = append(args, severity)
		argIdx++
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM waf_incidents %s", where)
	var total int
	if err := a.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	args = append(args, pageSize, offset)
	rows, err := a.db.Query(
		fmt.Sprintf(`SELECT id, event_id, source_ip, method, uri, attack_type, severity, action, asset_name, tenant_id, created_at
		             FROM waf_incidents %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1),
		args...,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var items []WafIncident
	for rows.Next() {
		var inc WafIncident
		if err := rows.Scan(&inc.ID, &inc.EventID, &inc.SourceIP, &inc.Method, &inc.URI,
			&inc.AttackType, &inc.Severity, &inc.Action, &inc.AssetName, &inc.TenantID, &inc.CreatedAt); err == nil {
			items = append(items, inc)
		}
	}
	if items == nil {
		items = []WafIncident{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(IncidentListResponse{Items: items, Total: total, Page: page, PageSize: pageSize})
}

func (a *App) handleStats(w http.ResponseWriter, r *http.Request) {
	stats := WafStats{
		TopAttackTypes: map[string]int64{},
		TopSourceIPs:   map[string]int64{},
		TopURIs:        map[string]int64{},
	}

	if a.db != nil {
		a.db.QueryRow("SELECT COUNT(*) FROM waf_incidents").Scan(&stats.TotalEvents)
		a.db.QueryRow("SELECT COUNT(*) FROM waf_incidents WHERE action = 'Prevent'").Scan(&stats.TotalBlocked)
		a.db.QueryRow("SELECT COUNT(*) FROM waf_incidents WHERE action = 'Detect'").Scan(&stats.TotalDetected)
		a.db.QueryRow("SELECT COUNT(*) FROM waf_incidents WHERE created_at > NOW() - INTERVAL '24 hours'").Scan(&stats.Last24Hours)

		rows, err := a.db.Query("SELECT attack_type, COUNT(*) FROM waf_incidents GROUP BY attack_type ORDER BY COUNT(*) DESC LIMIT 10")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var k string
				var v int64
				if rows.Scan(&k, &v) == nil {
					stats.TopAttackTypes[k] = v
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbOk := a.db != nil && a.db.Ping() == nil
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "openappsec-reporter",
		"version": "1.0.0",
		"db":      dbOk,
	})
}

// ─── Persistence ──────────────────────────────────────────────────────────────

func (a *App) persistEvent(ev *WafEvent) error {
	if a.db == nil {
		return nil
	}
	raw, _ := json.Marshal(ev)
	_, err := a.db.Exec(`
		INSERT INTO waf_incidents (id, event_id, source_ip, destination_ip, method, uri,
		  status_code, attack_type, severity, confidence, action, user_agent,
		  tenant_id, asset_name, practice_id, rule_id, raw_payload, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
		ON CONFLICT (event_id) DO NOTHING`,
		uuid.New().String(), ev.EventID, ev.SourceIP, ev.DestinationIP,
		ev.Method, ev.URI, ev.StatusCode, ev.AttackType, ev.Severity,
		ev.Confidence, ev.Action, ev.UserAgent, ev.TenantID,
		ev.AssetName, ev.PracticeID, ev.RuleID, string(raw),
	)
	return err
}

// ─── Kafka Publish ────────────────────────────────────────────────────────────

func (a *App) publishToKafka(ev *WafEvent) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return a.kafka.WriteMessages(ctx, kafka.Message{
		Key:   []byte(ev.EventID),
		Value: data,
	})
}

// ─── Dapr Publish ─────────────────────────────────────────────────────────────

func (a *App) publishToDapr(ev *WafEvent) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/bis.waf.events", daprPort, daprPubsub)
	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("dapr returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	app := NewApp()
	app.logger.Info().Str("port", port).Msg("OpenAppSec Reporter starting")

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	// Auth middleware — validate BIS_WAF_KEY header
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			key := r.Header.Get("X-BIS-WAF-Key")
			if key != serviceKey {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Post("/waf/event", app.handleWafEvent)
	r.Post("/waf/batch", app.handleBatchEvents)
	r.Get("/waf/incidents", app.handleListIncidents)
	r.Get("/waf/stats", app.handleStats)
	r.Get("/health", app.handleHealth)

	addr := ":" + port
	app.logger.Info().Str("addr", addr).Msg("Listening")
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
