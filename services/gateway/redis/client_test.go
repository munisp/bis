package redis

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNewClientRequiresExplicitAddress(t *testing.T) {
	client, err := NewClient("", "")
	if client != nil {
		t.Fatal("NewClient returned a client without an address")
	}
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
}

func TestUnavailableClientNeverAllowsRateLimit(t *testing.T) {
	var client *Client
	allowed, remaining, reset, err := client.RateLimit(context.Background(), "rate:tenant:1", 10, time.Minute)
	if allowed || remaining != 0 || reset != 0 {
		t.Fatalf("unavailable rate limit = (%v, %d, %v), want (false, 0, 0)", allowed, remaining, reset)
	}
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
}

func TestUnavailableClientRejectsStatefulOperations(t *testing.T) {
	var client *Client
	if _, err := client.Get(context.Background(), "session:token"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Get error = %v, want ErrUnavailable", err)
	}
	if err := client.Set(context.Background(), "session:token", "value", time.Minute); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Set error = %v, want ErrUnavailable", err)
	}
	if err := client.Del(context.Background(), "session:token"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Del error = %v, want ErrUnavailable", err)
	}
	if err := client.LPush("dlq", "payload"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("LPush error = %v, want ErrUnavailable", err)
	}
	if _, err := client.RPop("dlq"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("RPop error = %v, want ErrUnavailable", err)
	}
}
