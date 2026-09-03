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

type mockKafka struct{ events []map[string]interface{} }

func (p *mockKafka) Publish(_ context.Context, _ string, _ string, value []byte) error {
	var event map[string]interface{}
	if err := json.Unmarshal(value, &event); err != nil {
		return err
	}
	p.events = append(p.events, event)
	return nil
}

func newAMLServer(t *testing.T, response models.AMLScreenResponse, status int) *httptest.Server {
	t.Helper()
	t.Setenv("BIS_AML_ENGINE_KEY", "aml-test-key")
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-BIS-Key") != "aml-test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(response)
	}))
}

func validMT103() models.MT103 {
	return models.MT103{
		SenderBIC: "BISNGLA1XXX", ReceiverBIC: "BARCGB22XXX", Amount: 50000, Currency: "USD", ValueDate: time.Now(),
		OrderingCustomer: models.Party{Name: "Acme Corp", Account: "1234567890", Country: "NG"},
		Beneficiary:      models.Party{Name: "Global Imports Ltd", Account: "GB29NWBK60161331926819", Country: "GB"},
		RemittanceInfo:   "Invoice INV-2026-001", ChargesCode: "SHA",
	}
}

func TestHandleMT103AcceptsOnlyAfterAMLAndEventDelivery(t *testing.T) {
	publisher := &mockKafka{}
	aml := newAMLServer(t, models.AMLScreenResponse{RiskScore: 12, RiskLevel: "low", Blocked: false}, http.StatusOK)
	defer aml.Close()
	h := handlers.NewSWIFTHandler(aml.URL, publisher)
	body, _ := json.Marshal(validMT103())
	request := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.HandleMT103(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", response.Code, response.Body.String())
	}
	if len(publisher.events) != 1 {
		t.Fatalf("expected one durable event, got %d", len(publisher.events))
	}
	if publisher.events[0]["eventType"] != "swift.mt103.accepted" {
		t.Fatalf("unexpected event type: %v", publisher.events[0]["eventType"])
	}
}

func TestHandleMT103FailsClosedWhenAMLUnavailable(t *testing.T) {
	publisher := &mockKafka{}
	t.Setenv("BIS_AML_ENGINE_KEY", "aml-test-key")
	h := handlers.NewSWIFTHandler("http://127.0.0.1:1", publisher)
	body, _ := json.Marshal(validMT103())
	request := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.HandleMT103(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
	if len(publisher.events) != 0 {
		t.Fatal("payment must not publish an accepted event without AML")
	}
}

func TestHandleMT103BlocksProviderMarkedTransaction(t *testing.T) {
	publisher := &mockKafka{}
	aml := newAMLServer(t, models.AMLScreenResponse{RiskScore: 100, RiskLevel: "critical", Blocked: true}, http.StatusOK)
	defer aml.Close()
	h := handlers.NewSWIFTHandler(aml.URL, publisher)
	body, _ := json.Marshal(validMT103())
	request := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.HandleMT103(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}
	if len(publisher.events) != 1 || publisher.events[0]["eventType"] != "swift.mt103.blocked" {
		t.Fatal("blocked transaction must have a durable blocked event")
	}
}

func TestHandleMT103RejectsMalformedRequest(t *testing.T) {
	h := handlers.NewSWIFTHandler("http://127.0.0.1:1", &mockKafka{})
	body, _ := json.Marshal(models.MT103{Amount: 1, Currency: "USD"})
	request := httptest.NewRequest(http.MethodPost, "/api/swift/mt103", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.HandleMT103(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestHandleMT202RequiresDurableEvent(t *testing.T) {
	publisher := &mockKafka{}
	h := handlers.NewSWIFTHandler("", publisher)
	requestBody, _ := json.Marshal(models.MT202{SenderBIC: "BISNGLA1XXX", ReceiverBIC: "DEUTDEDBXXX", Amount: 500000, Currency: "USD", OrderingBank: "BISNGLA1XXX", BeneficiaryBank: "BARCGB22XXX"})
	request := httptest.NewRequest(http.MethodPost, "/api/swift/mt202", bytes.NewReader(requestBody))
	response := httptest.NewRecorder()
	h.HandleMT202(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", response.Code)
	}
	if len(publisher.events) != 1 {
		t.Fatal("expected a durable MT202 event")
	}
}

func TestHandleGPITrackRequiresConfiguredProvider(t *testing.T) {
	h := handlers.NewSWIFTHandler("", &mockKafka{})
	request := httptest.NewRequest(http.MethodGet, "/api/swift/gpi/test-uetr", nil)
	request.SetPathValue("uetr", "test-uetr")
	response := httptest.NewRecorder()
	h.HandleGPITrack(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
}

func TestHandleGPITrackReturnsProviderPayload(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-BIC") != "BISNGLA1XXX" {
			http.Error(w, "missing BIC", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"uetr": "test-uetr", "status": "ACSP"})
	}))
	defer provider.Close()
	h := handlers.NewSWIFTHandlerWithGPI("", provider.URL, "BISNGLA1XXX", &mockKafka{})
	request := httptest.NewRequest(http.MethodGet, "/api/swift/gpi/test-uetr", nil)
	request.SetPathValue("uetr", "test-uetr")
	response := httptest.NewRecorder()
	h.HandleGPITrack(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}
