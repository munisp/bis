// Package tigerbeetleaudit provides cross-reference validation between the
// BIS PostgreSQL audit log and TigerBeetle's immutable double-entry ledger.
//
// TigerBeetle stores every financial transfer as an immutable account entry.
// This service reconciles those entries against the BIS audit_events table to
// detect:
//   - Missing entries (in BIS but not in TigerBeetle)
//   - Phantom entries (in TigerBeetle but not in BIS)
//   - Amount mismatches
//   - Timestamp drift > configurable threshold
package tigerbeetleaudit

import (
"context"
"encoding/json"
"fmt"
"log/slog"
"net/http"
"os"
"strconv"
"time"
)

// ─── Config ───────────────────────────────────────────────────────────────────

// Config holds runtime configuration for the reconciliation service.
type Config struct {
// TigerBeetleURL is the HTTP API endpoint of the TigerBeetle proxy.
// TigerBeetle itself uses a custom binary protocol; this assumes a thin
// HTTP proxy (e.g. tb-node or a custom Go proxy) sits in front.
TigerBeetleURL string

// GatewayURL is the BIS gateway base URL for fetching audit events.
GatewayURL string

// GatewayKey is the X-Gateway-Key header value.
GatewayKey string

// MaxTimestampDriftMs is the maximum allowed drift between BIS and
// TigerBeetle timestamps in milliseconds (default: 5000).
MaxTimestampDriftMs int64

// BatchSize is the number of transfers to fetch per reconciliation page.
BatchSize int
}

// DefaultConfig returns a Config populated from environment variables.
func DefaultConfig() Config {
drift, _ := strconv.ParseInt(os.Getenv("TB_MAX_DRIFT_MS"), 10, 64)
if drift == 0 {
drift = 5000
}
batch, _ := strconv.Atoi(os.Getenv("TB_BATCH_SIZE"))
if batch == 0 {
batch = 500
}
return Config{
TigerBeetleURL:      getEnv("TIGERBEETLE_URL", "http://localhost:3000"),
GatewayURL:          getEnv("GATEWAY_URL", "http://localhost:8080"),
GatewayKey:          getEnv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod"),
MaxTimestampDriftMs: drift,
BatchSize:           batch,
}
}

func getEnv(key, fallback string) string {
if v := os.Getenv(key); v != "" {
return v
}
return fallback
}

// ─── Domain types ─────────────────────────────────────────────────────────────

// TBTransfer represents a TigerBeetle transfer record returned by the proxy.
type TBTransfer struct {
ID              string `json:"id"`
DebitAccountID  string `json:"debit_account_id"`
CreditAccountID string `json:"credit_account_id"`
Amount          int64  `json:"amount"`
UserData        string `json:"user_data"` // BIS tx_ref stored here
Timestamp       int64  `json:"timestamp"` // nanoseconds since epoch
Ledger          uint32 `json:"ledger"`
Code            uint16 `json:"code"`
}

// BISAuditEvent represents a row from the BIS audit_events table.
type BISAuditEvent struct {
ID          string    `json:"id"`
TxRef       string    `json:"txRef"`
AmountKobo  int64     `json:"amountKobo"`
AccountID   string    `json:"accountId"`
EventType   string    `json:"eventType"`
CreatedAt   time.Time `json:"createdAt"`
TenantID    string    `json:"tenantId"`
}

// DiscrepancyKind describes the type of reconciliation discrepancy.
type DiscrepancyKind string

const (
DiscrepancyMissing         DiscrepancyKind = "MISSING_IN_TIGERBEETLE"
DiscrepancyPhantom         DiscrepancyKind = "PHANTOM_IN_TIGERBEETLE"
DiscrepancyAmountMismatch  DiscrepancyKind = "AMOUNT_MISMATCH"
DiscrepancyTimestampDrift  DiscrepancyKind = "TIMESTAMP_DRIFT"
)

// Discrepancy represents a single reconciliation finding.
type Discrepancy struct {
Kind        DiscrepancyKind `json:"kind"`
TxRef       string          `json:"txRef"`
BISAmount   *int64          `json:"bisAmount,omitempty"`
TBAmount    *int64          `json:"tbAmount,omitempty"`
BISTime     *time.Time      `json:"bisTime,omitempty"`
TBTimeMs    *int64          `json:"tbTimeMs,omitempty"`
DriftMs     *int64          `json:"driftMs,omitempty"`
DetectedAt  time.Time       `json:"detectedAt"`
}

// ReconciliationReport summarises a single reconciliation run.
type ReconciliationReport struct {
RunAt          time.Time     `json:"runAt"`
BISEventCount  int           `json:"bisEventCount"`
TBTransferCount int          `json:"tbTransferCount"`
Discrepancies  []Discrepancy `json:"discrepancies"`
DurationMs     int64         `json:"durationMs"`
}

// ─── HTTP client helpers ──────────────────────────────────────────────────────

// HTTPClient is an interface so we can inject a mock in tests.
type HTTPClient interface {
Do(req *http.Request) (*http.Response, error)
}

// Reconciler performs the cross-reference between BIS and TigerBeetle.
type Reconciler struct {
cfg    Config
client HTTPClient
logger *slog.Logger
}

// NewReconciler creates a new Reconciler with the given config and HTTP client.
func NewReconciler(cfg Config, client HTTPClient) *Reconciler {
return &Reconciler{
cfg:    cfg,
client: client,
logger: slog.New(slog.NewJSONHandler(os.Stdout, nil)),
}
}

// fetchBISEvents retrieves audit events from the BIS gateway for the given
// time window.
func (r *Reconciler) fetchBISEvents(ctx context.Context, from, to time.Time) ([]BISAuditEvent, error) {
url := fmt.Sprintf(
"%s/v1/audit/events?from=%s&to=%s&limit=%d",
r.cfg.GatewayURL,
from.UTC().Format(time.RFC3339),
to.UTC().Format(time.RFC3339),
r.cfg.BatchSize,
)

req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
return nil, fmt.Errorf("build BIS request: %w", err)
}
req.Header.Set("X-Gateway-Key", r.cfg.GatewayKey)

resp, err := r.client.Do(req)
if err != nil {
return nil, fmt.Errorf("fetch BIS events: %w", err)
}
defer resp.Body.Close()

if resp.StatusCode != http.StatusOK {
return nil, fmt.Errorf("BIS returned %d", resp.StatusCode)
}

var events []BISAuditEvent
if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
return nil, fmt.Errorf("decode BIS events: %w", err)
}
return events, nil
}

// fetchTBTransfers retrieves transfers from TigerBeetle for the given ledger
// within the time window.
func (r *Reconciler) fetchTBTransfers(ctx context.Context, from, to time.Time) ([]TBTransfer, error) {
url := fmt.Sprintf(
"%s/transfers?from_ts=%d&to_ts=%d&limit=%d",
r.cfg.TigerBeetleURL,
from.UnixNano(),
to.UnixNano(),
r.cfg.BatchSize,
)

req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
return nil, fmt.Errorf("build TB request: %w", err)
}

resp, err := r.client.Do(req)
if err != nil {
return nil, fmt.Errorf("fetch TB transfers: %w", err)
}
defer resp.Body.Close()

if resp.StatusCode != http.StatusOK {
return nil, fmt.Errorf("TigerBeetle returned %d", resp.StatusCode)
}

var transfers []TBTransfer
if err := json.NewDecoder(resp.Body).Decode(&transfers); err != nil {
return nil, fmt.Errorf("decode TB transfers: %w", err)
}
return transfers, nil
}

// Reconcile performs a full cross-reference for the given time window and
// returns a ReconciliationReport.
func (r *Reconciler) Reconcile(ctx context.Context, from, to time.Time) (*ReconciliationReport, error) {
start := time.Now()

bisEvents, err := r.fetchBISEvents(ctx, from, to)
if err != nil {
return nil, fmt.Errorf("fetch BIS events: %w", err)
}

tbTransfers, err := r.fetchTBTransfers(ctx, from, to)
if err != nil {
return nil, fmt.Errorf("fetch TB transfers: %w", err)
}

discrepancies := r.crossReference(bisEvents, tbTransfers)

report := &ReconciliationReport{
RunAt:           start,
BISEventCount:   len(bisEvents),
TBTransferCount: len(tbTransfers),
Discrepancies:   discrepancies,
DurationMs:      time.Since(start).Milliseconds(),
}

r.logger.Info("reconciliation complete",
"bis_events", len(bisEvents),
"tb_transfers", len(tbTransfers),
"discrepancies", len(discrepancies),
"duration_ms", report.DurationMs,
)

return report, nil
}

// crossReference compares BIS events against TigerBeetle transfers and
// returns all discrepancies found.
func (r *Reconciler) crossReference(bisEvents []BISAuditEvent, tbTransfers []TBTransfer) []Discrepancy {
now := time.Now()
var discrepancies []Discrepancy

// Build lookup maps
bisMap := make(map[string]BISAuditEvent, len(bisEvents))
for _, e := range bisEvents {
bisMap[e.TxRef] = e
}

tbMap := make(map[string]TBTransfer, len(tbTransfers))
for _, t := range tbTransfers {
tbMap[t.UserData] = t
}

// Check BIS events against TigerBeetle
for txRef, bisEvent := range bisMap {
tbTransfer, found := tbMap[txRef]
if !found {
discrepancies = append(discrepancies, Discrepancy{
Kind:       DiscrepancyMissing,
TxRef:      txRef,
BISAmount:  &bisEvent.AmountKobo,
DetectedAt: now,
})
continue
}

// Check amount match
if bisEvent.AmountKobo != tbTransfer.Amount {
bisAmt := bisEvent.AmountKobo
tbAmt := tbTransfer.Amount
discrepancies = append(discrepancies, Discrepancy{
Kind:       DiscrepancyAmountMismatch,
TxRef:      txRef,
BISAmount:  &bisAmt,
TBAmount:   &tbAmt,
DetectedAt: now,
})
}

// Check timestamp drift
tbTimeMs := tbTransfer.Timestamp / 1_000_000 // nanoseconds -> milliseconds
bisTimeMs := bisEvent.CreatedAt.UnixMilli()
driftMs := tbTimeMs - bisTimeMs
if driftMs < 0 {
driftMs = -driftMs
}
if driftMs > r.cfg.MaxTimestampDriftMs {
bisTime := bisEvent.CreatedAt
discrepancies = append(discrepancies, Discrepancy{
Kind:       DiscrepancyTimestampDrift,
TxRef:      txRef,
BISTime:    &bisTime,
TBTimeMs:   &tbTimeMs,
DriftMs:    &driftMs,
DetectedAt: now,
})
}
}

// Check TigerBeetle transfers not in BIS (phantom entries)
for txRef := range tbMap {
if _, found := bisMap[txRef]; !found {
tbAmt := tbMap[txRef].Amount
discrepancies = append(discrepancies, Discrepancy{
Kind:       DiscrepancyPhantom,
TxRef:      txRef,
TBAmount:   &tbAmt,
DetectedAt: now,
})
}
}

return discrepancies
}
