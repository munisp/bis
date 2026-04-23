// Package bis provides the official Go SDK for the BIS (Background Intelligence System) API.
//
// Quick start:
//
//	client, err := bis.NewClient(bis.Config{APIKey: "bis_live_your_key"})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	investigations, err := client.Investigations.List(context.Background(), bis.ListInvestigationsParams{
//	    Status: "open",
//	})
package bis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

const (
	DefaultBaseURL = "https://bis.example.ng/api/v1"
	DefaultTimeout = 30 * time.Second
	SDKVersion     = "1.0.0"
)

// Config holds the BIS client configuration.
type Config struct {
	// APIKey is your BIS API key. Defaults to BIS_API_KEY env var.
	APIKey string
	// BaseURL is the API base URL. Defaults to DefaultBaseURL.
	BaseURL string
	// Timeout is the HTTP request timeout. Defaults to DefaultTimeout.
	Timeout time.Duration
	// HTTPClient allows injecting a custom HTTP client.
	HTTPClient *http.Client
}

// Client is the BIS API client.
type Client struct {
	config         Config
	httpClient     *http.Client
	Investigations *InvestigationsService
	KYC            *KYCService
	Alerts         *AlertsService
	Transactions   *TransactionsService
	SAR            *SARService
	QuickCheck     *QuickCheckService
	LEX            *LEXService
	Analytics      *AnalyticsService
}

// NewClient creates a new BIS API client.
func NewClient(cfg Config) (*Client, error) {
	if cfg.APIKey == "" {
		cfg.APIKey = os.Getenv("BIS_API_KEY")
	}
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("bis: APIKey is required; set BIS_API_KEY env var or pass Config.APIKey")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = DefaultTimeout
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: cfg.Timeout}
	}

	c := &Client{config: cfg, httpClient: httpClient}
	c.Investigations = &InvestigationsService{client: c}
	c.KYC = &KYCService{client: c}
	c.Alerts = &AlertsService{client: c}
	c.Transactions = &TransactionsService{client: c}
	c.SAR = &SARService{client: c}
	c.QuickCheck = &QuickCheckService{client: c}
	c.LEX = &LEXService{client: c}
	c.Analytics = &AnalyticsService{client: c}
	return c, nil
}

// do executes an HTTP request and decodes the JSON response into v.
func (c *Client) do(ctx context.Context, method, path string, params url.Values, body interface{}, v interface{}) error {
	u := c.config.BaseURL + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("bis: marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, bodyReader)
	if err != nil {
		return fmt.Errorf("bis: create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "bis-go-sdk/"+SDKVersion)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("bis: execute request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("bis: read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		_ = json.Unmarshal(respBody, &apiErr)
		apiErr.StatusCode = resp.StatusCode
		if apiErr.Message == "" {
			apiErr.Message = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		if resp.StatusCode == 429 {
			retryAfter, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			apiErr.RetryAfter = retryAfter
		}
		return &apiErr
	}

	if v != nil {
		if err := json.Unmarshal(respBody, v); err != nil {
			return fmt.Errorf("bis: decode response: %w", err)
		}
	}
	return nil
}

// APIError represents an error returned by the BIS API.
type APIError struct {
	StatusCode int    `json:"-"`
	Message    string `json:"message"`
	Code       string `json:"code"`
	RetryAfter int    `json:"-"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("bis: API error %d: %s", e.StatusCode, e.Message)
}

// IsNotFound returns true if the error is a 404 Not Found error.
func IsNotFound(err error) bool {
	if apiErr, ok := err.(*APIError); ok {
		return apiErr.StatusCode == 404
	}
	return false
}

// IsRateLimited returns true if the error is a 429 Too Many Requests error.
func IsRateLimited(err error) bool {
	if apiErr, ok := err.(*APIError); ok {
		return apiErr.StatusCode == 429
	}
	return false
}

// IsUnauthorized returns true if the error is a 401 Unauthorized error.
func IsUnauthorized(err error) bool {
	if apiErr, ok := err.(*APIError); ok {
		return apiErr.StatusCode == 401
	}
	return false
}
