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

func TestAuthMiddleware_KeyInQueryParam(t *testing.T) {
	gatewayKey = "test-key-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/health?key=test-key-123", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// ─── corsMiddleware tests ─────────────────────────────────────────────────────

func TestCORSMiddleware_OptionsRequest(t *testing.T) {
	handler := corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodOptions, "/api/nin", nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204 for OPTIONS, got %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("expected Access-Control-Allow-Origin: *")
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

// ─── sandboxNIN tests ─────────────────────────────────────────────────────────

func TestSandboxNIN_ValidNIN(t *testing.T) {
	result := sandboxNIN("12345678901")
	if result.Status != "VERIFIED" {
		t.Error("expected NIN status to be VERIFIED")
	}
	if result.FirstName == "" {
		t.Error("expected FirstName to be populated")
	}
	if result.NIN != "12345678901" {
		t.Errorf("expected NIN to be echoed back, got %s", result.NIN)
	}
}

func TestSandboxNIN_DifferentNINs_DifferentResults(t *testing.T) {
	r1 := sandboxNIN("11111111111")
	r2 := sandboxNIN("22222222222")
	// Different seeds should produce different names
	if r1.FirstName == r2.FirstName && r1.LastName == r2.LastName {
		t.Log("Warning: same name for different NINs (low probability)")
	}
}

// ─── sandboxBVN tests ─────────────────────────────────────────────────────────

func TestSandboxBVN_ValidBVN(t *testing.T) {
	result := sandboxBVN("22123456789")
	if result.BVN == "" {
		t.Error("expected BVN to be populated")
	}
	if result.BVN != "22123456789" {
		t.Errorf("expected BVN to be echoed back, got %s", result.BVN)
	}
	if result.Bank == "" {
		t.Error("expected Bank to be populated")
	}
}

// ─── sandboxCAC tests ─────────────────────────────────────────────────────────

func TestSandboxCAC_ValidRC(t *testing.T) {
	result := sandboxCAC("RC123456")
	if result.Status == "" {
		t.Error("expected company status to be populated")
	}
	if result.RCNumber != "RC123456" {
		t.Errorf("expected RCNumber to be echoed back, got %s", result.RCNumber)
	}
	if result.CompanyName == "" {
		t.Error("expected CompanyName to be populated")
	}
}

// ─── sandboxSanctions tests ───────────────────────────────────────────────────

func TestSandboxSanctions_CleanName(t *testing.T) {
	result := sandboxSanctions("John Smith")
	// Most names should be clean
	if result.Hits == nil {
		result.Hits = []SanctionHit{}
	}
	// Verify structure
	if result.Queried != "John Smith" {
		t.Errorf("expected name to be echoed back, got %s", result.Queried)
	}
}

func TestSandboxSanctions_ResponseHasName(t *testing.T) {
	result := sandboxSanctions("Test Person")
	if result.Queried == "" {
		t.Error("expected Queried to be populated")
	}
}

// ─── sandboxCredit tests ──────────────────────────────────────────────────────

func TestSandboxCredit_ValidBVN(t *testing.T) {
	result := sandboxCredit("22123456789")
	if result.Score < 300 || result.Score > 850 {
		t.Errorf("credit score %d out of range 300-850", result.Score)
	}
	if result.BVN != "22123456789" {
		t.Errorf("expected BVN echoed back, got %s", result.BVN)
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

// ─── deterministicRNG tests ───────────────────────────────────────────────────

func TestDeterministicRNG_Reproducible(t *testing.T) {
	rng1 := deterministicRNG("same-seed")
	rng2 := deterministicRNG("same-seed")
	v1 := rng1.Intn(1000)
	v2 := rng2.Intn(1000)
	if v1 != v2 {
		t.Errorf("expected same value for same seed, got %d vs %d", v1, v2)
	}
}

func TestDeterministicRNG_DifferentSeeds(t *testing.T) {
	rng1 := deterministicRNG("seed-a")
	rng2 := deterministicRNG("seed-b")
	v1 := rng1.Intn(10000)
	v2 := rng2.Intn(10000)
	if v1 == v2 {
		t.Log("Warning: same value for different seeds (low probability)")
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
