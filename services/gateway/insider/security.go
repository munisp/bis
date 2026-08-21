package insider

import (
	"crypto/subtle"
	"crypto/tls"
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
		next.ServeHTTP(w, r)
	})
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
