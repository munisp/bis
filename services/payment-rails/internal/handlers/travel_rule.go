package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"bis/payment-rails/internal/models"
)

// TravelRuleHandler implements FATF Travel Rule (FATF Recommendation 16)
// Threshold: USD 1,000 / EUR 1,000 / NGN 1,600,000
type TravelRuleHandler struct {
	kafka KafkaPublisher
}

func NewTravelRuleHandler(kafka KafkaPublisher) *TravelRuleHandler {
	return &TravelRuleHandler{kafka: kafka}
}

// POST /api/travel-rule/send — originating VASP sends travel rule data
func (h *TravelRuleHandler) HandleSend(w http.ResponseWriter, r *http.Request) {
	var payload models.TravelRulePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Validate required fields per FATF R.16
	if err := validateTravelRulePayload(payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if payload.RecordRef == "" {
		payload.RecordRef = fmt.Sprintf("TR-%d-%s", time.Now().UnixMilli(), randHex(4))
	}

	// Publish to Kafka for beneficiary VASP processing
	event := map[string]interface{}{
		"eventType":  "travel_rule.sent",
		"recordRef":  payload.RecordRef,
		"originator": payload.OriginatorName,
		"beneficiary": payload.BeneficiaryName,
		"amount":     payload.Amount,
		"currency":   payload.Currency,
		"vasp":       payload.VASP,
		"timestamp":  time.Now().UTC(),
	}
	if h.kafka != nil {
		data, _ := json.Marshal(event)
		_ = h.kafka.Publish(r.Context(), "travel-rule-events", payload.RecordRef, data)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"recordRef":   payload.RecordRef,
		"status":      "sent",
		"sentAt":      time.Now().UTC(),
		"message":     "Travel rule data transmitted to beneficiary VASP",
	})
}

// POST /api/travel-rule/receive — beneficiary VASP receives travel rule data
func (h *TravelRuleHandler) HandleReceive(w http.ResponseWriter, r *http.Request) {
	var payload models.TravelRulePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Publish acknowledgement
	event := map[string]interface{}{
		"eventType":  "travel_rule.received",
		"recordRef":  payload.RecordRef,
		"timestamp":  time.Now().UTC(),
	}
	if h.kafka != nil {
		data, _ := json.Marshal(event)
		_ = h.kafka.Publish(r.Context(), "travel-rule-events", payload.RecordRef, data)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"recordRef":      payload.RecordRef,
		"status":         "acknowledged",
		"acknowledgedAt": time.Now().UTC(),
	})
}

// GET /api/travel-rule/threshold — return current thresholds by currency
func (h *TravelRuleHandler) HandleThresholds(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"thresholds": map[string]float64{
			"USD": 1000,
			"EUR": 1000,
			"GBP": 1000,
			"NGN": 1_600_000,
			"GHS": 15000,
			"KES": 130000,
			"ZAR": 18000,
			"XOF": 655000,
		},
		"regulation":  "FATF Recommendation 16",
		"effectiveDate": "2023-01-01",
		"jurisdiction": "Pan-Africa / FATF",
	})
}

// ─── Validation ───────────────────────────────────────────────────────────────

func validateTravelRulePayload(p models.TravelRulePayload) error {
	if p.OriginatorName == "" {
		return fmt.Errorf("originatorName is required")
	}
	if p.BeneficiaryName == "" {
		return fmt.Errorf("beneficiaryName is required")
	}
	if p.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if len(p.Currency) != 3 {
		return fmt.Errorf("currency must be 3-letter ISO code")
	}
	// Check threshold
	thresholds := map[string]float64{
		"USD": 1000, "EUR": 1000, "GBP": 1000,
		"NGN": 1_600_000, "GHS": 15000, "KES": 130000,
	}
	if threshold, ok := thresholds[p.Currency]; ok && p.Amount < threshold {
		return fmt.Errorf("amount %.2f %s is below travel rule threshold %.2f", p.Amount, p.Currency, threshold)
	}
	return nil
}
