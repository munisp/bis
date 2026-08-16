package insider_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"bis/gateway/insider"
)

func okHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func newMW(cfg insider.Config) *insider.Middleware {
	return insider.New(cfg)
}

// ─── AnomalousIPBlock ─────────────────────────────────────────────────────────

func TestAnomalousIPBlock_AllowsWhenNoCIDRs(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{} // no restriction
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	rr := httptest.NewRecorder()
	mw.AnomalousIPBlock(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestAnomalousIPBlock_BlocksUnknownIP(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{"10.0.0.0/8"}
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	rr := httptest.NewRecorder()
	mw.AnomalousIPBlock(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestAnomalousIPBlock_AllowsKnownIP(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{"10.0.0.0/8"}
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.RemoteAddr = "10.1.2.3:5678"
	rr := httptest.NewRecorder()
	mw.AnomalousIPBlock(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestAnomalousIPBlock_RespectsXForwardedFor(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{"10.0.0.0/8"}
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.RemoteAddr = "127.0.0.1:9999"            // trusted proxy
	req.Header.Set("X-Forwarded-For", "1.2.3.4") // real client IP
	rr := httptest.NewRecorder()
	mw.AnomalousIPBlock(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for forwarded IP 1.2.3.4, got %d", rr.Code)
	}
}

// ─── PrivilegedAccess ─────────────────────────────────────────────────────────

func TestPrivilegedAccess_AllowsNonPrivilegedPath(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.BreakGlassSecret = "test-secret"
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rr := httptest.NewRecorder()
	mw.PrivilegedAccess(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for non-privileged path, got %d", rr.Code)
	}
}

func TestPrivilegedAccess_BlocksPrivilegedWithoutToken(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.BreakGlassSecret = "test-secret"
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/delete", nil)
	rr := httptest.NewRecorder()
	mw.PrivilegedAccess(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without break-glass token, got %d", rr.Code)
	}
}

func TestPrivilegedAccess_AllowsPrivilegedWithToken(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.BreakGlassSecret = "some-valid-token"
	cfg.DualControlPaths = []string{} // no dual-control paths for this test
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/delete", nil)
	req.Header.Set("X-BIS-BreakGlass", "some-valid-token")
	rr := httptest.NewRecorder()
	mw.PrivilegedAccess(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 with break-glass token, got %d", rr.Code)
	}
}

func TestPrivilegedAccess_DualControlRequired(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.BreakGlassSecret = "test-secret"
	cfg.DualControlPaths = []string{"/v1/admin/export-all"}
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/export-all", nil)
	req.Header.Set("X-BIS-BreakGlass", "some-valid-token")
	// No X-BIS-Approver header
	rr := httptest.NewRecorder()
	mw.PrivilegedAccess(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without approver token, got %d", rr.Code)
	}
}

func TestPrivilegedAccess_DualControlPasses(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.BreakGlassSecret = "some-valid-token"
	cfg.ApproverSecret = "approver-token"
	cfg.DualControlPaths = []string{"/v1/admin/export-all"}
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/export-all", nil)
	req.Header.Set("X-BIS-BreakGlass", "some-valid-token")
	req.Header.Set("X-BIS-Approver", "approver-token")
	rr := httptest.NewRecorder()
	mw.PrivilegedAccess(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 with both tokens, got %d", rr.Code)
	}
}

// ─── ExfilTracker ─────────────────────────────────────────────────────────────

func TestExfilTracker_DoesNotBlockBelowLimit(t *testing.T) {
	tracker := insider.NewExfilTracker(60, 1024*1024) // 1 MB limit
	exceeded, _ := tracker.Record("user1", 512*1024)  // 512 KB
	if exceeded {
		t.Fatal("expected not exceeded for 512 KB below 1 MB limit")
	}
}

func TestExfilTracker_BlocksAboveLimit(t *testing.T) {
	tracker := insider.NewExfilTracker(60, 1024*1024)    // 1 MB limit
	tracker.Record("user2", 900*1024)                    // 900 KB
	exceeded, total := tracker.Record("user2", 200*1024) // +200 KB = 1.1 MB
	if !exceeded {
		t.Fatalf("expected exceeded for %d bytes above 1 MB limit", total)
	}
}

func TestExfilTracker_IsolatesUsers(t *testing.T) {
	tracker := insider.NewExfilTracker(60, 1024*1024) // 1 MB limit
	tracker.Record("userA", 900*1024)
	exceeded, _ := tracker.Record("userB", 900*1024) // different user
	if exceeded {
		t.Fatal("expected userB to be independent of userA's window")
	}
}

// ─── RiskScorer ───────────────────────────────────────────────────────────────

func TestRiskScorer_LowRiskForNormalRequest(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{}
	cfg.WorkingHoursStart = 0
	cfg.WorkingHoursEnd = 23
	scorer := insider.NewRiskScorer(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/investigations", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 BIS-Platform")
	req.Header.Set("Referer", "https://app.bis.ng")
	score, _ := scorer.Score(req, false)

	if score >= 0.5 {
		t.Fatalf("expected low risk score for normal request, got %.2f", score)
	}
}

func TestRiskScorer_HighRiskForSuspiciousRequest(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.AllowedCIDRs = []string{"10.0.0.0/8"}
	cfg.WorkingHoursStart = 9
	cfg.WorkingHoursEnd = 17
	cfg.BreakGlassSecret = "secret"
	scorer := insider.NewRiskScorer(cfg)

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/delete", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	req.Header.Set("User-Agent", "") // empty UA
	// No Referer, no BreakGlass token, outside working hours (depends on test time)
	score, reasons := scorer.Score(req, true)

	if score < 0.3 {
		t.Fatalf("expected elevated risk score for suspicious request, got %.2f (reasons: %v)", score, reasons)
	}
}

// ─── MTLSVerify ───────────────────────────────────────────────────────────────

func TestMTLSVerify_AllowsWhenDisabled(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.RequireMTLS = false
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	rr := httptest.NewRecorder()
	mw.MTLSVerify(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 when mTLS disabled, got %d", rr.Code)
	}
}

func TestMTLSVerify_BlocksWhenEnabledAndNoTLS(t *testing.T) {
	cfg := insider.DefaultConfig()
	cfg.RequireMTLS = true
	mw := newMW(cfg)

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	// req.TLS is nil — no TLS connection
	rr := httptest.NewRecorder()
	mw.MTLSVerify(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when mTLS required but no TLS, got %d", rr.Code)
	}
}
