// topics.go — Kafka topic management helpers for BIS gateway.
package kafka

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	kafkago "github.com/segmentio/kafka-go"
)

// EnsureTopic creates a topic through the Kafka controller when it does not
// already exist. Broker configuration and controller reachability are mandatory.
func EnsureTopic(topic string) error {
	if strings.TrimSpace(topic) == "" {
		return fmt.Errorf("Kafka topic is required")
	}
	brokers := strings.Split(strings.TrimSpace(os.Getenv("KAFKA_BROKERS")), ",")
	if len(brokers) == 0 || strings.TrimSpace(brokers[0]) == "" {
		return fmt.Errorf("KAFKA_BROKERS is required to provision topic %q", topic)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	bootstrap, err := kafkago.DialContext(ctx, "tcp", strings.TrimSpace(brokers[0]))
	if err != nil {
		return fmt.Errorf("connect to Kafka bootstrap broker: %w", err)
	}
	defer bootstrap.Close()

	controller, err := bootstrap.Controller()
	if err != nil {
		return fmt.Errorf("discover Kafka controller: %w", err)
	}
	controllerAddress := fmt.Sprintf("%s:%d", controller.Host, controller.Port)
	controllerConnection, err := kafkago.DialContext(ctx, "tcp", controllerAddress)
	if err != nil {
		return fmt.Errorf("connect to Kafka controller: %w", err)
	}
	defer controllerConnection.Close()

	err = controllerConnection.CreateTopics(kafkago.TopicConfig{
		Topic:             topic,
		NumPartitions:     3,
		ReplicationFactor: 1,
	})
	if err != nil && !errors.Is(err, kafkago.TopicAlreadyExists) {
		return fmt.Errorf("create Kafka topic %q: %w", topic, err)
	}
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
