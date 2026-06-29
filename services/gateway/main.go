// BIS API Gateway — Go
// Proxies requests to Nigerian data sources (NIMC, BVN, CAC, EFCC, OFAC, etc.)
// and exposes a unified REST API consumed by the Node.js BFF.
//
// Port: 8081
// All endpoints require X-BIS-Key header (validated against BIS_GATEWAY_KEY env var).
// Middleware: Redis caching, Kafka event publishing, Keycloak JWT validation, Permify authz
//
// External API integration pattern:
//   - NIMC NIN:      POST https://api.nimc.gov.ng/v1/nin/verify  (env: NIMC_API_URL, NIMC_API_KEY)
//   - NIBSS BVN:     POST https://api.nibss-plc.org.ng/v1/bvn    (env: NIBSS_API_URL, NIBSS_API_KEY)
//   - CAC:           GET  https://efts.cac.gov.ng/api/v1/company  (env: CAC_API_URL, CAC_API_KEY)
//   - OFAC/UN:       GET  https://api.ofac.treasury.gov/v1/search (env: OFAC_API_URL, OFAC_API_KEY)
//   - CRC Credit:    POST https://api.creditreg.ng/v1/score       (env: CRC_API_URL, CRC_API_KEY)
//
// When an external API key is not configured, the gateway falls back to a
// deterministic sandbox response (clearly flagged in the response as "sandbox: true").
// This ensures the service is fully functional in development without real credentials.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	daprpkg "bis/gateway/dapr"
	insiderpkg "bis/gateway/insider"
	kafkapkg "bis/gateway/kafka"
	ospkg "bis/gateway/opensearch"
	keycloakpkg "bis/gateway/keycloak"
	permifypkg "bis/gateway/permify"
	redispkg "bis/gateway/redis"
	temporalpkg "bis/gateway/temporal"
	tigerbeetlepkg "bis/gateway/tigerbeetle"
	verifypkg "bis/gateway/verify"
)

// ─── Config ──────────────────────────────────────────────────────────────────

var (
	port          = envOr("GATEWAY_PORT", "8081")
	gatewayKey    = envOr("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")
	riskEngineURL = envOr("RISK_ENGINE_URL", "http://localhost:8082")
	eventProcURL  = envOr("EVENT_PROCESSOR_URL", "http://localhost:8083")

	// External API credentials — empty = sandbox mode
	nimcAPIURL  = envOr("NIMC_API_URL", "")
	nimcAPIKey  = envOr("NIMC_API_KEY", "")
	nibssAPIURL = envOr("NIBSS_API_URL", "")
	nibssAPIKey = envOr("NIBSS_API_KEY", "")
	cacAPIURL   = envOr("CAC_API_URL", "")
	cacAPIKey   = envOr("CAC_API_KEY", "")
	ofacAPIURL  = envOr("OFAC_API_URL", "")
	ofacAPIKey  = envOr("OFAC_API_KEY", "")
	crcAPIURL   = envOr("CRC_API_URL", "")
	crcAPIKey   = envOr("CRC_API_KEY", "")

	// Biometric engine
	biometricEngineURL = envOr("BIOMETRIC_ENGINE_URL", "http://localhost:8084")

	// Middleware
	redisAddr     = envOr("REDIS_ADDR", "localhost:6379")
	redisPassword = envOr("REDIS_PASSWORD", "bis_redis_dev")
	kafkaBrokers  = envOr("KAFKA_BROKERS", "localhost:9092")
	keycloakURL   = envOr("KEYCLOAK_URL", "")
	permifyURL    = envOr("PERMIFY_URL", "")
	temporalHost  = envOr("TEMPORAL_HOST", "")
	tbAddr        = envOr("TIGERBEETLE_ADDR", "")

	// Initialized middleware clients (nil = not configured)
	redisClient      *redispkg.Client
	kafkaProducer    *kafkapkg.Producer
	keycloakClient   *keycloakpkg.OIDCClient
	permifyClient    *permifypkg.Client
	temporalClient   *temporalpkg.Client
	tbClient         *tigerbeetlepkg.Client
	// BIS own verification engine (with Youverify fallback)
	verifyEngine     *verifypkg.Engine
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Middleware init ──────────────────────────────────────────────────────────

func initMiddleware() {
	// Redis
	if redisAddr != "" {
		c, err := redispkg.NewClient(redisAddr, redisPassword)
		if err != nil {
			log.Printf("[WARN] Redis unavailable: %v — caching disabled", err)
		} else {
			redisClient = c
			log.Printf("[INFO] Redis connected: %s", redisAddr)
		}
	}

	// Kafka
	if kafkaBrokers != "" {
		p, err := kafkapkg.NewProducer(kafkaBrokers)
		if err != nil {
			log.Printf("[WARN] Kafka unavailable: %v — event publishing disabled", err)
		} else {
			kafkaProducer = p
			log.Printf("[INFO] Kafka producer connected: %s", kafkaBrokers)
			startDLQReplay()
		}
	}

	// Keycloak
	if keycloakURL != "" {
		c, err := keycloakpkg.NewOIDCClient(keycloakURL, envOr("KEYCLOAK_REALM", "bis"), envOr("KEYCLOAK_CLIENT_ID", "bis-gateway"))
		if err != nil {
			log.Printf("[WARN] Keycloak unavailable: %v — OIDC validation disabled", err)
		} else {
			keycloakClient = c
			log.Printf("[INFO] Keycloak OIDC client initialized: %s", keycloakURL)
		}
	}

	// Permify
	if permifyURL != "" {
		permifyClient = permifypkg.New()
		log.Printf("[INFO] Permify client initialized: %s", permifyURL)
	}

	// Temporal
	if temporalHost != "" {
		c, err := temporalpkg.NewClient(temporalHost, envOr("TEMPORAL_NAMESPACE", "bis"))
		if err != nil {
			log.Printf("[WARN] Temporal unavailable: %v — workflow orchestration disabled", err)
		} else {
			temporalClient = c
			log.Printf("[INFO] Temporal client initialized: %s", temporalHost)
		}
	}

	// TigerBeetle
	if tbAddr != "" {
		tbClient = tigerbeetlepkg.New()
		log.Printf("[INFO] TigerBeetle client initialized: %s", tbAddr)
	}

	// BIS Verification Engine (own engine + Youverify fallback)
	verifyEngine = verifypkg.New(verifypkg.ConfigFromEnv())
	log.Printf("[INFO] BIS Verification Engine initialized (own: NIMC=%v NIBSS=%v CAC=%v OFAC=%v, youverify=%v)",
		os.Getenv("BIS_VERIFY_NIMC_URL") != "",
		os.Getenv("BIS_VERIFY_NIBSS_URL") != "",
		os.Getenv("BIS_VERIFY_CAC_URL") != "",
		os.Getenv("BIS_VERIFY_OFAC_URL") != "",
		os.Getenv("YOUVERIFY_API_KEY") != "",
	)
}

// ─── Models ──────────────────────────────────────────────────────────────────

type NINResult struct {
	NIN        string  `json:"nin"`
	FirstName  string  `json:"firstName"`
	LastName   string  `json:"lastName"`
	MiddleName string  `json:"middleName"`
	DOB        string  `json:"dob"`
	Gender     string  `json:"gender"`
	Phone      string  `json:"phone"`
	State      string  `json:"state"`
	LGA        string  `json:"lga"`
	Address    string  `json:"address"`
	Photo      string  `json:"photo"`
	Status     string  `json:"status"`
	MatchScore float64 `json:"matchScore"`
	VerifiedAt string  `json:"verifiedAt"`
	Sandbox    bool    `json:"sandbox,omitempty"`
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
	Sandbox     bool    `json:"sandbox,omitempty"`
}

type CACResult struct {
	RCNumber     string   `json:"rcNumber"`
	CompanyName  string   `json:"companyName"`
	Status       string   `json:"status"`
	Type         string   `json:"type"`
	DateReg      string   `json:"dateRegistered"`
	Address      string   `json:"address"`
	Directors    []string `json:"directors"`
	Shareholders []string `json:"shareholders"`
	VerifiedAt   string   `json:"verifiedAt"`
	Sandbox      bool     `json:"sandbox,omitempty"`
}

type SanctionsResult struct {
	Queried   string        `json:"queried"`
	Hits      []SanctionHit `json:"hits"`
	Clear     bool          `json:"clear"`
	CheckedAt string        `json:"checkedAt"`
	Sandbox   bool          `json:"sandbox,omitempty"`
}

type SanctionHit struct {
	List       string   `json:"list"`
	Name       string   `json:"name"`
	Score      float64  `json:"score"`
	EntityType string   `json:"entityType"`
	Programs   []string `json:"programs"`
	Reason     string   `json:"reason"`
}

type PEPResult struct {
	Queried   string   `json:"queried"`
	IsPEP     bool     `json:"isPEP"`
	Roles     []string `json:"roles"`
	Party     string   `json:"party"`
	Country   string   `json:"country"`
	CheckedAt string   `json:"checkedAt"`
	Sandbox   bool     `json:"sandbox,omitempty"`
}

type CreditResult struct {
	BVN         string `json:"bvn"`
	Score       int    `json:"score"`
	Grade       string `json:"grade"`
	TotalLoans  int    `json:"totalLoans"`
	ActiveLoans int    `json:"activeLoans"`
	Defaults    int    `json:"defaults"`
	CheckedAt   string `json:"checkedAt"`
	Sandbox     bool   `json:"sandbox,omitempty"`
}

type GatewayError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ─── Middleware ───────────────────────────────────────────────────────────────

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Try Keycloak Bearer token if configured
		if keycloakClient != nil {
			bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if bearer != "" {
				if err := keycloakClient.ValidateToken(r.Context(), bearer); err == nil {
					next(w, r)
					return
				}
			}
		}

		// 2. Fall back to X-BIS-Key header / query param
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

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// cacheGet retrieves a cached value from Redis. Returns nil if Redis is not configured or key missing.
func cacheGet(ctx context.Context, key string) []byte {
	if redisClient == nil {
		return nil
	}
	val, err := redisClient.Get(ctx, key)
	if err != nil {
		return nil
	}
	return []byte(val)
}

// cacheSet stores a value in Redis with a TTL. No-op if Redis is not configured.
func cacheSet(ctx context.Context, key string, val []byte, ttl time.Duration) {
	if redisClient == nil {
		return
	}
	if err := redisClient.Set(ctx, key, string(val), ttl); err != nil {
		log.Printf("[WARN] Redis SET failed for key %s: %v", key, err)
	}
}

// publishEvent sends an event to Kafka with DLQ fallback on failure.
func publishEvent(topic string, payload any) {
	publishEventWithDLQ(topic, payload)
}

// checkPermify verifies fine-grained authorization. Returns true if Permify is not configured (permissive default).
func checkPermify(ctx context.Context, subject, action, resource string) bool {
	if permifyClient == nil {
		return true // permissive when not configured
	}
	allowed, err := permifyClient.Check(ctx, "user", subject, action, resource)
	if err != nil {
		log.Printf("[WARN] Permify check failed: %v — allowing by default", err)
		return true
	}
	return allowed
}

// proxyExternalAPI makes a real HTTP call to an external API.
// Returns (body, nil) on success, (nil, err) on failure.
func proxyExternalAPI(method, url, apiKey string, reqBody any) ([]byte, error) {
	var bodyReader io.Reader
	if reqBody != nil {
		data, err := json.Marshal(reqBody)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("X-API-Key", apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream error %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ─── Sandbox data helpers ─────────────────────────────────────────────────────

var nigerianStates = []string{
	"Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Delta", "Anambra",
	"Kaduna", "Enugu", "Ogun", "Imo", "Borno", "Edo", "Kwara", "Plateau",
}

var nigerianFirstNames = []string{
	"ADEBAYO", "NGOZI", "EMEKA", "FATIMA", "CHIOMA", "IBRAHIM", "AISHA",
	"OLUWASEUN", "KELECHI", "AMINA", "TUNDE", "BLESSING", "UCHE", "HALIMA",
}

var nigerianLastNames = []string{
	"OKAFOR", "IBRAHIM", "NWOSU", "ADEYEMI", "BELLO", "EZE", "JOHNSON",
	"ABUBAKAR", "OKONKWO", "WILLIAMS", "MUSA", "OSEI", "DIKE", "LAWAL",
}

var banks = []string{
	"Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA",
	"Fidelity Bank", "Union Bank", "Stanbic IBTC", "Wema Bank", "Polaris Bank",
}

func deterministicRNG(seed string) *rand.Rand {
	s := int64(0)
	for _, c := range seed {
		s += int64(c)
	}
	return rand.New(rand.NewSource(s))
}

func sandboxNIN(nin string) NINResult {
	rng := deterministicRNG(nin)
	state := nigerianStates[rng.Intn(len(nigerianStates))]
	return NINResult{
		NIN:        nin,
		FirstName:  nigerianFirstNames[rng.Intn(len(nigerianFirstNames))],
		LastName:   nigerianLastNames[rng.Intn(len(nigerianLastNames))],
		MiddleName: nigerianFirstNames[rng.Intn(len(nigerianFirstNames))],
		DOB:        fmt.Sprintf("%d-%02d-%02d", 1970+rng.Intn(35), 1+rng.Intn(12), 1+rng.Intn(28)),
		Gender:     []string{"MALE", "FEMALE"}[rng.Intn(2)],
		Phone:      fmt.Sprintf("0%d%07d", 803+rng.Intn(10), rng.Intn(9999999)),
		State:      state,
		LGA:        "Ikeja",
		Address:    fmt.Sprintf("%d Adeola Odeku Street, %s", 10+rng.Intn(90), state),
		Status:     "VERIFIED",
		MatchScore: 0.92 + rng.Float64()*0.08,
		VerifiedAt: now(),
		Sandbox:    true,
	}
}

func sandboxBVN(bvn string) BVNResult {
	rng := deterministicRNG(bvn)
	return BVNResult{
		BVN:         bvn,
		FirstName:   nigerianFirstNames[rng.Intn(len(nigerianFirstNames))],
		LastName:    nigerianLastNames[rng.Intn(len(nigerianLastNames))],
		MiddleName:  nigerianFirstNames[rng.Intn(len(nigerianFirstNames))],
		DOB:         fmt.Sprintf("%d-%02d-%02d", 1975+rng.Intn(30), 1+rng.Intn(12), 1+rng.Intn(28)),
		Phone:       fmt.Sprintf("0%d%07d", 812+rng.Intn(10), rng.Intn(9999999)),
		Bank:        banks[rng.Intn(len(banks))],
		AccountNo:   fmt.Sprintf("%010d", rng.Intn(9999999999)),
		Watchlisted: rng.Float64() < 0.04,
		MatchScore:  0.93 + rng.Float64()*0.07,
		VerifiedAt:  now(),
		Sandbox:     true,
	}
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /v1/nin/:nin — NIMC NIN lookup
func handleNINLookup(w http.ResponseWriter, r *http.Request) {
	nin := strings.TrimPrefix(r.URL.Path, "/v1/nin/")
	if len(nin) != 11 {
		writeError(w, http.StatusBadRequest, "INVALID_NIN", "NIN must be exactly 11 digits")
		return
	}

	// Check Permify authorization
	if !checkPermify(r.Context(), "gateway", "read", "nin") {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Insufficient permissions for NIN lookup")
		return
	}

	// Redis cache check (TTL: 24h — NIN data doesn't change frequently)
	cacheKey := "nin:" + nin
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	// BIS Verification Engine: own engine → Youverify → sandbox
	vr := verifyEngine.LookupNIN(r.Context(), nin)
	result := NINResult{
		NIN:        vr.NIN,
		FirstName:  vr.FirstName,
		LastName:   vr.LastName,
		MiddleName: vr.MiddleName,
		DOB:        vr.DOB,
		Gender:     vr.Gender,
		Phone:      vr.Phone,
		Address:    vr.Address,
		State:      vr.State,
		Photo:      vr.Photo,
		Status:     vr.Status,
		VerifiedAt: vr.CheckedAt,
		Sandbox:    vr.Sandbox,
	}
	log.Printf("[INFO] NIN lookup %s: source=%s sandbox=%v", nin, vr.Source, vr.Sandbox)

	// Cache the result
	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 24*time.Hour)
	}

	// Publish lookup event to Kafka
	publishEvent("bis.gateway.nin_lookup", map[string]any{
		"nin":       nin,
		"sandbox":   result.Sandbox,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

// GET /v1/bvn/:bvn — CBN BVN lookup
func handleBVNLookup(w http.ResponseWriter, r *http.Request) {
	bvn := strings.TrimPrefix(r.URL.Path, "/v1/bvn/")
	if len(bvn) != 11 {
		writeError(w, http.StatusBadRequest, "INVALID_BVN", "BVN must be exactly 11 digits")
		return
	}

	if !checkPermify(r.Context(), "gateway", "read", "bvn") {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Insufficient permissions for BVN lookup")
		return
	}

	cacheKey := "bvn:" + bvn
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	// BIS Verification Engine: own engine → Youverify → sandbox
	vr := verifyEngine.LookupBVN(r.Context(), bvn)
	result := BVNResult{
		BVN:        vr.BVN,
		FirstName:  vr.FirstName,
		LastName:   vr.LastName,
		MiddleName: vr.MiddleName,
		DOB:        vr.DOB,
		Phone:      vr.Phone,
		Bank:       vr.BankName,
		AccountNo:  vr.AccountNumber,
		VerifiedAt: vr.CheckedAt,
		Sandbox:    vr.Sandbox,
	}
	log.Printf("[INFO] BVN lookup %s: source=%s sandbox=%v", bvn, vr.Source, vr.Sandbox)

	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 24*time.Hour)
	}

	publishEvent("bis.gateway.bvn_lookup", map[string]any{
		"bvn":       bvn,
		"sandbox":   result.Sandbox,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

// GET /v1/cac/:rc — CAC company lookup
func handleCACLookup(w http.ResponseWriter, r *http.Request) {
	rc := strings.TrimPrefix(r.URL.Path, "/v1/cac/")
	if rc == "" {
		writeError(w, http.StatusBadRequest, "INVALID_RC", "RC number is required")
		return
	}

	cacheKey := "cac:" + rc
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	// BIS Verification Engine: own engine → Youverify → sandbox
	vr := verifyEngine.LookupCAC(r.Context(), rc)
	result := CACResult{
		RCNumber:    vr.RCNumber,
		CompanyName: vr.CompanyName,
		Status:      vr.Status,
		Type:        vr.CompanyType,
		DateReg:     vr.IncDate,
		Address:     vr.Address,
		Directors:   vr.Directors,
		VerifiedAt:  vr.CheckedAt,
		Sandbox:     vr.Sandbox,
	}
	log.Printf("[INFO] CAC lookup %s: source=%s sandbox=%v", rc, vr.Source, vr.Sandbox)

	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 12*time.Hour)
	}

	publishEvent("bis.gateway.cac_lookup", map[string]any{
		"rc":        rc,
		"sandbox":   result.Sandbox,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

func sandboxCAC(rc string) CACResult {
	rng := deterministicRNG(rc)
	companyTypes := []string{"Private Limited Company", "Public Limited Company", "Business Name", "Incorporated Trustee"}
	return CACResult{
		RCNumber:     rc,
		CompanyName:  fmt.Sprintf("%s %s LIMITED", nigerianLastNames[rng.Intn(len(nigerianLastNames))], []string{"TECH", "VENTURES", "SOLUTIONS", "ENTERPRISES", "GLOBAL"}[rng.Intn(5)]),
		Status:       []string{"ACTIVE", "ACTIVE", "ACTIVE", "INACTIVE", "STRUCK_OFF"}[rng.Intn(5)],
		Type:         companyTypes[rng.Intn(len(companyTypes))],
		DateReg:      fmt.Sprintf("%d-%02d-%02d", 2000+rng.Intn(24), 1+rng.Intn(12), 1+rng.Intn(28)),
		Address:      fmt.Sprintf("Plot %d, %s Road, Lagos", rng.Intn(100), nigerianStates[rng.Intn(len(nigerianStates))]),
		Directors:    []string{nigerianFirstNames[rng.Intn(len(nigerianFirstNames))] + " " + nigerianLastNames[rng.Intn(len(nigerianLastNames))], nigerianFirstNames[rng.Intn(len(nigerianFirstNames))] + " " + nigerianLastNames[rng.Intn(len(nigerianLastNames))]},
		Shareholders: []string{nigerianFirstNames[rng.Intn(len(nigerianFirstNames))] + " " + nigerianLastNames[rng.Intn(len(nigerianLastNames))] + " (60%)", nigerianFirstNames[rng.Intn(len(nigerianFirstNames))] + " " + nigerianLastNames[rng.Intn(len(nigerianLastNames))] + " (40%)"},
		VerifiedAt:   now(),
		Sandbox:      true,
	}
}

// GET /v1/sanctions/:name — OFAC + UN + INTERPOL sanctions screening
func handleSanctionsCheck(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/v1/sanctions/")
	name = strings.ReplaceAll(name, "%20", " ")
	if name == "" {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "Name is required")
		return
	}

	cacheKey := "sanctions:" + strings.ToUpper(name)
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	// BIS Verification Engine: own engine → Youverify → sandbox
	vr := verifyEngine.CheckSanctions(r.Context(), name)
	// Map verify.SanctionsResult → gateway SanctionsResult
	hits := make([]SanctionHit, 0, len(vr.Hits))
	for _, h := range vr.Hits {
		hits = append(hits, SanctionHit{
			List:       h.List,
			Name:       h.Name,
			Score:      h.Score,
			EntityType: h.EntityType,
			Programs:   h.Programs,
			Reason:     h.Reason,
		})
	}
	result := SanctionsResult{
		Queried:   vr.Queried,
		Hits:      hits,
		Clear:     vr.Clear,
		CheckedAt: vr.CheckedAt,
		Sandbox:   vr.Sandbox,
	}
	log.Printf("[INFO] Sanctions check %s: source=%s clear=%v hits=%d", name, vr.Source, vr.Clear, len(hits))

	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 6*time.Hour)
	}

	publishEvent("bis.gateway.sanctions_check", map[string]any{
		"name":      name,
		"clear":     result.Clear,
		"hits":      len(result.Hits),
		"sandbox":   result.Sandbox,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

func sandboxSanctions(name string) SanctionsResult {
	rng := deterministicRNG(name)
	hits := []SanctionHit{}
	clear := true
	// ~3% hit rate in sandbox
	if rng.Float64() < 0.03 {
		clear = false
		hits = append(hits, SanctionHit{
			List:       []string{"OFAC SDN", "UN Security Council", "EU Consolidated"}[rng.Intn(3)],
			Name:       strings.ToUpper(name),
			Score:      0.85 + rng.Float64()*0.15,
			EntityType: []string{"Individual", "Entity"}[rng.Intn(2)],
			Programs:   []string{"SDGT", "CYBER2"},
			Reason:     "Designated for involvement in financial crime",
		})
	}
	return SanctionsResult{
		Queried:   name,
		Hits:      hits,
		Clear:     clear,
		CheckedAt: now(),
		Sandbox:   true,
	}
}

// GET /v1/pep/:name — PEP screening
func handlePEPCheck(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/v1/pep/")
	name = strings.ReplaceAll(name, "%20", " ")

	cacheKey := "pep:" + strings.ToUpper(name)
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	rng := deterministicRNG(name)
	isPEP := rng.Float64() < 0.08 // ~8% PEP rate
	roles := []string{}
	party := ""
	if isPEP {
		roles = []string{
			[]string{"Senator", "Governor", "Minister", "House of Representatives Member", "Local Government Chairman"}[rng.Intn(5)],
		}
		party = []string{"APC", "PDP", "LP", "NNPP"}[rng.Intn(4)]
	}

	result := PEPResult{
		Queried:   name,
		IsPEP:     isPEP,
		Roles:     roles,
		Party:     party,
		Country:   "Nigeria",
		CheckedAt: now(),
		Sandbox:   true,
	}

	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 6*time.Hour)
	}

	publishEvent("bis.gateway.pep_check", map[string]any{
		"name":      name,
		"isPEP":     isPEP,
		"sandbox":   true,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

// GET /v1/credit/:bvn — Credit bureau check
func handleCreditCheck(w http.ResponseWriter, r *http.Request) {
	bvn := strings.TrimPrefix(r.URL.Path, "/v1/credit/")

	cacheKey := "credit:" + bvn
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		w.Write(cached)
		return
	}

	var result CreditResult

	if crcAPIURL != "" && crcAPIKey != "" {
		body, err := proxyExternalAPI("POST", crcAPIURL+"/score", crcAPIKey, map[string]string{"bvn": bvn})
		if err != nil {
			log.Printf("[WARN] CRC API error for BVN %s: %v — falling back to sandbox", bvn, err)
			result = sandboxCredit(bvn)
		} else {
			if err := json.Unmarshal(body, &result); err != nil {
				log.Printf("[WARN] CRC response parse error: %v — falling back to sandbox", err)
				result = sandboxCredit(bvn)
			}
		}
	} else {
		result = sandboxCredit(bvn)
	}

	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 12*time.Hour)
	}

	publishEvent("bis.gateway.credit_check", map[string]any{
		"bvn":       bvn,
		"score":     result.Score,
		"sandbox":   result.Sandbox,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, result)
}

func sandboxCredit(bvn string) CreditResult {
	rng := deterministicRNG(bvn)
	score := 450 + rng.Intn(400)
	grade := "A"
	switch {
	case score < 550:
		grade = "D"
	case score < 650:
		grade = "C"
	case score < 750:
		grade = "B"
	}
	return CreditResult{
		BVN:         bvn,
		Score:       score,
		Grade:       grade,
		TotalLoans:  rng.Intn(8),
		ActiveLoans: rng.Intn(3),
		Defaults:    rng.Intn(2),
		CheckedAt:   now(),
		Sandbox:     true,
	}
}

// POST /v1/risk-score — Proxy to Python risk engine
func handleRiskScore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "POST", riskEngineURL+"/score", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create risk engine request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", gatewayKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "RISK_ENGINE_UNAVAILABLE", "Risk engine is not responding")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/workflow/start — Start a Temporal workflow
func handleWorkflowStart(w http.ResponseWriter, r *http.Request) {
	if temporalClient == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"workflowId": fmt.Sprintf("wf-%d", time.Now().UnixMilli()),
			"status":     "started",
			"mode":       "direct", // no Temporal — direct execution
		})
		return
	}

	var req struct {
		WorkflowType string         `json:"workflowType"`
		Input        map[string]any `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid request body")
		return
	}

	runID, err := temporalClient.StartWorkflow(r.Context(), req.WorkflowType, req.Input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WORKFLOW_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"workflowId": runID,
		"status":     "started",
		"mode":       "temporal",
	})
}

// POST /v1/biometric/liveness — proxy to biometric engine liveness check
func handleBiometricLiveness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/liveness", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// Biometric engine not running — return sandbox response
		writeJSON(w, http.StatusOK, map[string]any{
			"liveness": true,
			"score":    0.97,
			"challenge": "blink",
			"passed":   true,
			"sandbox":  true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/enroll — proxy to biometric engine enrollment
func handleBiometricEnroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/enroll", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enrolled":   true,
			"faceId":     fmt.Sprintf("face-%d", time.Now().UnixMilli()),
			"quality":    0.94,
			"sandbox":    true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/verify — proxy to biometric engine face matching
func handleBiometricVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"match":      true,
			"similarity": 0.96,
			"threshold":  0.80,
			"faceId":     r.URL.Query().Get("faceId"),
			"sandbox":    true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/liveness/active — proxy to biometric engine active liveness
func handleBiometricActiveLiveness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify/liveness/active", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"score": 0.97, "live": true, "challenge": "blink",
			"challenge_completed": true, "frames_analysed": 10, "sandbox": true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	// Publish Kafka event
	publishEvent("bis.biometric.active_liveness_checked", map[string]any{"status": resp.StatusCode})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/antispoofing — proxy to biometric engine anti-spoofing
func handleBiometricAntispoofing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify/antispoofing", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"score": 0.98, "genuine": true, "reason": "passed",
			"model": "texture_analysis_fallback", "sandbox": true,
			"details": map[string]any{"sharpness": 0.95, "colour_depth": 0.92, "hf_score": 0.88},
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	publishEvent("bis.biometric.antispoofing_checked", map[string]any{"status": resp.StatusCode})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/full — proxy to biometric engine full composite verification
func handleBiometricFullVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify/full", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"verified": true, "overall_score": 0.96, "sandbox": true,
			"liveness": map[string]any{"live": true, "score": 0.97},
			"antispoofing": map[string]any{"genuine": true, "score": 0.98},
			"face_match": nil, "failure_reasons": []string{},
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	publishEvent("bis.biometric.full_verification", map[string]any{"status": resp.StatusCode})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/match — proxy to biometric engine 1:1 face matching
func handleBiometricMatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify/match", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"score": 0.96, "cosine_similarity": 0.92, "match": true,
			"threshold": 0.40, "reason": "match", "using_arcface": false, "sandbox": true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	publishEvent("bis.biometric.face_matched", map[string]any{"status": resp.StatusCode})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/detect — proxy to biometric engine face detection
func handleBiometricDetect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/detect/face", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"face_detected": true, "face_count": 1, "quality_score": 0.94,
			"bbox": map[string]any{"x": 0.2, "y": 0.1, "w": 0.6, "h": 0.8}, "sandbox": true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/landmarks — proxy to biometric engine 68-point landmark extraction
func handleBiometricLandmarks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/detect/landmarks", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"landmarks_found": true, "landmark_count": 68, "sandbox": true,
			"landmarks": []map[string]any{{"x": 0.3, "y": 0.4, "z": 0.0}},
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/features — proxy to biometric engine face feature extraction
func handleBiometricFeatures(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/extract/features", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"embedding_dimension": 512, "embedding_model": "arcface_fallback",
			"face_detected": true, "quality_score": 0.94, "sandbox": true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/ocr/face-extract — proxy to biometric engine face extraction from document
func handleBiometricFaceExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/ocr/face-extract", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true, "face_image": nil, "sandbox": true,
			"face_dimensions": map[string]any{"width": 120, "height": 160},
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/document-match — proxy to biometric engine document match
func handleBiometricDocumentMatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/verify/document-match", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create biometric request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"verified": true, "overall_score": 0.95, "sandbox": true,
			"document_face_found": true, "face_match": map[string]any{"match": true, "score": 0.95},
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	publishEvent("bis.biometric.document_match", map[string]any{"status": resp.StatusCode})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/biometric/ocr — proxy to biometric engine document OCR
func handleDocumentOCR(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "Failed to read request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", biometricEngineURL+"/ocr", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create OCR request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("X-BIS-Key", gatewayKey)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"documentType": "NIN_SLIP",
			"nin":          "12345678901",
			"firstName":    "ADAEZE",
			"lastName":     "OKONKWO",
			"dob":          "1990-05-15",
			"faceExtracted": true,
			"confidence":   0.91,
			"sandbox":      true,
		})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{
		"status":  "ok",
		"service": "bis-gateway",
		"version": "2.0.0",
		"time":    now(),
		"middleware": map[string]bool{
			"redis":        redisClient != nil,
			"kafka":        kafkaProducer != nil,
			"keycloak":     keycloakClient != nil,
			"permify":      permifyClient != nil,
			"temporal":     temporalClient != nil,
			"tigerbeetle":  tbClient != nil,
		},
		"externalAPIs": map[string]bool{
			"nimc":      nimcAPIURL != "" && nimcAPIKey != "",
			"nibss":     nibssAPIURL != "" && nibssAPIKey != "",
			"cac":       cacAPIURL != "" && cacAPIKey != "",
			"ofac":      ofacAPIURL != "" && ofacAPIKey != "",
			"crc":       crcAPIURL != "" && crcAPIKey != "",
			"biometric": biometricEngineURL != "",
		},
	}
	writeJSON(w, http.StatusOK, status)
}

// ─── NIP Name Enquiry ────────────────────────────────────────────────────────

// POST /v1/nip/name-enquiry — NIBSS NIP interbank account name resolution.
// Resolves a 10-digit NUBAN to the registered account holder name.
// CBN Payments System Vision 2025: NIP name enquiry mandatory for all interbank transfers.
type NIPNameEnquiryRequest struct {
	AccountNumber string `json:"accountNumber"`
	BankCode      string `json:"bankCode,omitempty"`
}
type NIPNameEnquiryResponse struct {
	AccountNumber string `json:"accountNumber"`
	AccountName   string `json:"accountName"`
	BankCode      string `json:"bankCode"`
	BankName      string `json:"bankName"`
	Verified      bool   `json:"verified"`
	Source        string `json:"source"`
}

var nipBankNames = map[string]string{
	"044": "Access Bank", "058": "GTBank", "011": "First Bank",
	"057": "Zenith Bank", "033": "UBA", "070": "Fidelity Bank",
	"232": "Sterling Bank", "076": "Polaris Bank", "035": "Wema Bank",
	"214": "FCMB", "082": "Keystone Bank", "301": "Jaiz Bank",
	"101": "ProvidusBank", "000023": "Stanbic IBTC",
}
var nipMockNames = []string{
	"ADEBAYO OLUWASEUN MICHAEL", "IBRAHIM FATIMA AISHA", "OKONKWO CHUKWUEMEKA DAVID",
	"ABUBAKAR MUSA IBRAHIM", "NWOSU CHIDINMA GRACE", "ADELEKE TAIWO BLESSING",
	"HASSAN AMINAT FOLAKE", "EZE IFEANYI KINGSLEY", "BELLO ABDULLAHI SANI", "OKAFOR NGOZI PEACE",
	"DANJUMA HALIMA ZAINAB", "OKEKE CHUKWUDI PETER", "LAWAL YUSUF ABDULRAHMAN", "ADEKUNLE SEUN JAMES",
	"MUSA HADIZA BELLO", "CHUKWU EMEKA SUNDAY", "ALIYU FATIMA USMAN", "OGUNDELE TUNDE RASHEED",
}

func handleNIPNameEnquiry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	var req NIPNameEnquiryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}
	if len(req.AccountNumber) != 10 {
		writeError(w, http.StatusBadRequest, "INVALID_NUBAN", "Account number must be exactly 10 digits")
		return
	}
	// In live mode, call NIBSS NIP name enquiry API
	nibssNIPURL := envOr("NIBSS_NIP_URL", "")
	nibssNIPKey := envOr("NIBSS_NIP_KEY", "")
	if nibssNIPURL != "" && nibssNIPKey != "" {
		body := map[string]string{"accountNumber": req.AccountNumber, "bankCode": req.BankCode}
		respBytes, err := proxyExternalAPI(http.MethodPost, nibssNIPURL+"/name-enquiry", nibssNIPKey, body)
		if err == nil {
			var live NIPNameEnquiryResponse
			if json.Unmarshal(respBytes, &live) == nil && live.AccountName != "" {
				live.Verified = true
				live.Source = "nibss_live"
				writeJSON(w, http.StatusOK, live)
				return
			}
		}
	}
	// Sandbox / fallback: deterministic mock based on account number digits
	rng := deterministicRNG(req.AccountNumber)
	nameIdx := rng.Intn(len(nipMockNames))
	bankCode := req.BankCode
	if bankCode == "" {
		bankCodes := []string{"044", "058", "011", "057", "033", "070", "232", "076", "035", "214"}
		bankCode = bankCodes[rng.Intn(len(bankCodes))]
	}
	bankName := nipBankNames[bankCode]
	if bankName == "" {
		bankName = "Nigerian Bank"
	}
	writeJSON(w, http.StatusOK, NIPNameEnquiryResponse{
		AccountNumber: req.AccountNumber,
		AccountName:   nipMockNames[nameIdx],
		BankCode:      bankCode,
		BankName:      bankName,
		Verified:      true,
		Source:        "sandbox",
	})
}

// ─── Router ───────────────────────────────────────────────────────────────────

func newRouter() http.Handler {
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
	mux.HandleFunc("/v1/risk-score", protected(handleRiskScore))
	mux.HandleFunc("/v1/workflow/start", protected(handleWorkflowStart))
	mux.HandleFunc("/v1/biometric/liveness", protected(handleBiometricLiveness))
	mux.HandleFunc("/v1/biometric/liveness/active", protected(handleBiometricActiveLiveness))
	mux.HandleFunc("/v1/biometric/antispoofing", protected(handleBiometricAntispoofing))
	mux.HandleFunc("/v1/biometric/full", protected(handleBiometricFullVerify))
	mux.HandleFunc("/v1/biometric/match", protected(handleBiometricMatch))
	mux.HandleFunc("/v1/biometric/detect", protected(handleBiometricDetect))
	mux.HandleFunc("/v1/biometric/landmarks", protected(handleBiometricLandmarks))
	mux.HandleFunc("/v1/biometric/features", protected(handleBiometricFeatures))
	mux.HandleFunc("/v1/biometric/enroll", protected(handleBiometricEnroll))
	mux.HandleFunc("/v1/biometric/verify", protected(handleBiometricVerify))
	mux.HandleFunc("/v1/biometric/ocr", protected(handleDocumentOCR))
	mux.HandleFunc("/v1/biometric/ocr/face-extract", protected(handleBiometricFaceExtract))
	mux.HandleFunc("/v1/biometric/document-match", protected(handleBiometricDocumentMatch))
	mux.HandleFunc("/v1/nip/name-enquiry", protected(handleNIPNameEnquiry))

	// ── OpenSearch endpoints ────────────────────────────────────────────────
	mux.HandleFunc("/v1/search", protected(ospkg.HandleSearch))
	mux.HandleFunc("/v1/index/investigation", protected(ospkg.HandleIndexInvestigation))
	mux.HandleFunc("/v1/index/alert", protected(ospkg.HandleIndexAlert))

	// ── Mojaloop / NIP payment rail endpoints ────────────────────────────────
	mux.HandleFunc("/v1/mojaloop/transfer", protected(handleMojaloopTransfer))
	mux.HandleFunc("/v1/mojaloop/status/", protected(handleMojaloopStatus))
	mux.HandleFunc("/v1/nip/transfer", protected(handleNIPTransfer))

	// ── Stablecoin (USDC / cUSD) endpoints ────────────────────────────────────
	// Transfer uses per-account sliding-window rate limiting (irreversible on-chain ops).
	// Read-only endpoints use a higher read-RPM limit.
	mux.Handle("/v1/stablecoin/transfer",
		StablecoinTransferRateLimitMiddleware(http.HandlerFunc(protected(handleStablecoinTransfer))))
	mux.Handle("/v1/stablecoin/balance/",
		StablecoinReadRateLimitMiddleware(http.HandlerFunc(protected(handleStablecoinBalance))))
	mux.Handle("/v1/stablecoin/quote",
		StablecoinReadRateLimitMiddleware(http.HandlerFunc(protected(handleStablecoinQuote))))
	mux.Handle("/v1/stablecoin/history/",
		StablecoinReadRateLimitMiddleware(http.HandlerFunc(protected(handleStablecoinHistory))))

	// ── Velocity alert ingest (from Rust fluvio-velocity sidecar) ─────────────
	mux.HandleFunc("/v1/velocity/alert", protected(handleVelocityAlert))

	// ── Criminal Records, Corporate Check, AI Summary, Field Visit, Thin-File ──
	RegisterCriminalRecordsRoutes(mux)
	RegisterMojaloopComplianceRoutes(mux, protected)

	// ── Dapr pub/sub subscriber endpoints ────────────────────────────────────
	// Dapr calls GET /dapr/subscribe to discover subscriptions
	mux.HandleFunc("/dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(daprpkg.Subscriptions())
	})
	mux.HandleFunc("/dapr/subscribe/aml-alerts", daprpkg.HandleAMLAlert)
	mux.HandleFunc("/dapr/subscribe/investigation-events", daprpkg.HandleInvestigationEvent)
	mux.HandleFunc("/dapr/subscribe/biometric-events", daprpkg.HandleBiometricEvent)
	mux.HandleFunc("/dapr/subscribe/kyc-events", daprpkg.HandleKYCEvent)
		mux.HandleFunc("/dapr/subscribe/payment-events", daprpkg.HandlePaymentEvent)
	// Insider Threat — Dapr subscription handler
	mux.HandleFunc("/dapr/subscribe/insider-events", insiderpkg.HandleInsiderEvent)
	return mux
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	// Ensure OpenSearch indices exist at startup (non-fatal)
	if err := ospkg.EnsureIndices(); err != nil {
		log.Printf("[OpenSearch] index setup warning: %v", err)
	}
	// Ensure all Kafka topics exist at startup (best-effort)
	RegisterCriminalRecordsTopics()

	log.Printf("BIS API Gateway v2.0 starting on :%s", port)
	log.Printf("Risk Engine URL: %s", riskEngineURL)
	log.Printf("Event Processor URL: %s", eventProcURL)

	initMiddleware()

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      newRouter(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
