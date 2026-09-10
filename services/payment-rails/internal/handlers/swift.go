package handlers

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"bis/payment-rails/internal/models"

	"github.com/google/uuid"
)

// SWIFTHandler processes SWIFT MT103/MT202 messages
type SWIFTHandler struct {
	amlURL      string
	kafka       KafkaPublisher
	swiftGPIURL string
	swiftBIC    string
	httpClient  *http.Client
}

type KafkaPublisher interface {
	Publish(ctx context.Context, topic string, key string, value []byte) error
}

func NewSWIFTHandler(amlURL string, kafka KafkaPublisher) *SWIFTHandler {
	return &SWIFTHandler{amlURL: amlURL, kafka: kafka,
		httpClient: &http.Client{Timeout: 10 * time.Second}}
}

// NewSWIFTHandlerWithGPI creates a handler with SWIFT GPI API credentials.
func NewSWIFTHandlerWithGPI(amlURL, swiftGPIURL, swiftBIC string, kafka KafkaPublisher) *SWIFTHandler {
	return &SWIFTHandler{amlURL: amlURL, kafka: kafka,
		swiftGPIURL: swiftGPIURL, swiftBIC: swiftBIC,
		httpClient: &http.Client{Timeout: 10 * time.Second}}
}

// POST /api/swift/mt103
func (h *SWIFTHandler) HandleMT103(w http.ResponseWriter, r *http.Request) {
	var req models.MT103
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Assign UETR if not provided
	if req.UETR == "" {
		req.UETR = uuid.New().String()
	}
	if req.TransactionRef == "" {
		req.TransactionRef = fmt.Sprintf("MT103-%d-%s", time.Now().UnixMilli(), randHex(4))
	}
	if req.ChargesCode == "" {
		req.ChargesCode = "SHA"
	}

	// Validate mandatory fields
	if req.SenderBIC == "" || req.ReceiverBIC == "" {
		writeError(w, http.StatusBadRequest, "senderBic and receiverBic are required")
		return
	}
	if req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "amount must be positive")
		return
	}
	if len(req.Currency) != 3 {
		writeError(w, http.StatusBadRequest, "currency must be 3-letter ISO code")
		return
	}

	// AML pre-screening
	screenReq := models.AMLScreenRequest{
		TransactionRef:     req.TransactionRef,
		Amount:             req.Amount,
		Currency:           req.Currency,
		OriginatorName:     req.OrderingCustomer.Name,
		OriginatorCountry:  req.OrderingCustomer.Country,
		BeneficiaryName:    req.Beneficiary.Name,
		BeneficiaryCountry: req.Beneficiary.Country,
		TransactionType:    "swift_mt103",
		Narration:          req.RemittanceInfo,
	}
	screenResp, err := h.screenAML(r.Context(), screenReq)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "AML screening is unavailable; transaction was not accepted")
		return
	}

	if screenResp.Blocked {
		// Publish blocked event to Kafka
		event := models.PaymentEvent{
			EventType:      "swift.mt103.blocked",
			TransactionRef: req.TransactionRef,
			UETR:           req.UETR,
			Amount:         req.Amount,
			Currency:       req.Currency,
			Status:         "blocked",
			RiskLevel:      screenResp.RiskLevel,
			Timestamp:      time.Now().UTC(),
		}
		if err := h.publishEvent(r.Context(), "payment-events", event); err != nil {
			writeError(w, http.StatusServiceUnavailable, "blocked transaction could not be durably recorded")
			return
		}
		writeError(w, http.StatusForbidden, "transaction blocked by AML screening")
		return
	}

	status := "accepted"
	if screenResp.RiskLevel == "high" || screenResp.RiskLevel == "critical" {
		status = "pending_compliance"
	}

	// Publish accepted event
	event := models.PaymentEvent{
		EventType:      "swift.mt103.accepted",
		TransactionRef: req.TransactionRef,
		UETR:           req.UETR,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Status:         status,
		RiskLevel:      screenResp.RiskLevel,
		Timestamp:      time.Now().UTC(),
	}
	if err := h.publishEvent(r.Context(), "payment-events", event); err != nil {
		writeError(w, http.StatusServiceUnavailable, "payment event could not be durably recorded")
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"uetr":           req.UETR,
		"transactionRef": req.TransactionRef,
		"status":         status,
		"riskLevel":      screenResp.RiskLevel,
		"riskScore":      screenResp.RiskScore,
		"flags":          screenResp.Flags,
		"acceptedAt":     time.Now().UTC(),
	})
}

// POST /api/swift/mt202
func (h *SWIFTHandler) HandleMT202(w http.ResponseWriter, r *http.Request) {
	var req models.MT202
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.UETR == "" {
		req.UETR = uuid.New().String()
	}
	if req.TransactionRef == "" {
		req.TransactionRef = fmt.Sprintf("MT202-%d-%s", time.Now().UnixMilli(), randHex(4))
	}

	// MT202COV requires underlying MT103
	if req.IsCOV && req.UnderlyingMT103 == nil {
		writeError(w, http.StatusBadRequest, "MT202COV requires underlying MT103 details")
		return
	}

	event := models.PaymentEvent{
		EventType:      "swift.mt202.accepted",
		TransactionRef: req.TransactionRef,
		UETR:           req.UETR,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Status:         "accepted",
		Timestamp:      time.Now().UTC(),
	}
	if err := h.publishEvent(r.Context(), "payment-events", event); err != nil {
		writeError(w, http.StatusServiceUnavailable, "payment event could not be durably recorded")
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"uetr":           req.UETR,
		"transactionRef": req.TransactionRef,
		"status":         "accepted",
		"acceptedAt":     time.Now().UTC(),
	})
}

// GET /api/swift/gpi/:uetr — GPI tracker.
// The endpoint returns only a response received from the configured SWIFT GPI provider.
func (h *SWIFTHandler) HandleGPITrack(w http.ResponseWriter, r *http.Request) {
	uetr := r.PathValue("uetr")
	if uetr == "" {
		writeError(w, http.StatusBadRequest, "uetr is required")
		return
	}
	if h.swiftGPIURL == "" || h.swiftBIC == "" {
		writeError(w, http.StatusServiceUnavailable, "SWIFT GPI integration is not configured")
		return
	}
	apiURL := fmt.Sprintf("%s/transactions/%s", h.swiftGPIURL, uetr)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "unable to create SWIFT GPI request")
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-BIC", h.swiftBIC)
	resp, err := h.httpClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "SWIFT GPI service is unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("SWIFT GPI returned HTTP %d", resp.StatusCode))
		return
	}
	var gpiResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&gpiResp); err != nil {
		writeError(w, http.StatusBadGateway, "invalid SWIFT GPI response")
		return
	}
	writeJSON(w, http.StatusOK, gpiResp)
}

func (h *SWIFTHandler) bic() string {
	return h.swiftBIC
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// screenAML calls the authenticated BIS AML Engine. An unavailable or malformed
// AML result rejects the payment path rather than producing an unscreened decision.
func (h *SWIFTHandler) screenAML(ctx context.Context, req models.AMLScreenRequest) (*models.AMLScreenResponse, error) {
	if h.amlURL == "" {
		return nil, fmt.Errorf("AML_ENGINE_URL is not configured")
	}
	amlKey := os.Getenv("BIS_AML_ENGINE_KEY")
	if amlKey == "" {
		return nil, fmt.Errorf("BIS_AML_ENGINE_KEY is not configured")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal AML request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.amlURL+"/screen", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create AML request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-BIS-Key", amlKey)
	client := &http.Client{Timeout: 5 * time.Second}
	httpResp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("AML request: %w", err)
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AML returned HTTP %d", httpResp.StatusCode)
	}
	var resp models.AMLScreenResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return nil, fmt.Errorf("decode AML response: %w", err)
	}
	return &resp, nil
}

func (h *SWIFTHandler) publishEvent(ctx context.Context, topic string, event models.PaymentEvent) error {
	if h.kafka == nil {
		return fmt.Errorf("Kafka publisher is not configured")
	}
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal payment event: %w", err)
	}
	if err := h.kafka.Publish(ctx, topic, event.TransactionRef, data); err != nil {
		return fmt.Errorf("publish payment event: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := cryptorand.Read(b); err != nil {
		panic(fmt.Sprintf("secure random generation failed: %v", err))
	}
	return hex.EncodeToString(b)
}
