package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── Helper ──────────────────────────────────────────────────────────────────

func newTestHandler() *Handler {
	cfg := Config{
		Port:         "8090",
		OllamaURL:    "http://localhost:11434",
		BISGatewayKey: "test-gateway-key",
		LakehouseURL: "http://localhost:8082",
	}
	return NewHandler(cfg)
}

// ─── Config tests ─────────────────────────────────────────────────────────────

func TestLoadConfigDefaults(t *testing.T) {
	cfg := loadConfig()
	if cfg.OllamaURL == "" {
		t.Error("OllamaURL should have a default value")
	}
	if cfg.Port == "" {
		t.Error("Port should have a default value")
	}
}

func TestGetEnvFallback(t *testing.T) {
	val := getEnv("BIS_NONEXISTENT_ENV_VAR_12345", "fallback-value")
	if val != "fallback-value" {
		t.Errorf("expected fallback-value, got %s", val)
	}
}

func TestGetEnvReturnsDefault(t *testing.T) {
	val := getEnv("ANOTHER_NONEXISTENT_VAR_99999", "default")
	if val != "default" {
		t.Errorf("expected default, got %s", val)
	}
}

// ─── OllamaClient constructor ─────────────────────────────────────────────────

func TestNewOllamaClientSetsBaseURL(t *testing.T) {
	c := NewOllamaClient("http://localhost:11434")
	if c.baseURL != "http://localhost:11434" {
		t.Errorf("expected http://localhost:11434, got %s", c.baseURL)
	}
}

func TestNewOllamaClientHasHTTPClient(t *testing.T) {
	c := NewOllamaClient("http://localhost:11434")
	if c.httpClient == nil {
		t.Error("httpClient should not be nil")
	}
}

// ─── Handler constructor ──────────────────────────────────────────────────────

func TestNewHandlerSetsConfig(t *testing.T) {
	h := newTestHandler()
	if h.cfg.BISGatewayKey != "test-gateway-key" {
		t.Errorf("expected test-gateway-key, got %s", h.cfg.BISGatewayKey)
	}
}

func TestNewHandlerCreatesOllamaClient(t *testing.T) {
	h := newTestHandler()
	if h.ollama == nil {
		t.Error("ollama client should not be nil")
	}
}

// ─── Health endpoint ──────────────────────────────────────────────────────────

func TestHealthEndpointReturns200(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHealthEndpointReturnsJSON(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Errorf("expected valid JSON, got error: %v", err)
	}
}

func TestHealthEndpointContainsStatus(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)
	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	if _, ok := body["status"]; !ok {
		t.Error("health response should contain 'status' field")
	}
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

func TestBisAuthMiddlewareRejectsNoKey(t *testing.T) {
	middleware := bisAuthMiddleware("secret-key")
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing key, got %d", w.Code)
	}
}

func TestBisAuthMiddlewareRejectsWrongKey(t *testing.T) {
	middleware := bisAuthMiddleware("correct-key")
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("X-BIS-Key", "wrong-key")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for wrong key, got %d", w.Code)
	}
}

func TestBisAuthMiddlewareAcceptsCorrectKey(t *testing.T) {
	middleware := bisAuthMiddleware("correct-key")
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("X-BIS-Key", "correct-key")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for correct key, got %d", w.Code)
	}
}

func TestBisAuthMiddlewareAcceptsBearerToken(t *testing.T) {
	middleware := bisAuthMiddleware("bearer-key")
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer bearer-key")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for bearer token, got %d", w.Code)
	}
}

// ─── writeJSON helper ─────────────────────────────────────────────────────────

func TestWriteJSONSetsContentType(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "value"})
	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected application/json content type, got %s", ct)
	}
}

func TestWriteJSONSetsStatusCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, map[string]string{"key": "value"})
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", w.Code)
	}
}

func TestWriteErrorSetsStatusCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "bad request")
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestWriteErrorContainsMessage(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "test error message")
	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["error"] != "test error message" {
		t.Errorf("expected error message in body, got %v", body)
	}
}

// ─── Chat endpoint (with mock Ollama) ────────────────────────────────────────

func TestChatEndpointRejectsMissingBody(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat", bytes.NewBufferString("invalid json"))
	w := httptest.NewRecorder()
	h.Chat(w, req)
	if w.Code == http.StatusOK {
		t.Error("expected non-200 for invalid JSON body")
	}
}

func TestChatEndpointRejectsEmptyMessages(t *testing.T) {
	h := newTestHandler()
	body := `{"model": "llama3", "messages": []}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Chat(w, req)
	// Empty messages should return 400 or 500 (Ollama unavailable)
	if w.Code == http.StatusOK {
		t.Error("expected non-200 for empty messages")
	}
}

// ─── Embed endpoint ───────────────────────────────────────────────────────────

func TestEmbedEndpointRejectsMissingBody(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/embed", bytes.NewBufferString("not json"))
	w := httptest.NewRecorder()
	h.Embed(w, req)
	if w.Code == http.StatusOK {
		t.Error("expected non-200 for invalid JSON body")
	}
}

// ─── ExplainRisk endpoint ─────────────────────────────────────────────────────

func TestExplainRiskRejectsMissingBody(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/explain-risk", bytes.NewBufferString("bad json"))
	w := httptest.NewRecorder()
	h.ExplainRisk(w, req)
	if w.Code == http.StatusOK {
		t.Error("expected non-200 for invalid JSON body")
	}
}

// ─── Data model tests ─────────────────────────────────────────────────────────

func TestChatMessageFields(t *testing.T) {
	msg := ChatMessage{Role: "user", Content: "Hello"}
	if msg.Role != "user" {
		t.Errorf("expected user role, got %s", msg.Role)
	}
	if msg.Content != "Hello" {
		t.Errorf("expected Hello content, got %s", msg.Content)
	}
}

func TestChatRequestFields(t *testing.T) {
	req := ChatRequest{
		Model:    "llama3",
		Messages: []ChatMessage{{Role: "user", Content: "test"}},
		Stream:   false,
	}
	if req.Model != "llama3" {
		t.Errorf("expected llama3, got %s", req.Model)
	}
	if len(req.Messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(req.Messages))
	}
}

func TestEmbedRequestFields(t *testing.T) {
	req := EmbedRequest{
		Model:  "nomic-embed-text",
		Input: "embed this text",
	}
	if req.Model != "nomic-embed-text" {
		t.Errorf("expected nomic-embed-text, got %s", req.Model)
	}
}
