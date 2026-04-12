package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestParseSMSText_Valid(t *testing.T) {
	parsed, err := parseSMSText("LEX NPF-LA-001 123456 ARREST LA Suspect arrested at Mile 2 market", "+2348012345678", "at_sms")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if parsed.AgencyCode != "NPF-LA-001" {
		t.Errorf("expected NPF-LA-001, got %s", parsed.AgencyCode)
	}
	if parsed.PIN != "123456" {
		t.Errorf("expected 123456, got %s", parsed.PIN)
	}
	if parsed.IncidentType != "ARREST" {
		t.Errorf("expected ARREST, got %s", parsed.IncidentType)
	}
	if parsed.StateFull != "lagos" {
		t.Errorf("expected lagos, got %s", parsed.StateFull)
	}
	if parsed.Narrative != "Suspect arrested at Mile 2 market" {
		t.Errorf("unexpected narrative: %s", parsed.Narrative)
	}
}

func TestParseSMSText_InvalidPrefix(t *testing.T) {
	_, err := parseSMSText("REPORT NPF-LA-001 1234 ARREST LA narrative", "+234", "at_sms")
	if err == nil {
		t.Error("expected error for invalid prefix")
	}
}

func TestParseSMSText_InvalidStateCode(t *testing.T) {
	_, err := parseSMSText("LEX NPF-LA-001 1234 ARREST XX narrative", "+234", "at_sms")
	if err == nil {
		t.Error("expected error for invalid state code")
	}
}

func TestParseSMSText_TooFewParts(t *testing.T) {
	_, err := parseSMSText("LEX NPF-LA-001 1234 ARREST", "+234", "at_sms")
	if err == nil {
		t.Error("expected error for too few parts")
	}
}

func TestParseSMSText_InvalidPIN(t *testing.T) {
	_, err := parseSMSText("LEX NPF-LA-001 abc ARREST LA narrative", "+234", "at_sms")
	if err == nil {
		t.Error("expected error for non-numeric PIN")
	}
}

func TestParseSMSText_UnknownIncidentType(t *testing.T) {
	parsed, err := parseSMSText("LEX NPF-LA-001 1234 UNKNOWN LA narrative", "+234", "at_sms")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Unknown types should default to OTHER
	if parsed.IncidentType != "OTHER" {
		t.Errorf("expected OTHER for unknown type, got %s", parsed.IncidentType)
	}
}

func TestHandleATWebhook_Valid(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	form := url.Values{}
	form.Set("from", "+2348012345678")
	form.Set("to", "12345")
	form.Set("text", "LEX NPF-LA-001 123456 ARREST LA Suspect found with stolen goods")
	form.Set("id", "msg-001")

	req := httptest.NewRequest(http.MethodPost, "/sms/at", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	srv.handleATWebhook(rr, req)

	// Should be 202 Accepted (queued offline since BIS is unreachable)
	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.HasPrefix(rr.Body.String(), "OK:LEX-SMS-") {
		t.Errorf("expected OK:LEX-SMS- prefix, got: %s", rr.Body.String())
	}
}

func TestHandleATWebhook_InvalidFormat(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	form := url.Values{}
	form.Set("from", "+234")
	form.Set("text", "Hello world") // not LEX format
	req := httptest.NewRequest(http.MethodPost, "/sms/at", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()

	srv.handleATWebhook(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestHandleTermiiWebhook_Valid(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	body := `{"from":"+2348012345678","to":"12345","text":"LEX NPF-KN-001 9876 DRUG KN Drug cache found in warehouse","id":"termii-001"}`
	req := httptest.NewRequest(http.MethodPost, "/sms/termii", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.handleTermiiWebhook(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleTermiiWebhook_InvalidJSON(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	req := httptest.NewRequest(http.MethodPost, "/sms/termii", strings.NewReader("{invalid"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.handleTermiiWebhook(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestStateCodeMap_Completeness(t *testing.T) {
	// Nigeria has 36 states + FCT = 37 entries
	if len(stateCodeMap) != 37 {
		t.Errorf("expected 37 state codes, got %d", len(stateCodeMap))
	}
	// Spot check key states
	required := []string{"LA", "KN", "AB", "RI", "FC"}
	for _, code := range required {
		if _, ok := stateCodeMap[code]; !ok {
			t.Errorf("missing state code: %s", code)
		}
	}
}

func TestSendOutboundSMS_NoCredentials(t *testing.T) {
	// Without credentials, SendOutboundSMS should fail gracefully (not panic)
	os.Unsetenv("AT_API_KEY")
	os.Unsetenv("AT_USERNAME")
	os.Unsetenv("TERMII_API_KEY")
	os.Setenv("SMS_PROVIDER", "africas_talking")
	result := SendOutboundSMS("+2348012345678", "Test confirmation message")
	if result.Success {
		t.Error("expected failure when credentials not set")
	}
	if result.Error == "" {
		t.Error("expected non-empty error message")
	}
	if result.Provider != "africas_talking" {
		t.Errorf("expected provider africas_talking, got %s", result.Provider)
	}
}

func TestSendOutboundSMS_TermiiNoCredentials(t *testing.T) {
	os.Unsetenv("TERMII_API_KEY")
	os.Setenv("SMS_PROVIDER", "termii")
	result := SendOutboundSMS("+2348012345678", "Test confirmation message")
	if result.Success {
		t.Error("expected failure when TERMII_API_KEY not set")
	}
	if result.Provider != "termii" {
		t.Errorf("expected provider termii, got %s", result.Provider)
	}
	os.Unsetenv("SMS_PROVIDER")
}

// ─── PIN Expiry and Lockout Tests ─────────────────────────────────────────────

func TestIssuePIN_And_VerifyPIN_Valid(t *testing.T) {
	store := newTestStore(t)
	phone := "+2348012345678"
	pinHash := "sha256:NPF-LA-001:123456"

	if err := store.IssuePIN(phone, pinHash, "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN: %v", err)
	}

	result := store.VerifyPIN(phone, pinHash)
	if !result.Valid {
		t.Errorf("expected valid PIN, got: %+v", result)
	}
	if result.Expired || result.Locked || result.Used {
		t.Errorf("unexpected flags: %+v", result)
	}
}

func TestVerifyPIN_NoSession_ReturnsExpired(t *testing.T) {
	store := newTestStore(t)
	result := store.VerifyPIN("+2348000000000", "sha256:hash")
	if !result.Expired {
		t.Errorf("expected Expired=true for phone with no PIN session, got: %+v", result)
	}
}

func TestVerifyPIN_WrongPIN_IncrementsAttempts(t *testing.T) {
	store := newTestStore(t)
	phone := "+2348012345678"
	pinHash := "sha256:correct"
	wrongHash := "sha256:wrong"

	if err := store.IssuePIN(phone, pinHash, "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN: %v", err)
	}

	// First wrong attempt
	r1 := store.VerifyPIN(phone, wrongHash)
	if r1.Valid || r1.Locked {
		t.Errorf("expected invalid but not locked on attempt 1: %+v", r1)
	}
	if r1.Attempts != 1 {
		t.Errorf("expected 1 attempt, got %d", r1.Attempts)
	}
	if r1.Remaining != PINMaxAttempts-1 {
		t.Errorf("expected %d remaining, got %d", PINMaxAttempts-1, r1.Remaining)
	}

	// Second wrong attempt
	r2 := store.VerifyPIN(phone, wrongHash)
	if r2.Valid || r2.Locked {
		t.Errorf("expected invalid but not locked on attempt 2: %+v", r2)
	}
	if r2.Attempts != 2 {
		t.Errorf("expected 2 attempts, got %d", r2.Attempts)
	}
}

func TestVerifyPIN_ThreeWrongAttempts_TriggersLockout(t *testing.T) {
	store := newTestStore(t)
	phone := "+2348012345678"
	pinHash := "sha256:correct"
	wrongHash := "sha256:wrong"

	if err := store.IssuePIN(phone, pinHash, "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN: %v", err)
	}

	// 3 wrong attempts should trigger lockout
	for i := 1; i <= PINMaxAttempts; i++ {
		r := store.VerifyPIN(phone, wrongHash)
		if i < PINMaxAttempts && r.Locked {
			t.Errorf("should not be locked on attempt %d", i)
		}
		if i == PINMaxAttempts && !r.Locked {
			t.Errorf("should be locked after %d attempts, got: %+v", PINMaxAttempts, r)
		}
	}

	// Subsequent attempt should also be locked
	rLocked := store.VerifyPIN(phone, pinHash) // even correct PIN
	if !rLocked.Locked {
		t.Errorf("expected locked after %d failed attempts, got: %+v", PINMaxAttempts, rLocked)
	}
}

func TestVerifyPIN_ReplayPrevented(t *testing.T) {
	store := newTestStore(t)
	phone := "+2348012345678"
	pinHash := "sha256:correct"

	if err := store.IssuePIN(phone, pinHash, "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN: %v", err)
	}

	// First use — should succeed
	r1 := store.VerifyPIN(phone, pinHash)
	if !r1.Valid {
		t.Fatalf("expected valid on first use: %+v", r1)
	}

	// Second use — should be marked as used
	r2 := store.VerifyPIN(phone, pinHash)
	if !r2.Used {
		t.Errorf("expected Used=true on replay, got: %+v", r2)
	}
}

func TestIssuePIN_ResetsAttemptCounter(t *testing.T) {
	store := newTestStore(t)
	phone := "+2348012345678"
	pinHash := "sha256:correct"
	wrongHash := "sha256:wrong"

	if err := store.IssuePIN(phone, pinHash, "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN: %v", err)
	}

	// 2 wrong attempts
	store.VerifyPIN(phone, wrongHash)
	store.VerifyPIN(phone, wrongHash)

	// Re-issue PIN — should reset counter
	if err := store.IssuePIN(phone, "sha256:newpin", "NPF-LA-001"); err != nil {
		t.Fatalf("IssuePIN (re-issue): %v", err)
	}

	// Now correct PIN should work
	r := store.VerifyPIN(phone, "sha256:newpin")
	if !r.Valid {
		t.Errorf("expected valid after re-issue, got: %+v", r)
	}
}

func TestHandlePINIssue_And_Verify_HTTP(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	// Issue PIN via HTTP
	issueBody := `{"phone":"+2348012345678","agencyCode":"NPF-LA-001","pinHash":"sha256:test:1234"}`
	req := httptest.NewRequest(http.MethodPost, "/pin/issue", strings.NewReader(issueBody))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.handlePINIssue(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 from /pin/issue, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify PIN via HTTP
	verifyBody := `{"phone":"+2348012345678","pinHash":"sha256:test:1234"}`
	req2 := httptest.NewRequest(http.MethodPost, "/pin/verify", strings.NewReader(verifyBody))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	srv.handlePINVerify(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("expected 200 from /pin/verify, got %d: %s", rr2.Code, rr2.Body.String())
	}
}

func TestHandlePINVerify_Lockout_Returns429(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	// Issue PIN
	issueBody := `{"phone":"+2348099999999","agencyCode":"NPF-KN-001","pinHash":"sha256:correct"}`
	req := httptest.NewRequest(http.MethodPost, "/pin/issue", strings.NewReader(issueBody))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.handlePINIssue(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("issue failed: %s", rr.Body.String())
	}

	// 3 wrong attempts to trigger lockout
	for i := 0; i < PINMaxAttempts; i++ {
		vBody := `{"phone":"+2348099999999","pinHash":"sha256:wrong"}`
		vReq := httptest.NewRequest(http.MethodPost, "/pin/verify", strings.NewReader(vBody))
		vReq.Header.Set("Content-Type", "application/json")
		vRR := httptest.NewRecorder()
		srv.handlePINVerify(vRR, vReq)
	}

	// Next attempt should return 429
	vBody := `{"phone":"+2348099999999","pinHash":"sha256:correct"}`
	vReq := httptest.NewRequest(http.MethodPost, "/pin/verify", strings.NewReader(vBody))
	vReq.Header.Set("Content-Type", "application/json")
	vRR := httptest.NewRecorder()
	srv.handlePINVerify(vRR, vReq)
	if vRR.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 after lockout, got %d: %s", vRR.Code, vRR.Body.String())
	}
}

func TestHandlePINVerify_Expired_Returns401(t *testing.T) {
	store := newTestStore(t)
	srv := &Server{store: store, bis: NewBISClient("http://localhost:9999", ""), config: Config{}}

	// Verify with no PIN issued — should return 401 expired
	vBody := `{"phone":"+2348011111111","pinHash":"sha256:anyhash"}`
	vReq := httptest.NewRequest(http.MethodPost, "/pin/verify", strings.NewReader(vBody))
	vReq.Header.Set("Content-Type", "application/json")
	vRR := httptest.NewRecorder()
	srv.handlePINVerify(vRR, vReq)
	if vRR.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired/missing PIN, got %d: %s", vRR.Code, vRR.Body.String())
	}
}
