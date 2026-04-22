// Package idempotency provides helpers for generating deterministic transfer IDs
// from idempotency keys. This prevents double-posting in payment systems.
//
// Lesson from 1B payments article: idempotency keys are critical for payment deduplication.
// The transfer ID in TigerBeetle MUST be derived from the idempotency key so that
// retried requests produce the same transfer ID and TigerBeetle deduplicates them.
package idempotency

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// TransferID derives a deterministic 128-bit transfer ID from an idempotency key.
// The ID is formatted as a 32-character hex string (UUID-like, no dashes).
// TigerBeetle uses this ID for deduplication: if the same ID is submitted twice,
// the second submission returns "exists" without creating a duplicate transfer.
func TransferID(idempotencyKey string) string {
	h := sha256.Sum256([]byte("bis-transfer:" + idempotencyKey))
	return hex.EncodeToString(h[:16]) // first 128 bits = 32 hex chars
}

// AccountID derives a deterministic account ID from a logical account identifier.
// Used to map BIS account numbers to TigerBeetle account IDs.
func AccountID(accountRef string) string {
	h := sha256.Sum256([]byte("bis-account:" + accountRef))
	return hex.EncodeToString(h[:16])
}

// GenerateKey generates a new idempotency key for a payment request.
// Format: {type}-{timestamp_ms}-{ref}
// Example: "swift-mt103-1714000000000-BISNG001"
func GenerateKey(paymentType, ref string) string {
	ts := time.Now().UnixMilli()
	return fmt.Sprintf("%s-%d-%s", strings.ToLower(paymentType), ts, ref)
}

// Validate checks that an idempotency key meets minimum requirements.
func Validate(key string) error {
	if key == "" {
		return fmt.Errorf("idempotency key must not be empty")
	}
	if len(key) < 8 {
		return fmt.Errorf("idempotency key too short (minimum 8 characters)")
	}
	if len(key) > 256 {
		return fmt.Errorf("idempotency key too long (maximum 256 characters)")
	}
	return nil
}
