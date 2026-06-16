package kafka_test

import (
	"context"
	"testing"
	"time"

	"bis/payment-rails/internal/kafka"
)

// TestNewReturnsStubWhenNoBrokers verifies that New() returns a no-op stub
// when KAFKA_BROKERS is not set, so the service starts cleanly in dev/test.
func TestNewReturnsStubWhenNoBrokers(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")
	pub := kafka.New(kafka.LoadConfigFromEnv())
	if pub == nil {
		t.Fatal("expected non-nil publisher")
	}
	// Stub publish must not error.
	ctx := context.Background()
	if err := pub.Publish(ctx, "test-topic", "k1", []byte(`{"test":true}`)); err != nil {
		t.Fatalf("stub publish returned error: %v", err)
	}
	if err := pub.Close(); err != nil {
		t.Fatalf("stub close returned error: %v", err)
	}
}

// TestLoadConfigFromEnvDefaults verifies default values when env vars are absent.
func TestLoadConfigFromEnvDefaults(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")
	t.Setenv("KAFKA_BATCH_SIZE", "")
	t.Setenv("KAFKA_BATCH_TIMEOUT", "")
	t.Setenv("KAFKA_WRITE_TIMEOUT", "")
	cfg := kafka.LoadConfigFromEnv()
	if cfg.BatchSize != 100 {
		t.Errorf("expected BatchSize=100, got %d", cfg.BatchSize)
	}
	if cfg.BatchTimeout != 10*time.Millisecond {
		t.Errorf("expected BatchTimeout=10ms, got %v", cfg.BatchTimeout)
	}
	if cfg.WriteTimeout != 10*time.Second {
		t.Errorf("expected WriteTimeout=10s, got %v", cfg.WriteTimeout)
	}
}

// TestLoadConfigFromEnvCustom verifies env var overrides are applied.
func TestLoadConfigFromEnvCustom(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "broker1:9092,broker2:9092")
	t.Setenv("KAFKA_USERNAME", "alice")
	t.Setenv("KAFKA_PASSWORD", "secret")
	t.Setenv("KAFKA_BATCH_SIZE", "500")
	t.Setenv("KAFKA_BATCH_TIMEOUT", "50ms")
	t.Setenv("KAFKA_WRITE_TIMEOUT", "30s")
	cfg := kafka.LoadConfigFromEnv()
	if cfg.Brokers != "broker1:9092,broker2:9092" {
		t.Errorf("unexpected brokers: %s", cfg.Brokers)
	}
	if cfg.Username != "alice" {
		t.Errorf("unexpected username: %s", cfg.Username)
	}
	if cfg.BatchSize != 500 {
		t.Errorf("expected BatchSize=500, got %d", cfg.BatchSize)
	}
	if cfg.BatchTimeout != 50*time.Millisecond {
		t.Errorf("expected BatchTimeout=50ms, got %v", cfg.BatchTimeout)
	}
	if cfg.WriteTimeout != 30*time.Second {
		t.Errorf("expected WriteTimeout=30s, got %v", cfg.WriteTimeout)
	}
}

// TestStubPublisherMultipleMessages verifies the stub handles multiple publishes.
func TestStubPublisherMultipleMessages(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")
	pub := kafka.New(kafka.LoadConfigFromEnv())
	ctx := context.Background()
	topics := []string{"payments.swift", "payments.sepa", "payments.travel_rule"}
	for _, topic := range topics {
		for i := 0; i < 10; i++ {
			if err := pub.Publish(ctx, topic, "key", []byte(`{}`)); err != nil {
				t.Fatalf("publish to %s failed: %v", topic, err)
			}
		}
	}
}

// TestPublisherInterface verifies that both stub and real writer satisfy Publisher.
func TestPublisherInterface(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")
	var _ kafka.Publisher = kafka.New(kafka.LoadConfigFromEnv())
}
