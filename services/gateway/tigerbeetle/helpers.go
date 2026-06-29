// helpers.go — package-level convenience wrappers for the BIS gateway.
// These functions allow criminal_records.go and other new handlers to call
// TigerBeetle without needing a direct reference to the tbClient variable
// (which lives in main.go's package scope).
package tigerbeetle

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"
)

// defaultClient is the singleton client used by package-level helpers.
// It is initialised lazily on first use via New().
var defaultClient *Client

func init() {
	defaultClient = New()
}

// DebitCheckFee records a billable check fee debit in the TigerBeetle ledger.
//
//   - tenantID:   the requesting user/tenant identifier
//   - ref:        the check reference (e.g. "CRR-001234")
//   - checkType:  human-readable check type (e.g. "criminal_record_request")
//   - amountKobo: fee in kobo (100 kobo = ₦1)
func DebitCheckFee(ctx context.Context, tenantID, ref, checkType string, amountKobo uint64) error {
	if defaultClient == nil || !defaultClient.enabled {
		log.Printf("[TigerBeetle] disabled — skipping DebitCheckFee for %s %s", checkType, ref)
		return nil
	}
	// Ensure the tenant account exists (idempotent)
	if err := defaultClient.CreateAccount(ctx, tenantID); err != nil {
		log.Printf("[TigerBeetle] CreateAccount warning for %s: %v", tenantID, err)
	}
	debit := InvestigationDebit{
		TenantID:        tenantID,
		InvestigationID: ref,
		Tier:            TierBasic,
		Amount:          amountKobo,
		Timestamp:       time.Now(),
	}
	return defaultClient.RecordInvestigationDebit(ctx, debit)
}

// CreateAuditEntry records a zero-value immutable audit entry in TigerBeetle.
// Used for non-financial events that still require an immutable ledger record
// (e.g. analyst verifications, thin-file flags, status changes).
//
// TigerBeetle does not natively support zero-amount transfers; we use amount=1
// as a sentinel value and tag the transfer with the action in user_data.
func CreateAuditEntry(ctx context.Context, actorID, ref, action string, _ uint64) error {
	if defaultClient == nil || !defaultClient.enabled {
		log.Printf("[TigerBeetle] disabled — skipping CreateAuditEntry for %s %s", action, ref)
		return nil
	}
	// Encode action into a deterministic transfer ID
	rng := rand.New(rand.NewSource(int64(hashString(actorID + ref + action))))
	transferID := fmt.Sprintf("%d", rng.Uint64())

	debit := InvestigationDebit{
		TenantID:        actorID,
		InvestigationID: ref + ":" + action,
		Tier:            TierBasic,
		Amount:          1, // sentinel — not a real charge
		Timestamp:       time.Now(),
	}
	_ = transferID
	return defaultClient.RecordInvestigationDebit(ctx, debit)
}

// hashString returns a simple hash of a string for seeding RNGs.
func hashString(s string) uint32 {
	h := uint32(2166136261)
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}
