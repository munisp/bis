// Package internal — standalone API clients for NIMC, NIBSS, CAC, and Youverify.
// All result types (NINResult, BVNResult, CACResult, SanctionsResult, SanctionsHit)
// are defined in engine.go. These clients are thin wrappers around the respective
// upstream APIs and are used by Engine when direct credentials are available.
package internal

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── NIMC Client ─────────────────────────────────────────────────────────────

// NIMCClient wraps the NIMC identity API directly.
type NIMCClient struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// NewNIMCClient creates a NIMCClient from environment variables.
func NewNIMCClient() *NIMCClient {
	return &NIMCClient{
		baseURL: envOrDefault("BIS_VERIFY_NIMC_URL", "https://api.nimc.gov.ng/v1"),
		apiKey:  os.Getenv("BIS_VERIFY_NIMC_KEY"),
		hc:      &http.Client{Timeout: 10 * time.Second},
	}
}

// IsConfigured returns true when the NIMC API key is set.
func (c *NIMCClient) IsConfigured() bool { return c.apiKey != "" }

// Lookup resolves a NIN to identity attributes via the NIMC API.
// Returns (nil, nil) when credentials are absent.
func (c *NIMCClient) Lookup(nin string) (*NINResult, error) {
	if !c.IsConfigured() {
		return nil, nil
	}
	if len(nin) != 11 {
		return nil, fmt.Errorf("NIN must be exactly 11 digits")
	}

	url := fmt.Sprintf("%s/identity/nin/%s", c.baseURL, nin)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("nimc: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nimc: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("NIN not found")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("nimc: status %d: %s", resp.StatusCode, string(body))
	}

	var raw struct {
		Data struct {
			NIN        string `json:"nin"`
			FirstName  string `json:"firstname"`
			LastName   string `json:"surname"`
			MiddleName string `json:"middlename"`
			DOB        string `json:"birthdate"`
			Gender     string `json:"gender"`
			Phone      string `json:"telephoneno"`
			Address    string `json:"residence_AdressLine1"`
			State      string `json:"residence_state"`
			Photo      string `json:"photo"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("nimc: decode response: %w", err)
	}
	d := raw.Data
	return &NINResult{
		NIN:        d.NIN,
		FirstName:  d.FirstName,
		LastName:   d.LastName,
		MiddleName: d.MiddleName,
		DOB:        d.DOB,
		Gender:     d.Gender,
		Phone:      d.Phone,
		Address:    d.Address,
		State:      d.State,
		Photo:      d.Photo,
		Source:     "nimc-direct",
		Sandbox:    false,
	}, nil
}

// ─── NIBSS Client ─────────────────────────────────────────────────────────────

// NIBSSClient wraps the NIBSS BVN API directly.
type NIBSSClient struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// NewNIBSSClient creates a NIBSSClient from environment variables.
func NewNIBSSClient() *NIBSSClient {
	return &NIBSSClient{
		baseURL: envOrDefault("BIS_VERIFY_NIBSS_URL", "https://api.nibss-plc.com.ng/v2"),
		apiKey:  os.Getenv("BIS_VERIFY_NIBSS_KEY"),
		hc:      &http.Client{Timeout: 10 * time.Second},
	}
}

// IsConfigured returns true when the NIBSS API key is set.
func (c *NIBSSClient) IsConfigured() bool { return c.apiKey != "" }

// Lookup resolves a BVN to identity attributes via the NIBSS API.
func (c *NIBSSClient) Lookup(bvn string) (*BVNResult, error) {
	if !c.IsConfigured() {
		return nil, nil
	}
	if len(bvn) != 11 {
		return nil, fmt.Errorf("BVN must be exactly 11 digits")
	}

	url := fmt.Sprintf("%s/bvn/%s", c.baseURL, bvn)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("nibss: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nibss: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("BVN not found")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("nibss: status %d: %s", resp.StatusCode, string(body))
	}

	var raw struct {
		Data struct {
			BVN       string `json:"bvn"`
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
			DOB       string `json:"dateOfBirth"`
			Phone     string `json:"phoneNumber"`
			Gender    string `json:"gender"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("nibss: decode response: %w", err)
	}
	d := raw.Data
	return &BVNResult{
		BVN:       d.BVN,
		FirstName: d.FirstName,
		LastName:  d.LastName,
		DOB:       d.DOB,
		Phone:     d.Phone,
		Gender:    d.Gender,
		Source:    "nibss-direct",
		Sandbox:   false,
	}, nil
}

// ─── CAC Client ───────────────────────────────────────────────────────────────

// CACDirectClient wraps the CAC company registry API directly.
type CACDirectClient struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// NewCACDirectClient creates a CACDirectClient from environment variables.
func NewCACDirectClient() *CACDirectClient {
	return &CACDirectClient{
		baseURL: envOrDefault("BIS_VERIFY_CAC_URL", "https://api.cac.gov.ng/v1"),
		apiKey:  os.Getenv("BIS_VERIFY_CAC_KEY"),
		hc:      &http.Client{Timeout: 12 * time.Second},
	}
}

// IsConfigured returns true when the CAC API key is set.
func (c *CACDirectClient) IsConfigured() bool { return c.apiKey != "" }

// Lookup resolves a CAC RC number to company attributes.
func (c *CACDirectClient) Lookup(rcNumber string) (*CACResult, error) {
	if !c.IsConfigured() {
		return nil, nil
	}

	url := fmt.Sprintf("%s/company/rc/%s", c.baseURL, rcNumber)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("cac: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cac: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("RC number not found")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("cac: status %d: %s", resp.StatusCode, string(body))
	}

	var raw struct {
		Data struct {
			RC          string   `json:"rcNumber"`
			CompanyName string   `json:"companyName"`
			Type        string   `json:"companyType"`
			DateReg     string   `json:"registrationDate"`
			Status      string   `json:"status"`
			Address     string   `json:"address"`
			State       string   `json:"state"`
			Directors   []string `json:"directors"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("cac: decode response: %w", err)
	}
	d := raw.Data
	return &CACResult{
		RC:          d.RC,
		CompanyName: d.CompanyName,
		Type:        d.Type,
		DateReg:     d.DateReg,
		Status:      d.Status,
		Address:     d.Address,
		State:       d.State,
		Directors:   d.Directors,
		Source:      "cac-direct",
		Sandbox:     false,
	}, nil
}

// ─── Youverify Fallback Client ────────────────────────────────────────────────

// YouverifyFallbackClient wraps the Youverify identity API as a fallback.
type YouverifyFallbackClient struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// NewYouverifyFallbackClient creates a YouverifyFallbackClient from environment variables.
func NewYouverifyFallbackClient() *YouverifyFallbackClient {
	return &YouverifyFallbackClient{
		baseURL: envOrDefault("YOUVERIFY_BASE_URL", "https://api.youverify.co/v2"),
		apiKey:  os.Getenv("YOUVERIFY_API_KEY"),
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

// IsAvailable returns true when the Youverify API key is configured.
func (c *YouverifyFallbackClient) IsAvailable() bool { return c.apiKey != "" }

// VerifyNIN verifies a NIN via Youverify.
func (c *YouverifyFallbackClient) VerifyNIN(nin string) (*NINResult, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("youverify: API key not configured")
	}
	body, err := c.post("/identity/queries/nin", fmt.Sprintf(`{"id":%q,"isSubjectConsent":true}`, nin))
	if err != nil {
		return nil, err
	}
	var raw struct {
		Data struct {
			NIN       string `json:"nin"`
			FirstName string `json:"firstname"`
			LastName  string `json:"lastname"`
			DOB       string `json:"birthdate"`
			Gender    string `json:"gender"`
			Phone     string `json:"mobile"`
			Address   string `json:"address"`
			State     string `json:"state"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("youverify/nin: decode: %w", err)
	}
	d := raw.Data
	return &NINResult{
		NIN:       d.NIN,
		FirstName: d.FirstName,
		LastName:  d.LastName,
		DOB:       d.DOB,
		Gender:    d.Gender,
		Phone:     d.Phone,
		Address:   d.Address,
		State:     d.State,
		Source:    "youverify",
		Sandbox:   false,
	}, nil
}

// VerifyBVN verifies a BVN via Youverify.
func (c *YouverifyFallbackClient) VerifyBVN(bvn string) (*BVNResult, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("youverify: API key not configured")
	}
	body, err := c.post("/identity/queries/bvn", fmt.Sprintf(`{"id":%q,"isSubjectConsent":true}`, bvn))
	if err != nil {
		return nil, err
	}
	var raw struct {
		Data struct {
			BVN       string `json:"bvn"`
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
			DOB       string `json:"dateOfBirth"`
			Phone     string `json:"phoneNumber"`
			Gender    string `json:"gender"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("youverify/bvn: decode: %w", err)
	}
	d := raw.Data
	return &BVNResult{
		BVN:       d.BVN,
		FirstName: d.FirstName,
		LastName:  d.LastName,
		DOB:       d.DOB,
		Phone:     d.Phone,
		Gender:    d.Gender,
		Source:    "youverify",
		Sandbox:   false,
	}, nil
}

// VerifyRC verifies a CAC RC number via Youverify.
func (c *YouverifyFallbackClient) VerifyRC(rcNumber string) (*CACResult, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("youverify: API key not configured")
	}
	body, err := c.post("/identity/queries/cac", fmt.Sprintf(`{"id":%q}`, rcNumber))
	if err != nil {
		return nil, err
	}
	var raw struct {
		Data struct {
			RC          string   `json:"rcNumber"`
			CompanyName string   `json:"companyName"`
			Type        string   `json:"companyType"`
			DateReg     string   `json:"registrationDate"`
			Status      string   `json:"status"`
			Address     string   `json:"address"`
			State       string   `json:"state"`
			Directors   []string `json:"directors"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("youverify/cac: decode: %w", err)
	}
	d := raw.Data
	return &CACResult{
		RC:          d.RC,
		CompanyName: d.CompanyName,
		Type:        d.Type,
		DateReg:     d.DateReg,
		Status:      d.Status,
		Address:     d.Address,
		State:       d.State,
		Directors:   d.Directors,
		Source:      "youverify",
		Sandbox:     false,
	}, nil
}

// post sends a POST request to the Youverify API and returns the raw response body.
func (c *YouverifyFallbackClient) post(path string, payload string) ([]byte, error) {
	url := c.baseURL + path
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("youverify: build request: %w", err)
	}
	req.Header.Set("token", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("youverify: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("youverify: read body: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("youverify: record not found")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("youverify: status %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ─── Sanctions Client ─────────────────────────────────────────────────────────

// SanctionsAPIClient wraps the Youverify sanctions screening API.
type SanctionsAPIClient struct {
	baseURL   string
	apiKey    string
	threshold float64
	hc        *http.Client
}

// NewSanctionsAPIClient creates a SanctionsAPIClient from environment variables.
func NewSanctionsAPIClient() *SanctionsAPIClient {
	return &SanctionsAPIClient{
		baseURL:   envOrDefault("YOUVERIFY_BASE_URL", "https://api.youverify.co/v2"),
		apiKey:    os.Getenv("YOUVERIFY_API_KEY"),
		threshold: 0.75,
		hc:        &http.Client{Timeout: 15 * time.Second},
	}
}

// IsAvailable returns true when the API key is configured.
func (c *SanctionsAPIClient) IsAvailable() bool { return c.apiKey != "" }

// ScreenName checks a person or entity name against all sanctions lists.
func (c *SanctionsAPIClient) ScreenName(name string) (*SanctionsResult, error) {
	if !c.IsAvailable() {
		return nil, fmt.Errorf("sanctions: API key not configured")
	}

	url := fmt.Sprintf("%s/compliance/sanctions/screen", c.baseURL)
	payload := fmt.Sprintf(`{"name":%q,"threshold":%.2f}`, name, c.threshold)
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("sanctions: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sanctions: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("sanctions: status %d: %s", resp.StatusCode, string(body))
	}

	var raw struct {
		Data struct {
			Hits []struct {
				ListName   string   `json:"listName"`
				EntityName string   `json:"entityName"`
				Score      float64  `json:"score"`
				Aliases    []string `json:"aliases"`
			} `json:"hits"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("sanctions: decode response: %w", err)
	}

	hits := make([]SanctionsHit, 0, len(raw.Data.Hits))
	for _, h := range raw.Data.Hits {
		hits = append(hits, SanctionsHit{
			ListName:   h.ListName,
			EntityName: h.EntityName,
			Score:      h.Score,
			Aliases:    h.Aliases,
		})
	}
	return &SanctionsResult{
		Name:    name,
		Hits:    hits,
		Clear:   len(hits) == 0,
		Source:  "youverify-sanctions",
		Sandbox: false,
	}, nil
}
