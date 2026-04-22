package backpressure

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestLimiter_Acquire(t *testing.T) {
	l := New(3)

	if !l.Acquire() {
		t.Error("first acquire should succeed")
	}
	if !l.Acquire() {
		t.Error("second acquire should succeed")
	}
	if !l.Acquire() {
		t.Error("third acquire should succeed")
	}
	if l.Acquire() {
		t.Error("fourth acquire should fail (limit=3)")
	}

	l.Release()
	if !l.Acquire() {
		t.Error("acquire after release should succeed")
	}
}

func TestLimiter_Current(t *testing.T) {
	l := New(10)
	l.Acquire()
	l.Acquire()
	if l.Current() != 2 {
		t.Errorf("expected current=2, got %d", l.Current())
	}
	l.Release()
	if l.Current() != 1 {
		t.Errorf("expected current=1 after release, got %d", l.Current())
	}
}

func TestLimiter_Available(t *testing.T) {
	l := New(5)
	l.Acquire()
	l.Acquire()
	if l.Available() != 3 {
		t.Errorf("expected available=3, got %d", l.Available())
	}
}

func TestLimiter_Middleware_Allow(t *testing.T) {
	l := New(10)
	handler := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestLimiter_Middleware_Reject(t *testing.T) {
	l := New(1)
	// Exhaust the limit
	l.Acquire()

	handler := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header")
	}
}

func TestLimiter_Concurrent(t *testing.T) {
	const limit = 50
	const goroutines = 100
	l := New(limit)

	var acquired int64
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Acquire() {
				mu.Lock()
				acquired++
				mu.Unlock()
				l.Release()
			}
		}()
	}
	wg.Wait()

	// All goroutines that acquired should have also released
	if l.Current() != 0 {
		t.Errorf("expected 0 in-flight after all goroutines done, got %d", l.Current())
	}
}

func TestLimiter_DefaultMax(t *testing.T) {
	l := New(0) // should default to 10000
	if l.max != 10000 {
		t.Errorf("expected default max=10000, got %d", l.max)
	}
}
