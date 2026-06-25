// stablecoin_ratelimit.go — Per-account stablecoin BFF rate-limiting for the BIS gateway.
//
// Rationale: stablecoin transfers are irreversible on-chain. A per-account
// sliding-window rate limiter prevents both accidental duplicate submissions and
// deliberate abuse (e.g. rapid-fire transfers draining a wallet).
//
// Design:
//   - Sliding-window counter backed by an in-memory map (Redis optional).
//   - Separate limits for transfer (mutating) vs. read-only (balance/quote/history).
//   - Limits are configurable via environment variables.
//   - Middleware wraps only the stablecoin transfer endpoint; read-only endpoints
//     use the existing ServiceRateLimitMiddleware.
//   - Returns RFC 7807-style JSON error with Retry-After header on 429.
//
// Environment variables:
//   STABLECOIN_TRANSFER_RPM   — max transfer requests per account per minute (default: 5)
//   STABLECOIN_TRANSFER_BURST — burst allowance above RPM (default: 2)
//   STABLECOIN_READ_RPM       — max read requests per account per minute (default: 60)

package main

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// ─── Configuration ────────────────────────────────────────────────────────────

type stablecoinRLConfig struct {
	transferRPM   int // max transfer requests per account per minute
	transferBurst int // burst allowance above RPM
	readRPM       int // max read requests per account per minute
}

func loadStablecoinRLConfig() stablecoinRLConfig {
	return stablecoinRLConfig{
		transferRPM:   envIntDefault("STABLECOIN_TRANSFER_RPM", 5),
		transferBurst: envIntDefault("STABLECOIN_TRANSFER_BURST", 2),
		readRPM:       envIntDefault("STABLECOIN_READ_RPM", 60),
	}
}

func envIntDefault(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// ─── Sliding-window counter ───────────────────────────────────────────────────

// slidingWindow tracks request timestamps for a single account within a 1-minute
// sliding window.
type slidingWindow struct {
	mu         sync.Mutex
	timestamps []time.Time
}

func (sw *slidingWindow) count(now time.Time, window time.Duration) int {
	cutoff := now.Add(-window)
	i := 0
	for i < len(sw.timestamps) && sw.timestamps[i].Before(cutoff) {
		i++
	}
	sw.timestamps = sw.timestamps[i:]
	return len(sw.timestamps)
}

func (sw *slidingWindow) add(now time.Time) {
	sw.timestamps = append(sw.timestamps, now)
}

// ─── Per-account rate limiter ─────────────────────────────────────────────────

// StablecoinRateLimiter maintains per-account sliding windows for stablecoin
// transfer and read endpoints.
type StablecoinRateLimiter struct {
	mu      sync.Mutex
	windows map[string]*slidingWindow
	cfg     stablecoinRLConfig
}

// NewStablecoinRateLimiter creates a new rate limiter with config from env.
func NewStablecoinRateLimiter() *StablecoinRateLimiter {
	rl := &StablecoinRateLimiter{
		windows: make(map[string]*slidingWindow),
		cfg:     loadStablecoinRLConfig(),
	}
	// Background GC: evict stale windows every 5 minutes
	go rl.gc()
	return rl
}

func (rl *StablecoinRateLimiter) window(accountID string) *slidingWindow {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if w, ok := rl.windows[accountID]; ok {
		return w
	}
	w := &slidingWindow{}
	rl.windows[accountID] = w
	return w
}

// AllowTransfer returns true if the account is within the transfer rate limit.
func (rl *StablecoinRateLimiter) AllowTransfer(accountID string) (bool, int, int) {
	w := rl.window(accountID)
	w.mu.Lock()
	defer w.mu.Unlock()
	now := time.Now()
	limit := rl.cfg.transferRPM + rl.cfg.transferBurst
	count := w.count(now, time.Minute)
	if count >= limit {
		retryAfter := 60 - int(time.Since(w.timestamps[0]).Seconds())
		if retryAfter < 1 {
			retryAfter = 1
		}
		return false, count, retryAfter
	}
	w.add(now)
	return true, count + 1, 0
}

// AllowRead returns true if the account is within the read rate limit.
func (rl *StablecoinRateLimiter) AllowRead(accountID string) bool {
	w := rl.window(accountID)
	w.mu.Lock()
	defer w.mu.Unlock()
	now := time.Now()
	if w.count(now, time.Minute) >= rl.cfg.readRPM {
		return false
	}
	w.add(now)
	return true
}

func (rl *StablecoinRateLimiter) gc() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		cutoff := now.Add(-time.Minute)
		for id, w := range rl.windows {
			w.mu.Lock()
			// Evict windows with no recent activity
			if len(w.timestamps) == 0 || w.timestamps[len(w.timestamps)-1].Before(cutoff) {
				delete(rl.windows, id)
			}
			w.mu.Unlock()
		}
		rl.mu.Unlock()
	}
}

// ─── Global instance ──────────────────────────────────────────────────────────

var stablecoinRL = NewStablecoinRateLimiter()

// ─── Middleware ───────────────────────────────────────────────────────────────

// StablecoinTransferRateLimitMiddleware wraps the stablecoin transfer handler
// with per-account rate limiting. The account ID is extracted from the
// authenticated JWT claim (set by the protected() middleware as X-Account-ID),
// falling back to the remote IP.
func StablecoinTransferRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accountID := r.Header.Get("X-Account-ID")
		if accountID == "" {
			accountID = r.Header.Get("X-Forwarded-For")
		}
		if accountID == "" {
			accountID = r.RemoteAddr
		}

		ok, count, retryAfter := stablecoinRL.AllowTransfer(accountID)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(stablecoinRL.cfg.transferRPM))
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(time.Duration(retryAfter)*time.Second).Unix(), 10))
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = fmt.Fprintf(w,
				`{"error":"stablecoin transfer rate limit exceeded","account":%q,"limit_rpm":%d,"retry_after_s":%d}`,
				accountID, stablecoinRL.cfg.transferRPM, retryAfter,
			)
			return
		}

		// Inject remaining count for observability
		remaining := stablecoinRL.cfg.transferRPM + stablecoinRL.cfg.transferBurst - count
		if remaining < 0 {
			remaining = 0
		}
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(stablecoinRL.cfg.transferRPM))
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

		next.ServeHTTP(w, r)
	})
}

// StablecoinReadRateLimitMiddleware wraps read-only stablecoin handlers.
func StablecoinReadRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accountID := r.Header.Get("X-Account-ID")
		if accountID == "" {
			accountID = r.RemoteAddr
		}
		if !stablecoinRL.AllowRead(accountID) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = fmt.Fprintf(w,
				`{"error":"stablecoin read rate limit exceeded","account":%q,"limit_rpm":%d}`,
				accountID, stablecoinRL.cfg.readRPM,
			)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Tests ────────────────────────────────────────────────────────────────────
// Tests are in stablecoin_ratelimit_test.go
