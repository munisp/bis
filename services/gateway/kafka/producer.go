package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	kafkago "github.com/segmentio/kafka-go"
)

// ErrUnavailable indicates that an event cannot be durably acknowledged by Kafka.
var ErrUnavailable = errors.New("kafka producer unavailable")

// BISEvent is the canonical event envelope published to Kafka.
type BISEvent struct {
	EventType   string      `json:"event_type"`
	SubjectRef  string      `json:"subject_ref"`
	Severity    string      `json:"severity"`
	Payload     interface{} `json:"payload"`
	Source      string      `json:"source"`
	PublishedAt time.Time   `json:"published_at"`
}

// Producer owns a synchronous Kafka writer. It does not use package-level state,
// which makes unavailable dependencies observable and tests isolation-safe.
type Producer struct {
	mu     sync.RWMutex
	writer *kafkago.Writer
}

// NewProducer requires explicit broker addresses. It deliberately does not fall
// back to localhost:9092 because a silent local destination is not a production
// delivery guarantee.
func NewProducer(brokers string) (*Producer, error) {
	parts := strings.FieldsFunc(brokers, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n'
	})
	if len(parts) == 0 {
		return nil, fmt.Errorf("%w: KAFKA_BROKERS is required", ErrUnavailable)
	}
	for _, broker := range parts {
		if strings.TrimSpace(broker) == "" {
			return nil, fmt.Errorf("%w: broker address is empty", ErrUnavailable)
		}
	}
	return &Producer{writer: &kafkago.Writer{
		Addr:         kafkago.TCP(parts...),
		Balancer:     &kafkago.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		RequiredAcks: kafkago.RequireAll,
		Async:        false,
		WriteTimeout: 10 * time.Second,
		ReadTimeout:  10 * time.Second,
	}}, nil
}

// Publish returns only after the Kafka leader acknowledges the event according
// to RequireAll. Nil/closed producers are failures, never successful no-ops.
func (p *Producer) Publish(topic string, data interface{}) error {
	if p == nil {
		return ErrUnavailable
	}
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return fmt.Errorf("%w: topic is required", ErrUnavailable)
	}
	body, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal Kafka event: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.writer == nil {
		return ErrUnavailable
	}
	if err := p.writer.WriteMessages(ctx, kafkago.Message{
		Topic: topic,
		Key:   []byte("gateway"),
		Value: body,
		Time:  time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("%w: publish %s: %v", ErrUnavailable, topic, err)
	}
	return nil
}

// Close flushes and closes the writer. A close error is returned to its caller.
func (p *Producer) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.writer == nil {
		return nil
	}
	err := p.writer.Close()
	p.writer = nil
	return err
}
