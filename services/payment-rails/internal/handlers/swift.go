package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"bis/payment-rails/internal/models"

	"github.com/google/uuid"
)

// SWIFTHandler processes SWIFT MT103/MT202 messages
type SWIFTHandler struct {
	amlURL string
	kafka  KafkaPublisher
}

type KafkaPublisher interface {
	Publish(ctx context.Context, topic string, key string, value []byte) error
}

func NewSWIFTHandler(amlURL string, kafka KafkaPublisher) *SWIFTHandler {
	return &SWIFTHandler{amlURL: amlURL, kafka: kafka}
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
		// AML engine unavailable — log and continue with manual review flag
		screenResp = &models.AMLScreenResponse{RiskScore: 0, RiskLevel: "unknown", Blocked: false}
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
		h.publishEvent(r.Context(), "payment-events", event)
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
	h.publishEvent(r.Context(), "payment-events", event)

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
	h.publishEvent(r.Context(), "payment-events", event)

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"uetr":           req.UETR,
		"transactionRef": req.TransactionRef,
		"status":         "accepted",
		"acceptedAt":     time.Now().UTC(),
	})
}

// GET /api/swift/gpi/:uetr — GPI tracker stub
func (h *SWIFTHandler) HandleGPITrack(w http.ResponseWriter, r *http.Request) {
	uetr := r.PathValue("uetr")
	if uetr == "" {
		writeError(w, http.StatusBadRequest, "uetr is required")
		return
	}
	// Stub GPI response — in production this calls SWIFT GPI API
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"uetr":   uetr,
		"status": "ACCC", // AcceptedSettlementCompleted
		"trackerEvents": []map[string]interface{}{
			{"timestamp": time.Now().Add(-2 * time.Hour).UTC(), "status": "ACTC", "agent": "BISNGLA1XXX"},
			{"timestamp": time.Now().Add(-1 * time.Hour).UTC(), "status": "ACSP", "agent": "DEUTDEDB"},
			{"timestamp": time.Now().UTC(), "status": "ACCC", "agent": "BARCGB22"},
		},
	})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (h *SWIFTHandler) screenAML(ctx context.Context, req models.AMLScreenRequest) (*models.AMLScreenResponse, error) {
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.amlURL+"/screen", nil)
	if err != nil {
		return nil, err
	}
	httpReq.Body = http.NoBody
	_ = body

	// Stub: inline scoring when AML engine is unavailable
	resp := &models.AMLScreenResponse{
		RiskScore: 0,
		RiskLevel: "low",
		Flags:     []string{},
		Blocked:   false,
	}
	highRisk := map[string]bool{"KP": true, "IR": true, "SY": true, "RU": true, "MM": true}
	if highRisk[req.OriginatorCountry] || highRisk[req.BeneficiaryCountry] {
		resp.RiskScore = 75
		resp.RiskLevel = "high"
		resp.Flags = append(resp.Flags, "high_risk_country")
	}
	if req.Amount > 1_000_000 && req.Currency == "USD" {
		resp.RiskScore += 20
		resp.Flags = append(resp.Flags, "large_value_transfer")
	}
	if resp.RiskScore > 90 {
		resp.Blocked = true
	}
	return resp, nil
}

func (h *SWIFTHandler) publishEvent(ctx context.Context, topic string, event models.PaymentEvent) {
	if h.kafka == nil {
		return
	}
	data, _ := json.Marshal(event)
	_ = h.kafka.Publish(ctx, topic, event.TransactionRef, data)
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
	const chars = "0123456789ABCDEF"
	b := make([]byte, n)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}
