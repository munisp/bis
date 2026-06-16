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
	"time"

	"github.com/rs/zerolog/log"
	kafkago "github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/scram"
)

// Publisher is the interface satisfied by both the real writer and the stub.
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
	writers map[string]*kafkago.Writer
	cfg     WriterConfig
}

// New creates a new Kafka publisher.  If cfg.Brokers is empty the function
// returns a no-op stub so the service starts cleanly in dev/test environments.
func New(cfg WriterConfig) Publisher {
	if cfg.Brokers == "" {
		log.Warn().Msg("[Kafka] KAFKA_BROKERS not set — using no-op stub publisher")
		return &stubPublisher{}
	}
	log.Info().
		Str("brokers", cfg.Brokers).
		Bool("sasl", cfg.Username != "").
		Msg("[Kafka] initialising real publisher")
	return &writer{
		writers: make(map[string]*kafkago.Writer),
		cfg:     cfg,
	}
}

// writerFor returns (creating if necessary) a *kafkago.Writer for the given topic.
func (w *writer) writerFor(topic string) *kafkago.Writer {
	if kw, ok := w.writers[topic]; ok {
		return kw
	}
	brokers := strings.Split(w.cfg.Brokers, ",")
	transport := &kafkago.Transport{
		DialTimeout: 5 * time.Second,
	}
	// Enable TLS + SASL when credentials are provided.
	if w.cfg.Username != "" {
		mechanism, err := scram.Mechanism(scram.SHA512, w.cfg.Username, w.cfg.Password)
		if err != nil {
			log.Error().Err(err).Msg("[Kafka] failed to create SCRAM mechanism")
		} else {
			transport.SASL = mechanism
			transport.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
		}
	}
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
		// Allow the writer to create the topic automatically if it doesn't exist.
		AllowAutoTopicCreation: true,
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

// ── No-op stub ────────────────────────────────────────────────────────────────

// stubPublisher is a no-op publisher used when KAFKA_BROKERS is not configured.
type stubPublisher struct{}

func (s *stubPublisher) Publish(_ context.Context, topic, key string, value []byte) error {
	log.Debug().
		Str("topic", topic).
		Str("key", key).
		Int("bytes", len(value)).
		Msg("[Kafka/stub] publish (no-op)")
	return nil
}

func (s *stubPublisher) Close() error { return nil }
