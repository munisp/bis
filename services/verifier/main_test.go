package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"bis/verifier/internal"
)

func setupTestServer() *http.ServeMux {
	os.Setenv("GATEWAY_SANDBOX", "true")
	cfg := internal.ConfigFromEnv()
	cfg.SandboxMode = true
	eng := internal.NewEngine(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("POST /v1/nin", ninHandler(eng))
	mux.HandleFunc("POST /v1/bvn", bvnHandler(eng))
	mux.HandleFunc("POST /v1/cac", cacHandler(eng))
	mux.HandleFunc("POST /v1/sanctions", sanctionsHandler(eng))
	return mux
}

func TestHealthEndpoint(t *testing.T) {
	mux := setupTestServer()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", resp["status"])
	}
}

func TestNINEndpointRequiresAuth(t *testing.T) {
	mux := setupTestServer()
	body := bytes.NewBufferString(`{"nin":"12345678901"}`)
	req := httptest.NewRequest("POST", "/v1/nin", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestNINEndpointSandbox(t *testing.T) {
	os.Setenv("BIS_VERIFIER_KEY", "test-key")
	verifierKey = "test-key"
	defer func() { verifierKey = envOr("BIS_VERIFIER_KEY", "dev-verifier-key-change-in-prod") }()

	mux := setupTestServer()
	body := bytes.NewBufferString(`{"nin":"12345678901"}`)
	req := httptest.NewRequest("POST", "/v1/nin", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", "test-key")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["sandbox"] != true {
		t.Errorf("expected sandbox=true, got %v", resp["sandbox"])
	}
	if resp["nin"] != "12345678901" {
		t.Errorf("expected nin=12345678901, got %v", resp["nin"])
	}
}

func TestBVNEndpointSandbox(t *testing.T) {
	os.Setenv("BIS_VERIFIER_KEY", "test-key")
	verifierKey = "test-key"
	defer func() { verifierKey = envOr("BIS_VERIFIER_KEY", "dev-verifier-key-change-in-prod") }()

	mux := setupTestServer()
	body := bytes.NewBufferString(`{"bvn":"22345678901"}`)
	req := httptest.NewRequest("POST", "/v1/bvn", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", "test-key")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["sandbox"] != true {
		t.Errorf("expected sandbox=true, got %v", resp["sandbox"])
	}
}

func TestSanctionsEndpointSandboxHit(t *testing.T) {
	os.Setenv("BIS_VERIFIER_KEY", "test-key")
	verifierKey = "test-key"
	defer func() { verifierKey = envOr("BIS_VERIFIER_KEY", "dev-verifier-key-change-in-prod") }()

	mux := setupTestServer()
	body := bytes.NewBufferString(`{"name":"SANCTIONED ENTITY"}`)
	req := httptest.NewRequest("POST", "/v1/sanctions", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", "test-key")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["clear"] != false {
		t.Errorf("expected clear=false for sanctioned entity, got %v", resp["clear"])
	}
}

func TestSanctionsEndpointSandboxClear(t *testing.T) {
	os.Setenv("BIS_VERIFIER_KEY", "test-key")
	verifierKey = "test-key"
	defer func() { verifierKey = envOr("BIS_VERIFIER_KEY", "dev-verifier-key-change-in-prod") }()

	mux := setupTestServer()
	body := bytes.NewBufferString(`{"name":"John Smith"}`)
	req := httptest.NewRequest("POST", "/v1/sanctions", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", "test-key")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["clear"] != true {
		t.Errorf("expected clear=true for clean name, got %v", resp["clear"])
	}
}
