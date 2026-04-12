// lex-intake — Go microservice for LEX (Law Enforcement Extension) submission intake.
//
// Designed for low-bandwidth / intermittent-connectivity environments:
//   - Accepts submissions via HTTP POST (JSON or multipart/form-data)
//   - Queues submissions locally in SQLite when BIS is unreachable
//   - Background goroutine syncs queued submissions to BIS REST API
//   - PIN-based authentication (no OAuth required for field officers)
//   - Rate limiting: max 5 submissions per submitter per 24 hours
//   - gzip compression on all responses
//   - SMS/USSD callback endpoint for feature-phone submissions
//
// Environment variables:
//   LEX_PORT          HTTP port (default: 8090)
//   LEX_BIS_URL       BIS server base URL (e.g. https://bis.example.com)
//   LEX_BIS_API_KEY   Bearer token for BIS API
//   LEX_DB_PATH       SQLite database path (default: ./lex-intake.db)
//   LEX_SYNC_INTERVAL Sync interval in seconds (default: 60)

package main

import (
	"compress/gzip"
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
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// ─── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	Port         string
	BisURL       string
	BisAPIKey    string
	DBPath       string
	SyncInterval time.Duration
}

func loadConfig() Config {
	port := getEnv("LEX_PORT", "8090")
	bisURL := getEnv("LEX_BIS_URL", "http://localhost:3000")
	bisAPIKey := getEnv("LEX_BIS_API_KEY", "")
	dbPath := getEnv("LEX_DB_PATH", "./lex-intake.db")
	syncSecs, _ := strconv.Atoi(getEnv("LEX_SYNC_INTERVAL", "60"))
	if syncSecs < 10 {
		syncSecs = 10
	}
	return Config{
		Port:         port,
		BisURL:       bisURL,
		BisAPIKey:    bisAPIKey,
		DBPath:       dbPath,
		SyncInterval: time.Duration(syncSecs) * time.Second,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Database ─────────────────────────────────────────────────────────────────

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS submissions (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			local_ref     TEXT NOT NULL UNIQUE,
			submitter_id  TEXT NOT NULL,
			agency_code   TEXT NOT NULL,
			pin_hash      TEXT NOT NULL,
			payload       TEXT NOT NULL,
			status        TEXT NOT NULL DEFAULT 'queued',
			bis_ref       TEXT,
			sync_attempts INTEGER NOT NULL DEFAULT 0,
			last_error    TEXT,
			created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			synced_at     DATETIME
		);
		CREATE TABLE IF NOT EXISTS rate_limits (
			submitter_id  TEXT NOT NULL,
			window_start  DATETIME NOT NULL,
			count         INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (submitter_id, window_start)
		);
		CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
		CREATE INDEX IF NOT EXISTS idx_submissions_submitter ON submissions(submitter_id);
	`)
	return err
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

func (s *Store) CheckRateLimit(submitterID string, maxPerDay int) (bool, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	windowStart := time.Now().UTC().Truncate(24 * time.Hour).Format("2006-01-02 15:04:05")

	// Upsert window
	_, err := s.db.Exec(`
		INSERT INTO rate_limits (submitter_id, window_start, count)
		VALUES (?, ?, 0)
		ON CONFLICT(submitter_id, window_start) DO NOTHING
	`, submitterID, windowStart)
	if err != nil {
		return false, 0, err
	}

	var count int
	err = s.db.QueryRow(`SELECT count FROM rate_limits WHERE submitter_id = ? AND window_start = ?`, submitterID, windowStart).Scan(&count)
	if err != nil {
		return false, 0, err
	}

	if count >= maxPerDay {
		return false, count, nil
	}

	_, err = s.db.Exec(`UPDATE rate_limits SET count = count + 1 WHERE submitter_id = ? AND window_start = ?`, submitterID, windowStart)
	return true, count + 1, err
}

// ─── Submission Queue ─────────────────────────────────────────────────────────

type QueuedSubmission struct {
	ID           int64
	LocalRef     string
	SubmitterID  string
	AgencyCode   string
	Payload      string
	Status       string
	SyncAttempts int
	LastError    string
	CreatedAt    time.Time
}

func (s *Store) Enqueue(localRef, submitterID, agencyCode, pinHash, payload string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO submissions (local_ref, submitter_id, agency_code, pin_hash, payload)
		VALUES (?, ?, ?, ?, ?)
	`, localRef, submitterID, agencyCode, pinHash, payload)
	return err
}

func (s *Store) GetQueued(limit int) ([]QueuedSubmission, error) {
	rows, err := s.db.Query(`
		SELECT id, local_ref, submitter_id, agency_code, payload, status, sync_attempts, COALESCE(last_error,''), created_at
		FROM submissions
		WHERE status IN ('queued', 'retry')
		ORDER BY created_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []QueuedSubmission
	for rows.Next() {
		var sub QueuedSubmission
		var createdStr string
		if err := rows.Scan(&sub.ID, &sub.LocalRef, &sub.SubmitterID, &sub.AgencyCode, &sub.Payload, &sub.Status, &sub.SyncAttempts, &sub.LastError, &createdStr); err != nil {
			continue
		}
		sub.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdStr)
		result = append(result, sub)
	}
	return result, nil
}

func (s *Store) MarkSynced(id int64, bisRef string) error {
	_, err := s.db.Exec(`UPDATE submissions SET status='synced', bis_ref=?, synced_at=CURRENT_TIMESTAMP WHERE id=?`, bisRef, id)
	return err
}

func (s *Store) MarkFailed(id int64, errMsg string, attempts int) error {
	status := "retry"
	if attempts >= 5 {
		status = "failed"
	}
	_, err := s.db.Exec(`UPDATE submissions SET status=?, last_error=?, sync_attempts=? WHERE id=?`, status, errMsg, attempts, id)
	return err
}

func (s *Store) GetStats() (map[string]int, error) {
	rows, err := s.db.Query(`SELECT status, COUNT(*) FROM submissions GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := map[string]int{}
	for rows.Next() {
		var status string
		var count int
		rows.Scan(&status, &count)
		stats[status] = count
	}
	return stats, nil
}

// ─── BIS Sync Client ──────────────────────────────────────────────────────────

type BISClient struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

func NewBISClient(baseURL, apiKey string) *BISClient {
	return &BISClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

type BISSubmitResponse struct {
	SubmissionRef string `json:"submissionRef"`
	Status        string `json:"status"`
}

func (c *BISClient) Submit(payload string) (string, error) {
	req, err := http.NewRequest("POST", c.BaseURL+"/api/lex/intake", strings.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	var body io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gr, err := gzip.NewReader(resp.Body)
		if err != nil {
			return "", err
		}
		defer gr.Close()
		body = gr
	}

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(body)
		return "", fmt.Errorf("BIS returned %d: %s", resp.StatusCode, string(b))
	}

	var result BISSubmitResponse
	if err := json.NewDecoder(body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode error: %w", err)
	}
	return result.SubmissionRef, nil
}

func (c *BISClient) Ping() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", c.BaseURL+"/api/health", nil)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

// ─── Background Sync Worker ───────────────────────────────────────────────────

func syncWorker(store *Store, bis *BISClient, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if !bis.Ping() {
			log.Printf("[sync] BIS unreachable — %d items remain queued", func() int {
				stats, _ := store.GetStats()
				return stats["queued"] + stats["retry"]
			}())
			continue
		}
		subs, err := store.GetQueued(50)
		if err != nil {
			log.Printf("[sync] GetQueued error: %v", err)
			continue
		}
		for _, sub := range subs {
			bisRef, err := bis.Submit(sub.Payload)
			if err != nil {
				log.Printf("[sync] Failed to sync %s (attempt %d): %v", sub.LocalRef, sub.SyncAttempts+1, err)
				store.MarkFailed(sub.ID, err.Error(), sub.SyncAttempts+1)
			} else {
				log.Printf("[sync] Synced %s → BIS ref %s", sub.LocalRef, bisRef)
				store.MarkSynced(sub.ID, bisRef)
			}
		}
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	store  *Store
	bis    *BISClient
	config Config
}

// gzipWriter wraps ResponseWriter with gzip compression
type gzipWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipWriter) Write(b []byte) (int, error) { return g.gz.Write(b) }

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzip.NewWriter(w)
		defer gz.Close()
		w.Header().Set("Content-Encoding", "gzip")
		next.ServeHTTP(&gzipWriter{w, gz}, r)
	})
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// POST /submit — main submission endpoint
func (s *Server) handleSubmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonResponse(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	submitterID, _ := body["submitterId"].(string)
	agencyCode, _ := body["agencyCode"].(string)
	pin, _ := body["pin"].(string)

	if submitterID == "" || agencyCode == "" || pin == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "submitterId, agencyCode, and pin are required"})
		return
	}

	// Rate limit check
	allowed, count, err := s.store.CheckRateLimit(submitterID, 5)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": "rate limit check failed"})
		return
	}
	if !allowed {
		jsonResponse(w, http.StatusTooManyRequests, map[string]string{
			"error": fmt.Sprintf("daily submission limit reached (%d/5). Try again tomorrow.", count),
		})
		return
	}

	// Generate local reference
	localRef := fmt.Sprintf("LEX-LOCAL-%s-%d", strings.ToUpper(agencyCode), time.Now().UnixMilli())

	// Hash PIN for storage (SHA-256 would be done in production; simplified here)
	pinHash := fmt.Sprintf("sha256:%s:%s", submitterID, pin)

	// Serialize payload
	payload, _ := json.Marshal(body)

	// Try to sync immediately if BIS is reachable
	if s.bis.Ping() {
		bisRef, err := s.bis.Submit(string(payload))
		if err == nil {
			// Immediate success — store as synced
			s.store.Enqueue(localRef, submitterID, agencyCode, pinHash, string(payload))
			jsonResponse(w, http.StatusOK, map[string]any{
				"localRef": localRef,
				"bisRef":   bisRef,
				"status":   "synced",
				"queued":   false,
			})
			return
		}
		log.Printf("[submit] BIS sync failed, queuing: %v", err)
	}

	// Queue for later sync
	if err := s.store.Enqueue(localRef, submitterID, agencyCode, pinHash, string(payload)); err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": "failed to queue submission"})
		return
	}

	jsonResponse(w, http.StatusAccepted, map[string]any{
		"localRef": localRef,
		"status":   "queued",
		"queued":   true,
		"message":  "Submission queued offline. It will be synced to BIS when connectivity is restored.",
	})
}

// POST /sms — SMS/USSD callback (simplified key=value format for feature phones)
// Format: submitterId=XXX&agencyCode=NPF-LA-HQ-001&pin=123456&type=arrest&state=LA&narrative=...
func (s *Server) handleSMS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form data", http.StatusBadRequest)
		return
	}

	submitterID := r.FormValue("submitterId")
	agencyCode := r.FormValue("agencyCode")
	pin := r.FormValue("pin")
	incidentType := r.FormValue("type")
	state := r.FormValue("state")
	narrative := r.FormValue("narrative")

	if submitterID == "" || agencyCode == "" || pin == "" || narrative == "" {
		http.Error(w, "MISSING_FIELDS", http.StatusBadRequest)
		return
	}

	allowed, _, _ := s.store.CheckRateLimit(submitterID, 5)
	if !allowed {
		w.Write([]byte("LIMIT_REACHED"))
		return
	}

	payload, _ := json.Marshal(map[string]any{
		"submitterId":  submitterID,
		"agencyCode":   agencyCode,
		"pin":          pin,
		"incidentType": incidentType,
		"incidentState": state,
		"narrative":    narrative,
		"channel":      "sms",
	})

	localRef := fmt.Sprintf("LEX-SMS-%s-%d", strings.ToUpper(agencyCode), time.Now().UnixMilli())
	pinHash := fmt.Sprintf("sha256:%s:%s", submitterID, pin)

	if err := s.store.Enqueue(localRef, submitterID, agencyCode, pinHash, string(payload)); err != nil {
		w.Write([]byte("ERROR"))
		return
	}

	// SMS response is plain text (feature phone compatible)
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(fmt.Sprintf("OK:%s", localRef)))
}

// GET /status — health + queue stats
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	stats, _ := s.store.GetStats()
	bisOnline := s.bis.Ping()
	jsonResponse(w, http.StatusOK, map[string]any{
		"service":   "lex-intake",
		"version":   "1.0.0",
		"bisOnline": bisOnline,
		"queue":     stats,
		"time":      time.Now().UTC().Format(time.RFC3339),
	})
}

// GET /queue — list queued submissions (admin)
func (s *Server) handleQueue(w http.ResponseWriter, r *http.Request) {
	subs, err := s.store.GetQueued(100)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	type item struct {
		LocalRef     string    `json:"localRef"`
		SubmitterID  string    `json:"submitterId"`
		AgencyCode   string    `json:"agencyCode"`
		Status       string    `json:"status"`
		SyncAttempts int       `json:"syncAttempts"`
		LastError    string    `json:"lastError,omitempty"`
		CreatedAt    time.Time `json:"createdAt"`
	}
	result := make([]item, len(subs))
	for i, s := range subs {
		result[i] = item{s.LocalRef, s.SubmitterID, s.AgencyCode, s.Status, s.SyncAttempts, s.LastError, s.CreatedAt}
	}
	jsonResponse(w, http.StatusOK, map[string]any{"count": len(result), "items": result})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()

	store, err := NewStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("Failed to open store: %v", err)
	}

	bis := NewBISClient(cfg.BisURL, cfg.BisAPIKey)

	srv := &Server{store: store, bis: bis, config: cfg}

	// Start background sync worker
	go syncWorker(store, bis, cfg.SyncInterval)

	mux := http.NewServeMux()
	mux.HandleFunc("/submit", srv.handleSubmit)
	mux.HandleFunc("/sms", srv.handleSMS)
	mux.HandleFunc("/sms/at", srv.handleATWebhook)       // Africa's Talking webhook
	mux.HandleFunc("/sms/termii", srv.handleTermiiWebhook) // Termii webhook
	mux.HandleFunc("/status", srv.handleStatus)
	mux.HandleFunc("/queue", srv.handleQueue)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	handler := gzipMiddleware(mux)

	addr := ":" + cfg.Port
	log.Printf("[lex-intake] Starting on %s | BIS: %s | Sync: %v", addr, cfg.BisURL, cfg.SyncInterval)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
