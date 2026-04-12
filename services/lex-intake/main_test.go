package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	f, err := os.CreateTemp("", "lex-test-*.db")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })
	store, err := NewStore(f.Name())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return store
}

func TestRateLimit(t *testing.T) {
	store := newTestStore(t)
	for i := 0; i < 5; i++ {
		ok, _, err := store.CheckRateLimit("officer-001", 5)
		if err != nil {
			t.Fatalf("CheckRateLimit error: %v", err)
		}
		if !ok {
			t.Fatalf("expected allowed on attempt %d", i+1)
		}
	}
	// 6th should be denied
	ok, count, err := store.CheckRateLimit("officer-001", 5)
	if err != nil {
		t.Fatalf("CheckRateLimit error: %v", err)
	}
	if ok {
		t.Error("expected rate limit to be hit on 6th attempt")
	}
	if count != 5 {
		t.Errorf("expected count=5, got %d", count)
	}
}

func TestEnqueueAndGetQueued(t *testing.T) {
	store := newTestStore(t)
	payload := `{"submitterId":"off-1","agencyCode":"NPF-LA","narrative":"test"}`
	err := store.Enqueue("LEX-LOCAL-TEST-001", "off-1", "NPF-LA", "hash", payload)
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	subs, err := store.GetQueued(10)
	if err != nil {
		t.Fatalf("GetQueued: %v", err)
	}
	if len(subs) != 1 {
		t.Fatalf("expected 1 queued, got %d", len(subs))
	}
	if subs[0].LocalRef != "LEX-LOCAL-TEST-001" {
		t.Errorf("unexpected local ref: %s", subs[0].LocalRef)
	}
}

func TestMarkSynced(t *testing.T) {
	store := newTestStore(t)
	store.Enqueue("LEX-LOCAL-SYNC-001", "off-2", "NPF-KN", "hash", `{}`)
	subs, _ := store.GetQueued(1)
	if err := store.MarkSynced(subs[0].ID, "LEX-BIS-00001"); err != nil {
		t.Fatalf("MarkSynced: %v", err)
	}
	// Should no longer appear in queued
	remaining, _ := store.GetQueued(10)
	if len(remaining) != 0 {
		t.Errorf("expected 0 queued after sync, got %d", len(remaining))
	}
}

func TestMarkFailed_RetryThenFailed(t *testing.T) {
	store := newTestStore(t)
	store.Enqueue("LEX-LOCAL-FAIL-001", "off-3", "NPF-AB", "hash", `{}`)
	subs, _ := store.GetQueued(1)
	id := subs[0].ID

	// Attempts 1-4 → status = retry
	for i := 1; i <= 4; i++ {
		store.MarkFailed(id, "network error", i)
		remaining, _ := store.GetQueued(10)
		if len(remaining) != 1 {
			t.Errorf("attempt %d: expected still in queue", i)
		}
	}
	// Attempt 5 → status = failed (removed from retry queue)
	store.MarkFailed(id, "permanent error", 5)
	remaining, _ := store.GetQueued(10)
	if len(remaining) != 0 {
		t.Errorf("expected 0 queued after 5 failures, got %d", len(remaining))
	}
}

func TestGetStats(t *testing.T) {
	store := newTestStore(t)
	store.Enqueue("REF-1", "off-1", "NPF-LA", "h", `{}`)
	store.Enqueue("REF-2", "off-2", "NPF-LA", "h", `{}`)
	subs, _ := store.GetQueued(10)
	store.MarkSynced(subs[0].ID, "BIS-1")

	stats, err := store.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if stats["queued"] != 1 {
		t.Errorf("expected 1 queued, got %d", stats["queued"])
	}
	if stats["synced"] != 1 {
		t.Errorf("expected 1 synced, got %d", stats["synced"])
	}
}

func newTestServer(t *testing.T) (*Server, *Store) {
	t.Helper()
	store := newTestStore(t)
	bis := NewBISClient("http://localhost:19999", "") // unreachable
	return &Server{store: store, bis: bis, config: loadConfig()}, store
}

func TestHandleSubmit_MissingFields(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"submitterId":"off-1"}`
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.handleSubmit(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestHandleSubmit_Queued(t *testing.T) {
	srv, store := newTestServer(t)
	body := `{"submitterId":"off-1","agencyCode":"NPF-LA","pin":"123456","incidentType":"arrest","incidentState":"LA","narrative":"Suspect apprehended near market"}`
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.handleSubmit(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["queued"] != true {
		t.Error("expected queued=true")
	}

	subs, _ := store.GetQueued(10)
	if len(subs) != 1 {
		t.Errorf("expected 1 queued submission, got %d", len(subs))
	}
}

func TestHandleSubmit_RateLimitEnforced(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"submitterId":"off-rl","agencyCode":"NPF-LA","pin":"123456","incidentType":"arrest","incidentState":"LA","narrative":"test"}`

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.handleSubmit(rr, req)
		if rr.Code != http.StatusAccepted {
			t.Errorf("attempt %d: expected 202, got %d", i+1, rr.Code)
		}
	}

	// 6th should be 429
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.handleSubmit(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 on 6th attempt, got %d", rr.Code)
	}
}

func TestHandleSMS(t *testing.T) {
	srv, store := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/sms", bytes.NewBufferString(
		"submitterId=off-sms&agencyCode=NPF-RI&pin=654321&type=theft&state=RI&narrative=Stolen+vehicle+reported",
	))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	srv.handleSMS(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	resp := rr.Body.String()
	if !bytes.HasPrefix([]byte(resp), []byte("OK:")) {
		t.Errorf("expected OK: prefix, got: %s", resp)
	}
	subs, _ := store.GetQueued(10)
	if len(subs) != 1 {
		t.Errorf("expected 1 SMS submission queued, got %d", len(subs))
	}
}

func TestHandleStatus(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	rr := httptest.NewRecorder()
	srv.handleStatus(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["service"] != "lex-intake" {
		t.Errorf("unexpected service name: %v", resp["service"])
	}
}

func TestLocalRefFormat(t *testing.T) {
	ref := fmt.Sprintf("LEX-LOCAL-%s-%d", "NPF-LA", time.Now().UnixMilli())
	if !bytes.HasPrefix([]byte(ref), []byte("LEX-LOCAL-NPF-LA-")) {
		t.Errorf("unexpected ref format: %s", ref)
	}
}
