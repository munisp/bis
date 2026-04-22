package idempotency

import (
	"strings"
	"testing"
)

func TestTransferID_Deterministic(t *testing.T) {
	key := "swift-mt103-1714000000000-BISNG001"
	id1 := TransferID(key)
	id2 := TransferID(key)
	if id1 != id2 {
		t.Errorf("TransferID should be deterministic: got %s and %s", id1, id2)
	}
}

func TestTransferID_Length(t *testing.T) {
	id := TransferID("test-key")
	if len(id) != 32 {
		t.Errorf("expected 32-char hex ID, got %d chars: %s", len(id), id)
	}
}

func TestTransferID_Unique(t *testing.T) {
	id1 := TransferID("key-1")
	id2 := TransferID("key-2")
	if id1 == id2 {
		t.Error("different keys should produce different IDs")
	}
}

func TestAccountID_Deterministic(t *testing.T) {
	ref := "0123456789-NGN"
	id1 := AccountID(ref)
	id2 := AccountID(ref)
	if id1 != id2 {
		t.Errorf("AccountID should be deterministic: got %s and %s", id1, id2)
	}
}

func TestGenerateKey_Format(t *testing.T) {
	key := GenerateKey("swift-mt103", "BISNG001")
	if !strings.HasPrefix(key, "swift-mt103-") {
		t.Errorf("expected key to start with 'swift-mt103-', got %s", key)
	}
	if !strings.HasSuffix(key, "-BISNG001") {
		t.Errorf("expected key to end with '-BISNG001', got %s", key)
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		key     string
		wantErr bool
	}{
		{"", true},
		{"short", true},
		{"valid-key-12345", false},
		{strings.Repeat("x", 257), true},
		{strings.Repeat("x", 256), false},
		{"swift-mt103-1714000000000-BISNG001", false},
	}
	for _, tc := range tests {
		err := Validate(tc.key)
		if (err != nil) != tc.wantErr {
			t.Errorf("Validate(%q): wantErr=%v, got err=%v", tc.key, tc.wantErr, err)
		}
	}
}
