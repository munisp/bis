// Package retry provides exponential backoff retry logic for external calls.
package retry

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"math/rand"
	"time"
)

// Config holds retry configuration.
type Config struct {
	MaxAttempts int
	InitialWait time.Duration
	MaxWait     time.Duration
	Multiplier  float64
	Jitter      bool
}

// DefaultConfig returns a sensible default retry config.
func DefaultConfig() Config {
	return Config{
		MaxAttempts: 4,
		InitialWait: 100 * time.Millisecond,
		MaxWait:     8 * time.Second,
		Multiplier:  2.0,
		Jitter:      true,
	}
}

// Do executes fn with exponential backoff retry.
// Returns the last error if all attempts fail.
func Do(ctx context.Context, cfg Config, name string, fn func() error) error {
	var lastErr error
	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return fmt.Errorf("%s: context cancelled after %d attempts: %w", name, attempt-1, ctx.Err())
		}
		lastErr = fn()
		if lastErr == nil {
			return nil
		}
		// Don't retry on non-retryable errors
		if errors.Is(lastErr, ErrNotRetryable) {
			return lastErr
		}
		if attempt == cfg.MaxAttempts {
			break
		}
		wait := time.Duration(float64(cfg.InitialWait) * math.Pow(cfg.Multiplier, float64(attempt-1)))
		if wait > cfg.MaxWait {
			wait = cfg.MaxWait
		}
		if cfg.Jitter {
			// Add ±25% jitter
			jitter := time.Duration(rand.Float64()*0.5*float64(wait) - 0.25*float64(wait))
			wait += jitter
			if wait < 0 {
				wait = cfg.InitialWait
			}
		}
		log.Printf("[retry] %s attempt %d/%d failed: %v — retrying in %s", name, attempt, cfg.MaxAttempts, lastErr, wait)
		select {
		case <-ctx.Done():
			return fmt.Errorf("%s: context cancelled during backoff: %w", name, ctx.Err())
		case <-time.After(wait):
		}
	}
	return fmt.Errorf("%s: all %d attempts failed, last error: %w", name, cfg.MaxAttempts, lastErr)
}

// ErrNotRetryable marks an error as non-retryable.
var ErrNotRetryable = errors.New("not retryable")

// NotRetryable wraps an error to mark it as non-retryable.
func NotRetryable(err error) error {
	return fmt.Errorf("%w: %v", ErrNotRetryable, err)
}
