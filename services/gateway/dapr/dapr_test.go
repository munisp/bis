package dapr

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

func makeCloudEvent(t *testing.T, data map[string]interface{}) []byte {
	t.Helper()
	raw, _ := json.Marshal(data)
	event := CloudEvent{
		ID:          "test-event-001",
		Source:      "bis-bff",
		Type:        "com.bis.test",
		SpecVersion: "1.0",
		DataContent: "application/json",
		Data:        json.RawMessage(raw),
		Time:        "2026-06-16T12:00:00Z",
	}
	body, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal CloudEvent: %v", err)
	}
	return body
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

func TestSubscriptions(t *testing.T) {
	subs := Subscriptions()
	if len(subs) < 5 {
		t.Errorf("expected at least 5 subscriptions, got %d", len(subs))
	}

	topics := make(map[string]bool)
	for _, s := range subs {
		topics[s.Topic] = true
		if s.PubsubName == "" {
			t.Errorf("subscription %q has empty pubsubname", s.Topic)
		}
		if s.Route == "" {
			t.Errorf("subscription %q has empty route", s.Topic)
		}
	}

	required := []string{
		"bis.aml.alerts",
		"bis.investigation.events",
		"bis.biometric.events",
		"bis.kyc.events",
		"bis.payment.events",
	}
	for _, topic := range required {
		if !topics[topic] {
			t.Errorf("missing required subscription for topic %q", topic)
		}
	}
}

// ─── AML alert handler ────────────────────────────────────────────────────────

func TestHandleAMLAlert_Success(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"alertId":   42,
		"alertType": "velocity",
		"riskScore": 87.5,
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/aml-alerts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleAMLAlert(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["status"] != "SUCCESS" {
		t.Errorf("expected status=SUCCESS, got %q", resp["status"])
	}
}

func TestHandleAMLAlert_MalformedBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/aml-alerts",
		bytes.NewReader([]byte("not-json")))
	rr := httptest.NewRecorder()

	HandleAMLAlert(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for malformed body, got %d", rr.Code)
	}
}

func TestHandleAMLAlert_MalformedData(t *testing.T) {
	// CloudEvent with non-JSON data
	event := CloudEvent{
		ID:          "test-002",
		Source:      "bis-bff",
		Type:        "com.bis.test",
		SpecVersion: "1.0",
		DataContent: "application/json",
		Data:        json.RawMessage(`"not-an-object"`),
		Time:        "2026-06-16T12:00:00Z",
	}
	body, _ := json.Marshal(event)

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/aml-alerts", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandleAMLAlert(rr, req)

	// Should still return 200 (don't retry malformed messages)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for malformed data (no retry), got %d", rr.Code)
	}
}

// ─── Investigation event handler ─────────────────────────────────────────────

func TestHandleInvestigationEvent_Created(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType":  "created",
		"ref":        "INV-2026-001",
		"riskScore":  72.0,
		"subjectName": "John Doe",
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/investigation-events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleInvestigationEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHandleInvestigationEvent_Escalated(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType": "escalated",
		"ref":       "INV-2026-002",
		"riskScore": 95.0,
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/investigation-events", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandleInvestigationEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// ─── Biometric event handler ──────────────────────────────────────────────────

func TestHandleBiometricEvent_Enrolled(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType":  "enrolled",
		"subjectRef": "KYC-001",
		"score":      0.98,
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/biometric-events", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandleBiometricEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHandleBiometricEvent_SpoofDetected(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType":  "spoof_detected",
		"subjectRef": "KYC-002",
		"spoofType":  "print",
		"score":      0.12,
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/biometric-events", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandleBiometricEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// ─── KYC event handler ────────────────────────────────────────────────────────

func TestHandleKYCEvent(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType":  "completed",
		"subjectRef": "KYC-003",
		"status":     "approved",
		"riskScore":  45.0,
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/kyc-events", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandleKYCEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// ─── Payment event handler ────────────────────────────────────────────────────

func TestHandlePaymentEvent(t *testing.T) {
	body := makeCloudEvent(t, map[string]interface{}{
		"eventType":  "completed",
		"txRef":      "TXN-2026-001",
		"amountKobo": 500000,
		"currency":   "NGN",
		"rail":       "nip",
	})

	req := httptest.NewRequest(http.MethodPost, "/dapr/subscribe/payment-events", bytes.NewReader(body))
	rr := httptest.NewRecorder()

	HandlePaymentEvent(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}
