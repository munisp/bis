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
)

const outboxCipherAlgorithm = "AES-256-GCM"

type outboxKeyring struct {
	activeVersion string
	keys          map[string][]byte
}

func loadOutboxKeyringFromEnv() (*outboxKeyring, error) {
	activeVersion := strings.TrimSpace(os.Getenv("BIS_OUTBOX_ACTIVE_KEY_VERSION"))
	encodedKeys := strings.TrimSpace(os.Getenv("BIS_OUTBOX_KEYRING"))
	if activeVersion == "" {
		return nil, errors.New("BIS_OUTBOX_ACTIVE_KEY_VERSION is required")
	}
	if encodedKeys == "" {
		return nil, errors.New("BIS_OUTBOX_KEYRING is required")
	}

	keys := make(map[string][]byte)
	for _, entry := range strings.Split(encodedKeys, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), ":", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, errors.New("BIS_OUTBOX_KEYRING entries must be version:base64key")
		}
		if _, exists := keys[parts[0]]; exists {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING duplicates key version %q", parts[0])
		}
		key, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("BIS_OUTBOX_KEYRING key %q must be base64-encoded 32-byte material", parts[0])
		}
		keys[parts[0]] = key
	}
	if _, exists := keys[activeVersion]; !exists {
		return nil, fmt.Errorf("BIS_OUTBOX_ACTIVE_KEY_VERSION %q is absent from BIS_OUTBOX_KEYRING", activeVersion)
	}
	return &outboxKeyring{activeVersion: activeVersion, keys: keys}, nil
}

func outboxAAD(topic, idempotencyKey string) []byte {
	return []byte("bis-outbox-v1|" + topic + "|" + idempotencyKey)
}

func (k *outboxKeyring) encrypt(topic, idempotencyKey string, plaintext []byte) (ciphertext, nonce []byte, version string, err error) {
	if k == nil {
		return nil, nil, "", errors.New("outbox keyring is unavailable")
	}
	key := k.keys[k.activeVersion]
	block, err := aes.NewCipher(key)
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
	if k == nil {
		return nil, errors.New("outbox keyring is unavailable")
	}
	key, exists := k.keys[version]
	if !exists {
		return nil, fmt.Errorf("outbox key version %q is unavailable", version)
	}
	block, err := aes.NewCipher(key)
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
	return k != nil && version != k.activeVersion
}
