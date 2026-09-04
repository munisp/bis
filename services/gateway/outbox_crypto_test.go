package main

import (
	"encoding/base64"
	"testing"
)

func testKey(byteValue byte) string {
	return base64.StdEncoding.EncodeToString(make([]byte, 32))[:0] + base64.StdEncoding.EncodeToString(bytesOf(byteValue, 32))
}

func bytesOf(value byte, count int) []byte {
	result := make([]byte, count)
	for i := range result {
		result[i] = value
	}
	return result
}

func TestOutboxKeyringEncryptDecryptAndRotation(t *testing.T) {
	previous := t.Setenv
	_ = previous
	t.Setenv("BIS_OUTBOX_ACTIVE_KEY_VERSION", "v2")
	t.Setenv("BIS_OUTBOX_KEYRING", "v1:"+testKey(1)+",v2:"+testKey(2))
	keyring, err := loadOutboxKeyringFromEnv()
	if err != nil {
		t.Fatalf("load keyring: %v", err)
	}
	plaintext := []byte(`{"recordRef":"NG-DEMO-0001","purpose":"fraud_prevention"}`)
	ciphertext, nonce, version, err := keyring.encrypt("bis.lookup", "bis.lookup:NG-DEMO-0001", plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if version != "v2" || string(ciphertext) == string(plaintext) || len(nonce) != 12 {
		t.Fatal("expected AES-GCM ciphertext using the active version and 96-bit nonce")
	}
	decrypted, err := keyring.decrypt("bis.lookup", "bis.lookup:NG-DEMO-0001", version, ciphertext, nonce)
	if err != nil || string(decrypted) != string(plaintext) {
		t.Fatalf("round-trip decrypt failed: %v", err)
	}
	if _, err := keyring.decrypt("bis.lookup", "bis.lookup:tampered", version, ciphertext, nonce); err == nil {
		t.Fatal("expected authenticated metadata tampering to be rejected")
	}
	if !keyring.needsRotation("v1") || keyring.needsRotation("v2") {
		t.Fatal("expected only non-active key versions to require rotation")
	}
}

func TestOutboxKeyringRejectsMalformedKeyMaterial(t *testing.T) {
	t.Setenv("BIS_OUTBOX_ACTIVE_KEY_VERSION", "v1")
	t.Setenv("BIS_OUTBOX_KEYRING", "v1:not-base64")
	if _, err := loadOutboxKeyringFromEnv(); err == nil {
		t.Fatal("expected malformed key material to be rejected")
	}
}
