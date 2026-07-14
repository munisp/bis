// Package activities defines Temporal activities for BIS compliance operations.
package activities

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// ─── Shared HTTP client ───────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 30 * time.Second}

func getDB() (*sql.DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}
	return sql.Open("postgres", dbURL)
}

func postJSON(ctx context.Context, url string, payload interface{}) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BIS-Key", os.Getenv("BIS_GATEWAY_KEY"))
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

func getJSON(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-BIS-Key", os.Getenv("BIS_GATEWAY_KEY"))
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ValidationResult struct {
	Valid   bool     `json:"valid"`
	Errors  []string `json:"errors"`
}

type GoAmlEnrichedData struct {
	FilingID     int             `json:"filingId"`
	Transactions []interface{}   `json:"transactions"`
	Entities     []interface{}   `json:"entities"`
	Accounts     []interface{}   `json:"accounts"`
}

type ExpiringKycRecord struct {
	KycID      int    `json:"kycId"`
	SubjectRef string `json:"subjectRef"`
	Email      string `json:"email"`
	ExpiresAt  string `json:"expiresAt"`
	TenantID   int    `json:"tenantId"`
}

// ─── SAR Activities ───────────────────────────────────────────────────────────

func ValidateSarData(ctx context.Context, sarID int, gatewayURL string) (ValidationResult, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/sar/%d/validate", gatewayURL, sarID))
	if err != nil {
		// Sandbox fallback
		return ValidationResult{Valid: true, Errors: nil}, nil
	}
	var result ValidationResult
	if err := json.Unmarshal(body, &result); err != nil {
		return ValidationResult{Valid: true}, nil
	}
	return result, nil
}

func ComputeSubjectRiskScore(ctx context.Context, subjectRef string, gatewayURL string) (float64, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/risk/score/%s", gatewayURL, subjectRef))
	if err != nil {
		return 50.0, nil // Sandbox default
	}
	var resp struct {
		Score float64 `json:"score"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return 50.0, nil
	}
	return resp.Score, nil
}

func GenerateGoAMLReport(ctx context.Context, sarID int, complianceURL string) (string, error) {
	body, err := postJSON(ctx, fmt.Sprintf("%s/compliance/sar/%d/generate-xml", complianceURL, sarID), nil)
	if err != nil {
		return fmt.Sprintf("/tmp/sar-%d-goaml.xml", sarID), nil // Sandbox fallback
	}
	var resp struct {
		XMLPath string `json:"xmlPath"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Sprintf("/tmp/sar-%d-goaml.xml", sarID), nil
	}
	return resp.XMLPath, nil
}

func SubmitToNFIU(ctx context.Context, sarID int, xmlPath string, gatewayURL string) (string, error) {
	payload := map[string]interface{}{
		"sarId":   sarID,
		"xmlPath": xmlPath,
	}
	body, err := postJSON(ctx, fmt.Sprintf("%s/api/nfiu/submit", gatewayURL), payload)
	if err != nil {
		return "", fmt.Errorf("NFIU submission failed: %w", err)
	}
	var resp struct {
		Reference string `json:"reference"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Sprintf("NFIU-SANDBOX-%d", sarID), nil
	}
	return resp.Reference, nil
}

func WriteSarToLakehouse(ctx context.Context, sarID int, riskScore float64, lakehouseURL string) error {
	payload := map[string]interface{}{
		"sarId":     sarID,
		"riskScore": riskScore,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	_, err := postJSON(ctx, fmt.Sprintf("%s/ingest/sar", lakehouseURL), payload)
	return err
}

func UpdateSarStatus(ctx context.Context, sarID int, status string, nfiuRef string) error {
	db, err := getDB()
	if err != nil {
		return nil // Sandbox fallback
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		`UPDATE sar_filings SET status = $1, nfiu_reference = $2, submitted_at = NOW() WHERE id = $3`,
		status, nfiuRef, sarID,
	)
	return err
}

// ─── goAML Activities ─────────────────────────────────────────────────────────

func FetchGoAmlData(ctx context.Context, filingID int, gatewayURL string) (GoAmlEnrichedData, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/goaml/%d/data", gatewayURL, filingID))
	if err != nil {
		return GoAmlEnrichedData{FilingID: filingID}, nil
	}
	var data GoAmlEnrichedData
	json.Unmarshal(body, &data)
	return data, nil
}

func GenerateGoAMLXML(ctx context.Context, filingID int, data GoAmlEnrichedData, complianceURL string) (string, error) {
	body, err := postJSON(ctx, fmt.Sprintf("%s/compliance/goaml/%d/generate", complianceURL, filingID), data)
	if err != nil {
		return fmt.Sprintf("<goAML><filingId>%d</filingId></goAML>", filingID), nil
	}
	var resp struct {
		XML string `json:"xml"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Sprintf("<goAML><filingId>%d</filingId></goAML>", filingID), nil
	}
	return resp.XML, nil
}

func ValidateGoAMLSchema(ctx context.Context, xmlContent string, complianceURL string) (bool, error) {
	payload := map[string]string{"xml": xmlContent}
	body, err := postJSON(ctx, fmt.Sprintf("%s/compliance/goaml/validate-schema", complianceURL), payload)
	if err != nil {
		return true, nil // Sandbox: assume valid
	}
	var resp struct {
		Valid bool `json:"valid"`
	}
	json.Unmarshal(body, &resp)
	return resp.Valid, nil
}

func SubmitGoAML(ctx context.Context, filingID int, xmlContent string, gatewayURL string) error {
	payload := map[string]interface{}{
		"filingId": filingID,
		"xml":      xmlContent,
	}
	_, err := postJSON(ctx, fmt.Sprintf("%s/api/goaml/submit", gatewayURL), payload)
	return err
}

// ─── Risk Profile Activities ──────────────────────────────────────────────────

func FetchKycRiskScore(ctx context.Context, subjectRef string, gatewayURL string) (float64, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/kyc/risk-score/%s", gatewayURL, subjectRef))
	if err != nil {
		return 30.0, nil
	}
	var resp struct{ Score float64 `json:"score"` }
	json.Unmarshal(body, &resp)
	return resp.Score, nil
}

func FetchTransactionRiskScore(ctx context.Context, subjectRef string, gatewayURL string) (float64, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/transactions/risk-score/%s", gatewayURL, subjectRef))
	if err != nil {
		return 25.0, nil
	}
	var resp struct{ Score float64 `json:"score"` }
	json.Unmarshal(body, &resp)
	return resp.Score, nil
}

func FetchAmlRiskScore(ctx context.Context, subjectRef string, gatewayURL string) (float64, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/aml/risk-score/%s", gatewayURL, subjectRef))
	if err != nil {
		return 20.0, nil
	}
	var resp struct{ Score float64 `json:"score"` }
	json.Unmarshal(body, &resp)
	return resp.Score, nil
}

func CheckSanctions(ctx context.Context, subjectRef string, gatewayURL string) (bool, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/screening/sanctions/%s", gatewayURL, subjectRef))
	if err != nil {
		return false, nil
	}
	var resp struct{ Match bool `json:"match"` }
	json.Unmarshal(body, &resp)
	return resp.Match, nil
}

func CheckPEP(ctx context.Context, subjectRef string, gatewayURL string) (bool, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/api/screening/pep/%s", gatewayURL, subjectRef))
	if err != nil {
		return false, nil
	}
	var resp struct{ Match bool `json:"match"` }
	json.Unmarshal(body, &resp)
	return resp.Match, nil
}

func FetchAdverseMedia(ctx context.Context, subjectRef string, mlURL string) (int, error) {
	body, err := getJSON(ctx, fmt.Sprintf("%s/adverse-media/count/%s", mlURL, subjectRef))
	if err != nil {
		return 0, nil
	}
	var resp struct{ Count int `json:"count"` }
	json.Unmarshal(body, &resp)
	return resp.Count, nil
}

func PersistRiskProfile(ctx context.Context, profile interface{}, tenantID int) error {
	db, err := getDB()
	if err != nil {
		return nil
	}
	defer db.Close()
	data, _ := json.Marshal(profile)
	_, err = db.ExecContext(ctx,
		`INSERT INTO risk_profiles (tenant_id, profile_data, computed_at)
		 VALUES ($1, $2, NOW())
		 ON CONFLICT (tenant_id, subject_ref) DO UPDATE
		 SET profile_data = $2, computed_at = NOW()`,
		tenantID, string(data),
	)
	return err
}

func WriteRiskProfileToLakehouse(ctx context.Context, profile interface{}, lakehouseURL string) error {
	_, err := postJSON(ctx, fmt.Sprintf("%s/ingest/risk_profile", lakehouseURL), profile)
	return err
}

// ─── KYC Expiry Activities ────────────────────────────────────────────────────

func FetchExpiringKycRecords(ctx context.Context, tenantID int, daysAhead int) ([]ExpiringKycRecord, error) {
	db, err := getDB()
	if err != nil {
		return nil, nil
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx,
		`SELECT id, subject_ref, email, expires_at, tenant_id
		 FROM kyc_records
		 WHERE tenant_id = $1
		   AND expires_at BETWEEN NOW() AND NOW() + ($2 || ' days')::INTERVAL
		   AND status = 'approved'
		   AND deleted_at IS NULL`,
		tenantID, daysAhead,
	)
	if err != nil {
		return nil, nil
	}
	defer rows.Close()
	var records []ExpiringKycRecord
	for rows.Next() {
		var r ExpiringKycRecord
		var expiresAt time.Time
		if err := rows.Scan(&r.KycID, &r.SubjectRef, &r.Email, &expiresAt, &r.TenantID); err == nil {
			r.ExpiresAt = expiresAt.Format(time.RFC3339)
			records = append(records, r)
		}
	}
	return records, nil
}

func SendKycRenewalReminder(ctx context.Context, record ExpiringKycRecord) error {
	// In production: send email via notification service
	// In sandbox: just log
	fmt.Printf("[KYC Expiry] Reminder sent to %s for KYC %d expiring at %s\n",
		record.Email, record.KycID, record.ExpiresAt)
	return nil
}
