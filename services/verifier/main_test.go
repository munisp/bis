package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bis/verifier/internal"
)

func setupTestServer(t *testing.T) *http.ServeMux {
	t.Helper()
	cfg := internal.ConfigFromEnv()
	// Every provider is deliberately absent for these fail-closed tests.
	cfg.SandboxMode = false
	cfg.NIMCUrl = ""
	cfg.NIBSSUrl = ""
	cfg.CACUrl = ""
	cfg.OFACUrl = ""
	cfg.YouverifyAPIKey = ""
	eng := internal.NewEngine(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("POST /v1/nin", ninHandler(eng))
	mux.HandleFunc("POST /v1/bvn", bvnHandler(eng))
	mux.HandleFunc("POST /v1/cac", cacHandler(eng))
	mux.HandleFunc("POST /v1/sanctions", sanctionsHandler(eng))
	return mux
}

func withVerifierKey(t *testing.T) {
	t.Helper()
	previous := verifierKey
	verifierKey = "test-key"
	t.Cleanup(func() { verifierKey = previous })
}

func TestHealthEndpointReportsSyntheticResponsesDisabled(t *testing.T) {
	mux := setupTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["sandbox"] != false {
		t.Fatalf("expected synthetic responses disabled, got sandbox=%v", resp["sandbox"])
	}
}

func TestVerificationEndpointsRequireAuthentication(t *testing.T) {
	mux := setupTestServer(t)
	previous := verifierKey
	verifierKey = "test-key"
	t.Cleanup(func() { verifierKey = previous })
	req := httptest.NewRequest(http.MethodPost, "/v1/nin", bytes.NewBufferString(`{"nin":"12345678901"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestVerificationEndpointsRejectSyntheticFallbacks(t *testing.T) {
	withVerifierKey(t)
	mux := setupTestServer(t)
	cases := []struct {
		name string
		path string
		body string
	}{
		{name: "NIN", path: "/v1/nin", body: `{"nin":"12345678901"}`},
		{name: "BVN", path: "/v1/bvn", body: `{"bvn":"22345678901"}`},
		{name: "CAC", path: "/v1/cac", body: `{"rc":"RC123456"}`},
		{name: "sanctions", path: "/v1/sanctions", body: `{"name":"John Smith"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-BIS-Key", "test-key")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != http.StatusBadGateway {
				t.Fatalf("expected 502 when no provider is configured, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}
