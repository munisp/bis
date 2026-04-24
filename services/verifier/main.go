// BIS Verifier Microservice — Go
//
// Standalone identity verification service that exposes Nigerian data source
// lookups over a clean REST API. This service is the BIS own-engine layer —
// it calls NIMC, NIBSS, CAC, and sanctions APIs directly, with a Youverify
// fallback when own-engine credentials are not configured.
//
// Port: 8086
// Auth: X-BIS-Key header (BIS_VERIFIER_KEY env var)
//
// Routes:
//   POST /v1/nin        — NIN lookup (NIMC)
//   POST /v1/bvn        — BVN lookup (NIBSS)
//   POST /v1/cac        — CAC RC lookup
//   POST /v1/sanctions  — OFAC/UN/EU/EFCC sanctions check
//   GET  /health        — Health check
//
// Environment variables:
//   BIS_VERIFIER_KEY        — API key for this service (required)
//   BIS_VERIFY_NIMC_URL     — NIMC API endpoint
//   BIS_VERIFY_NIMC_KEY     — NIMC API key
//   BIS_VERIFY_NIBSS_URL    — NIBSS API endpoint
//   BIS_VERIFY_NIBSS_KEY    — NIBSS API key
//   BIS_VERIFY_CAC_URL      — CAC API endpoint
//   BIS_VERIFY_CAC_KEY      — CAC API key
//   YOUVERIFY_BASE_URL      — Youverify fallback base URL
//   YOUVERIFY_API_KEY       — Youverify API key
//   GATEWAY_SANDBOX         — "true" to force sandbox mode (default: false)
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"bis/verifier/internal"
)

// ─── Config ──────────────────────────────────────────────────────────────────

var (
	port         = envOr("VERIFIER_PORT", "8086")
	verifierKey  = envOr("BIS_VERIFIER_KEY", "dev-verifier-key-change-in-prod")
	sandboxMode  = os.Getenv("GATEWAY_SANDBOX") == "true"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Middleware ───────────────────────────────────────────────────────────────

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-BIS-Key")
		if key == "" {
			key = r.Header.Get("Authorization")
			if len(key) > 7 && key[:7] == "Bearer " {
				key = key[7:]
			}
		}
		if key != verifierKey {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-BIS-Key, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("[%s] %s %s %dms", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start).Milliseconds())
	})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// ─── Handlers ────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "bis-verifier",
		"sandbox": sandboxMode,
		"ts":      time.Now().UTC().Format(time.RFC3339),
	})
}

func ninHandler(eng *internal.Engine) http.HandlerFunc {
	return authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			NIN string `json:"nin"`
		}
		if err := decodeBody(r, &req); err != nil || req.NIN == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nin is required"})
			return
		}
		result, err := eng.LookupNIN(r.Context(), req.NIN)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

func bvnHandler(eng *internal.Engine) http.HandlerFunc {
	return authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			BVN string `json:"bvn"`
		}
		if err := decodeBody(r, &req); err != nil || req.BVN == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bvn is required"})
			return
		}
		result, err := eng.LookupBVN(r.Context(), req.BVN)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

func cacHandler(eng *internal.Engine) http.HandlerFunc {
	return authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RC string `json:"rc"`
		}
		if err := decodeBody(r, &req); err != nil || req.RC == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "rc (registration number) is required"})
			return
		}
		result, err := eng.LookupCAC(r.Context(), req.RC)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

func sanctionsHandler(eng *internal.Engine) http.HandlerFunc {
	return authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name        string `json:"name"`
			DateOfBirth string `json:"dateOfBirth,omitempty"`
			Nationality string `json:"nationality,omitempty"`
		}
		if err := decodeBody(r, &req); err != nil || req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
			return
		}
		result, err := eng.CheckSanctions(r.Context(), req.Name, req.DateOfBirth, req.Nationality)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := internal.ConfigFromEnv()
	cfg.SandboxMode = sandboxMode
	eng := internal.NewEngine(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("POST /v1/nin", ninHandler(eng))
	mux.HandleFunc("POST /v1/bvn", bvnHandler(eng))
	mux.HandleFunc("POST /v1/cac", cacHandler(eng))
	mux.HandleFunc("POST /v1/sanctions", sanctionsHandler(eng))

	handler := loggingMiddleware(corsMiddleware(mux))

	log.Printf("[verifier] Starting on :%s (sandbox=%v)", port, sandboxMode)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("[verifier] Fatal: %v", err)
	}
}
