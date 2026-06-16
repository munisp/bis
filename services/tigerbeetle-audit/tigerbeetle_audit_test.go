package tigerbeetleaudit

import (
"bytes"
"context"
"encoding/json"
"io"
"net/http"
"testing"
"time"
)

// ─── Mock HTTP client ─────────────────────────────────────────────────────────

type mockHTTPClient struct {
bisEvents   []BISAuditEvent
tbTransfers []TBTransfer
bisErr      bool
tbErr       bool
}

func (m *mockHTTPClient) Do(req *http.Request) (*http.Response, error) {
var body []byte
var err error

if req.URL.Path == "/v1/audit/events" || (req.URL.Host == "localhost:8080" && req.URL.Path == "/v1/audit/events") {
if m.bisErr {
return &http.Response{StatusCode: 500, Body: io.NopCloser(bytes.NewReader([]byte("error")))}, nil
}
body, err = json.Marshal(m.bisEvents)
} else {
if m.tbErr {
return &http.Response{StatusCode: 500, Body: io.NopCloser(bytes.NewReader([]byte("error")))}, nil
}
body, err = json.Marshal(m.tbTransfers)
}

if err != nil {
return nil, err
}
return &http.Response{
StatusCode: 200,
Body:       io.NopCloser(bytes.NewReader(body)),
}, nil
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

func testConfig() Config {
return Config{
TigerBeetleURL:      "http://localhost:3000",
GatewayURL:          "http://localhost:8080",
GatewayKey:          "test-key",
MaxTimestampDriftMs: 5000,
BatchSize:           100,
}
}

func baseTime() time.Time {
return time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
}

func makeAuditEvent(txRef string, amount int64, t time.Time) BISAuditEvent {
return BISAuditEvent{
ID:         "evt-" + txRef,
TxRef:      txRef,
AmountKobo: amount,
AccountID:  "ACC-001",
EventType:  "transfer.completed",
CreatedAt:  t,
TenantID:   "tenant-001",
}
}

func makeTBTransfer(txRef string, amount int64, t time.Time) TBTransfer {
return TBTransfer{
ID:              "tb-" + txRef,
DebitAccountID:  "ACC-001",
CreditAccountID: "ACC-002",
Amount:          amount,
UserData:        txRef,
Timestamp:       t.UnixNano(),
Ledger:          1,
Code:            1,
}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestNoDiscrepancies(t *testing.T) {
t0 := baseTime()
bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
makeAuditEvent("TXN-002", 200_000, t0.Add(time.Second)),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 100_000, t0),
makeTBTransfer("TXN-002", 200_000, t0.Add(time.Second)),
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}
if len(report.Discrepancies) != 0 {
t.Errorf("expected 0 discrepancies, got %d: %+v", len(report.Discrepancies), report.Discrepancies)
}
if report.BISEventCount != 2 {
t.Errorf("expected BISEventCount=2, got %d", report.BISEventCount)
}
if report.TBTransferCount != 2 {
t.Errorf("expected TBTransferCount=2, got %d", report.TBTransferCount)
}
}

func TestMissingInTigerBeetle(t *testing.T) {
t0 := baseTime()
bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
makeAuditEvent("TXN-MISSING", 50_000, t0),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 100_000, t0),
// TXN-MISSING is absent from TigerBeetle
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}

missing := filterByKind(report.Discrepancies, DiscrepancyMissing)
if len(missing) != 1 {
t.Errorf("expected 1 MISSING discrepancy, got %d", len(missing))
}
if missing[0].TxRef != "TXN-MISSING" {
t.Errorf("expected TxRef=TXN-MISSING, got %s", missing[0].TxRef)
}
}

func TestPhantomInTigerBeetle(t *testing.T) {
t0 := baseTime()
bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 100_000, t0),
makeTBTransfer("TXN-PHANTOM", 999_000, t0), // Not in BIS
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}

phantom := filterByKind(report.Discrepancies, DiscrepancyPhantom)
if len(phantom) != 1 {
t.Errorf("expected 1 PHANTOM discrepancy, got %d", len(phantom))
}
if phantom[0].TxRef != "TXN-PHANTOM" {
t.Errorf("expected TxRef=TXN-PHANTOM, got %s", phantom[0].TxRef)
}
}

func TestAmountMismatch(t *testing.T) {
t0 := baseTime()
bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 99_999, t0), // Amount differs by 1 kobo
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}

mismatch := filterByKind(report.Discrepancies, DiscrepancyAmountMismatch)
if len(mismatch) != 1 {
t.Errorf("expected 1 AMOUNT_MISMATCH discrepancy, got %d", len(mismatch))
}
if *mismatch[0].BISAmount != 100_000 {
t.Errorf("expected BISAmount=100000, got %d", *mismatch[0].BISAmount)
}
if *mismatch[0].TBAmount != 99_999 {
t.Errorf("expected TBAmount=99999, got %d", *mismatch[0].TBAmount)
}
}

func TestTimestampDrift(t *testing.T) {
t0 := baseTime()
tbTime := t0.Add(10 * time.Second) // 10s drift > 5s threshold

bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 100_000, tbTime),
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}

drift := filterByKind(report.Discrepancies, DiscrepancyTimestampDrift)
if len(drift) != 1 {
t.Errorf("expected 1 TIMESTAMP_DRIFT discrepancy, got %d", len(drift))
}
if *drift[0].DriftMs < 9000 {
t.Errorf("expected drift >= 9000ms, got %d", *drift[0].DriftMs)
}
}

func TestTimestampWithinThreshold(t *testing.T) {
t0 := baseTime()
tbTime := t0.Add(2 * time.Second) // 2s drift < 5s threshold

bisEvents := []BISAuditEvent{
makeAuditEvent("TXN-001", 100_000, t0),
}
tbTransfers := []TBTransfer{
makeTBTransfer("TXN-001", 100_000, tbTime),
}

client := &mockHTTPClient{bisEvents: bisEvents, tbTransfers: tbTransfers}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}

drift := filterByKind(report.Discrepancies, DiscrepancyTimestampDrift)
if len(drift) != 0 {
t.Errorf("expected 0 TIMESTAMP_DRIFT discrepancies, got %d", len(drift))
}
}

func TestEmptyInputs(t *testing.T) {
t0 := baseTime()
client := &mockHTTPClient{bisEvents: nil, tbTransfers: nil}
r := NewReconciler(testConfig(), client)

report, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err != nil {
t.Fatalf("unexpected error: %v", err)
}
if len(report.Discrepancies) != 0 {
t.Errorf("expected 0 discrepancies for empty inputs, got %d", len(report.Discrepancies))
}
}

func TestBISFetchError(t *testing.T) {
t0 := baseTime()
client := &mockHTTPClient{bisErr: true}
r := NewReconciler(testConfig(), client)

_, err := r.Reconcile(context.Background(), t0.Add(-time.Hour), t0.Add(time.Hour))
if err == nil {
t.Error("expected error when BIS fetch fails, got nil")
}
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func filterByKind(discrepancies []Discrepancy, kind DiscrepancyKind) []Discrepancy {
var result []Discrepancy
for _, d := range discrepancies {
if d.Kind == kind {
result = append(result, d)
}
}
return result
}
