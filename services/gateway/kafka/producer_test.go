package kafka

import (
	"errors"
	"testing"
)

func TestNewProducerRequiresExplicitBroker(t *testing.T) {
	for _, brokers := range []string{"", " \t\n"} {
		producer, err := NewProducer(brokers)
		if producer != nil {
			t.Fatalf("NewProducer(%q) returned a producer", brokers)
		}
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("NewProducer(%q) error = %v, want ErrUnavailable", brokers, err)
		}
	}
}

func TestPublishFailsClosedForUnavailableProducer(t *testing.T) {
	var nilProducer *Producer
	if err := nilProducer.Publish("bis.events", map[string]string{"event": "x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("nil producer error = %v, want ErrUnavailable", err)
	}

	producer := &Producer{}
	if err := producer.Publish("bis.events", map[string]string{"event": "x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("uninitialized producer error = %v, want ErrUnavailable", err)
	}
}

func TestPublishRejectsEmptyTopicBeforeAnyBrokerWrite(t *testing.T) {
	producer, err := NewProducer("127.0.0.1:1")
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	defer producer.Close()
	if err := producer.Publish("  ", map[string]string{"event": "x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("empty topic error = %v, want ErrUnavailable", err)
	}
}

func TestCloseMakesFuturePublicationFail(t *testing.T) {
	producer, err := NewProducer("127.0.0.1:1")
	if err != nil {
		t.Fatalf("NewProducer: %v", err)
	}
	if err := producer.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := producer.Publish("bis.events", map[string]string{"event": "x"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("closed producer error = %v, want ErrUnavailable", err)
	}
}
