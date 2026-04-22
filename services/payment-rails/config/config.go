package config

import (
	"fmt"
	"os"
)

// Config holds all runtime configuration for the payment-rails service.
type Config struct {
	Port         string
	DatabaseURL  string
	RedisURL     string
	KafkaBroker  string
	LogLevel     string
	AMLEngineURL string

	// SWIFT GPI endpoint (stub — replace with real SWIFT API in production)
	SwiftGPIURL string
	SwiftBIC    string

	// SEPA endpoint (stub — replace with real SEPA clearing house in production)
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
		Port:         getEnv("PORT", "8087"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db"),
		RedisURL:     getEnv("REDIS_URL", "redis://localhost:6379"),
		KafkaBroker:  getEnv("KAFKA_BROKER", "localhost:9092"),
		LogLevel:     getEnv("LOG_LEVEL", "info"),
		AMLEngineURL: getEnv("AML_ENGINE_URL", "http://localhost:8085"),
		SwiftGPIURL:  getEnv("SWIFT_GPI_URL", "https://api.swift.com/v1/gpi"),
		SwiftBIC:     getEnv("SWIFT_BIC", "BISNGLA1XXX"),
		SEPAEndpoint: getEnv("SEPA_ENDPOINT", "https://sepa.bis-platform.local/v1"),

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
