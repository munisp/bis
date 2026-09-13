package main

import (
	"testing"
	"time"
)

func TestArchiveKeyPolicyRejectsExpiredActiveKey(t *testing.T) {
	t.Setenv("BIS_ARCHIVE_KMS_POLICY_ENFORCE_EXPIRY", "true")
	t.Setenv("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON", `{"alias/bis-archive":"2020-01-01T00:00:00Z"}`)
	if _, err := loadArchiveKeyPolicy("alias/bis-archive"); err == nil {
		t.Fatal("expected expired active KMS key to reject archive-worker startup")
	}
}

func TestArchiveKeyPolicyRequiresRegistryInEnforcedMode(t *testing.T) {
	t.Setenv("BIS_ARCHIVE_KMS_POLICY_ENFORCE_EXPIRY", "true")
	t.Setenv("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON", `{}`)
	if _, err := loadArchiveKeyPolicy("alias/bis-archive"); err == nil {
		t.Fatal("expected enforced archive key policy to require active-key registry entry")
	}
}

func TestExpiredKeyRecoveryQuarantinesInterruptedUpload(t *testing.T) {
	expiresAt := time.Now().UTC().Add(-time.Minute)
	policy := &archiveKeyPolicy{activeKeyID: "alias/current", expiries: map[string]time.Time{"alias/retired": expiresAt}, enforce: true, now: func() time.Time { return time.Now().UTC() }}
	keyID := "alias/retired"
	quarantine, reason := recoveryKeyDisposition(policy, "uploading", &keyID)
	if !quarantine || reason == "" {
		t.Fatal("expected interrupted upload encrypted with expired KMS key to be quarantined")
	}
	quarantine, _ = recoveryKeyDisposition(policy, "planned", nil)
	if quarantine {
		t.Fatal("expected planned batch without immutable object to remain releasable")
	}
}

func TestArchiveKeyPolicySignalsRotationLeadTime(t *testing.T) {
	expiresAt := time.Now().UTC().Add(48 * time.Hour)
	policy := &archiveKeyPolicy{activeKeyID: "alias/current", expiries: map[string]time.Time{"alias/current": expiresAt}, enforce: true, now: func() time.Time { return time.Now().UTC() }}
	if !policy.rotationDue() {
		t.Fatal("expected active archive KMS key inside rotation lead time to require rotation")
	}
}

func TestArchiveKeyPolicyProductionAutomaticallyRequiresExpiryMetadata(t *testing.T) {
	t.Setenv("BIS_ENV", "production")
	t.Setenv("BIS_ARCHIVE_KMS_POLICY_ENFORCE_EXPIRY", "")
	t.Setenv("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON", `{}`)
	if _, err := loadArchiveKeyPolicy("alias/bis-archive"); err == nil {
		t.Fatal("expected production archive worker to reject an active KMS key without expiry metadata")
	}
}
