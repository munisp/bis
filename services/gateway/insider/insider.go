// Package insider handles insider threat detection events from the Dapr pub/sub bus.
// This package processes behavioural anomaly events published by the Rust
// event-processor service and triggers alerts for the BIS investigation team.
package insider

import (
	"encoding/json"
	"log"
	"net/http"
)

// InsiderEvent represents an insider threat event from the event processor.
type InsiderEvent struct {
	EventType  string                 `json:"type"`
	SubjectID  string                 `json:"subjectId"`
	TenantID   string                 `json:"tenantId"`
	RiskScore  float64                `json:"riskScore"`
	Indicators []string               `json:"indicators"`
	Payload    map[string]interface{} `json:"payload"`
	Timestamp  string                 `json:"timestamp"`
}

// HandleInsiderEvent is the Dapr subscriber for the insider-events topic.
// It receives behavioural anomaly events and logs them for investigation.
func HandleInsiderEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var event InsiderEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		log.Printf("[Insider] Failed to decode event: %v", err)
		http.Error(w, "invalid event", http.StatusBadRequest)
		return
	}

	log.Printf("[Insider] Received event: type=%s subject=%s riskScore=%.2f indicators=%v",
		event.EventType, event.SubjectID, event.RiskScore, event.Indicators)

	// Acknowledge to Dapr — downstream processing is handled by the event-processor
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}
