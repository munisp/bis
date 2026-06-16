// Package opensearch provides an OpenSearch client for the BIS gateway.
//
// Manages three indices:
//   - bis-investigations  (ref, subjectName, subjectType, status, riskScore, tier)
//   - bis-alerts          (alertRef, title, riskLevel, status, transactionRef)
//   - bis-kyc             (subjectName, nin, bvn, status, riskScore)
//
// Falls back silently when OPENSEARCH_URL is not configured (dev mode).
package opensearch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Config ───────────────────────────────────────────────────────────────────

var (
	opensearchURL      = os.Getenv("OPENSEARCH_URL")
	opensearchUser     = envOr("OPENSEARCH_USER", "admin")
	opensearchPassword = envOr("OPENSEARCH_PASSWORD", "admin")
	httpClient         = &http.Client{Timeout: 10 * time.Second}
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Index names ──────────────────────────────────────────────────────────────

const (
	IndexInvestigations = "bis-investigations"
	IndexAlerts         = "bis-alerts"
	IndexKYC            = "bis-kyc"
)

// ─── Document types ───────────────────────────────────────────────────────────

// InvestigationDoc is the OpenSearch document for an investigation.
type InvestigationDoc struct {
	Ref         string    `json:"ref"`
	SubjectName string    `json:"subjectName"`
	SubjectType string    `json:"subjectType"`
	Status      string    `json:"status"`
	RiskScore   float64   `json:"riskScore"`
	Tier        string    `json:"tier"`
	Priority    string    `json:"priority"`
	Country     string    `json:"country"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	TenantID    string    `json:"tenantId"`
}

// AlertDoc is the OpenSearch document for an AML alert.
type AlertDoc struct {
	AlertRef       string    `json:"alertRef"`
	Title          string    `json:"title"`
	RiskLevel      string    `json:"riskLevel"`
	Status         string    `json:"status"`
	TransactionRef string    `json:"transactionRef,omitempty"`
	TriggeredValue float64   `json:"triggeredValue,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	TenantID       string    `json:"tenantId"`
}

// KYCDoc is the OpenSearch document for a KYC record.
type KYCDoc struct {
	ID          int       `json:"id"`
	SubjectName string    `json:"subjectName"`
	NIN         string    `json:"nin,omitempty"`
	BVN         string    `json:"bvn,omitempty"`
	Status      string    `json:"status"`
	RiskScore   float64   `json:"riskScore"`
	CreatedAt   time.Time `json:"createdAt"`
	TenantID    string    `json:"tenantId"`
}

// SearchResult is the generic OpenSearch search response.
type SearchResult struct {
	Total   int64             `json:"total"`
	Hits    []json.RawMessage `json:"hits"`
	MaxScore float64          `json:"maxScore"`
}

// ─── Index management ─────────────────────────────────────────────────────────

// EnsureIndices creates the BIS indices if they don't already exist.
func EnsureIndices() error {
	if opensearchURL == "" {
		log.Println("[OpenSearch] OPENSEARCH_URL not set — index management disabled")
		return nil
	}

	indices := map[string]string{
		IndexInvestigations: `{
			"mappings": {
				"properties": {
					"ref":         {"type": "keyword"},
					"subjectName": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
					"subjectType": {"type": "keyword"},
					"status":      {"type": "keyword"},
					"riskScore":   {"type": "float"},
					"tier":        {"type": "keyword"},
					"priority":    {"type": "keyword"},
					"country":     {"type": "keyword"},
					"createdAt":   {"type": "date"},
					"updatedAt":   {"type": "date"},
					"tenantId":    {"type": "keyword"}
				}
			}
		}`,
		IndexAlerts: `{
			"mappings": {
				"properties": {
					"alertRef":       {"type": "keyword"},
					"title":          {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
					"riskLevel":      {"type": "keyword"},
					"status":         {"type": "keyword"},
					"transactionRef": {"type": "keyword"},
					"triggeredValue": {"type": "float"},
					"createdAt":      {"type": "date"},
					"tenantId":       {"type": "keyword"}
				}
			}
		}`,
		IndexKYC: `{
			"mappings": {
				"properties": {
					"id":          {"type": "integer"},
					"subjectName": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
					"nin":         {"type": "keyword"},
					"bvn":         {"type": "keyword"},
					"status":      {"type": "keyword"},
					"riskScore":   {"type": "float"},
					"createdAt":   {"type": "date"},
					"tenantId":    {"type": "keyword"}
				}
			}
		}`,
	}

	for name, mapping := range indices {
		if err := createIndexIfNotExists(name, mapping); err != nil {
			return fmt.Errorf("ensure index %s: %w", name, err)
		}
	}
	return nil
}

func createIndexIfNotExists(index, mapping string) error {
	// Check if index exists
	req, _ := http.NewRequest(http.MethodHead, opensearchURL+"/"+index, nil)
	req.SetBasicAuth(opensearchUser, opensearchPassword)
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("check index %s: %w", index, err)
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return nil // already exists
	}

	// Create index
	req, _ = http.NewRequest(http.MethodPut, opensearchURL+"/"+index,
		strings.NewReader(mapping))
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(opensearchUser, opensearchPassword)

	resp, err = httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("create index %s: %w", index, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("create index %s: %d %s", index, resp.StatusCode, string(body))
	}

	log.Printf("[OpenSearch] Created index: %s", index)
	return nil
}

// ─── Document indexing ────────────────────────────────────────────────────────

// IndexInvestigation upserts an investigation document.
func IndexInvestigation(doc InvestigationDoc) error {
	return indexDocument(IndexInvestigations, doc.Ref, doc)
}

// IndexAlert upserts an alert document.
func IndexAlert(doc AlertDoc) error {
	return indexDocument(IndexAlerts, doc.AlertRef, doc)
}

// IndexKYCRecord upserts a KYC record document.
func IndexKYCRecord(doc KYCDoc) error {
	return indexDocument(IndexKYC, fmt.Sprintf("%d", doc.ID), doc)
}

func indexDocument(index, id string, doc interface{}) error {
	if opensearchURL == "" {
		return nil // dev mode
	}

	payload, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("marshal document: %w", err)
	}

	url := fmt.Sprintf("%s/%s/_doc/%s", opensearchURL, index, id)
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(opensearchUser, opensearchPassword)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("index document %s/%s: %w", index, id, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("index document %s/%s: %d %s", index, id, resp.StatusCode, string(body))
	}

	return nil
}

// ─── Search ───────────────────────────────────────────────────────────────────

// SearchRequest is the cross-entity search request.
type SearchRequest struct {
	Query    string   `json:"query"`
	Indices  []string `json:"indices,omitempty"` // nil = all three
	TenantID string   `json:"tenantId"`
	From     int      `json:"from"`
	Size     int      `json:"size"`
}

// CrossEntitySearch performs a multi-index search across investigations, alerts, and KYC.
func CrossEntitySearch(req SearchRequest) (map[string]SearchResult, error) {
	if opensearchURL == "" {
		return map[string]SearchResult{
			IndexInvestigations: {Total: 0, Hits: []json.RawMessage{}},
			IndexAlerts:         {Total: 0, Hits: []json.RawMessage{}},
			IndexKYC:            {Total: 0, Hits: []json.RawMessage{}},
		}, nil
	}

	indices := req.Indices
	if len(indices) == 0 {
		indices = []string{IndexInvestigations, IndexAlerts, IndexKYC}
	}

	if req.Size == 0 {
		req.Size = 20
	}

	results := make(map[string]SearchResult)

	for _, index := range indices {
		result, err := searchIndex(index, req)
		if err != nil {
			log.Printf("[OpenSearch] search %s error: %v", index, err)
			results[index] = SearchResult{Total: 0, Hits: []json.RawMessage{}}
			continue
		}
		results[index] = result
	}

	return results, nil
}

func searchIndex(index string, req SearchRequest) (SearchResult, error) {
	query := map[string]interface{}{
		"from": req.From,
		"size": req.Size,
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": []interface{}{
					map[string]interface{}{
						"multi_match": map[string]interface{}{
							"query":  req.Query,
							"fields": []string{"subjectName^3", "ref^2", "alertRef^2", "title^2", "nin", "bvn", "*"},
							"type":   "best_fields",
							"fuzziness": "AUTO",
						},
					},
				},
				"filter": []interface{}{
					map[string]interface{}{
						"term": map[string]interface{}{
							"tenantId": req.TenantID,
						},
					},
				},
			},
		},
		"highlight": map[string]interface{}{
			"fields": map[string]interface{}{
				"subjectName": map[string]interface{}{},
				"title":       map[string]interface{}{},
			},
		},
	}

	payload, _ := json.Marshal(query)
	url := fmt.Sprintf("%s/%s/_search", opensearchURL, index)

	httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return SearchResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.SetBasicAuth(opensearchUser, opensearchPassword)

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return SearchResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return SearchResult{}, fmt.Errorf("search %s: %d %s", index, resp.StatusCode, string(body))
	}

	var osResp struct {
		Hits struct {
			Total struct {
				Value int64 `json:"value"`
			} `json:"total"`
			MaxScore float64 `json:"max_score"`
			Hits     []struct {
				Source json.RawMessage `json:"_source"`
				Score  float64         `json:"_score"`
			} `json:"hits"`
		} `json:"hits"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&osResp); err != nil {
		return SearchResult{}, fmt.Errorf("decode search response: %w", err)
	}

	hits := make([]json.RawMessage, len(osResp.Hits.Hits))
	for i, h := range osResp.Hits.Hits {
		hits[i] = h.Source
	}

	return SearchResult{
		Total:    osResp.Hits.Total.Value,
		Hits:     hits,
		MaxScore: osResp.Hits.MaxScore,
	}, nil
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

// HandleSearch handles POST /v1/search requests from the BFF.
func HandleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SearchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if strings.TrimSpace(req.Query) == "" {
		http.Error(w, "query is required", http.StatusBadRequest)
		return
	}

	results, err := CrossEntitySearch(req)
	if err != nil {
		log.Printf("[OpenSearch] search error: %v", err)
		http.Error(w, "search failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}

// HandleIndexInvestigation handles POST /v1/index/investigation from the BFF.
func HandleIndexInvestigation(w http.ResponseWriter, r *http.Request) {
	var doc InvestigationDoc
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&doc); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if err := IndexInvestigation(doc); err != nil {
		log.Printf("[OpenSearch] index investigation error: %v", err)
		http.Error(w, "indexing failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "indexed"})
}

// HandleIndexAlert handles POST /v1/index/alert from the BFF.
func HandleIndexAlert(w http.ResponseWriter, r *http.Request) {
	var doc AlertDoc
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&doc); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if err := IndexAlert(doc); err != nil {
		log.Printf("[OpenSearch] index alert error: %v", err)
		http.Error(w, "indexing failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "indexed"})
}
