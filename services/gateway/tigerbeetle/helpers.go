// helpers.go — package-level convenience wrappers for the BIS gateway.
// These functions allow criminal_records.go and other new handlers to call
// TigerBeetle without needing a direct reference to the tbClient variable
// (which lives in main.go's package scope).
package tigerbeetle

import (
	"context"
	"fmt"
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
		return fmt.Errorf("TigerBeetle ledger is unavailable for %s", checkType)
	}
	// Ensure the tenant account exists before recording a debit.
	if err := defaultClient.CreateAccount(ctx, tenantID); err != nil {
		return fmt.Errorf("create tenant ledger account: %w", err)
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
		return fmt.Errorf("TigerBeetle ledger is unavailable for audit entry")
	}

	debit := InvestigationDebit{
		TenantID:        actorID,
		InvestigationID: ref + ":" + action,
		Tier:            TierBasic,
		Amount:          1, // sentinel — not a real charge
		Timestamp:       time.Now(),
	}
	return defaultClient.RecordInvestigationDebit(ctx, debit)
}
