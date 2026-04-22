package retry_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/bis-platform/case-manager/internal/retry"
)

func TestDo_SuccessOnFirstAttempt(t *testing.T) {
	calls := 0
	err := retry.Do(context.Background(), retry.DefaultConfig(), "test", func() error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected 1 call, got %d", calls)
	}
}

func TestDo_SuccessOnSecondAttempt(t *testing.T) {
	calls := 0
	cfg := retry.Config{MaxAttempts: 3, InitialWait: 1 * time.Millisecond, MaxWait: 10 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error {
		calls++
		if calls < 2 {
			return errors.New("transient error")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
}

func TestDo_AllAttemptsFail(t *testing.T) {
	cfg := retry.Config{MaxAttempts: 3, InitialWait: 1 * time.Millisecond, MaxWait: 5 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error {
		return errors.New("persistent error")
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestDo_NotRetryable(t *testing.T) {
	calls := 0
	cfg := retry.Config{MaxAttempts: 5, InitialWait: 1 * time.Millisecond, MaxWait: 5 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error {
		calls++
		return retry.NotRetryable(errors.New("bad input"))
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if calls != 1 {
		t.Fatalf("expected 1 call (not retryable), got %d", calls)
	}
}

func TestDo_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately
	err := retry.Do(ctx, retry.DefaultConfig(), "test", func() error {
		return errors.New("should not be called after cancel")
	})
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}
