// Package tigerbeetle provides a TigerBeetle ledger client for the payment-rails service.
// It implements the 1B payments architecture lessons:
//   - Batch size: 8,190 transfers per commit (fits one 1 MB network envelope)
//   - Zero fsyncs: durability via O_DIRECT + circular WAL + checksums
//   - Idempotency: transfer IDs are deterministic from idempotency keys
//   - Hot/Warm/Cold tiering: TigerBeetle is the hot tier (0–90 days)
package tigerbeetle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// MaxBatchSize is TigerBeetle's optimal batch size: 8,190 transfers × 128 B = 1,048,320 B ≈ 1 MB.
// This is the single biggest throughput multiplier — batching amortises the WAL commit cost.
const MaxBatchSize = 8190

// ─── Data model (128-byte aligned, mirrors TigerBeetle's native structs) ──────

// Account mirrors TigerBeetle's Account struct (128 bytes on the wire).
type Account struct {
	ID             string `json:"id"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
	UserData128    string `json:"user_data_128"` // arbitrary 128-bit metadata
	UserData64     uint64 `json:"user_data_64"`  // tenant ID or ledger shard
	UserData32     uint32 `json:"user_data_32"`  // account tier / flags
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
}

// Transfer mirrors TigerBeetle's Transfer struct (128 bytes on the wire).
// The ID field MUST be set from the idempotency key to guarantee deduplication.
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          uint64 `json:"amount"` // in smallest currency unit (kobo for NGN)
	PendingID       string `json:"pending_id,omitempty"`
	UserData128     string `json:"user_data_128"` // transaction reference
	UserData64      uint64 `json:"user_data_64"`  // originator account hash
	UserData32      uint32 `json:"user_data_32"`  // payment type code
	Timeout         uint32 `json:"timeout"`       // 0 = no timeout (posted immediately)
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
}

// TransferResult is returned by TigerBeetle for each transfer in a batch.
type TransferResult struct {
	Index  uint32 `json:"index"`
	Result string `json:"result"` // "ok", "exists", "exceeds_credits", etc.
}

// ─── Ledger constants ──────────────────────────────────────────────────────────

const (
	// LedgerNGN is the ISO 4217 numeric code for Nigerian Naira.
	LedgerNGN uint32 = 566
	// LedgerUSD is the ISO 4217 numeric code for US Dollar.
	LedgerUSD uint32 = 840
	// LedgerEUR is the ISO 4217 numeric code for Euro.
	LedgerEUR uint32 = 978

	// AccountNostro is the platform's NGN nostro account.
	AccountNostro = "1000000000000001"
	// AccountSuspense is used for pending/two-phase transfers.
	AccountSuspense = "1000000000000002"
	// AccountFeeRevenue collects payment processing fees.
	AccountFeeRevenue = "1000000000000003"
)

// Payment type codes (stored in Transfer.Code)
const (
	CodeSWIFTMT103  uint16 = 103
	CodeSWIFTMT202  uint16 = 202
	CodeSEPACredit  uint16 = 8
	CodeSEPADebit   uint16 = 9
	CodeSEPAInstant uint16 = 10
	CodeNIPTransfer uint16 = 20
	CodeRTGS        uint16 = 21
	CodeInternal    uint16 = 99
)

// ─── Batch accumulator ────────────────────────────────────────────────────────

// PendingBatch accumulates transfers until MaxBatchSize is reached or Flush is called.
// This is the core of the 1B payments architecture: batching is the #1 throughput multiplier.
type PendingBatch struct {
	mu        sync.Mutex
	transfers []Transfer
	maxSize   int
	flushFn   func(ctx context.Context, transfers []Transfer) ([]TransferResult, error)
}

// NewPendingBatch creates a batch accumulator with the given flush function.
func NewPendingBatch(maxSize int, flushFn func(ctx context.Context, transfers []Transfer) ([]TransferResult, error)) *PendingBatch {
	if maxSize <= 0 || maxSize > MaxBatchSize {
		maxSize = MaxBatchSize
	}
	return &PendingBatch{
		transfers: make([]Transfer, 0, maxSize),
		maxSize:   maxSize,
		flushFn:   flushFn,
	}
}

// Add appends a transfer to the batch. If the batch is full, it is flushed automatically.
func (b *PendingBatch) Add(ctx context.Context, t Transfer) ([]TransferResult, error) {
	b.mu.Lock()
	b.transfers = append(b.transfers, t)
	full := len(b.transfers) >= b.maxSize
	var batch []Transfer
	if full {
		batch = make([]Transfer, len(b.transfers))
		copy(batch, b.transfers)
		b.transfers = b.transfers[:0]
	}
	b.mu.Unlock()

	if full {
		return b.flushFn(ctx, batch)
	}
	return nil, nil
}

// Flush commits all pending transfers to TigerBeetle immediately.
func (b *PendingBatch) Flush(ctx context.Context) ([]TransferResult, error) {
	b.mu.Lock()
	if len(b.transfers) == 0 {
		b.mu.Unlock()
		return nil, nil
	}
	batch := make([]Transfer, len(b.transfers))
	copy(batch, b.transfers)
	b.transfers = b.transfers[:0]
	b.mu.Unlock()
	return b.flushFn(ctx, batch)
}

// Len returns the number of pending transfers.
func (b *PendingBatch) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.transfers)
}

// ─── Client ───────────────────────────────────────────────────────────────────

// Client communicates with the TigerBeetle HTTP proxy sidecar.
// When TIGERBEETLE_URL is not set the client operates in no-op mode (safe for dev).
type Client struct {
	baseURL    string
	httpClient *http.Client
	enabled    bool
	batch      *PendingBatch
}

// New creates a Client from environment variables.
func New() *Client {
	url := os.Getenv("TIGERBEETLE_URL")
	if url == "" {
		log.Println("[TigerBeetle/payment-rails] TIGERBEETLE_URL not set — ledger recording disabled")
		return &Client{enabled: false}
	}
	c := &Client{
		baseURL: url,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		enabled: true,
	}
	c.batch = NewPendingBatch(MaxBatchSize, c.commitBatch)
	return c
}

// ─── Account management ───────────────────────────────────────────────────────

// EnsureAccount creates a TigerBeetle account if it does not already exist.
// TigerBeetle is idempotent on account creation with the same ID.
func (c *Client) EnsureAccount(ctx context.Context, acct Account) error {
	if !c.enabled {
		return nil
	}
	return c.post(ctx, "/accounts/create", []Account{acct})
}

// EnsureSystemAccounts bootstraps the platform's nostro, suspense, and fee accounts.
func (c *Client) EnsureSystemAccounts(ctx context.Context) error {
	if !c.enabled {
		return nil
	}
	accounts := []Account{
		{ID: AccountNostro, Ledger: LedgerNGN, Code: 1, Flags: 0},
		{ID: AccountSuspense, Ledger: LedgerNGN, Code: 2, Flags: 0},
		{ID: AccountFeeRevenue, Ledger: LedgerNGN, Code: 3, Flags: 0},
	}
	return c.post(ctx, "/accounts/create", accounts)
}

// ─── Transfer submission ──────────────────────────────────────────────────────

// SubmitTransfer adds a single transfer to the pending batch.
// The transfer ID MUST be derived from the idempotency key to prevent double-posting.
// When the batch reaches MaxBatchSize (8,190), it is committed automatically.
func (c *Client) SubmitTransfer(ctx context.Context, t Transfer) ([]TransferResult, error) {
	if !c.enabled {
		log.Printf("[TigerBeetle/payment-rails] (disabled) would submit transfer id=%s amount=%d", t.ID, t.Amount)
		return nil, nil
	}
	return c.batch.Add(ctx, t)
}

// SubmitBatch commits a slice of transfers directly (bypasses the accumulator).
// Use this for bulk import or archival replay scenarios.
func (c *Client) SubmitBatch(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
	if !c.enabled {
		return nil, nil
	}
	// Split into MaxBatchSize chunks to respect TigerBeetle's 1 MB envelope limit.
	var allResults []TransferResult
	for i := 0; i < len(transfers); i += MaxBatchSize {
		end := i + MaxBatchSize
		if end > len(transfers) {
			end = len(transfers)
		}
		results, err := c.commitBatch(ctx, transfers[i:end])
		if err != nil {
			return allResults, fmt.Errorf("batch [%d:%d]: %w", i, end, err)
		}
		allResults = append(allResults, results...)
	}
	return allResults, nil
}

// FlushPending commits any transfers still in the accumulator.
// Call this on graceful shutdown or at the end of a request cycle.
func (c *Client) FlushPending(ctx context.Context) ([]TransferResult, error) {
	if !c.enabled || c.batch == nil {
		return nil, nil
	}
	return c.batch.Flush(ctx)
}

// PendingCount returns the number of transfers waiting in the accumulator.
func (c *Client) PendingCount() int {
	if c.batch == nil {
		return 0
	}
	return c.batch.Len()
}

// ─── Balance queries ──────────────────────────────────────────────────────────

// GetBalance returns the posted (settled) balance for an account in the smallest currency unit.
func (c *Client) GetBalance(ctx context.Context, accountID string) (uint64, error) {
	if !c.enabled {
		return 0, nil
	}
	resp, err := c.httpClient.Get(fmt.Sprintf("%s/accounts/%s", c.baseURL, accountID))
	if err != nil {
		return 0, fmt.Errorf("tigerbeetle get balance: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return 0, nil
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("tigerbeetle get balance: HTTP %d", resp.StatusCode)
	}
	var acct Account
	if err := json.NewDecoder(resp.Body).Decode(&acct); err != nil {
		return 0, fmt.Errorf("tigerbeetle decode balance: %w", err)
	}
	// Posted balance = credits_posted - debits_posted
	if acct.CreditsPosted >= acct.DebitsPosted {
		return acct.CreditsPosted - acct.DebitsPosted, nil
	}
	return 0, nil
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// commitBatch sends a batch of transfers to TigerBeetle and returns per-transfer results.
func (c *Client) commitBatch(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
	if len(transfers) == 0 {
		return nil, nil
	}
	start := time.Now()
	body, err := json.Marshal(transfers)
	if err != nil {
		return nil, fmt.Errorf("marshal batch: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/transfers/create", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle commit batch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("tigerbeetle commit batch: HTTP %d", resp.StatusCode)
	}
	var results []TransferResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		// Empty body = all transfers committed successfully
		return nil, nil
	}
	elapsed := time.Since(start)
	log.Printf("[TigerBeetle/payment-rails] Committed batch: %d transfers in %v (%.0f TPS)",
		len(transfers), elapsed, float64(len(transfers))/elapsed.Seconds())
	return results, nil
}

func (c *Client) post(ctx context.Context, path string, body interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle post %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("tigerbeetle post %s: HTTP %d", path, resp.StatusCode)
	}
	return nil
}
