// Package retry provides exponential backoff retry logic for external verification API calls.
package retry

import (
	"context"
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
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

// DefaultConfig returns a sensible default retry config for external API calls.
func DefaultConfig() Config {
	return Config{
		MaxAttempts: 3,
		InitialWait: 200 * time.Millisecond,
		MaxWait:     5 * time.Second,
		Multiplier:  2.0,
		Jitter:      true,
	}
}

// ErrNotRetryable marks an error as non-retryable (e.g. 400 Bad Request, 404 Not Found).
var ErrNotRetryable = errors.New("not retryable")

// NotRetryable wraps an error to mark it as non-retryable.
func NotRetryable(err error) error {
	return fmt.Errorf("%w: %v", ErrNotRetryable, err)
}

func secureJitter(wait time.Duration) (time.Duration, error) {
	span := big.NewInt(int64(wait) / 2)
	if span.Sign() <= 0 {
		return 0, nil
	}
	sample, err := cryptorand.Int(cryptorand.Reader, span)
	if err != nil {
		return 0, err
	}
	return time.Duration(sample.Int64() - int64(wait)/4), nil
}

// Do executes fn with exponential backoff retry.
func Do(ctx context.Context, cfg Config, name string, fn func() error) error {
	var lastErr error
	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return fmt.Errorf("%s: context cancelled: %w", name, ctx.Err())
		}
		lastErr = fn()
		if lastErr == nil {
			return nil
		}
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
			if jitter, err := secureJitter(wait); err == nil {
				wait += jitter
			}
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
	return fmt.Errorf("%s: all %d attempts failed: %w", name, cfg.MaxAttempts, lastErr)
}
