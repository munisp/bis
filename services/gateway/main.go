// BIS API Gateway — Go
// Proxies requests to Nigerian data sources (NIMC, BVN, CAC, EFCC, OFAC, etc.)
// and exposes a unified REST API consumed by the Node.js BFF.
//
// Port: 8081
// All endpoints require X-BIS-Key header (validated against BIS_GATEWAY_KEY env var).

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Config ──────────────────────────────────────────────────────────────────

var (
	port       = envOr("GATEWAY_PORT", "8081")
	gatewayKey = envOr("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")
	riskEngineURL = envOr("RISK_ENGINE_URL", "http://localhost:8082")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Models ──────────────────────────────────────────────────────────────────

type NINResult struct {
	NIN         string `json:"nin"`
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	MiddleName  string `json:"middleName"`
	DOB         string `json:"dob"`
	Gender      string `json:"gender"`
	Phone       string `json:"phone"`
	State       string `json:"state"`
	LGA         string `json:"lga"`
	Address     string `json:"address"`
	Photo       string `json:"photo"`
	Status      string `json:"status"`
	MatchScore  float64 `json:"matchScore"`
	VerifiedAt  string `json:"verifiedAt"`
}

type BVNResult struct {
	BVN         string  `json:"bvn"`
	FirstName   string  `json:"firstName"`
	LastName    string  `json:"lastName"`
	MiddleName  string  `json:"middleName"`
	DOB         string  `json:"dob"`
	Phone       string  `json:"phone"`
	Bank        string  `json:"bank"`
	AccountNo   string  `json:"accountNo"`
	Watchlisted bool    `json:"watchlisted"`
	MatchScore  float64 `json:"matchScore"`
	VerifiedAt  string  `json:"verifiedAt"`
}

type CACResult struct {
	RCNumber    string   `json:"rcNumber"`
	CompanyName string   `json:"companyName"`
	Status      string   `json:"status"`
	Type        string   `json:"type"`
	DateReg     string   `json:"dateRegistered"`
	Address     string   `json:"address"`
	Directors   []string `json:"directors"`
	Shareholders []string `json:"shareholders"`
	VerifiedAt  string   `json:"verifiedAt"`
}

type SanctionsResult struct {
	Queried   string        `json:"queried"`
	Hits      []SanctionHit `json:"hits"`
	Clear     bool          `json:"clear"`
	CheckedAt string        `json:"checkedAt"`
}

type SanctionHit struct {
	List       string  `json:"list"`
	Name       string  `json:"name"`
	Score      float64 `json:"score"`
	EntityType string  `json:"entityType"`
	Programs   []string `json:"programs"`
	Reason     string  `json:"reason"`
}

type PEPResult struct {
	Queried   string   `json:"queried"`
	IsPEP     bool     `json:"isPEP"`
	Roles     []string `json:"roles"`
	Party     string   `json:"party"`
	Country   string   `json:"country"`
	CheckedAt string   `json:"checkedAt"`
}

type CreditResult struct {
	BVN         string  `json:"bvn"`
	Score       int     `json:"score"`
	Grade       string  `json:"grade"`
	TotalLoans  int     `json:"totalLoans"`
	ActiveLoans int     `json:"activeLoans"`
	Defaults    int     `json:"defaults"`
	CheckedAt   string  `json:"checkedAt"`
}

type GatewayError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ─── Middleware ───────────────────────────────────────────────────────────────

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-BIS-Key")
		if key == "" {
			key = r.URL.Query().Get("key")
		}
		if key != gatewayKey {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or missing API key")
			return
		}
		next(w, r)
	}
}

func loggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		log.Printf("[%s] %s %s", r.Method, r.URL.Path, r.RemoteAddr)
		next(w, r)
		log.Printf("[%s] %s completed in %s", r.Method, r.URL.Path, time.Since(start))
	}
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-BIS-Key, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func chain(h http.HandlerFunc, middlewares ...func(http.HandlerFunc) http.HandlerFunc) http.HandlerFunc {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, GatewayError{Code: code, Message: msg})
}

func simulateLatency() {
	ms := 80 + rand.Intn(120) // 80–200ms realistic API latency
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

var nigerianStates = []string{
	"Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Delta", "Anambra",
	"Kaduna", "Enugu", "Ogun", "Imo", "Borno", "Edo", "Kwara", "Plateau",
}

var banks = []string{
	"Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA",
	"Fidelity Bank", "Union Bank", "Stanbic IBTC", "Wema Bank", "Polaris Bank",
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /v1/nin/:nin — NIMC NIN lookup
func handleNINLookup(w http.ResponseWriter, r *http.Request) {
	nin := strings.TrimPrefix(r.URL.Path, "/v1/nin/")
	if len(nin) != 11 {
		writeError(w, http.StatusBadRequest, "INVALID_NIN", "NIN must be exactly 11 digits")
		return
	}
	simulateLatency()

	// Deterministic mock from NIN seed
	seed := int64(0)
	for _, c := range nin {
		seed += int64(c)
	}
	rng := rand.New(rand.NewSource(seed))
	state := nigerianStates[rng.Intn(len(nigerianStates))]

	result := NINResult{
		NIN:        nin,
		FirstName:  "ADEBAYO",
		LastName:   "OKAFOR",
		MiddleName: "CHUKWUEMEKA",
		DOB:        "1988-04-15",
		Gender:     "MALE",
		Phone:      fmt.Sprintf("0803%07d", rng.Intn(9999999)),
		State:      state,
		LGA:        "Ikeja",
		Address:    fmt.Sprintf("%d Adeola Odeku Street, %s", 10+rng.Intn(90), state),
		Photo:      "",
		Status:     "VERIFIED",
		MatchScore: 0.97 + rng.Float64()*0.03,
		VerifiedAt: now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /v1/bvn/:bvn — CBN BVN lookup
func handleBVNLookup(w http.ResponseWriter, r *http.Request) {
	bvn := strings.TrimPrefix(r.URL.Path, "/v1/bvn/")
	if len(bvn) != 11 {
		writeError(w, http.StatusBadRequest, "INVALID_BVN", "BVN must be exactly 11 digits")
		return
	}
	simulateLatency()

	seed := int64(0)
	for _, c := range bvn {
		seed += int64(c)
	}
	rng := rand.New(rand.NewSource(seed))
	bank := banks[rng.Intn(len(banks))]

	result := BVNResult{
		BVN:        bvn,
		FirstName:  "NGOZI",
		LastName:   "IBRAHIM",
		MiddleName: "FATIMA",
		DOB:        "1992-11-03",
		Phone:      fmt.Sprintf("0812%07d", rng.Intn(9999999)),
		Bank:       bank,
		AccountNo:  fmt.Sprintf("%010d", rng.Intn(9999999999)),
		Watchlisted: rng.Float64() < 0.05, // 5% watchlisted
		MatchScore: 0.94 + rng.Float64()*0.06,
		VerifiedAt: now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /v1/cac/:rc — CAC company lookup
func handleCACLookup(w http.ResponseWriter, r *http.Request) {
	rc := strings.TrimPrefix(r.URL.Path, "/v1/cac/")
	if rc == "" {
		writeError(w, http.StatusBadRequest, "INVALID_RC", "RC number is required")
		return
	}
	simulateLatency()

	result := CACResult{
		RCNumber:    rc,
		CompanyName: "TECHBRIDGE SOLUTIONS LIMITED",
		Status:      "ACTIVE",
		Type:        "Private Limited Company",
		DateReg:     "2015-06-22",
		Address:     "Plot 14, Admiralty Way, Lekki Phase 1, Lagos",
		Directors:   []string{"ADEBAYO OKAFOR", "NGOZI IBRAHIM", "EMEKA NWOSU"},
		Shareholders: []string{"ADEBAYO OKAFOR (60%)", "NGOZI IBRAHIM (40%)"},
		VerifiedAt:  now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /v1/sanctions/:name — OFAC + UN + INTERPOL sanctions screening
func handleSanctionsCheck(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/v1/sanctions/")
	name = strings.ReplaceAll(name, "%20", " ")
	if name == "" {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "Name is required")
		return
	}
	simulateLatency()

	// Deterministic: flag names containing "NWOSU" as a hit for demo
	hits := []SanctionHit{}
	clear := true
	if strings.Contains(strings.ToUpper(name), "NWOSU") {
		clear = false
		hits = append(hits, SanctionHit{
			List:       "OFAC SDN",
			Name:       name,
			Score:      0.91,
			EntityType: "Individual",
			Programs:   []string{"SDGT", "CYBER2"},
			Reason:     "Designated for involvement in cyber-enabled financial fraud",
		})
	}

	result := SanctionsResult{
		Queried:   name,
		Hits:      hits,
		Clear:     clear,
		CheckedAt: now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /v1/pep/:name — PEP screening
func handlePEPCheck(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/v1/pep/")
	name = strings.ReplaceAll(name, "%20", " ")
	simulateLatency()

	isPEP := strings.Contains(strings.ToUpper(name), "IBRAHIM")
	roles := []string{}
	party := ""
	if isPEP {
		roles = []string{"Senator", "Former Minister of Finance"}
		party = "APC"
	}

	result := PEPResult{
		Queried:   name,
		IsPEP:     isPEP,
		Roles:     roles,
		Party:     party,
		Country:   "Nigeria",
		CheckedAt: now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /v1/credit/:bvn — Credit bureau check
func handleCreditCheck(w http.ResponseWriter, r *http.Request) {
	bvn := strings.TrimPrefix(r.URL.Path, "/v1/credit/")
	simulateLatency()

	seed := int64(0)
	for _, c := range bvn {
		seed += int64(c)
	}
	rng := rand.New(rand.NewSource(seed))
	score := 450 + rng.Intn(400) // 450–850

	grade := "A"
	switch {
	case score < 550:
		grade = "D"
	case score < 650:
		grade = "C"
	case score < 750:
		grade = "B"
	}

	result := CreditResult{
		BVN:         bvn,
		Score:       score,
		Grade:       grade,
		TotalLoans:  rng.Intn(8),
		ActiveLoans: rng.Intn(3),
		Defaults:    rng.Intn(2),
		CheckedAt:   now(),
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "bis-gateway",
		"version": "1.0.0",
		"time":    now(),
	})
}

// ─── Router ───────────────────────────────────────────────────────────────────

func router() http.Handler {
	mux := http.NewServeMux()

	protected := func(h http.HandlerFunc) http.HandlerFunc {
		return chain(h, corsMiddleware, loggingMiddleware, authMiddleware)
	}
	public := func(h http.HandlerFunc) http.HandlerFunc {
		return chain(h, corsMiddleware, loggingMiddleware)
	}

	mux.HandleFunc("/health", public(handleHealth))
	mux.HandleFunc("/v1/nin/", protected(handleNINLookup))
	mux.HandleFunc("/v1/bvn/", protected(handleBVNLookup))
	mux.HandleFunc("/v1/cac/", protected(handleCACLookup))
	mux.HandleFunc("/v1/sanctions/", protected(handleSanctionsCheck))
	mux.HandleFunc("/v1/pep/", protected(handlePEPCheck))
	mux.HandleFunc("/v1/credit/", protected(handleCreditCheck))

	return mux
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.Printf("BIS API Gateway starting on :%s", port)
	log.Printf("Risk Engine URL: %s", riskEngineURL)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
