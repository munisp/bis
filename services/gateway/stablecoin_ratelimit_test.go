package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ─── slidingWindow tests ──────────────────────────────────────────────────────

func TestSlidingWindow_CountAndAdd(t *testing.T) {
	sw := &slidingWindow{}
	now := time.Now()

	// Empty window
	if got := sw.count(now, time.Minute); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}

	// Add 1 old event (outside window) and 3 recent events
	sw.add(now.Add(-90 * time.Second)) // older than 1 minute — should be evicted
	sw.add(now.Add(-30 * time.Second))
	sw.add(now.Add(-20 * time.Second))
	sw.add(now.Add(-10 * time.Second))

	// count() should evict the old event and return 3
	if got := sw.count(now, time.Minute); got != 3 {
		t.Fatalf("expected 3 after eviction, got %d", got)
	}
}

// ─── StablecoinRateLimiter tests ──────────────────────────────────────────────

func newTestRL(transferRPM, burst, readRPM int) *StablecoinRateLimiter {
	return &StablecoinRateLimiter{
		windows: make(map[string]*slidingWindow),
		cfg: stablecoinRLConfig{
			transferRPM:   transferRPM,
			transferBurst: burst,
			readRPM:       readRPM,
		},
	}
}

func TestAllowTransfer_WithinLimit(t *testing.T) {
	rl := newTestRL(5, 0, 60)
	for i := 0; i < 5; i++ {
		ok, _, _ := rl.AllowTransfer("account-001")
		if !ok {
			t.Fatalf("expected allowed on request %d", i+1)
		}
	}
}

func TestAllowTransfer_ExceedsLimit(t *testing.T) {
	rl := newTestRL(3, 0, 60)
	for i := 0; i < 3; i++ {
		rl.AllowTransfer("account-002")
	}
	ok, _, retryAfter := rl.AllowTransfer("account-002")
	if ok {
		t.Fatal("expected rate limit to be exceeded")
	}
	if retryAfter < 1 {
		t.Fatalf("expected retryAfter >= 1, got %d", retryAfter)
	}
}

func TestAllowTransfer_BurstAllowance(t *testing.T) {
	rl := newTestRL(3, 2, 60) // limit = 3 + 2 = 5
	for i := 0; i < 5; i++ {
		ok, _, _ := rl.AllowTransfer("account-003")
		if !ok {
			t.Fatalf("expected allowed within burst on request %d", i+1)
		}
	}
	ok, _, _ := rl.AllowTransfer("account-003")
	if ok {
		t.Fatal("expected rate limit to be exceeded after burst")
	}
}

func TestAllowTransfer_IsolatedPerAccount(t *testing.T) {
	rl := newTestRL(2, 0, 60)
	// Exhaust account-A
	rl.AllowTransfer("account-A")
	rl.AllowTransfer("account-A")
	okA, _, _ := rl.AllowTransfer("account-A")
	if okA {
		t.Fatal("account-A should be rate limited")
	}
	// account-B should still be allowed
	okB, _, _ := rl.AllowTransfer("account-B")
	if !okB {
		t.Fatal("account-B should not be rate limited")
	}
}

func TestAllowRead_WithinLimit(t *testing.T) {
	rl := newTestRL(5, 0, 3)
	for i := 0; i < 3; i++ {
		if !rl.AllowRead("reader-001") {
			t.Fatalf("expected allowed on read %d", i+1)
		}
	}
	if rl.AllowRead("reader-001") {
		t.Fatal("expected read rate limit exceeded")
	}
}

// ─── Middleware tests ─────────────────────────────────────────────────────────

func TestStablecoinTransferRateLimitMiddleware_Allows(t *testing.T) {
	// Swap global limiter for a test instance
	orig := stablecoinRL
	stablecoinRL = newTestRL(10, 0, 60)
	defer func() { stablecoinRL = orig }()

	handler := StablecoinTransferRateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/stablecoin/transfer", nil)
	req.Header.Set("X-Account-ID", "mw-test-account")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if rr.Header().Get("X-RateLimit-Limit") == "" {
		t.Fatal("expected X-RateLimit-Limit header")
	}
}

func TestStablecoinTransferRateLimitMiddleware_Blocks(t *testing.T) {
	orig := stablecoinRL
	stablecoinRL = newTestRL(2, 0, 60)
	defer func() { stablecoinRL = orig }()

	handler := StablecoinTransferRateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	accountID := "mw-block-account"
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/stablecoin/transfer", nil)
		req.Header.Set("X-Account-ID", accountID)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
	}

	// Third request should be blocked
	req := httptest.NewRequest(http.MethodPost, "/v1/stablecoin/transfer", nil)
	req.Header.Set("X-Account-ID", accountID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on 429")
	}
}

func TestStablecoinReadRateLimitMiddleware_Blocks(t *testing.T) {
	orig := stablecoinRL
	stablecoinRL = newTestRL(10, 0, 2)
	defer func() { stablecoinRL = orig }()

	handler := StablecoinReadRateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	accountID := "reader-block"
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/stablecoin/balance/0xabc", nil)
		req.Header.Set("X-Account-ID", accountID)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/stablecoin/balance/0xabc", nil)
	req.Header.Set("X-Account-ID", accountID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rr.Code)
	}
}
