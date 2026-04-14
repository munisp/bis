package config

import (
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	RedisURL    string
	KafkaBroker string
	LogLevel    string
	AMLEngineURL string
	// SWIFT GPI endpoint (stub)
	SwiftGPIURL  string
	SwiftBIC     string
	// SEPA endpoint (stub)
	SEPAEndpoint string
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
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
