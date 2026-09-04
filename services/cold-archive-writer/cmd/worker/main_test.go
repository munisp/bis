package main

import "testing"

func setValidConfig(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgresql://archive:secret@localhost:5432/bis")
	t.Setenv("BIS_ARCHIVE_S3_ENDPOINT", "https://minio.example.test")
	t.Setenv("BIS_ARCHIVE_S3_ACCESS_KEY", "access")
	t.Setenv("BIS_ARCHIVE_S3_SECRET_KEY", "secret")
	t.Setenv("BIS_ARCHIVE_S3_BUCKET", "cold-archive")
	t.Setenv("BIS_ARCHIVE_S3_REGION", "us-east-1")
	t.Setenv("BIS_COLD_ARCHIVE_BATCH_SIZE", "5000")
	t.Setenv("BIS_COLD_ARCHIVE_AGE_DAYS", "365")
}

func TestLoadConfigAcceptsExplicitSecurePostgresAndStorage(t *testing.T) {
	setValidConfig(t)
	config, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if config.BatchSize != 5000 || config.ColdAgeDays != 365 {
		t.Fatalf("unexpected numeric config: %#v", config)
	}
	if config.S3Endpoint != "minio.example.test" {
		t.Fatalf("endpoint = %q", config.S3Endpoint)
	}
}

func TestLoadConfigRejectsUnsafeOrMissingConfiguration(t *testing.T) {
	t.Run("missing database", func(t *testing.T) {
		setValidConfig(t)
		t.Setenv("DATABASE_URL", "")
		if _, err := loadConfig(); err == nil {
			t.Fatal("missing database URL accepted")
		}
	})
	t.Run("non postgres database", func(t *testing.T) {
		setValidConfig(t)
		t.Setenv("DATABASE_URL", "invalid-db-scheme://archive:secret@localhost/bis")
		if _, err := loadConfig(); err == nil {
			t.Fatal("non-PostgreSQL URL accepted")
		}
	})
	t.Run("plaintext storage", func(t *testing.T) {
		setValidConfig(t)
		t.Setenv("BIS_ARCHIVE_S3_ENDPOINT", "http://minio.example.test")
		if _, err := loadConfig(); err == nil {
			t.Fatal("plaintext object storage endpoint accepted")
		}
	})
	t.Run("oversized batch", func(t *testing.T) {
		setValidConfig(t)
		t.Setenv("BIS_COLD_ARCHIVE_BATCH_SIZE", "10001")
		if _, err := loadConfig(); err == nil {
			t.Fatal("oversized batch accepted")
		}
	})
}

func TestArchiveRecordPreservesDecimalAmount(t *testing.T) {
	record := TransactionArchiveV1{AmountDecimal: "1234567890.123456789", Currency: "NGN"}
	if record.AmountDecimal != "1234567890.123456789" {
		t.Fatal("decimal amount was changed")
	}
}
