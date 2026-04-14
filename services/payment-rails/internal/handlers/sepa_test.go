package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bis/payment-rails/internal/handlers"
	"bis/payment-rails/internal/models"
)

func TestHandleCreditTransfer_Valid(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSEPAHandler(kafka)

	req := models.SEPACreditTransferRequest{
		PaymentType:    models.SEPACreditTransfer,
		Amount:         1500.00,
		Currency:       "EUR",
		DebtorName:     "Test Debtor GmbH",
		DebtorIBAN:     "DE89370400440532013000",
		DebtorBIC:      "DEUTDEDB",
		CreditorName:   "Test Creditor SA",
		CreditorIBAN:   "FR7630006000011234567890189",
		CreditorBIC:    "BNPAFRPP",
		RemittanceInfo: "Invoice 2026-001",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/sepa/credit-transfer", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleCreditTransfer(w, r)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["response"] == nil {
		t.Error("expected response object")
	}
	if resp["xmlPayload"] == nil {
		t.Error("expected xmlPayload (pacs.008)")
	}
}

func TestHandleCreditTransfer_InvalidIBAN(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSEPAHandler(kafka)

	req := models.SEPACreditTransferRequest{
		Amount:       100,
		Currency:     "EUR",
		DebtorName:   "Test",
		DebtorIBAN:   "INVALID",
		CreditorName: "Test2",
		CreditorIBAN: "FR7630006000011234567890189",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/sepa/credit-transfer", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleCreditTransfer(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid IBAN, got %d", w.Code)
	}
}

func TestHandleInstant_ExceedsLimit(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSEPAHandler(kafka)

	req := models.SEPACreditTransferRequest{
		PaymentType:  models.SEPAInstant,
		Amount:       200_000, // Exceeds 100k EUR limit
		Currency:     "EUR",
		DebtorName:   "Test",
		DebtorIBAN:   "DE89370400440532013000",
		CreditorName: "Test2",
		CreditorIBAN: "FR7630006000011234567890189",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/sepa/instant", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleInstant(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for amount exceeding SCT Inst limit, got %d", w.Code)
	}
}

func TestHandleInstant_ValidSmallAmount(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSEPAHandler(kafka)

	req := models.SEPACreditTransferRequest{
		PaymentType:  models.SEPAInstant,
		Amount:       500,
		Currency:     "EUR",
		DebtorName:   "Test",
		DebtorIBAN:   "DE89370400440532013000",
		CreditorName: "Test2",
		CreditorIBAN: "FR7630006000011234567890189",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/sepa/instant", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleInstant(w, r)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleDirectDebit_Valid(t *testing.T) {
	kafka := &mockKafka{}
	h := handlers.NewSEPAHandler(kafka)

	req := models.SEPACreditTransferRequest{
		PaymentType:  models.SEPADirectDebit,
		Amount:       250,
		Currency:     "EUR",
		DebtorName:   "Subscriber",
		DebtorIBAN:   "DE89370400440532013000",
		CreditorName: "Service Provider",
		CreditorIBAN: "NL91ABNA0417164300",
	}
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/sepa/direct-debit", bytes.NewReader(body))
	w := httptest.NewRecorder()

	h.HandleDirectDebit(w, r)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", w.Code)
	}
}
