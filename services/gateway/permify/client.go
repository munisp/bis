// Package permify provides a fail-closed Permify authorization client for the BIS gateway.
package permify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	// ErrUnavailable means a protected request cannot be authorized because the
	// policy decision point is unavailable or is not correctly configured.
	ErrUnavailable = errors.New("permify authorization service unavailable")
	// ErrDenied is returned only when Permify explicitly denies a request.
	ErrDenied = errors.New("permify permission denied")
)

// Client is a Permify REST API client. A disabled client never grants access.
type Client struct {
	baseURL    string
	tenantID   string
	apiKey     string
	httpClient *http.Client
	enabled    bool
}

// CheckRequest mirrors the Permify /v1/tenants/{id}/permissions/check body.
type CheckRequest struct {
	Metadata   CheckMetadata `json:"metadata"`
	Entity     Entity        `json:"entity"`
	Permission string        `json:"permission"`
	Subject    Subject       `json:"subject"`
}

type CheckMetadata struct {
	SchemaVersion string `json:"schema_version,omitempty"`
	SnapToken     string `json:"snap_token,omitempty"`
	Depth         int    `json:"depth"`
}

type Entity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Subject struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Relation string `json:"relation,omitempty"`
}

type CheckResponse struct {
	Can string `json:"can"`
}

// New creates a client from environment variables. Missing configuration yields
// a non-authorizing client: all protected checks return ErrUnavailable.
func New() *Client {
	return NewWithHTTPClient(
		os.Getenv("PERMIFY_URL"),
		os.Getenv("PERMIFY_TENANT_ID"),
		os.Getenv("PERMIFY_API_KEY"),
		&http.Client{Timeout: 3 * time.Second},
	)
}

// NewWithHTTPClient supports narrow test and controlled dependency injection.
// A valid URL, tenant ID, API key, and client are all mandatory for authorization.
func NewWithHTTPClient(baseURL, tenantID, apiKey string, httpClient *http.Client) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	tenantID = strings.TrimSpace(tenantID)
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" || tenantID == "" || apiKey == "" || httpClient == nil {
		return &Client{enabled: false}
	}
	return &Client{
		baseURL:    baseURL,
		tenantID:   tenantID,
		apiKey:     apiKey,
		httpClient: httpClient,
		enabled:    true,
	}
}

// IsConfigured reports whether this client has all mandatory policy-decision configuration.
func (c *Client) IsConfigured() bool {
	return c != nil && c.enabled && c.httpClient != nil
}

// Check grants access only for an explicit RESULT_ALLOWED response. All local,
// transport, HTTP 5xx, decoding, and unknown-decision failures deny access.
func (c *Client) Check(ctx context.Context, entityType, entityID, permission, subjectID string) (bool, error) {
	if c == nil || !c.enabled || c.httpClient == nil {
		return false, ErrUnavailable
	}
	if strings.TrimSpace(entityType) == "" || strings.TrimSpace(entityID) == "" || strings.TrimSpace(permission) == "" || strings.TrimSpace(subjectID) == "" {
		return false, fmt.Errorf("permify invalid check input")
	}

	body, err := json.Marshal(CheckRequest{
		Metadata:   CheckMetadata{Depth: 20},
		Entity:     Entity{Type: entityType, ID: entityID},
		Permission: permission,
		Subject:    Subject{Type: "user", ID: subjectID},
	})
	if err != nil {
		return false, fmt.Errorf("permify marshal: %w", err)
	}

	requestURL := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", c.baseURL, c.tenantID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("permify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusInternalServerError {
		return false, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return false, fmt.Errorf("permify check status %d", resp.StatusCode)
	}

	var result CheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("%w: decode response: %v", ErrUnavailable, err)
	}
	switch result.Can {
	case "RESULT_ALLOWED":
		return true, nil
	case "RESULT_DENIED":
		return false, ErrDenied
	default:
		return false, fmt.Errorf("%w: unknown decision %q", ErrUnavailable, result.Can)
	}
}

// WriteRelationship creates a relation tuple in Permify. It never reports a
// successful write when the client or authorization service is unavailable.
func (c *Client) WriteRelationship(ctx context.Context, entityType, entityID, relation, subjectType, subjectID string) error {
	if c == nil || !c.enabled || c.httpClient == nil {
		return ErrUnavailable
	}
	payload := map[string]any{
		"metadata": map[string]any{},
		"tuples": []map[string]any{{
			"entity":   map[string]string{"type": entityType, "id": entityID},
			"relation": relation,
			"subject":  map[string]string{"type": subjectType, "id": subjectID},
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("permify marshal relationship: %w", err)
	}
	requestURL := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", c.baseURL, c.tenantID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("permify relationship request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: write relationship: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusInternalServerError {
		return fmt.Errorf("%w: relationship status %d", ErrUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("permify write relationship: status %d", resp.StatusCode)
	}
	return nil
}

// Middleware returns an HTTP middleware that denies absent identity, explicit
// policy denial, and policy-service unavailability without reaching the handler.
func (c *Client) Middleware(entityType, permission string, entityIDFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subjectID := strings.TrimSpace(r.Header.Get("X-BIS-User-ID"))
			if subjectID == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			allowed, err := c.Check(r.Context(), entityType, entityIDFn(r), permission, subjectID)
			if errors.Is(err, ErrUnavailable) {
				http.Error(w, `{"error":"authorization_unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			if err != nil || !allowed {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
