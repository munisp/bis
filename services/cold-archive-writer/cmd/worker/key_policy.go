package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

type archiveKeyPolicy struct {
	activeKeyID string
	expiries    map[string]time.Time
	enforce     bool
	now         func() time.Time
}

// BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON associates every active or retained KMS
// key identifier with an RFC3339 retirement boundary. Key material remains in
// the KMS; this policy prevents new use after its boundary and causes ambiguous
// recovery batches encrypted under retired material to be quarantined.
func loadArchiveKeyPolicy(activeKeyID string) (*archiveKeyPolicy, error) {
	policy := &archiveKeyPolicy{
		activeKeyID: strings.TrimSpace(activeKeyID),
		expiries:    map[string]time.Time{},
		enforce:     strings.EqualFold(strings.TrimSpace(os.Getenv("BIS_ARCHIVE_KMS_POLICY_ENFORCE_EXPIRY")), "true") || strings.EqualFold(strings.TrimSpace(os.Getenv("BIS_ENV")), "production"),
		now:         func() time.Time { return time.Now().UTC() },
	}
	if policy.activeKeyID == "" {
		return nil, fmt.Errorf("BIS_ARCHIVE_S3_KMS_KEY_ID is required")
	}

	registry := strings.TrimSpace(os.Getenv("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON"))
	if registry != "" {
		var values map[string]string
		if err := json.Unmarshal([]byte(registry), &values); err != nil {
			return nil, fmt.Errorf("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON must be a JSON object of key IDs to RFC3339 expiry values: %w", err)
		}
		for keyID, expiryText := range values {
			keyID = strings.TrimSpace(keyID)
			if keyID == "" {
				return nil, fmt.Errorf("archive KMS expiry registry contains an empty key ID")
			}
			expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(expiryText))
			if err != nil {
				return nil, fmt.Errorf("archive KMS key %q has invalid RFC3339 expiry: %w", keyID, err)
			}
			policy.expiries[keyID] = expiresAt.UTC()
		}
	}

	if policy.enforce {
		if _, exists := policy.expiries[policy.activeKeyID]; !exists {
			return nil, fmt.Errorf("BIS_ARCHIVE_S3_KMS_KEY_EXPIRIES_JSON must include active KMS key %q when expiry policy is enforced", policy.activeKeyID)
		}
	}
	if expired, reason := policy.isExpired(policy.activeKeyID); expired {
		return nil, fmt.Errorf("active archive KMS key is unusable: %s", reason)
	}
	return policy, nil
}

func (p *archiveKeyPolicy) currentTime() time.Time {
	if p != nil && p.now != nil {
		return p.now().UTC()
	}
	return time.Now().UTC()
}

func (p *archiveKeyPolicy) isExpired(keyID string) (bool, string) {
	if p == nil {
		return true, "archive key policy is unavailable"
	}
	keyID = strings.TrimSpace(keyID)
	if keyID == "" {
		return true, "archive object has no recorded KMS key ID"
	}
	expiresAt, known := p.expiries[keyID]
	if !known {
		if p.enforce {
			return true, fmt.Sprintf("KMS key %q is absent from the enforced expiry registry", keyID)
		}
		return false, ""
	}
	if !p.currentTime().Before(expiresAt) {
		return true, fmt.Sprintf("KMS key %q expired at %s", keyID, expiresAt.Format(time.RFC3339))
	}
	return false, ""
}

func (p *archiveKeyPolicy) rotationDue() bool {
	if p == nil {
		return true
	}
	expiresAt, exists := p.expiries[p.activeKeyID]
	if !exists {
		return p.enforce
	}
	return !p.currentTime().Add(30 * 24 * time.Hour).Before(expiresAt)
}

// recoveryKeyDisposition prevents recovery from silently committing or releasing
// data when object encryption cannot be verified under a currently approved KMS
// key. Planned rows have no object and can be released; uploaded or verified rows
// are quarantined for a restoration drill using approved historical access.
func recoveryKeyDisposition(policy *archiveKeyPolicy, status string, keyID *string) (quarantine bool, reason string) {
	if status == "planned" {
		return false, ""
	}
	if keyID == nil {
		return true, "archive batch has no persisted KMS key identity"
	}
	if expired, reason := policy.isExpired(*keyID); expired {
		return true, reason
	}
	return false, ""
}
