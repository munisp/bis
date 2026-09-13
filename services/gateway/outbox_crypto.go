package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const (
	outboxCipherAlgorithm   = "AES-256-GCM"
	outboxRotationLeadTime  = 30 * 24 * time.Hour
	outboxKeyringEntryUsage = "version:base64key[:not-after-rfc3339]"
)

type outboxKeyMaterial struct {
	value    []byte
	notAfter *time.Time
}

type outboxKeyring struct {
	activeVersion string
	keys          map[string]outboxKeyMaterial
	now           func() time.Time
}

func loadOutboxKeyringFromEnv() (*outboxKeyring, error) {
	activeVersion := strings.TrimSpace(os.Getenv("BIS_OUTBOX_ACTIVE_KEY_VERSION"))
	encodedKeys := strings.TrimSpace(os.Getenv("BIS_OUTBOX_KEYRING"))
	enforceExpiry := strings.EqualFold(strings.TrimSpace(os.Getenv("BIS_OUTBOX_KEY_POLICY_ENFORCE_EXPIRY")), "true") || strings.EqualFold(strings.TrimSpace(os.Getenv("BIS_ENV")), "production")
	if activeVersion == "" {
		return nil, errors.New("BIS_OUTBOX_ACTIVE_KEY_VERSION is required")
	}
	if encodedKeys == "" {
		return nil, errors.New("BIS_OUTBOX_KEYRING is required")
	}

	now := time.Now().UTC()
	keys := make(map[string]outboxKeyMaterial)
	for _, entry := range strings.Split(encodedKeys, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), ":", 3)
		if len(parts) < 2 || len(parts) > 3 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING entries must be %s", outboxKeyringEntryUsage)
		}
		version := strings.TrimSpace(parts[0])
		if _, exists := keys[version]; exists {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING duplicates key version %q", version)
		}
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(parts[1]))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING key %q must be base64-encoded 32-byte material", version)
		}
		material := outboxKeyMaterial{value: key}
		if len(parts) == 3 {
			expiryText := strings.TrimSpace(parts[2])
			if expiryText == "" {
				return nil, fmt.Errorf("BIS_OUTBOX_KEYRING key %q has an empty not-after time", version)
			}
			expiresAt, err := time.Parse(time.RFC3339, expiryText)
			if err != nil {
				return nil, fmt.Errorf("BIS_OUTBOX_KEYRING key %q has invalid not-after RFC3339 time: %w", version, err)
			}
			expiresAt = expiresAt.UTC()
			material.notAfter = &expiresAt
		} else if enforceExpiry {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING key %q must include not-after time when expiry policy is enforced", version)
		}
		keys[version] = material
	}
	activeMaterial, exists := keys[activeVersion]
	if !exists {
		return nil, fmt.Errorf("BIS_OUTBOX_ACTIVE_KEY_VERSION %q is absent from BIS_OUTBOX_KEYRING", activeVersion)
	}
	if activeMaterial.notAfter != nil && !now.Before(*activeMaterial.notAfter) {
		return nil, fmt.Errorf("active outbox key version %q expired at %s", activeVersion, activeMaterial.notAfter.Format(time.RFC3339))
	}
	return &outboxKeyring{activeVersion: activeVersion, keys: keys, now: func() time.Time { return time.Now().UTC() }}, nil
}

func outboxAAD(topic, idempotencyKey string) []byte {
	return []byte("bis-outbox-v1|" + topic + "|" + idempotencyKey)
}

func (k *outboxKeyring) currentTime() time.Time {
	if k != nil && k.now != nil {
		return k.now().UTC()
	}
	return time.Now().UTC()
}

func (k *outboxKeyring) materialForEncryption() (outboxKeyMaterial, error) {
	if k == nil {
		return outboxKeyMaterial{}, errors.New("outbox keyring is unavailable")
	}
	material, exists := k.keys[k.activeVersion]
	if !exists {
		return outboxKeyMaterial{}, fmt.Errorf("active outbox key version %q is unavailable", k.activeVersion)
	}
	if material.notAfter != nil && !k.currentTime().Before(*material.notAfter) {
		return outboxKeyMaterial{}, fmt.Errorf("active outbox key version %q has expired", k.activeVersion)
	}
	return material, nil
}

func (k *outboxKeyring) materialForDecryption(version string) (outboxKeyMaterial, error) {
	if k == nil {
		return outboxKeyMaterial{}, errors.New("outbox keyring is unavailable")
	}
	material, exists := k.keys[version]
	if !exists {
		return outboxKeyMaterial{}, fmt.Errorf("outbox key version %q is unavailable", version)
	}
	if material.notAfter != nil && !k.currentTime().Before(*material.notAfter) {
		return outboxKeyMaterial{}, fmt.Errorf("outbox key version %q expired at %s; quarantine and restore under an approved historical key", version, material.notAfter.Format(time.RFC3339))
	}
	return material, nil
}

func (k *outboxKeyring) encrypt(topic, idempotencyKey string, plaintext []byte) (ciphertext, nonce []byte, version string, err error) {
	material, err := k.materialForEncryption()
	if err != nil {
		return nil, nil, "", err
	}
	block, err := aes.NewCipher(material.value)
	if err != nil {
		return nil, nil, "", fmt.Errorf("create outbox cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, "", fmt.Errorf("create outbox GCM: %w", err)
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, "", fmt.Errorf("generate outbox nonce: %w", err)
	}
	return gcm.Seal(nil, nonce, plaintext, outboxAAD(topic, idempotencyKey)), nonce, k.activeVersion, nil
}

func (k *outboxKeyring) decrypt(topic, idempotencyKey, version string, ciphertext, nonce []byte) ([]byte, error) {
	material, err := k.materialForDecryption(version)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(material.value)
	if err != nil {
		return nil, fmt.Errorf("create outbox cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create outbox GCM: %w", err)
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, errors.New("outbox nonce has invalid length")
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, outboxAAD(topic, idempotencyKey))
	if err != nil {
		return nil, fmt.Errorf("decrypt outbox payload: %w", err)
	}
	return plaintext, nil
}

func (k *outboxKeyring) needsRotation(version string) bool {
	if k == nil || version != k.activeVersion {
		return k != nil
	}
	material, exists := k.keys[version]
	if !exists || material.notAfter == nil {
		return false
	}
	return !k.currentTime().Add(outboxRotationLeadTime).Before(*material.notAfter)
}
