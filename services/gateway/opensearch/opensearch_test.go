package opensearch

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ─── EnsureIndices (dev mode) ─────────────────────────────────────────────────

func TestEnsureIndices_DevMode(t *testing.T) {
	// With no OPENSEARCH_URL set, EnsureIndices should return nil (no-op)
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	if err := EnsureIndices(); err != nil {
		t.Errorf("EnsureIndices() in dev mode should not error, got: %v", err)
	}
}

// ─── IndexDocument (dev mode) ─────────────────────────────────────────────────

func TestIndexInvestigation_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	doc := InvestigationDoc{
		Ref:         "INV-2026-001",
		SubjectName: "John Doe",
		SubjectType: "individual",
		Status:      "pending",
		RiskScore:   72.5,
		Tier:        "standard",
		Priority:    "high",
		Country:     "NG",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		TenantID:    "tenant-001",
	}

	if err := IndexInvestigation(doc); err != nil {
		t.Errorf("IndexInvestigation() in dev mode should not error, got: %v", err)
	}
}

func TestIndexAlert_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	doc := AlertDoc{
		AlertRef:       "AML-2026-001",
		Title:          "High Risk Transaction",
		RiskLevel:      "high",
		Status:         "open",
		TransactionRef: "TXN-001",
		TriggeredValue: 5000000,
		CreatedAt:      time.Now(),
		TenantID:       "tenant-001",
	}

	if err := IndexAlert(doc); err != nil {
		t.Errorf("IndexAlert() in dev mode should not error, got: %v", err)
	}
}

func TestIndexKYCRecord_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	doc := KYCDoc{
		ID:          42,
		SubjectName: "Jane Smith",
		NIN:         "12345678901",
		BVN:         "12345678901",
		Status:      "passed",
		RiskScore:   25.0,
		CreatedAt:   time.Now(),
		TenantID:    "tenant-001",
	}

	if err := IndexKYCRecord(doc); err != nil {
		t.Errorf("IndexKYCRecord() in dev mode should not error, got: %v", err)
	}
}

// ─── CrossEntitySearch (dev mode) ─────────────────────────────────────────────

func TestCrossEntitySearch_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	results, err := CrossEntitySearch(SearchRequest{
		Query:    "John Doe",
		TenantID: "tenant-001",
	})
	if err != nil {
		t.Errorf("CrossEntitySearch() in dev mode should not error, got: %v", err)
	}

	// Should return empty results for all three indices
	for _, idx := range []string{IndexInvestigations, IndexAlerts, IndexKYC} {
		result, ok := results[idx]
		if !ok {
			t.Errorf("missing result for index %q", idx)
			continue
		}
		if result.Total != 0 {
			t.Errorf("expected 0 total for %q in dev mode, got %d", idx, result.Total)
		}
	}
}

// ─── HandleSearch HTTP handler ────────────────────────────────────────────────

func TestHandleSearch_MissingQuery(t *testing.T) {
	body, _ := json.Marshal(SearchRequest{
		Query:    "",
		TenantID: "tenant-001",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleSearch(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty query, got %d", rr.Code)
	}
}

func TestHandleSearch_WrongMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/search", nil)
	rr := httptest.NewRecorder()

	HandleSearch(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for GET, got %d", rr.Code)
	}
}

func TestHandleSearch_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	body, _ := json.Marshal(SearchRequest{
		Query:    "fraud",
		TenantID: "tenant-001",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleSearch(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 in dev mode, got %d: %s", rr.Code, rr.Body.String())
	}

	var results map[string]SearchResult
	if err := json.NewDecoder(rr.Body).Decode(&results); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(results) == 0 {
		t.Error("expected non-empty results map")
	}
}

func TestHandleSearch_InvalidBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/search",
		bytes.NewReader([]byte("not-json")))
	rr := httptest.NewRecorder()

	HandleSearch(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid body, got %d", rr.Code)
	}
}

// ─── HandleIndexInvestigation HTTP handler ────────────────────────────────────

func TestHandleIndexInvestigation_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	doc := InvestigationDoc{
		Ref:         "INV-2026-002",
		SubjectName: "Acme Corp",
		SubjectType: "corporate",
		Status:      "active",
		RiskScore:   55.0,
		Tier:        "enhanced",
		TenantID:    "tenant-001",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	body, _ := json.Marshal(doc)

	req := httptest.NewRequest(http.MethodPost, "/v1/index/investigation", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleIndexInvestigation(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 in dev mode, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleIndexAlert_DevMode(t *testing.T) {
	original := opensearchURL
	opensearchURL = ""
	defer func() { opensearchURL = original }()

	doc := AlertDoc{
		AlertRef:  "AML-2026-002",
		Title:     "Suspicious Transfer",
		RiskLevel: "critical",
		Status:    "escalated",
		CreatedAt: time.Now(),
		TenantID:  "tenant-001",
	}
	body, _ := json.Marshal(doc)

	req := httptest.NewRequest(http.MethodPost, "/v1/index/alert", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	HandleIndexAlert(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 in dev mode, got %d: %s", rr.Code, rr.Body.String())
	}
}
