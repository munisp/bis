package kafka

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/segmentio/kafka-go"
)

// BISEvent is the canonical event envelope published to Kafka.
type BISEvent struct {
	EventType   string      `json:"event_type"`
	SubjectRef  string      `json:"subject_ref"`
	Severity    string      `json:"severity"`
	Payload     interface{} `json:"payload"`
	Source      string      `json:"source"`
	PublishedAt time.Time   `json:"published_at"`
}

var writer *kafka.Writer

// Init creates the Kafka writer. Call once at startup.
func Init() {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}
	writer = &kafka.Writer{
		Addr:         kafka.TCP(brokers),
		Topic:        "bis.events",
		Balancer:     &kafka.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
		Async:        true, // fire-and-forget for low-latency path
	}
	log.Printf("[Kafka] Producer initialized → %s/bis.events", brokers)
}

// Publish serialises and sends an event to the bis.events topic.
func Publish(ctx context.Context, event BISEvent) error {
	if writer == nil {
		log.Println("[Kafka] Writer not initialised — skipping publish")
		return nil
	}
	event.PublishedAt = time.Now().UTC()
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(event.SubjectRef),
		Value: body,
	})
}

// Close flushes and closes the writer gracefully.
func Close() {
	if writer != nil {
		if err := writer.Close(); err != nil {
			log.Printf("[Kafka] Error closing writer: %v", err)
		}
	}
}

// ─── Struct wrapper for dependency injection ──────────────────────────────────

// Producer is a thin wrapper around the package-level Kafka functions.
type Producer struct{}

// NewProducer initialises the Kafka writer and returns a Producer.
func NewProducer(brokers string) (*Producer, error) {
	if brokers != "" {
		os.Setenv("KAFKA_BROKERS", brokers)
	}
	Init()
	return &Producer{}, nil
}

// Publish sends an event to the bis.events topic.
func (p *Producer) Publish(topic string, data interface{}) error {
	event := BISEvent{
		EventType:  topic,
		SubjectRef: "gateway",
		Severity:   "info",
		Payload:    data,
		Source:     "bis-gateway",
	}
	return Publish(context.Background(), event)
}
