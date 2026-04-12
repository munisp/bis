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
