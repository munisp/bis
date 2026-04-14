package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"bis/payment-rails/internal/handlers"
	"bis/payment-rails/internal/models"
)

// mockKafka records published events for assertions
type mockKafka struct {
	events []map[string]interface{}
}

func (m *mockKafka) Publish(_ context.Context, topic, key string, value []byte) error {
	var event map[string]interface{}
	json.Unmarshal(value, &event)
	m.events = append(m.events, event)
	return nil
}

func TestHandleMT103_ValidRequest(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT103{
		SenderBIC:   "BISNGLA1XXX",
		ReceiverBIC: "BARCGB22XXX",
		Amount:      50000,
		Currency:    "USD",
		ValueDate:   time.Now(),
		OrderingCustomer: models.Party{
			Name:    "Acme Corp",
			Account: "1234567890",
			Country: "NG",
		},
		Beneficiary: models.Party{
			Name:    "Global Imports Ltd",
			Account: "GB29NWBK60161331926819",
			Country: "GB",
		},
		RemittanceInfo: "Invoice INV-2026-001",
		ChargesCode:    "SHA",
	}

	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleMT103(w, r)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["uetr"] == "" {
		t.Error("expected uetr in response")
	}
	if resp["status"] == "" {
		t.Error("expected status in response")
	}
}

func TestHandleMT103_MissingBIC(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT103{
		Amount:   1000,
		Currency: "USD",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT103(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleMT103_NegativeAmount(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT103{
		SenderBIC:   "BISNGLA1XXX",
		ReceiverBIC: "BARCGB22XXX",
		Amount:      -100,
		Currency:    "USD",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT103(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleMT103_HighRiskCountryFlagged(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT103{
		SenderBIC:   "BISNGLA1XXX",
		ReceiverBIC: "BARCGB22XXX",
		Amount:      100000,
		Currency:    "USD",
		OrderingCustomer: models.Party{Name: "Rogue Corp", Country: "KP"}, // North Korea
		Beneficiary:      models.Party{Name: "Shell Co", Country: "GB"},
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT103(w, r)

	// KP is high risk — should be pending_compliance or blocked
	if w.Code != http.StatusAccepted && w.Code != http.StatusForbidden {
		t.Errorf("expected 202 (pending_compliance) or 403 (blocked) for sanctioned country, got %d: %s", w.Code, w.Body.String())
	}
	// Verify it's flagged as high risk at minimum
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["riskLevel"] != "high" && resp["riskLevel"] != "critical" && w.Code != http.StatusForbidden {
		t.Errorf("expected high/critical risk level for KP transaction, got %v", resp["riskLevel"])
	}
}

func TestHandleMT103_KafkaEventPublished(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT103{
		SenderBIC:   "BISNGLA1XXX",
		ReceiverBIC: "BARCGB22XXX",
		Amount:      5000,
		Currency:    "EUR",
		OrderingCustomer: models.Party{Name: "Test Corp", Country: "NG"},
		Beneficiary:      models.Party{Name: "Test Beneficiary", Country: "DE"},
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT103(w, r)

	if len(kafka.events) == 0 {
		t.Error("expected Kafka event to be published")
	}
	if kafka.events[0]["eventType"] == nil {
		t.Error("expected eventType in Kafka event")
	}
}

func TestHandleMT202_ValidRequest(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT202{
		SenderBIC:    "BISNGLA1XXX",
		ReceiverBIC:  "DEUTDEDBXXX",
		Amount:       500000,
		Currency:     "USD",
		OrderingBank: "BISNGLA1XXX",
		BeneficiaryBank: "BARCGB22XXX",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt202", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT202(w, r)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", w.Code)
	}
}

func TestHandleMT202COV_RequiresUnderlyingMT103(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	req := models.MT202{
		SenderBIC:   "BISNGLA1XXX",
		ReceiverBIC: "DEUTDEDBXXX",
		Amount:      100000,
		Currency:    "USD",
		IsCOV:       true,
		// Missing UnderlyingMT103
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/swift/mt202", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleMT202(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for MT202COV without underlying MT103, got %d", w.Code)
	}
}

func TestHandleGPITrack(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSWIFTHandler("http://localhost:8085", kafka)

	r := httptest.NewRequest(http.MethodGet, "/api/swift/gpi/test-uetr-123", nil)
	r.SetPathValue("uetr", "test-uetr-123")
	w := httptest.NewRecorder()

	h.HandleGPITrack(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["uetr"] != "test-uetr-123" {
		t.Errorf("expected uetr=test-uetr-123, got %v", resp["uetr"])
	}
}
