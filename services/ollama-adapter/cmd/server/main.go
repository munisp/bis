// ollama-adapter: Go HTTP reverse proxy and router for local Ollama LLM
// Exposes BIS-authenticated endpoints for chat, embeddings, model management,
// and Lakehouse AI query routing. Runs as a sidecar alongside the BIS BFF.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	Port         string
	OllamaURL    string
	BISGatewayKey string
	MLServiceURL string
	LakehouseURL string
	DefaultModel string
}

func loadConfig() Config {
	return Config{
		Port:          getEnv("PORT", "8090"),
		OllamaURL:     getEnv("OLLAMA_URL", "http://localhost:11434"),
		BISGatewayKey: getEnv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod"),
		MLServiceURL:  getEnv("ML_SERVICE_URL", "http://localhost:8000"),
		LakehouseURL:  getEnv("LAKEHOUSE_URL", "http://localhost:8095"),
		DefaultModel:  getEnv("OLLAMA_DEFAULT_MODEL", "llama3.2"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Ollama Client ────────────────────────────────────────────────────────────

type OllamaClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewOllamaClient(baseURL string) *OllamaClient {
	return &OllamaClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
	Options  map[string]any `json:"options,omitempty"`
}

type ChatResponse struct {
	Model     string      `json:"model"`
	Message   ChatMessage `json:"message"`
	Done      bool        `json:"done"`
	CreatedAt time.Time   `json:"created_at"`
}

type EmbedRequest struct {
	Model  string `json:"model"`
	Input  string `json:"input"`
}

type EmbedResponse struct {
	Model      string    `json:"model"`
	Embeddings []float64 `json:"embeddings"`
}

type ModelInfo struct {
	Name       string    `json:"name"`
	ModifiedAt time.Time `json:"modified_at"`
	Size       int64     `json:"size"`
	Digest     string    `json:"digest"`
}

type ListModelsResponse struct {
	Models []ModelInfo `json:"models"`
}

func (c *OllamaClient) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama unreachable: %w", err)
	}
	defer resp.Body.Close()
	var result ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *OllamaClient) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/api/embed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama unreachable: %w", err)
	}
	defer resp.Body.Close()
	var result EmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *OllamaClient) ListModels(ctx context.Context) (*ListModelsResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama unreachable: %w", err)
	}
	defer resp.Body.Close()
	var result ListModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *OllamaClient) IsAvailable(ctx context.Context) bool {
	httpReq, _ := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/", nil)
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

type Handler struct {
	cfg    Config
	ollama *OllamaClient
}

func NewHandler(cfg Config) *Handler {
	return &Handler{
		cfg:    cfg,
		ollama: NewOllamaClient(cfg.OllamaURL),
	}
}

// Health check
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	ollamaOK := h.ollama.IsAvailable(r.Context())
	status := "healthy"
	if !ollamaOK {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":        status,
		"ollama_online": ollamaOK,
		"default_model": h.cfg.DefaultModel,
		"timestamp":     time.Now().UTC(),
	})
}

// List available Ollama models
func (h *Handler) ListModels(w http.ResponseWriter, r *http.Request) {
	models, err := h.ollama.ListModels(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama unavailable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, models)
}

// BIS-authenticated chat completion
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model    string        `json:"model"`
		Messages []ChatMessage `json:"messages"`
		Stream   bool          `json:"stream"`
		System   string        `json:"system"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	model := req.Model
	if model == "" {
		model = h.cfg.DefaultModel
	}
	messages := req.Messages
	if req.System != "" {
		messages = append([]ChatMessage{{Role: "system", Content: req.System}}, messages...)
	}
	chatReq := ChatRequest{
		Model:    model,
		Messages: messages,
		Stream:   false,
	}
	result, err := h.ollama.Chat(r.Context(), chatReq)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama chat failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// Generate embeddings for semantic search / Lakehouse indexing
func (h *Handler) Embed(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model string `json:"model"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	model := req.Model
	if model == "" {
		model = "nomic-embed-text"
	}
	result, err := h.ollama.Embed(r.Context(), EmbedRequest{Model: model, Input: req.Text})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama embed failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// Lakehouse AI query — natural language to SQL via Ollama
func (h *Handler) LakehouseQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Question string `json:"question"`
		Schema   string `json:"schema"`
		Model    string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.Question == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return
	}
	model := req.Model
	if model == "" {
		model = h.cfg.DefaultModel
	}
	systemPrompt := `You are a SQL expert for the BIS compliance platform. 
Convert the user's natural language question into a valid SQL query.
Return ONLY the SQL query, no explanation, no markdown code blocks.
The database uses PostgreSQL syntax.`

	if req.Schema != "" {
		systemPrompt += "\n\nDatabase schema:\n" + req.Schema
	}

	result, err := h.ollama.Chat(r.Context(), ChatRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: req.Question},
		},
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama unavailable: "+err.Error())
		return
	}

	generatedSQL := strings.TrimSpace(result.Message.Content)
	// Strip markdown code blocks if present
	generatedSQL = strings.TrimPrefix(generatedSQL, "```sql")
	generatedSQL = strings.TrimPrefix(generatedSQL, "```")
	generatedSQL = strings.TrimSuffix(generatedSQL, "```")
	generatedSQL = strings.TrimSpace(generatedSQL)

	writeJSON(w, http.StatusOK, map[string]any{
		"sql":   generatedSQL,
		"model": model,
	})
}

// Risk explanation — explain a risk score in plain language
func (h *Handler) ExplainRisk(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject    string         `json:"subject"`
		RiskScore  int            `json:"risk_score"`
		Factors    []string       `json:"factors"`
		Model      string         `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	model := req.Model
	if model == "" {
		model = h.cfg.DefaultModel
	}
	factorsStr := strings.Join(req.Factors, ", ")
	prompt := fmt.Sprintf(
		"Subject: %s\nRisk Score: %d/100\nRisk Factors: %s\n\nProvide a concise 2-3 sentence compliance risk explanation suitable for a regulatory report. Be specific about the risk factors and their implications.",
		req.Subject, req.RiskScore, factorsStr,
	)
	result, err := h.ollama.Chat(r.Context(), ChatRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: "You are a compliance risk analyst. Provide clear, professional risk explanations."},
			{Role: "user", Content: prompt},
		},
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama unavailable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"explanation": result.Message.Content,
		"model":       model,
	})
}

// Adverse media analysis — classify and summarise news articles
func (h *Handler) AnalyseMedia(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject string `json:"subject"`
		Article string `json:"article"`
		Model   string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	model := req.Model
	if model == "" {
		model = h.cfg.DefaultModel
	}
	prompt := fmt.Sprintf(
		"Subject: %s\n\nArticle:\n%s\n\nAnalyse this article for adverse media. Return a JSON object with: category (fraud|aml|sanctions|corruption|cyber|regulatory|reputational|none), severity (critical|high|medium|low|none), summary (1 sentence), and relevant (true/false).",
		req.Subject, req.Article,
	)
	result, err := h.ollama.Chat(r.Context(), ChatRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: "You are a compliance adverse media analyst. Always respond with valid JSON only."},
			{Role: "user", Content: prompt},
		},
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Ollama unavailable: "+err.Error())
		return
	}
	// Try to parse the JSON response
	var analysis map[string]any
	if err := json.Unmarshal([]byte(result.Message.Content), &analysis); err != nil {
		// Return raw if not valid JSON
		writeJSON(w, http.StatusOK, map[string]any{
			"raw":   result.Message.Content,
			"model": model,
		})
		return
	}
	analysis["model"] = model
	writeJSON(w, http.StatusOK, analysis)
}

// Reverse proxy to raw Ollama (for advanced use cases)
func (h *Handler) ProxyToOllama(w http.ResponseWriter, r *http.Request) {
	target, _ := url.Parse(h.cfg.OllamaURL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
		// Strip /ollama prefix
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/ollama")
	}
	proxy.ServeHTTP(w, r)
}

// ─── Middleware ───────────────────────────────────────────────────────────────

func bisAuthMiddleware(gatewayKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-BIS-Key")
			if key == "" {
				// Also check Authorization: Bearer
				auth := r.Header.Get("Authorization")
				if strings.HasPrefix(auth, "Bearer ") {
					key = strings.TrimPrefix(auth, "Bearer ")
				}
			}
			if key != gatewayKey {
				writeError(w, http.StatusUnauthorized, "Invalid BIS gateway key")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	cfg := loadConfig()
	h := NewHandler(cfg)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(120 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-BIS-Key"},
	}))

	// Health (public)
	r.Get("/health", h.Health)
	r.Get("/", h.Health)

	// Protected BIS routes
	r.Group(func(r chi.Router) {
		r.Use(bisAuthMiddleware(cfg.BISGatewayKey))

		// Model management
		r.Get("/models", h.ListModels)

		// Inference
		r.Post("/chat", h.Chat)
		r.Post("/embed", h.Embed)

		// BIS-specific AI endpoints
		r.Post("/lakehouse/query", h.LakehouseQuery)
		r.Post("/risk/explain", h.ExplainRisk)
		r.Post("/media/analyse", h.AnalyseMedia)

		// Raw Ollama proxy (for streaming, pull, etc.)
		r.Handle("/ollama/*", http.HandlerFunc(h.ProxyToOllama))
	})

	addr := ":" + cfg.Port
	log.Info().Str("addr", addr).Str("ollama", cfg.OllamaURL).Str("model", cfg.DefaultModel).Msg("BIS Ollama Adapter starting")
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal().Err(err).Msg("Server failed")
	}
}

// Ensure io is used
var _ = io.Discard
