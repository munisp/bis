// Package kafka provides a production-ready Kafka publisher for the payment-rails service.
// It wraps github.com/segmentio/kafka-go with:
//   - TLS support (SASL/SCRAM-SHA-512 for Confluent Cloud / MSK)
//   - Automatic topic creation on first publish
//   - Configurable batch size, linger, and compression (Snappy)
//   - Graceful shutdown via Close()
//   - Prometheus-compatible metrics hooks (via zerolog structured events)
package kafka

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	kafkago "github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/scram"
)

// Publisher is the durable event-publishing contract used by payment operations.
type Publisher interface {
	Publish(ctx context.Context, topic, key string, value []byte) error
	Close() error
}

// WriterConfig holds all tunable parameters for the Kafka writer.
type WriterConfig struct {
	// Brokers is a comma-separated list of bootstrap servers.
	Brokers string
	// Username / Password for SASL/SCRAM-SHA-512 (leave empty to disable SASL).
	Username string
	Password string
	// BatchSize is the maximum number of messages batched in one Produce request.
	BatchSize int
	// BatchTimeout is the maximum time to wait before flushing an incomplete batch.
	BatchTimeout time.Duration
	// WriteTimeout is the per-write deadline.
	WriteTimeout time.Duration
	// Async enables fire-and-forget mode (lower latency, no delivery guarantee).
	Async bool
}

// LoadConfigFromEnv reads WriterConfig from environment variables:
//
//	KAFKA_BROKERS        comma-separated bootstrap servers (required)
//	KAFKA_USERNAME       SASL username (optional)
//	KAFKA_PASSWORD       SASL password (optional)
//	KAFKA_BATCH_SIZE     default 100
//	KAFKA_BATCH_TIMEOUT  default 10ms
//	KAFKA_WRITE_TIMEOUT  default 10s
func LoadConfigFromEnv() WriterConfig {
	batchSize := 100
	if v := os.Getenv("KAFKA_BATCH_SIZE"); v != "" {
		fmt.Sscanf(v, "%d", &batchSize)
	}
	batchTimeout := 10 * time.Millisecond
	if v := os.Getenv("KAFKA_BATCH_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			batchTimeout = d
		}
	}
	writeTimeout := 10 * time.Second
	if v := os.Getenv("KAFKA_WRITE_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			writeTimeout = d
		}
	}
	return WriterConfig{
		Brokers:      os.Getenv("KAFKA_BROKERS"),
		Username:     os.Getenv("KAFKA_USERNAME"),
		Password:     os.Getenv("KAFKA_PASSWORD"),
		BatchSize:    batchSize,
		BatchTimeout: batchTimeout,
		WriteTimeout: writeTimeout,
	}
}

// writer is the production Kafka publisher backed by kafka-go.
type writer struct {
	mu      sync.Mutex
	writers map[string]*kafkago.Writer
	cfg     WriterConfig
}

// New creates a synchronous Kafka publisher. Payment processing must never
// acknowledge a durable operation when its event stream is unavailable.
func New(cfg WriterConfig) (Publisher, error) {
	if strings.TrimSpace(cfg.Brokers) == "" {
		return nil, fmt.Errorf("KAFKA_BROKERS must be configured")
	}
	if strings.TrimSpace(cfg.Username) == "" || strings.TrimSpace(cfg.Password) == "" {
		return nil, fmt.Errorf("KAFKA_USERNAME and KAFKA_PASSWORD must be configured for SASL/TLS")
	}
	if cfg.Async {
		return nil, fmt.Errorf("asynchronous Kafka publishing is prohibited for payment events")
	}
	log.Info().
		Str("brokers", cfg.Brokers).
		Msg("[Kafka] initialising durable SASL/TLS publisher")
	return &writer{
		writers: make(map[string]*kafkago.Writer),
		cfg:     cfg,
	}, nil
}

// writerFor returns (creating if necessary) a *kafkago.Writer for the given topic.
func (w *writer) writerFor(topic string) *kafkago.Writer {
	w.mu.Lock()
	defer w.mu.Unlock()
	if kw, ok := w.writers[topic]; ok {
		return kw
	}
	brokers := strings.Split(w.cfg.Brokers, ",")
	transport := &kafkago.Transport{
		DialTimeout: 5 * time.Second,
	}
	// Authentication and TLS were validated at construction time.
	mechanism, err := scram.Mechanism(scram.SHA512, w.cfg.Username, w.cfg.Password)
	if err != nil {
		panic(fmt.Sprintf("Kafka SCRAM configuration was prevalidated but failed: %v", err))
	}
	transport.SASL = mechanism
	transport.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	kw := &kafkago.Writer{
		Addr:         kafkago.TCP(brokers...),
		Topic:        topic,
		Balancer:     &kafkago.LeastBytes{},
		BatchSize:    w.cfg.BatchSize,
		BatchTimeout: w.cfg.BatchTimeout,
		WriteTimeout: w.cfg.WriteTimeout,
		Compression:  kafkago.Snappy,
		Async:        w.cfg.Async,
		Transport:    transport,
		// Payment topics are provisioned and access-controlled before deployment.
		AllowAutoTopicCreation: false,
		// Log errors via zerolog.
		Logger:      kafkago.LoggerFunc(func(msg string, args ...interface{}) { log.Debug().Msgf("[Kafka] "+msg, args...) }),
		ErrorLogger: kafkago.LoggerFunc(func(msg string, args ...interface{}) { log.Error().Msgf("[Kafka] "+msg, args...) }),
	}
	w.writers[topic] = kw
	return kw
}

// Publish writes a single message to the given topic.
func (w *writer) Publish(ctx context.Context, topic, key string, value []byte) error {
	kw := w.writerFor(topic)
	msg := kafkago.Message{
		Key:   []byte(key),
		Value: value,
		Time:  time.Now().UTC(),
	}
	start := time.Now()
	err := kw.WriteMessages(ctx, msg)
	elapsed := time.Since(start)
	if err != nil {
		log.Error().
			Err(err).
			Str("topic", topic).
			Str("key", key).
			Dur("elapsed_ms", elapsed).
			Msg("[Kafka] publish failed")
		return fmt.Errorf("kafka publish to %s: %w", topic, err)
	}
	log.Debug().
		Str("topic", topic).
		Str("key", key).
		Int("bytes", len(value)).
		Dur("elapsed_ms", elapsed).
		Msg("[Kafka] published")
	return nil
}

// Close flushes and closes all underlying writers.
func (w *writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	var errs []string
	for topic, kw := range w.writers {
		if err := kw.Close(); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", topic, err))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("kafka close errors: %s", strings.Join(errs, "; "))
	}
	return nil
}
