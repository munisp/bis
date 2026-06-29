// topics.go — Kafka topic management helpers for BIS gateway.
// EnsureTopic is a best-effort call that creates a Kafka topic if it does not
// exist. In development (no Kafka configured) this is a no-op.
package kafka

import (
	"log"
	"os"
)

// EnsureTopic attempts to create a Kafka topic if it does not exist.
// This is a best-effort operation; failures are logged but not fatal.
// In production, topics should be pre-created via the Kafka admin API or
// a Terraform/Helm chart. This helper is for development convenience.
func EnsureTopic(topic string) error {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		// Kafka not configured — no-op
		return nil
	}
	// In a production implementation this would use the Kafka admin client
	// (e.g. github.com/segmentio/kafka-go AdminClient) to create the topic.
	// For now we log the intent and return nil to avoid adding a new dependency.
	log.Printf("[Kafka] EnsureTopic: %s (broker: %s)", topic, brokers)
	return nil
}

// AllBISTopics returns the complete list of Kafka topics used by the BIS platform.
func AllBISTopics() []string {
	return []string{
		// Core investigation topics
		"bis.events",
		"bis.alerts",
		"bis.audit",
		"bis.billing",
		// AML / screening topics
		"bis.aml.alerts",
		"bis.screening.results",
		"bis.kyc.events",
		// Biometric topics
		"bis.biometric.events",
		// Payment topics
		"bis.payment.nip",
		"bis.payment.mojaloop",
		"bis.stablecoin.transfer",
		// Criminal records topics (new)
		"bis.criminal.request_submitted",
		"bis.criminal.record_ingested",
		"bis.criminal.record_verified",
		"bis.criminal.dapr_event",
		// Corporate check topics (new)
		"bis.corporate.check_completed",
		"bis.corporate.dapr_event",
		// Field visit topics (new)
		"bis.field_visit.checked_in",
		"bis.field_visit.checked_out",
		"bis.field_visit.completed",
		// Thin-file topics (new)
		"bis.investigation.thin_file_flagged",
		"bis.investigation.thin_file_reverted",
		// Mojaloop compliance (new)
		"bis.mojaloop.compliance_checked",
		// Fluvio velocity (new)
		"bis.fluvio.criminal_record",
		// Insider threat
		"bis.insider.events",
	}
}
