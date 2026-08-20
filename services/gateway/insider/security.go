package insider

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Config controls the gateway's insider-threat protections. Production callers
// must configure break-glass and dual-control credentials from their secret
// store; an empty credential never authorizes privileged access.
type Config struct {
	AllowedCIDRs      []string
	TrustedProxyCIDRs []string
	BreakGlassSecret  string
	ApproverSecret    string
	DualControlPaths  []string
	RequireMTLS       bool
	WorkingHoursStart int
	WorkingHoursEnd   int
	OPAURL            string
	BreakGlassAuditURL string
	GatewayAuditKey   string
}

func DefaultConfig() Config {
	return Config{
		AllowedCIDRs:      splitCSV(os.Getenv("BIS_GATEWAY_ALLOWED_CIDRS")),
		TrustedProxyCIDRs: []string{"127.0.0.0/8", "::1/128"},
		BreakGlassSecret:  os.Getenv("BIS_BREAK_GLASS_SECRET"),
		ApproverSecret:    os.Getenv("BIS_DUAL_CONTROL_APPROVER_SECRET"),
		DualControlPaths:  splitCSV(os.Getenv("BIS_DUAL_CONTROL_PATHS")),
		RequireMTLS:       os.Getenv("BIS_GATEWAY_REQUIRE_MTLS") == "true",
		WorkingHoursStart: 8,
		WorkingHoursEnd:   18,
		OPAURL:            os.Getenv("OPA_URL"),
		BreakGlassAuditURL: os.Getenv("BIS_BREAK_GLASS_AUDIT_URL"),
		GatewayAuditKey:   os.Getenv("BIS_GATEWAY_KEY"),
	}
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			result = append(result, item)
		}
	}
	return result
}

// Middleware applies request-level controls for privileged gateway operations.
type Middleware struct{ config Config }

func New(config Config) *Middleware { return &Middleware{config: config} }

func (m *Middleware) AnomalousIPBlock(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(m.config.AllowedCIDRs) == 0 || ipInCIDRs(m.clientIP(r), m.config.AllowedCIDRs) {
			next.ServeHTTP(w, r)
			return
		}
		http.Error(w, "client address is not authorized", http.StatusForbidden)
	})
}

func (m *Middleware) PrivilegedAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isPrivilegedPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if !secureEquals(r.Header.Get("X-BIS-BreakGlass"), m.config.BreakGlassSecret) {
			http.Error(w, "break-glass authorization required", http.StatusForbidden)
			return
		}
		if pathMatches(r.URL.Path, m.config.DualControlPaths) && !secureEquals(r.Header.Get("X-BIS-Approver"), m.config.ApproverSecret) {
			http.Error(w, "dual-control authorization required", http.StatusForbidden)
			return
		}
		audit, err := m.authorizeBreakGlass(r)
		if err != nil {
			http.Error(w, "break-glass policy authorization denied", http.StatusForbidden)
			return
		}
		if err := m.sendAuditWithRetry(audit, "break_glass_authorized"); err != nil {
			http.Error(w, "break-glass audit evidence unavailable", http.StatusServiceUnavailable)
			return
		}
		// A durable execution queue record must exist before the protected handler
		// can cause a side effect. A recovery worker can reconcile queued events if
		// completion delivery is interrupted after the downstream call returns.
		if err := m.sendAuditWithRetry(audit, "break_glass_execution_queued"); err != nil {
			http.Error(w, "break-glass execution queue unavailable", http.StatusServiceUnavailable)
			return
		}
		capture := &statusCapture{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(capture, r)
		if capture.status < http.StatusBadRequest {
			if err := m.sendAuditWithRetry(audit, "break_glass_executed"); err != nil {
				// Do not write after the protected handler may have committed its HTTP
				// response. The previously durable queue event preserves recovery work.
				log.Printf("break-glass completion audit delivery failed for %s: %v", audit.AuditID, err)
			}
		}
	})
}

type statusCapture struct {
	http.ResponseWriter
	status int
}

func (w *statusCapture) WriteHeader(status int) { w.status = status; w.ResponseWriter.WriteHeader(status) }

type breakGlassAudit struct {
	AuditID    string `json:"auditId"`
	ActorID    string `json:"actorId"`
	ApproverID string `json:"approverId"`
	Path       string `json:"path"`
	Reason     string `json:"reason"`
	Policy     string `json:"policy"`
	Decision   string `json:"decision"`
	DecidedAt  string `json:"decidedAt"`
	EventType  string `json:"eventType"`
}

func (m *Middleware) authorizeBreakGlass(r *http.Request) (breakGlassAudit, error) {
	actorID := strings.TrimSpace(r.Header.Get("X-BIS-User-ID"))
	approverID := strings.TrimSpace(r.Header.Get("X-BIS-Approver-ID"))
	reason := strings.TrimSpace(r.Header.Get("X-BIS-BreakGlass-Reason"))
	roles := strings.ToLower(r.Header.Get("X-BIS-User-Roles"))
	if m.config.OPAURL == "" || m.config.BreakGlassAuditURL == "" || m.config.GatewayAuditKey == "" || actorID == "" || approverID == "" || actorID == approverID || len(reason) < 10 || !strings.Contains(roles, "bis-admin") || r.Header.Get("X-BIS-MFA-Verified") != "keycloak-totp-required" {
		return breakGlassAudit{}, fmt.Errorf("required break-glass attributes are missing")
	}
	decisionInput := map[string]any{
		"input": map[string]any{
			"type": "gateway", "action": "gateway_break_glass", "mfaPassed": true,
			"actorId": actorID, "approverId": approverID, "reason": reason,
			"request": map[string]any{"method": r.Method, "path": r.URL.Path, "headers": map[string]string{"x-bis-user-roles": roles, "x-bis-security-stack": "caddy,open-appsec,apisix"}},
		},
	}
	body, _ := json.Marshal(decisionInput)
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Post(strings.TrimRight(m.config.OPAURL, "/")+"/v1/data/bis/authz", "application/json", bytes.NewReader(body))
	if err != nil { return breakGlassAudit{}, err }
	defer resp.Body.Close()
	var decision struct { Result struct { Allow bool `json:"allow"` } `json:"result"` }
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&decision) != nil || !decision.Result.Allow { return breakGlassAudit{}, fmt.Errorf("OPA denied break-glass request") }
	bytesID := make([]byte, 16)
	if _, err := rand.Read(bytesID); err != nil { return breakGlassAudit{}, err }
	return breakGlassAudit{AuditID: hex.EncodeToString(bytesID), ActorID: actorID, ApproverID: approverID, Path: r.URL.Path, Reason: reason, Policy: "bis/authz", Decision: "allow", DecidedAt: time.Now().UTC().Format(time.RFC3339Nano)}, nil
}

func (m *Middleware) sendAuditWithRetry(audit breakGlassAudit, eventType string) error {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if err := m.sendAudit(audit, eventType); err == nil { return nil } else { last = err }
		if attempt < 2 { time.Sleep(time.Duration(attempt+1) * 50 * time.Millisecond) }
	}
	return last
}

func (m *Middleware) sendAudit(audit breakGlassAudit, eventType string) error {
	audit.EventType = eventType
	body, err := json.Marshal(audit)
	if err != nil { return err }
	mac := hmac.New(sha256.New, []byte(m.config.GatewayAuditKey))
	_, _ = mac.Write(body)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(m.config.BreakGlassAuditURL, "/"), bytes.NewReader(body))
	if err != nil { return err }
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Gateway-Signature", hex.EncodeToString(mac.Sum(nil)))
	resp, err := (&http.Client{Timeout: time.Second}).Do(req)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated { data, _ := io.ReadAll(io.LimitReader(resp.Body, 1024)); return fmt.Errorf("audit sink returned %d: %s", resp.StatusCode, string(data)) }
	return nil
}

func (m *Middleware) MTLSVerify(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.config.RequireMTLS || verifiedClientCertificate(r.TLS) {
			next.ServeHTTP(w, r)
			return
		}
		http.Error(w, "mutual TLS client certificate required", http.StatusUnauthorized)
	})
}

func verifiedClientCertificate(state *tls.ConnectionState) bool {
	return state != nil && len(state.VerifiedChains) > 0 && len(state.PeerCertificates) > 0
}

func (m *Middleware) clientIP(r *http.Request) net.IP {
	peer := parseRemoteIP(r.RemoteAddr)
	if peer != nil && ipInCIDRs(peer, m.config.TrustedProxyCIDRs) {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
			if ip := net.ParseIP(forwarded); ip != nil {
				return ip
			}
		}
	}
	return peer
}

func parseRemoteIP(remote string) net.IP {
	host, _, err := net.SplitHostPort(remote)
	if err == nil {
		return net.ParseIP(host)
	}
	return net.ParseIP(remote)
}

func ipInCIDRs(ip net.IP, cidrs []string) bool {
	if ip == nil {
		return false
	}
	for _, raw := range cidrs {
		_, network, err := net.ParseCIDR(raw)
		if err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

func secureEquals(given, expected string) bool {
	if given == "" || expected == "" || len(given) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(given), []byte(expected)) == 1
}

func isPrivilegedPath(path string) bool {
	return strings.HasPrefix(path, "/v1/admin/") || strings.HasPrefix(path, "/v1/force-credit/")
}

func pathMatches(path string, configured []string) bool {
	for _, item := range configured {
		if path == item {
			return true
		}
	}
	return false
}

// ExfilTracker is process-local telemetry for identifying bursts before they
// are emitted to the durable event processor. It is deliberately not an
// authorization source of truth.
type ExfilTracker struct {
	mu      sync.Mutex
	window  time.Duration
	limit   int64
	entries map[string]exfilEntry
}

type exfilEntry struct {
	started time.Time
	bytes   int64
}

func NewExfilTracker(windowSeconds int, byteLimit int64) *ExfilTracker {
	return &ExfilTracker{window: time.Duration(windowSeconds) * time.Second, limit: byteLimit, entries: make(map[string]exfilEntry)}
}

func (t *ExfilTracker) Record(subject string, bytes int64) (bool, int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	entry := t.entries[subject]
	if entry.started.IsZero() || now.Sub(entry.started) >= t.window {
		entry = exfilEntry{started: now}
	}
	entry.bytes += bytes
	t.entries[subject] = entry
	return entry.bytes > t.limit, entry.bytes
}

type RiskScorer struct{ config Config }

func NewRiskScorer(config Config) *RiskScorer { return &RiskScorer{config: config} }

func (s *RiskScorer) Score(r *http.Request, privileged bool) (float64, []string) {
	var score float64
	reasons := make([]string, 0, 5)
	if len(s.config.AllowedCIDRs) > 0 && !ipInCIDRs(parseRemoteIP(r.RemoteAddr), s.config.AllowedCIDRs) {
		score += 0.25
		reasons = append(reasons, "source IP outside allowlist")
	}
	if privileged || isPrivilegedPath(r.URL.Path) {
		score += 0.20
		reasons = append(reasons, "privileged operation")
		if !secureEquals(r.Header.Get("X-BIS-BreakGlass"), s.config.BreakGlassSecret) {
			score += 0.20
			reasons = append(reasons, "missing or invalid break-glass authorization")
		}
	}
	if strings.TrimSpace(r.Header.Get("User-Agent")) == "" {
		score += 0.15
		reasons = append(reasons, "missing user agent")
	}
	if strings.TrimSpace(r.Header.Get("Referer")) == "" {
		score += 0.10
		reasons = append(reasons, "missing referer")
	}
	hour := time.Now().Hour()
	if s.config.WorkingHoursStart >= 0 && s.config.WorkingHoursEnd >= 0 && (hour < s.config.WorkingHoursStart || hour > s.config.WorkingHoursEnd) {
		score += 0.10
		reasons = append(reasons, "outside configured working hours")
	}
	if score > 1 {
		score = 1
	}
	return score, reasons
}
