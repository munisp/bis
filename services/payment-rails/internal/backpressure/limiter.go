// Package backpressure implements a semaphore-based in-flight request limiter.
// This prevents queue overflow when the TigerBeetle batch accumulator is full.
//
// Lesson from 1B payments article: backpressure is essential to prevent cascading
// failures when the payment pipeline is saturated. Rather than accepting requests
// that will be dropped, return 503 early so clients can retry with backoff.
package backpressure

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

// Limiter is a semaphore that limits the number of concurrent in-flight transfers.
type Limiter struct {
	max     int64
	current int64
}

// New creates a Limiter with the given maximum concurrency.
func New(max int) *Limiter {
	if max <= 0 {
		max = 10000
	}
	return &Limiter{max: int64(max)}
}

// Acquire attempts to acquire a slot. Returns false if the limit is reached.
func (l *Limiter) Acquire() bool {
	for {
		cur := atomic.LoadInt64(&l.current)
		if cur >= l.max {
			return false
		}
		if atomic.CompareAndSwapInt64(&l.current, cur, cur+1) {
			return true
		}
	}
}

// Release frees a slot.
func (l *Limiter) Release() {
	atomic.AddInt64(&l.current, -1)
}

// Current returns the number of in-flight requests.
func (l *Limiter) Current() int64 {
	return atomic.LoadInt64(&l.current)
}

// Available returns the number of available slots.
func (l *Limiter) Available() int64 {
	cur := atomic.LoadInt64(&l.current)
	if cur >= l.max {
		return 0
	}
	return l.max - cur
}

// Middleware returns an HTTP middleware that enforces the in-flight limit.
// When the limit is reached, it returns 503 Service Unavailable with a Retry-After header.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Acquire() {
			w.Header().Set("Retry-After", "1")
			w.Header().Set("X-Backpressure-Limit", fmt.Sprintf("%d", l.max))
			w.Header().Set("X-Backpressure-Current", fmt.Sprintf("%d", l.Current()))
			http.Error(w, `{"error":"service_overloaded","message":"Too many in-flight transfers — retry after 1s","code":503}`, http.StatusServiceUnavailable)
			return
		}
		defer l.Release()
		next.ServeHTTP(w, r)
	})
}
