package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── E.164 normalization (NG formats matrix) ──────────────────────────────────

func TestNormalizePhoneNG_NigerianFormats(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"trunk zero mobile", "08031234567", "+2348031234567"},
		{"bare NSN", "8031234567", "+2348031234567"},
		{"country code no plus", "2348031234567", "+2348031234567"},
		{"full E164", "+2348031234567", "+2348031234567"},
		{"trunk zero with spaces", "0803 123 4567", "+2348031234567"},
		{"E164 with spaces", "+234 803 123 4567", "+2348031234567"},
		{"dashes and dots", "0803-123-4567", "+2348031234567"},
		{"parenthesized", "(0803) 123 4567", "+2348031234567"},
		{"landline lagos trunk", "014630000", "+23414630000"},
		{"surrounding whitespace", "  +2349012345678  ", "+2349012345678"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizePhoneNG(tc.input, false)
			if err != nil {
				t.Fatalf("normalizePhoneNG(%q) error: %v", tc.input, err)
			}
			if got != tc.want {
				t.Errorf("normalizePhoneNG(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestNormalizePhoneNG_RejectsInvalid(t *testing.T) {
	invalid := []string{
		"",                // empty
		"12345",           // too short
		"0803123456",      // NG trunk but 9-digit NSN
		"080312345678",    // NG trunk but 11-digit NSN
		"+23408031234567", // NSN must not start with 0 after country code
		"002348031234567", // IDD prefix not supported
		"abcdefghij",      // non-numeric
		"+234803123456",   // 9-digit NSN with country code
		"+234",            // country code only
	}
	for _, input := range invalid {
		if got, err := normalizePhoneNG(input, false); err == nil {
			t.Errorf("normalizePhoneNG(%q) = %q, want error", input, got)
		}
	}
}

func TestNormalizePhoneNG_InternationalGating(t *testing.T) {
	// Non-NG number rejected without the env gate.
	if got, err := normalizePhoneNG("+14155552671", false); err == nil {
		t.Errorf("expected non-NG rejection, got %q", got)
	} else if !strings.Contains(err.Error(), "PHONE_LOOKUP_ALLOW_INTERNATIONAL") {
		t.Errorf("expected international-gate error message, got %v", err)
	}
	// Allowed when the gate is on.
	got, err := normalizePhoneNG("+14155552671", true)
	if err != nil || got != "+14155552671" {
		t.Errorf("international allowed: got %q err=%v", got, err)
	}
	// Malformed international still rejected with the gate on.
	for _, bad := range []string{"+0123456789", "+1", "+1234567890123456789"} {
		if got, err := normalizePhoneNG(bad, true); err == nil {
			t.Errorf("normalizePhoneNG(%q, international) = %q, want error", bad, got)
		}
	}
}

func TestMaskMSISDN(t *testing.T) {
	masked := maskMSISDN("+2348031234567")
	if masked != "+2348*******67" {
		t.Errorf("maskMSISDN = %q", masked)
	}
	if strings.Contains(masked, "0312") {
		t.Error("mask leaked middle digits")
	}
	if maskMSISDN("+12345") != "***" {
		t.Error("short numbers must be fully masked")
	}
}

// ─── Provider chain failover ──────────────────────────────────────────────────

func newHLRTestServer(t *testing.T, status int, body string) (*httptest.Server, *int) {
	t.Helper()
	calls := new(int)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		if r.Header.Get("Authorization") == "" && r.Header.Get("X-API-Key") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, calls
}

const validHLRBody = `{"msisdn":"+2348031234567","e164":"+2348031234567","carrier":"MTN Nigeria","line_type":"mobile","subscriber_name":"A. Bello","country":"ng"}`

func TestPhoneChainFailover_FirstProviderErrorsSecondAnswers(t *testing.T) {
	failing, failCalls := newHLRTestServer(t, http.StatusBadGateway, `{"error":"upstream down"}`)
	succeeding, okCalls := newHLRTestServer(t, http.StatusOK, validHLRBody)

	chain := &phoneLookupChain{providers: []PhoneProvider{
		newHLRProvider(failing.URL, "test-key-a", 2*time.Second),
		newHLRProvider(succeeding.URL, "test-key-b", 2*time.Second),
	}}

	rec, err := chain.Lookup(context.Background(), "+2348031234567")
	if err != nil {
		t.Fatalf("expected failover to succeed, got %v", err)
	}
	if *failCalls != 1 || *okCalls != 1 {
		t.Errorf("expected 1 call to each provider, got failing=%d succeeding=%d", *failCalls, *okCalls)
	}
	if rec.E164 != "+2348031234567" || rec.Carrier != "MTN Nigeria" || rec.LineType != "mobile" || rec.Source != "hlr" || rec.Country != "NG" {
		t.Errorf("unexpected record: %+v", rec)
	}
	if rec.SubscriberName != "A. Bello" {
		t.Errorf("expected subscriber name passthrough, got %q", rec.SubscriberName)
	}
}

func TestPhoneChainFailover_MalformedJSONFallsThrough(t *testing.T) {
	broken, _ := newHLRTestServer(t, http.StatusOK, `{"msisdn":12345`)                                     // invalid JSON
	strictBad, _ := newHLRTestServer(t, http.StatusOK, `{"msisdn":"+2348031234567","unknown_field":true}`) // unknown field
	good, goodCalls := newHLRTestServer(t, http.StatusOK, validHLRBody)

	chain := &phoneLookupChain{providers: []PhoneProvider{
		newHLRProvider(broken.URL, "k", 2*time.Second),
		newHLRProvider(strictBad.URL, "k", 2*time.Second),
		newHLRProvider(good.URL, "k", 2*time.Second),
	}}

	rec, err := chain.Lookup(context.Background(), "+2348031234567")
	if err != nil {
		t.Fatalf("expected fallthrough to valid provider, got %v", err)
	}
	if rec.Carrier != "MTN Nigeria" {
		t.Errorf("unexpected record: %+v", rec)
	}
	if *goodCalls != 1 {
		t.Errorf("expected final provider called once, got %d", *goodCalls)
	}
}

func TestPhoneChainAllProvidersFail(t *testing.T) {
	failing, _ := newHLRTestServer(t, http.StatusInternalServerError, `{"error":"down"}`)
	chain := &phoneLookupChain{providers: []PhoneProvider{newHLRProvider(failing.URL, "k", 2*time.Second)}}

	if _, err := chain.Lookup(context.Background(), "+2348031234567"); err == nil {
		t.Fatal("expected error when all providers fail")
	}
}

func TestPhoneChainCircuitBreakerOpens(t *testing.T) {
	failing, calls := newHLRTestServer(t, http.StatusInternalServerError, `{"error":"down"}`)
	p := newHLRProvider(failing.URL, "k", 2*time.Second)
	chain := &phoneLookupChain{providers: []PhoneProvider{p}}

	for i := 0; i < 3; i++ {
		_, _ = chain.Lookup(context.Background(), "+2348031234567")
	}
	if *calls != 3 {
		t.Fatalf("expected 3 upstream calls before breaker opens, got %d", *calls)
	}
	// Circuit is open: next lookup must not hit the upstream.
	if _, err := chain.Lookup(context.Background(), "+2348031234567"); err == nil {
		t.Fatal("expected error from open circuit")
	} else if !strings.Contains(err.Error(), "circuit open") {
		t.Fatalf("expected circuit-open error, got %v", err)
	}
	if *calls != 3 {
		t.Errorf("breaker open: upstream received %d calls, want 3", *calls)
	}
}

// ─── Fail-closed handler behaviour ────────────────────────────────────────────

func withPhoneChain(t *testing.T, chain *phoneLookupChain) {
	t.Helper()
	prev := phoneChain
	phoneChain = chain
	t.Cleanup(func() { phoneChain = prev })
}

func TestPhoneLookupFailClosed_NoProvidersConfigured(t *testing.T) {
	t.Setenv("PHONE_LOOKUP_PROVIDERS", "")
	withPhoneChain(t, buildPhoneChainFromEnv())

	req := httptest.NewRequest(http.MethodGet, "/v1/phone/08031234567", nil)
	rr := httptest.NewRecorder()
	handlePhoneLookup(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rr.Code)
	}
	var body GatewayError
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if body.Message != "phone lookup not configured" {
		t.Errorf("expected explicit 'phone lookup not configured' message, got %q", body.Message)
	}
}

func TestPhoneLookupFailClosed_ConfiguredButMissingCredentials(t *testing.T) {
	t.Setenv("PHONE_LOOKUP_PROVIDERS", "hlr")
	t.Setenv("HLR_API_URL", "")
	t.Setenv("HLR_API_KEY", "")
	withPhoneChain(t, buildPhoneChainFromEnv())

	req := httptest.NewRequest(http.MethodGet, "/v1/phone/08031234567", nil)
	rr := httptest.NewRecorder()
	handlePhoneLookup(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when provider credentials missing, got %d", rr.Code)
	}
}

func TestPhoneLookupRejectsInvalidNumber(t *testing.T) {
	good, _ := newHLRTestServer(t, http.StatusOK, validHLRBody)
	withPhoneChain(t, &phoneLookupChain{providers: []PhoneProvider{newHLRProvider(good.URL, "k", 2*time.Second)}})

	for _, path := range []string{"/v1/phone/123", "/v1/phone/notanumber", "/v1/phone/+14155552671"} {
		rr := httptest.NewRecorder()
		handlePhoneLookup(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d", path, rr.Code)
		}
	}
}

func TestPhoneLookupSuccessPath(t *testing.T) {
	good, calls := newHLRTestServer(t, http.StatusOK, validHLRBody)
	withPhoneChain(t, &phoneLookupChain{providers: []PhoneProvider{newHLRProvider(good.URL, "k", 2*time.Second)}})

	rr := httptest.NewRecorder()
	handlePhoneLookup(rr, httptest.NewRequest(http.MethodGet, "/v1/phone/0803-123-4567", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var rec PhoneRecord
	if err := json.NewDecoder(rr.Body).Decode(&rec); err != nil {
		t.Fatalf("decode record: %v", err)
	}
	if rec.E164 != "+2348031234567" || rec.Number != "0803-123-4567" || rec.LineType != "mobile" {
		t.Errorf("unexpected record: %+v", rec)
	}
	if *calls != 1 {
		t.Errorf("expected exactly 1 upstream call, got %d", *calls)
	}
}

// ─── Auth enforcement on the route ────────────────────────────────────────────

func TestPhoneRouteRequiresAuth(t *testing.T) {
	gatewayKey = "phone-route-test-key"
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/phone/", authMiddleware(handlePhoneLookup))

	// No key → 401.
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/phone/08031234567", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: expected 401, got %d", rr.Code)
	}

	// Wrong key → 401.
	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/phone/08031234567", nil)
	req.Header.Set("X-BIS-Key", "wrong")
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key: expected 401, got %d", rr.Code)
	}

	// Valid key reaches the handler (fail-closed 503 with empty chain).
	withPhoneChain(t, &phoneLookupChain{})
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/phone/08031234567", nil)
	req.Header.Set("X-BIS-Key", "phone-route-test-key")
	mux.ServeHTTP(rr, req)
	if rr.Code == http.StatusUnauthorized {
		t.Fatal("valid key must pass auth middleware")
	}
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("authenticated with empty chain: expected 503, got %d", rr.Code)
	}
}

func TestBuildPhoneChainFromEnv(t *testing.T) {
	t.Setenv("PHONE_LOOKUP_PROVIDERS", "")
	if c := buildPhoneChainFromEnv(); len(c.providers) != 0 {
		t.Errorf("empty spec: expected 0 providers, got %d", len(c.providers))
	}

	t.Setenv("PHONE_LOOKUP_PROVIDERS", "bogus,hlr")
	t.Setenv("HLR_API_URL", "https://hlr.example.test")
	t.Setenv("HLR_API_KEY", "k")
	c := buildPhoneChainFromEnv()
	if len(c.providers) != 1 || c.providers[0].Name() != "hlr" {
		t.Errorf("expected single hlr provider (bogus skipped), got %v", c.providers)
	}
	if _, err := c.Lookup(context.Background(), "+2348031234567"); err == nil {
		t.Error("expected unreachable-provider error")
	}
}

func TestPhoneCircuitBreakerHalfOpenRecovery(t *testing.T) {
	failing, calls := newHLRTestServer(t, http.StatusInternalServerError, `{"error":"down"}`)
	p := newHLRProvider(failing.URL, "k", time.Second)
	p.breaker = newPhoneCircuitBreaker(2, 40*time.Millisecond)

	if _, err := p.Lookup(context.Background(), "+2348031234567"); err == nil {
		t.Fatal("want error")
	}
	if _, err := p.Lookup(context.Background(), "+2348031234567"); err == nil {
		t.Fatal("want error")
	}
	// Open now.
	if _, err := p.Lookup(context.Background(), "+2348031234567"); !errors.Is(err, errPhoneCircuitOpen) && !strings.Contains(err.Error(), "circuit open") {
		t.Fatalf("want circuit open, got %v", err)
	}
	if *calls != 2 {
		t.Fatalf("upstream calls = %d, want 2", *calls)
	}
	// After cooldown a half-open probe is allowed through.
	time.Sleep(60 * time.Millisecond)
	_, _ = p.Lookup(context.Background(), "+2348031234567")
	if *calls != 3 {
		t.Fatalf("half-open probe must reach upstream, calls = %d", *calls)
	}
}
