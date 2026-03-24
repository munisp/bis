// Package tigerbeetle provides a TigerBeetle ledger client for the BIS gateway.
// Every investigation credit deduction is recorded as a double-entry transaction
// for an immutable financial audit trail.
//
// TigerBeetle uses a binary protocol; this package wraps the HTTP proxy sidecar
// (tigerbeetle-http) which exposes a JSON REST API over the native binary protocol.
// See: https://github.com/tigerbeetle/tigerbeetle
package tigerbeetle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"
)

// ─── Account IDs (well-known ledger accounts) ─────────────────────────────────
// TigerBeetle uses uint128 IDs; we represent them as strings here.
const (
	// AccountRevenue is the credit side — TourismPay revenue account.
	AccountRevenue = "1"
	// AccountTenantPrefix is prepended to tenant IDs for debit accounts.
	AccountTenantPrefix = "10000"
)

// ─── Ledger codes ─────────────────────────────────────────────────────────────
const (
	LedgerNGN uint32 = 566 // ISO 4217 numeric code for NGN
)

// ─── User-data codes (investigation tiers) ───────────────────────────────────
const (
	TierBasic    uint64 = 1
	TierStandard uint64 = 2
	TierPremium  uint64 = 3
)

// ─── Credit amounts per tier (in kobo, 1 NGN = 100 kobo) ─────────────────────
var TierAmounts = map[uint64]uint64{
	TierBasic:    50000,  // ₦500
	TierStandard: 150000, // ₦1,500
	TierPremium:  500000, // ₦5,000
}

// Client wraps the TigerBeetle HTTP proxy.
type Client struct {
	baseURL    string
	httpClient *http.Client
	enabled    bool
}

// Account mirrors TigerBeetle's Account struct.
type Account struct {
	ID             string `json:"id"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
	UserData128    string `json:"user_data_128"`
	UserData64     uint64 `json:"user_data_64"`
	UserData32     uint32 `json:"user_data_32"`
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
}

// Transfer mirrors TigerBeetle's Transfer struct.
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          uint64 `json:"amount"`
	UserData128     string `json:"user_data_128"`
	UserData64      uint64 `json:"user_data_64"`
	UserData32      uint32 `json:"user_data_32"`
	Timeout         uint32 `json:"timeout"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
}

// InvestigationDebit records a credit deduction for an investigation.
type InvestigationDebit struct {
	TransferID      string
	TenantID        string
	InvestigationID string
	Tier            uint64
	Amount          uint64
	Timestamp       time.Time
}

// New creates a TigerBeetle client from environment variables.
// When TIGERBEETLE_URL is not set the client is disabled (no-op).
func New() *Client {
	url := os.Getenv("TIGERBEETLE_URL")
	if url == "" {
		log.Println("[TigerBeetle] TIGERBEETLE_URL not set — ledger recording disabled")
		return &Client{enabled: false}
	}
	return &Client{
		baseURL: url,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		enabled: true,
	}
}

// CreateAccount ensures a tenant debit account exists in the ledger.
// TigerBeetle is idempotent on account creation with the same ID.
func (c *Client) CreateAccount(ctx context.Context, tenantID string) error {
	if !c.enabled {
		return nil
	}

	accounts := []Account{
		{
			ID:          AccountTenantPrefix + tenantID,
			Ledger:      LedgerNGN,
			Code:        1, // asset account
			Flags:       0,
			UserData128: tenantID,
		},
	}

	return c.post(ctx, "/accounts/create", accounts)
}

// EnsureRevenueAccount creates the platform revenue account if it doesn't exist.
func (c *Client) EnsureRevenueAccount(ctx context.Context) error {
	if !c.enabled {
		return nil
	}

	accounts := []Account{
		{
			ID:      AccountRevenue,
			Ledger:  LedgerNGN,
			Code:    2, // revenue account
			Flags:   0,
		},
	}

	return c.post(ctx, "/accounts/create", accounts)
}

// RecordInvestigationDebit posts a double-entry transfer:
//   Debit:  tenant account (reduces tenant balance)
//   Credit: revenue account (increases platform revenue)
func (c *Client) RecordInvestigationDebit(ctx context.Context, d InvestigationDebit) error {
	if !c.enabled {
		log.Printf("[TigerBeetle] (disabled) would record debit: tenant=%s inv=%s tier=%d amount=%d",
			d.TenantID, d.InvestigationID, d.Tier, d.Amount)
		return nil
	}

	amount := d.Amount
	if amount == 0 {
		amount = TierAmounts[d.Tier]
		if amount == 0 {
			amount = TierAmounts[TierBasic]
		}
	}

	transferID := d.TransferID
	if transferID == "" {
		transferID = newID()
	}

	transfers := []Transfer{
		{
			ID:              transferID,
			DebitAccountID:  AccountTenantPrefix + d.TenantID,
			CreditAccountID: AccountRevenue,
			Amount:          amount,
			UserData128:     d.InvestigationID,
			UserData64:      d.Tier,
			UserData32:      uint32(d.Timestamp.Unix()),
			Ledger:          LedgerNGN,
			Code:            1, // investigation debit
			Flags:           0,
		},
	}

	if err := c.post(ctx, "/transfers/create", transfers); err != nil {
		return fmt.Errorf("tigerbeetle record debit: %w", err)
	}

	log.Printf("[TigerBeetle] Recorded debit: transfer=%s tenant=%s inv=%s amount=%d kobo",
		transferID, d.TenantID, d.InvestigationID, amount)
	return nil
}

// GetAccountBalance returns the current posted balance for a tenant account.
func (c *Client) GetAccountBalance(ctx context.Context, tenantID string) (uint64, error) {
	if !c.enabled {
		return 0, nil
	}

	accountID := AccountTenantPrefix + tenantID
	url := fmt.Sprintf("%s/accounts/%s", c.baseURL, accountID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("tigerbeetle get account: %w", err)
	}
	defer resp.Body.Close()

	var account Account
	if err := json.NewDecoder(resp.Body).Decode(&account); err != nil {
		return 0, fmt.Errorf("tigerbeetle decode account: %w", err)
	}

	// Balance = credits_posted - debits_posted
	if account.CreditsPosted >= account.DebitsPosted {
		return account.CreditsPosted - account.DebitsPosted, nil
	}
	return 0, nil
}

// post sends a JSON POST request to the TigerBeetle HTTP proxy.
func (c *Client) post(ctx context.Context, path string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("tigerbeetle marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle post %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("tigerbeetle post %s: status %d", path, resp.StatusCode)
	}
	return nil
}

// newID generates a random 16-character hex string for TigerBeetle transfer IDs.
func newID() string {
	b := make([]byte, 8)
	rand.Read(b) //nolint:gosec
	return fmt.Sprintf("%x", b)
}
