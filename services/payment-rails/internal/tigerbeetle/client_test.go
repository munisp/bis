package tigerbeetle

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// ─── Batch accumulator tests ──────────────────────────────────────────────────

func TestPendingBatch_AddAndFlush(t *testing.T) {
	var flushed []Transfer
	var mu sync.Mutex
	flushFn := func(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
		mu.Lock()
		flushed = append(flushed, transfers...)
		mu.Unlock()
		return nil, nil
	}

	batch := NewPendingBatch(3, flushFn)

	// Add 2 transfers — should not flush yet
	_, _ = batch.Add(context.Background(), Transfer{ID: "t1", Amount: 100})
	_, _ = batch.Add(context.Background(), Transfer{ID: "t2", Amount: 200})

	mu.Lock()
	if len(flushed) != 0 {
		t.Errorf("expected 0 flushed, got %d", len(flushed))
	}
	mu.Unlock()

	// Add 3rd transfer — should trigger auto-flush
	_, _ = batch.Add(context.Background(), Transfer{ID: "t3", Amount: 300})

	mu.Lock()
	if len(flushed) != 3 {
		t.Errorf("expected 3 flushed after auto-flush, got %d", len(flushed))
	}
	mu.Unlock()
}

func TestPendingBatch_ManualFlush(t *testing.T) {
	var flushed []Transfer
	var mu sync.Mutex
	flushFn := func(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
		mu.Lock()
		flushed = append(flushed, transfers...)
		mu.Unlock()
		return nil, nil
	}

	batch := NewPendingBatch(10, flushFn)
	_, _ = batch.Add(context.Background(), Transfer{ID: "t1", Amount: 500})
	_, _ = batch.Add(context.Background(), Transfer{ID: "t2", Amount: 1000})

	if batch.Len() != 2 {
		t.Errorf("expected 2 pending, got %d", batch.Len())
	}

	_, err := batch.Flush(context.Background())
	if err != nil {
		t.Fatalf("flush error: %v", err)
	}

	if batch.Len() != 0 {
		t.Errorf("expected 0 pending after flush, got %d", batch.Len())
	}

	mu.Lock()
	if len(flushed) != 2 {
		t.Errorf("expected 2 flushed, got %d", len(flushed))
	}
	mu.Unlock()
}

func TestPendingBatch_EmptyFlush(t *testing.T) {
	flushFn := func(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
		t.Error("flushFn should not be called on empty batch")
		return nil, nil
	}
	batch := NewPendingBatch(10, flushFn)
	results, err := batch.Flush(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if results != nil {
		t.Errorf("expected nil results for empty flush")
	}
}

func TestPendingBatch_MaxSizeClamp(t *testing.T) {
	// MaxSize > MaxBatchSize should be clamped
	batch := NewPendingBatch(99999, func(_ context.Context, _ []Transfer) ([]TransferResult, error) {
		return nil, nil
	})
	if batch.maxSize != MaxBatchSize {
		t.Errorf("expected maxSize=%d, got %d", MaxBatchSize, batch.maxSize)
	}
}

// ─── HTTP client tests ────────────────────────────────────────────────────────

func TestClient_Disabled(t *testing.T) {
	// When TIGERBEETLE_URL is not set, client should be a no-op
	t.Setenv("TIGERBEETLE_URL", "")
	c := New()
	if c.enabled {
		t.Error("expected client to be disabled when TIGERBEETLE_URL is empty")
	}

	// All operations should succeed silently
	if err := c.EnsureAccount(context.Background(), Account{ID: "test"}); err != nil {
		t.Errorf("EnsureAccount on disabled client: %v", err)
	}
	results, err := c.SubmitTransfer(context.Background(), Transfer{ID: "t1"})
	if err != nil || results != nil {
		t.Errorf("SubmitTransfer on disabled client: results=%v err=%v", results, err)
	}
}

func TestClient_CommitBatch_HTTP(t *testing.T) {
	// Mock TigerBeetle HTTP proxy
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transfers/create" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var transfers []Transfer
		if err := json.NewDecoder(r.Body).Decode(&transfers); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if len(transfers) == 0 {
			t.Error("expected at least 1 transfer")
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode([]TransferResult{})
	}))
	defer server.Close()

	t.Setenv("TIGERBEETLE_URL", server.URL)
	c := New()
	if !c.enabled {
		t.Fatal("expected client to be enabled")
	}

	transfers := []Transfer{
		{ID: "t1", DebitAccountID: "acc1", CreditAccountID: "acc2", Amount: 50000, Ledger: LedgerNGN, Code: CodeNIPTransfer},
		{ID: "t2", DebitAccountID: "acc3", CreditAccountID: "acc4", Amount: 100000, Ledger: LedgerNGN, Code: CodeSWIFTMT103},
	}

	results, err := c.SubmitBatch(context.Background(), transfers)
	if err != nil {
		t.Fatalf("SubmitBatch error: %v", err)
	}
	_ = results
}

func TestClient_SubmitBatch_Chunking(t *testing.T) {
	// Verify that batches larger than MaxBatchSize are split correctly
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var transfers []Transfer
		json.NewDecoder(r.Body).Decode(&transfers)
		if len(transfers) > MaxBatchSize {
			t.Errorf("batch size %d exceeds MaxBatchSize %d", len(transfers), MaxBatchSize)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv("TIGERBEETLE_URL", server.URL)
	c := New()

	// Create MaxBatchSize + 1 transfers to force a split
	transfers := make([]Transfer, MaxBatchSize+1)
	for i := range transfers {
		transfers[i] = Transfer{ID: fmt.Sprintf("t%d", i), Amount: uint64(i + 1)}
	}

	_, err := c.SubmitBatch(context.Background(), transfers)
	if err != nil {
		t.Fatalf("SubmitBatch error: %v", err)
	}
	if callCount != 2 {
		t.Errorf("expected 2 HTTP calls for %d transfers, got %d", len(transfers), callCount)
	}
}

// ─── Constants tests ──────────────────────────────────────────────────────────

func TestConstants(t *testing.T) {
	if MaxBatchSize != 8190 {
		t.Errorf("MaxBatchSize should be 8190, got %d", MaxBatchSize)
	}
	if LedgerNGN != 566 {
		t.Errorf("LedgerNGN should be 566 (ISO 4217), got %d", LedgerNGN)
	}
	if LedgerUSD != 840 {
		t.Errorf("LedgerUSD should be 840 (ISO 4217), got %d", LedgerUSD)
	}
}

func TestTransferCodes(t *testing.T) {
	codes := []struct {
		name string
		code uint16
	}{
		{"SWIFT MT103", CodeSWIFTMT103},
		{"SWIFT MT202", CodeSWIFTMT202},
		{"SEPA Credit", CodeSEPACredit},
		{"SEPA Debit", CodeSEPADebit},
		{"SEPA Instant", CodeSEPAInstant},
		{"NIP Transfer", CodeNIPTransfer},
		{"RTGS", CodeRTGS},
		{"Internal", CodeInternal},
	}
	for _, tc := range codes {
		if tc.code == 0 {
			t.Errorf("code for %s should not be 0", tc.name)
		}
	}
}

// ─── Concurrency test ─────────────────────────────────────────────────────────

func TestPendingBatch_ConcurrentAdd(t *testing.T) {
	const goroutines = 20
	const perGoroutine = 10
	var total int
	var mu sync.Mutex

	flushFn := func(ctx context.Context, transfers []Transfer) ([]TransferResult, error) {
		mu.Lock()
		total += len(transfers)
		mu.Unlock()
		return nil, nil
	}

	batch := NewPendingBatch(MaxBatchSize, flushFn)
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				batch.Add(context.Background(), Transfer{
					ID:     fmt.Sprintf("g%d-t%d", g, i),
					Amount: uint64(g*perGoroutine + i + 1),
				})
			}
		}(g)
	}
	wg.Wait()

	// Flush remaining
	batch.Flush(context.Background())

	mu.Lock()
	defer mu.Unlock()
	expected := goroutines * perGoroutine
	if total != expected {
		t.Errorf("expected %d total transfers, got %d", expected, total)
	}
}

// ─── Timing test ──────────────────────────────────────────────────────────────

func TestBatchFillTime(t *testing.T) {
	// At 30,000 TPS, one batch of 8,190 fills in 273 ms (from the 1B payments article).
	// Verify our batch size calculation matches.
	const targetTPS = 30000
	const batchSize = MaxBatchSize
	fillTime := time.Duration(batchSize) * time.Second / time.Duration(targetTPS)
	// Should be approximately 273ms
	if fillTime < 250*time.Millisecond || fillTime > 300*time.Millisecond {
		t.Errorf("expected fill time ~273ms at 30K TPS, got %v", fillTime)
	}
}


