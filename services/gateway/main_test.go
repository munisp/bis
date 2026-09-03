package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── authMiddleware tests ─────────────────────────────────────────────────────

func TestAuthMiddleware_ValidKey(t *testing.T) {
	gatewayKey = "test-key-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-BIS-Key", "test-key-123")
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestAuthMiddleware_InvalidKey(t *testing.T) {
	gatewayKey = "test-key-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-BIS-Key", "wrong-key")
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuthMiddleware_MissingKey(t *testing.T) {
	gatewayKey = "test-key-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuthMiddleware_RejectsQueryParamCredential(t *testing.T) {
	gatewayKey = "test-key-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health?key=test-key-123", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected query-string credential rejection with 401, got %d", rr.Code)
	}
}

// ─── corsMiddleware tests ─────────────────────────────────────────────────────

func TestCORSMiddleware_OptionsRequest(t *testing.T) {
	t.Setenv("BIS_CORS_ORIGIN", "https://app.example.test")
	handler := corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodOptions, "/api/nin", nil)
	req.Header.Set("Origin", "https://app.example.test")
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204 for OPTIONS, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "https://app.example.test" {
		t.Error("expected explicit Access-Control-Allow-Origin")
	}
}

func TestCORSMiddleware_PassThrough(t *testing.T) {
	handler := corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// ─── writeJSON / writeError tests ─────────────────────────────────────────────

func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, http.StatusOK, map[string]string{"status": "ok"})
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Header().Get("Content-Type"), "application/json") {
		t.Error("expected Content-Type: application/json")
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Errorf("failed to decode JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %s", body["status"])
	}
}

func TestWriteError(t *testing.T) {
	rr := httptest.NewRecorder()
	writeError(rr, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid key")
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
	var body GatewayError
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Errorf("failed to decode error JSON: %v", err)
	}
	if body.Code != "UNAUTHORIZED" {
		t.Errorf("expected code UNAUTHORIZED, got %s", body.Code)
	}
}

// ─── envOr tests ──────────────────────────────────────────────────────────────

func TestEnvOr_DefaultValue(t *testing.T) {
	result := envOr("NONEXISTENT_ENV_VAR_XYZ", "default-value")
	if result != "default-value" {
		t.Errorf("expected default-value, got %s", result)
	}
}

func TestEnvOr_SetValue(t *testing.T) {
	t.Setenv("TEST_GATEWAY_VAR", "custom-value")
	result := envOr("TEST_GATEWAY_VAR", "default-value")
	if result != "custom-value" {
		t.Errorf("expected custom-value, got %s", result)
	}
}

// ─── chain middleware tests ───────────────────────────────────────────────────

func TestChain_OrderPreserved(t *testing.T) {
	order := []string{}
	m1 := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			order = append(order, "m1")
			next(w, r)
		}
	}
	m2 := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			order = append(order, "m2")
			next(w, r)
		}
	}
	handler := chain(func(w http.ResponseWriter, r *http.Request) {
		order = append(order, "handler")
	}, m1, m2)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if len(order) != 3 || order[0] != "m1" || order[1] != "m2" || order[2] != "handler" {
		t.Errorf("unexpected middleware order: %v", order)
	}
}
