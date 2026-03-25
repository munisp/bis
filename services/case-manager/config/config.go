// config/config.go — Configuration loader for BIS Case Manager
package config

import (
	"os"
	"strings"
)

// Config holds all runtime configuration for the case-manager service.
type Config struct {
	Env            string
	Port           string
	DatabaseURL    string
	JWTSecret      string
	KafkaBrokers   []string
	S3Bucket       string
	S3Region       string
	AppBaseURL     string
	AllowedOrigins []string
	PermifyURL     string
	PermifyToken   string
}

// Load reads configuration from environment variables.
// All values have sensible defaults for local development.
func Load() *Config {
	return &Config{
		Env:            getEnv("NODE_ENV", "development"),
		Port:           getEnv("CASE_MANAGER_PORT", "8081"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/bis_db?sslmode=disable"),
		JWTSecret:      getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		KafkaBrokers:   strings.Split(getEnv("KAFKA_BROKERS", "localhost:9092"), ","),
		S3Bucket:       getEnv("S3_BUCKET", "bis-platform"),
		S3Region:       getEnv("S3_REGION", "us-east-1"),
		AppBaseURL:     getEnv("APP_BASE_URL", "http://localhost:3000"),
		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"), ","),
		PermifyURL:     getEnv("PERMIFY_URL", "http://localhost:3476"),
		PermifyToken:   getEnv("PERMIFY_TOKEN", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
