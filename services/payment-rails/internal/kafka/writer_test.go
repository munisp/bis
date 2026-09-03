package kafka_test

import (
	"context"
	"testing"
	"time"

	"bis/payment-rails/internal/kafka"
)

func TestNewRejectsMissingBrokers(t *testing.T) {
	_, err := kafka.New(kafka.WriterConfig{})
	if err == nil {
		t.Fatal("expected missing KAFKA_BROKERS to be rejected")
	}
}

func TestNewRejectsMissingSASLCredentials(t *testing.T) {
	_, err := kafka.New(kafka.WriterConfig{Brokers: "broker.example.test:9093"})
	if err == nil {
		t.Fatal("expected missing SASL credentials to be rejected")
	}
}

func TestNewRejectsAsyncPublishing(t *testing.T) {
	_, err := kafka.New(kafka.WriterConfig{
		Brokers:  "broker.example.test:9093",
		Username: "payment-writer",
		Password: "test-secret",
		Async:    true,
	})
	if err == nil {
		t.Fatal("expected asynchronous payment publishing to be rejected")
	}
}

func TestNewCreatesDurablePublisher(t *testing.T) {
	pub, err := kafka.New(kafka.WriterConfig{
		Brokers:      "broker.example.test:9093",
		Username:     "payment-writer",
		Password:     "test-secret",
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
		WriteTimeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("expected durable publisher: %v", err)
	}
	if pub == nil {
		t.Fatal("expected non-nil durable publisher")
	}
	if err := pub.Close(); err != nil {
		t.Fatalf("close returned error: %v", err)
	}
}

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

func TestPublisherInterface(t *testing.T) {
	var _ kafka.Publisher = (*testPublisher)(nil)
}

type testPublisher struct{}

func (*testPublisher) Publish(_ context.Context, _ string, _ string, _ []byte) error { return nil }
func (*testPublisher) Close() error                                                  { return nil }
