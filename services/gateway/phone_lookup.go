// phone_lookup.go — BIS API Gateway
// Reverse phone lookup (Intelius reverse-phone analog), provider-agnostic and
// fail-closed: no synthetic subscriber data is ever returned. When no upstream
// provider is configured the endpoint answers 503 with an explicit
// "phone lookup not configured" message.
//
// Provider chain is built from PHONE_LOOKUP_PROVIDERS (comma-separated,
// ordered). Currently implemented providers:
//
//	hlr — generic HLR-lookup HTTP API
//	      env: HLR_API_URL, HLR_API_KEY, HLR_TIMEOUT_MS (default 8000)
//
// Route: GET /v1/phone/{number} (same auth middleware chain as /v1/nin).
// Input is normalized to E.164 with default region NG. Non-Nigerian numbers
// are rejected unless PHONE_LOOKUP_ALLOW_INTERNATIONAL=true.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// PhoneRecord is the normalized result of a reverse phone lookup.
type PhoneRecord struct {
	Number         string `json:"number"`                   // as queried (post-trim)
	E164           string `json:"e164"`                     // normalized E.164
	Carrier        string `json:"carrier,omitempty"`        // current carrier (post-porting, when known)
	LineType       string `json:"lineType"`                 // mobile | landline | voip | unknown
	SubscriberName string `json:"subscriberName,omitempty"` // only when the provider returns it
	Country        string `json:"country,omitempty"`        // ISO 3166-1 alpha-2
	Source         string `json:"source"`                   // raw provider label
	CheckedAt      string `json:"checkedAt"`
}

// PhoneProvider is the provider-agnostic reverse-lookup contract.
type PhoneProvider interface {
	Lookup(ctx context.Context, msisdn string) (*PhoneRecord, error)
	Name() string
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────
// The gateway has no existing breaker for outbound provider calls, so this is
// a real consecutive-failure breaker: after `threshold` consecutive failures
// the circuit opens for `cooldown`, then allows a single half-open probe.

type phoneCircuitBreaker struct {
	mu        sync.Mutex
	failures  int
	openUntil time.Time
	halfOpen  bool
	threshold int
	cooldown  time.Duration
}

func newPhoneCircuitBreaker(threshold int, cooldown time.Duration) *phoneCircuitBreaker {
	if threshold <= 0 {
		threshold = 3
	}
	if cooldown <= 0 {
		cooldown = 30 * time.Second
	}
	return &phoneCircuitBreaker{threshold: threshold, cooldown: cooldown}
}

var errPhoneCircuitOpen = errors.New("provider circuit open")

// allow reports whether a call may proceed.
func (b *phoneCircuitBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.openUntil.IsZero() {
		return true
	}
	if time.Now().Before(b.openUntil) {
		return false
	}
	// Cooldown elapsed: permit exactly one half-open probe.
	if b.halfOpen {
		return false
	}
	b.halfOpen = true
	return true
}

// report records the outcome of a call that was permitted by allow().
func (b *phoneCircuitBreaker) report(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err == nil {
		b.failures = 0
		b.openUntil = time.Time{}
		b.halfOpen = false
		return
	}
	if b.halfOpen {
		// Half-open probe failed: re-open for a full cooldown.
		b.halfOpen = false
		b.openUntil = time.Now().Add(b.cooldown)
		b.failures = b.threshold
		return
	}
	b.failures++
	if b.failures >= b.threshold {
		b.openUntil = time.Now().Add(b.cooldown)
	}
}

// ─── HLR provider ─────────────────────────────────────────────────────────────

// hlrProvider implements PhoneProvider against a generic HLR-lookup HTTP API.
// Request:  GET {base}/lookup?msisdn={e164} with Bearer + X-API-Key auth.
// Response: strict JSON (unknown fields rejected), mapped onto PhoneRecord.
type hlrProvider struct {
	baseURL string
	apiKey  string
	client  *http.Client
	breaker *phoneCircuitBreaker
}

func newHLRProvider(baseURL, apiKey string, timeout time.Duration) *hlrProvider {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	return &hlrProvider{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client:  &http.Client{Timeout: timeout},
		breaker: newPhoneCircuitBreaker(3, 30*time.Second),
	}
}

func (p *hlrProvider) Name() string { return "hlr" }

// hlrLookupResponse is the strict wire contract for the generic HLR API.
type hlrLookupResponse struct {
	MSISDN         string `json:"msisdn"`
	E164           string `json:"e164"`
	Carrier        string `json:"carrier"`
	LineType       string `json:"line_type"`
	SubscriberName string `json:"subscriber_name"`
	Country        string `json:"country"`
}

func (p *hlrProvider) Lookup(ctx context.Context, msisdn string) (rec *PhoneRecord, err error) {
	if !p.breaker.allow() {
		return nil, fmt.Errorf("hlr provider skipped: %w", errPhoneCircuitOpen)
	}
	defer func() { p.breaker.report(err) }()

	endpoint := p.baseURL + "/lookup?msisdn=" + url.QueryEscape(msisdn)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("hlr request build: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("X-API-Key", p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hlr http call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("hlr upstream status %d", resp.StatusCode)
	}

	var wire hlrLookupResponse
	dec := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&wire); err != nil {
		return nil, fmt.Errorf("hlr response decode: %w", err)
	}

	e164 := wire.E164
	if e164 == "" {
		e164 = wire.MSISDN
	}
	if e164 == "" {
		return nil, errors.New("hlr response contained no normalized number")
	}

	return &PhoneRecord{
		Number:         msisdn,
		E164:           e164,
		Carrier:        wire.Carrier,
		LineType:       normalizeLineType(wire.LineType),
		SubscriberName: wire.SubscriberName,
		Country:        strings.ToUpper(wire.Country),
		Source:         p.Name(),
		CheckedAt:      now(),
	}, nil
}

// normalizeLineType constrains provider line-type values to the public enum.
func normalizeLineType(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "mobile", "landline", "voip":
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return "unknown"
	}
}

// ─── Provider chain ───────────────────────────────────────────────────────────

var errPhoneNotConfigured = errors.New("phone lookup not configured")

// phoneLookupChain walks providers in configured order until one answers.
type phoneLookupChain struct {
	providers []PhoneProvider
}

// buildPhoneChainFromEnv constructs the ordered provider chain from
// PHONE_LOOKUP_PROVIDERS. Unknown provider names are skipped with a warning;
// a provider missing its credentials is skipped (never stubbed).
func buildPhoneChainFromEnv() *phoneLookupChain {
	chain := &phoneLookupChain{}
	spec := strings.TrimSpace(envOr("PHONE_LOOKUP_PROVIDERS", ""))
	if spec == "" {
		return chain
	}
	for _, name := range strings.Split(spec, ",") {
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "":
			continue
		case "hlr":
			base := envOr("HLR_API_URL", "")
			key := envOr("HLR_API_KEY", "")
			if base == "" || key == "" {
				log.Printf("[WARN] phone provider 'hlr' configured but HLR_API_URL/HLR_API_KEY missing — skipping")
				continue
			}
			timeout := time.Duration(8000) * time.Millisecond
			if ms := envOr("HLR_TIMEOUT_MS", ""); ms != "" {
				if d, err := time.ParseDuration(ms + "ms"); err == nil && d > 0 {
					timeout = d
				}
			}
			chain.providers = append(chain.providers, newHLRProvider(base, key, timeout))
		default:
			log.Printf("[WARN] unknown phone lookup provider %q in PHONE_LOOKUP_PROVIDERS — skipping", name)
		}
	}
	return chain
}

// Lookup tries each provider in order; the first successful record wins.
// All failures are aggregated and returned so the handler can fail closed.
func (c *phoneLookupChain) Lookup(ctx context.Context, msisdn string) (*PhoneRecord, error) {
	if c == nil || len(c.providers) == 0 {
		return nil, errPhoneNotConfigured
	}
	failures := make([]string, 0, len(c.providers))
	for _, p := range c.providers {
		rec, err := p.Lookup(ctx, msisdn)
		if err == nil && rec != nil {
			return rec, nil
		}
		failures = append(failures, fmt.Sprintf("%s: %v", p.Name(), err))
		log.Printf("[WARN] phone lookup provider %s failed for %s: %v", p.Name(), maskMSISDN(msisdn), err)
	}
	return nil, fmt.Errorf("all phone lookup providers failed (%s)", strings.Join(failures, "; "))
}

// phoneChain is built once at startup; provider env is static at runtime.
var phoneChain = buildPhoneChainFromEnv()

// ─── E.164 normalization (default region NG) ─────────────────────────────────
// Strict small normalizer for Nigerian +234 / 0-prefix formats plus generic
// E.164 passthrough when international lookups are explicitly enabled.

var errInvalidPhoneNumber = errors.New("invalid phone number")

// strip phone punctuation: spaces, dashes, dots, parentheses.
func cleanPhoneInput(raw string) string {
	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		switch {
		case r >= '0' && r <= '9', r == '+':
			b.WriteRune(r)
		case r == ' ', r == '-', r == '.', r == '(', r == ')':
			// ignored punctuation
		default:
			b.WriteRune(r) // preserved so digit validation rejects it
		}
	}
	return b.String()
}

func isAllDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(s) > 0
}

// validE164Shape enforces ITU-T E.164: "+" followed by 7–15 digits, first
// digit non-zero.
func validE164Shape(s string) bool {
	if len(s) < 8 || len(s) > 16 || !strings.HasPrefix(s, "+") {
		return false
	}
	d := s[1:]
	if d[0] == '0' || !isAllDigits(d) {
		return false
	}
	return true
}

// normalizePhoneNG normalizes raw input to E.164 with default region NG.
// Non-Nigerian numbers are rejected unless allowInternational is true.
func normalizePhoneNG(raw string, allowInternational bool) (string, error) {
	cleaned := cleanPhoneInput(strings.TrimSpace(raw))
	if cleaned == "" {
		return "", errInvalidPhoneNumber
	}

	switch {
	case strings.HasPrefix(cleaned, "+234"):
		// Already international NG format.
		return validateNGNumber("+234" + cleaned[4:])
	case strings.HasPrefix(cleaned, "234") && len(cleaned) == 13 && isAllDigits(cleaned):
		// Country code without plus.
		return validateNGNumber("+" + cleaned)
	case strings.HasPrefix(cleaned, "0"):
		// National format with trunk prefix: 0803… → +234803…
		return validateNGNumber("+234" + cleaned[1:])
	case isAllDigits(cleaned) && len(cleaned) == 10 && cleaned[0] != '0':
		// Bare national significant number (default region NG).
		return validateNGNumber("+234" + cleaned)
	case strings.HasPrefix(cleaned, "+"):
		// Other international format.
		if !allowInternational {
			return "", fmt.Errorf("%w: non-Nigerian numbers require PHONE_LOOKUP_ALLOW_INTERNATIONAL=true", errInvalidPhoneNumber)
		}
		if !validE164Shape(cleaned) {
			return "", errInvalidPhoneNumber
		}
		return cleaned, nil
	default:
		return "", errInvalidPhoneNumber
	}
}

// validateNGNumber enforces the Nigerian numbering plan shape:
//   - mobile:  10-digit NSN starting 7, 8 or 9 (070…, 080…, 090… ranges)
//   - landline: 8–9 digit NSN starting 1 or 2 (e.g. Lagos 01-XXXXXXX → 1463XXXX)
func validateNGNumber(e164 string) (string, error) {
	nsn := strings.TrimPrefix(e164, "+234")
	if !isAllDigits(nsn) {
		return "", errInvalidPhoneNumber
	}
	switch {
	case len(nsn) == 10 && (nsn[0] == '7' || nsn[0] == '8' || nsn[0] == '9'):
		return "+234" + nsn, nil
	case (len(nsn) == 8 || len(nsn) == 9) && (nsn[0] == '1' || nsn[0] == '2'):
		return "+234" + nsn, nil
	default:
		return "", errInvalidPhoneNumber
	}
}

// maskMSISDN masks the middle digits of an E.164 number for safe logging:
// +2348031234567 → +2348*****67
func maskMSISDN(e164 string) string {
	if len(e164) <= 7 {
		return "***"
	}
	head, tail := 5, 2
	return e164[:head] + strings.Repeat("*", len(e164)-head-tail) + e164[len(e164)-tail:]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// GET /v1/phone/{number} — reverse phone lookup.
func handlePhoneLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
		return
	}

	raw := strings.TrimPrefix(r.URL.Path, "/v1/phone/")
	allowInternational := strings.EqualFold(envOr("PHONE_LOOKUP_ALLOW_INTERNATIONAL", ""), "true")
	e164, err := normalizePhoneNG(raw, allowInternational)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PHONE_NUMBER", "Number must be a valid Nigerian phone number (e.g. 0803…, 234…, +234…)")
		return
	}

	if len(phoneChain.providers) == 0 {
		// Fail closed: no provider configured → explicit 503, never synthetic data.
		writeError(w, http.StatusServiceUnavailable, "PHONE_LOOKUP_NOT_CONFIGURED", "phone lookup not configured")
		return
	}

	// Redis cache (TTL: 6h — carrier/porting data changes more often than identity data).
	cacheKey := "phone:" + e164
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(cached)
		return
	}

	rec, err := phoneChain.Lookup(r.Context(), e164)
	if err != nil {
		log.Printf("[WARN] phone lookup %s failed: %v", maskMSISDN(e164), err)
		writeError(w, http.StatusServiceUnavailable, "PHONE_PROVIDER_UNAVAILABLE", "No phone lookup provider returned a record; no result was synthesized.")
		return
	}
	rec.Number = raw

	log.Printf("[INFO] phone lookup %s: source=%s lineType=%s carrier=%s", maskMSISDN(e164), rec.Source, rec.LineType, rec.Carrier)

	if data, err := json.Marshal(rec); err == nil {
		cacheSet(r.Context(), cacheKey, data, 6*time.Hour)
	}

	publishEvent("bis.gateway.phone_lookup", map[string]any{
		"phone":     maskMSISDN(e164),
		"source":    rec.Source,
		"lineType":  rec.LineType,
		"timestamp": now(),
	})

	writeJSON(w, http.StatusOK, rec)
}
