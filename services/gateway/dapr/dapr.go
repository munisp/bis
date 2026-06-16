// Package dapr provides Dapr pub/sub subscriber handlers for the BIS gateway.
//
// The gateway acts as a Dapr subscriber for:
//   - bis.aml.alerts        → forward to risk engine + Kafka
//   - bis.investigation.events → forward to case-manager + Kafka
//   - bis.biometric.events  → forward to biometric engine audit log
//
// Dapr calls these endpoints via HTTP POST when messages arrive on the topics.
// The sidecar is configured via infra/dapr/components/pubsub.yaml.
package dapr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// ─── Config ───────────────────────────────────────────────────────────────────

var (
	pubsubName       = envOr("DAPR_PUBSUB_NAME", "bis-pubsub")
	daprPort         = envOr("DAPR_HTTP_PORT", "3500")
	riskEngineURL    = envOr("RISK_ENGINE_URL", "http://localhost:8082")
	caseManagerURL   = envOr("CASE_MANAGER_URL", "http://localhost:8085")
	biometricEngURL  = envOr("BIOMETRIC_ENGINE_URL", "http://localhost:8084")
	kafkaBrokers     = envOr("KAFKA_BROKERS", "localhost:9092")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── CloudEvent envelope ──────────────────────────────────────────────────────

// CloudEvent is the Dapr CloudEvent envelope wrapping the published data.
type CloudEvent struct {
	ID          string          `json:"id"`
	Source      string          `json:"source"`
	Type        string          `json:"type"`
	SpecVersion string          `json:"specversion"`
	DataContent string          `json:"datacontenttype"`
	Data        json.RawMessage `json:"data"`
	Time        string          `json:"time"`
}

// ─── Subscription registration ────────────────────────────────────────────────

// Subscription describes a Dapr pub/sub subscription.
type Subscription struct {
	PubsubName string            `json:"pubsubname"`
	Topic      string            `json:"topic"`
	Route      string            `json:"route"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// Subscriptions returns the list of topics this service subscribes to.
// Dapr calls GET /dapr/subscribe to discover subscriptions.
func Subscriptions() []Subscription {
	return []Subscription{
		{
			PubsubName: pubsubName,
			Topic:      "bis.aml.alerts",
			Route:      "/dapr/subscribe/aml-alerts",
		},
		{
			PubsubName: pubsubName,
			Topic:      "bis.investigation.events",
			Route:      "/dapr/subscribe/investigation-events",
		},
		{
			PubsubName: pubsubName,
			Topic:      "bis.biometric.events",
			Route:      "/dapr/subscribe/biometric-events",
		},
		{
			PubsubName: pubsubName,
			Topic:      "bis.kyc.events",
			Route:      "/dapr/subscribe/kyc-events",
		},
		{
			PubsubName: pubsubName,
			Topic:      "bis.payment.events",
			Route:      "/dapr/subscribe/payment-events",
		},
	}
}

// ─── Handler: AML alerts ──────────────────────────────────────────────────────

// HandleAMLAlert processes incoming AML alert events from Dapr.
// Forwards to the risk engine for re-scoring and publishes to Kafka.
func HandleAMLAlert(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event CloudEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid CloudEvent", http.StatusBadRequest)
		return
	}

	var data map[string]interface{}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		log.Printf("[Dapr] AML alert: failed to parse data: %v", err)
		// Return 200 so Dapr doesn't retry malformed messages
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[Dapr] AML alert received: alertId=%v type=%v score=%v",
		data["alertId"], data["alertType"], data["riskScore"])

	// Forward to risk engine for re-scoring
	go forwardToService(riskEngineURL+"/v1/alert/process", data)

	// Acknowledge to Dapr
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// ─── Handler: Investigation events ───────────────────────────────────────────

// HandleInvestigationEvent processes incoming investigation events from Dapr.
// Forwards to case-manager for case linking.
func HandleInvestigationEvent(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event CloudEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid CloudEvent", http.StatusBadRequest)
		return
	}

	var data map[string]interface{}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		log.Printf("[Dapr] Investigation event: failed to parse data: %v", err)
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[Dapr] Investigation event received: type=%v ref=%v",
		data["eventType"], data["ref"])

	// Forward to case-manager for case linking on escalation
	if data["eventType"] == "escalated" {
		go forwardToService(caseManagerURL+"/v1/investigation/escalated", data)
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// ─── Handler: Biometric events ────────────────────────────────────────────────

// HandleBiometricEvent processes incoming biometric events from Dapr.
// Forwards spoof detections to the biometric engine audit log.
func HandleBiometricEvent(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event CloudEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid CloudEvent", http.StatusBadRequest)
		return
	}

	var data map[string]interface{}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		log.Printf("[Dapr] Biometric event: failed to parse data: %v", err)
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[Dapr] Biometric event received: type=%v subject=%v",
		data["eventType"], data["subjectRef"])

	// Forward spoof detections to biometric engine for audit
	if data["eventType"] == "spoof_detected" {
		go forwardToService(biometricEngURL+"/audit/spoof", data)
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// ─── Handler: KYC events ─────────────────────────────────────────────────────

// HandleKYCEvent processes incoming KYC events from Dapr.
func HandleKYCEvent(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event CloudEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid CloudEvent", http.StatusBadRequest)
		return
	}

	var data map[string]interface{}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[Dapr] KYC event received: type=%v subject=%v",
		data["eventType"], data["subjectRef"])

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// ─── Handler: Payment events ──────────────────────────────────────────────────

// HandlePaymentEvent processes incoming payment events from Dapr.
func HandlePaymentEvent(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event CloudEvent
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "invalid CloudEvent", http.StatusBadRequest)
		return
	}

	var data map[string]interface{}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[Dapr] Payment event received: type=%v txRef=%v amount=%v",
		data["eventType"], data["txRef"], data["amountKobo"])

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// ─── Dapr pub/sub publisher ───────────────────────────────────────────────────

// Publish sends an event to a Dapr topic via the sidecar HTTP API.
func Publish(topic string, data interface{}) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("dapr publish marshal: %w", err)
	}

	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s",
		daprPort, pubsubName, topic)

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("dapr publish request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("dapr publish: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("dapr publish failed: %d %s", resp.StatusCode, string(body))
	}

	return nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func forwardToService(url string, data map[string]interface{}) {
	payload, err := json.Marshal(data)
	if err != nil {
		log.Printf("[Dapr] forwardToService marshal error: %v", err)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		log.Printf("[Dapr] forwardToService %s error: %v", url, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[Dapr] forwardToService %s returned %d: %s", url, resp.StatusCode, string(body))
	}
}
