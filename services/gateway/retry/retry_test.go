package retry_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"bis/gateway/retry"
)

func TestDo_Success(t *testing.T) {
	err := retry.Do(context.Background(), retry.DefaultConfig(), "test", func() error { return nil })
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestDo_RetryThenSuccess(t *testing.T) {
	calls := 0
	cfg := retry.Config{MaxAttempts: 3, InitialWait: 1 * time.Millisecond, MaxWait: 5 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error {
		calls++
		if calls < 2 {
			return errors.New("transient")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
}

func TestDo_AllFail(t *testing.T) {
	cfg := retry.Config{MaxAttempts: 2, InitialWait: 1 * time.Millisecond, MaxWait: 5 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error { return errors.New("fail") })
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDo_NotRetryable(t *testing.T) {
	calls := 0
	cfg := retry.Config{MaxAttempts: 5, InitialWait: 1 * time.Millisecond, MaxWait: 5 * time.Millisecond, Multiplier: 2.0, Jitter: false}
	err := retry.Do(context.Background(), cfg, "test", func() error {
		calls++
		return retry.NotRetryable(errors.New("bad request"))
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if calls != 1 {
		t.Fatalf("expected 1 call, got %d", calls)
	}
}
