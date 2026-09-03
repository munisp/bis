package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds all runtime configuration for the payment-rails service.
type Config struct {
	Port          string
	DatabaseURL   string
	RedisURL      string
	KafkaBroker   string
	LogLevel      string
	AMLEngineURL  string
	ServiceAPIKey string

	// SWIFT GPI endpoint.
	SwiftGPIURL string
	SwiftBIC    string

	// SEPA clearing-house endpoint.
	SEPAEndpoint string

	// TigerBeetle ledger (hot tier — 0–90 days, O_DIRECT + circular WAL, zero fsyncs)
	// Set TIGERBEETLE_URL to enable ledger recording. When unset, the service operates
	// without ledger recording (safe for development).
	TigerBeetleURL string

	// Batch processing (1B payments architecture lesson)
	// MaxBatchSize: 8,190 transfers × 128 B = 1 MB per commit (TigerBeetle optimal)
	// BatchFlushIntervalMs: maximum time to wait before flushing a partial batch
	MaxBatchSize         int
	BatchFlushIntervalMs int

	// Idempotency key TTL in Redis (seconds). Prevents double-posting on retries.
	IdempotencyTTLSec int

	// Backpressure: maximum number of in-flight transfers before rejecting new requests
	MaxInflightTransfers int
}

func Load() *Config {
	return &Config{
		Port:          getEnv("PORT", "8087"),
		DatabaseURL:   getEnv("DATABASE_URL", ""),
		RedisURL:      getEnv("REDIS_URL", ""),
		KafkaBroker:   getEnv("KAFKA_BROKERS", ""),
		LogLevel:      getEnv("LOG_LEVEL", "info"),
		AMLEngineURL:  getEnv("AML_ENGINE_URL", ""),
		ServiceAPIKey: getEnv("BIS_PAYMENT_RAILS_KEY", ""),
		SwiftGPIURL:   getEnv("SWIFT_GPI_URL", ""),
		SwiftBIC:      getEnv("SWIFT_BIC", ""),
		SEPAEndpoint:  getEnv("SEPA_ENDPOINT", ""),

		// TigerBeetle hot tier
		TigerBeetleURL: getEnv("TIGERBEETLE_URL", ""),

		// Batch processing (1B payments lessons)
		MaxBatchSize:         getEnvInt("TB_MAX_BATCH_SIZE", 8190),
		BatchFlushIntervalMs: getEnvInt("TB_BATCH_FLUSH_MS", 100),

		// Idempotency
		IdempotencyTTLSec: getEnvInt("IDEMPOTENCY_TTL_SEC", 86400), // 24 hours

		// Backpressure
		MaxInflightTransfers: getEnvInt("MAX_INFLIGHT_TRANSFERS", 10000),
	}
}

// ValidateProduction verifies that the service cannot start with insecure defaults
// or absent dependencies in a production deployment.
func (c *Config) ValidateProduction() error {
	if !strings.EqualFold(os.Getenv("BIS_ENV"), "production") {
		return nil
	}
	missing := make([]string, 0)
	for key, value := range map[string]string{
		"BIS_PAYMENT_RAILS_KEY": c.ServiceAPIKey,
		"DATABASE_URL":          c.DatabaseURL,
		"KAFKA_BROKERS":         c.KafkaBroker,
		"TIGERBEETLE_URL":       c.TigerBeetleURL,
		"AML_ENGINE_URL":        c.AMLEngineURL,
		"SWIFT_GPI_URL":         c.SwiftGPIURL,
		"SWIFT_BIC":             c.SwiftBIC,
		"SEPA_ENDPOINT":         c.SEPAEndpoint,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing mandatory production configuration: %s", strings.Join(missing, ", "))
	}
	return nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 {
		return def
	}
	return n
}
