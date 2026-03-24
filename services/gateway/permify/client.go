// Package permify provides a Permify authorization client for the BIS gateway.
// It calls the Permify REST API to check permissions before forwarding requests.
package permify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// Client is a Permify REST API client.
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
	Can     string `json:"can"` // "RESULT_ALLOWED" | "RESULT_DENIED"
	Allowed bool   // derived
}

// New creates a Permify client from environment variables.
// When PERMIFY_URL is not set the client is disabled (fail-open).
func New() *Client {
	url := os.Getenv("PERMIFY_URL")
	if url == "" {
		log.Println("[Permify] PERMIFY_URL not set — authorization checks disabled (fail-open)")
		return &Client{enabled: false}
	}
	return &Client{
		baseURL:  url,
		tenantID: getEnvOrDefault("PERMIFY_TENANT_ID", "t1"),
		apiKey:   os.Getenv("PERMIFY_API_KEY"),
		httpClient: &http.Client{
			Timeout: 3 * time.Second,
		},
		enabled: true,
	}
}

// Check returns true if the subject has the given permission on the entity.
// On error or when Permify is disabled, it returns true (fail-open).
func (c *Client) Check(ctx context.Context, entityType, entityID, permission, subjectID string) (bool, error) {
	if !c.enabled {
		return true, nil
	}

	req := CheckRequest{
		Metadata:   CheckMetadata{Depth: 20},
		Entity:     Entity{Type: entityType, ID: entityID},
		Permission: permission,
		Subject:    Subject{Type: "user", ID: subjectID},
	}

	body, err := json.Marshal(req)
	if err != nil {
		return true, fmt.Errorf("permify marshal: %w", err)
	}

	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", c.baseURL, c.tenantID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return true, fmt.Errorf("permify request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		log.Printf("[Permify] Check failed (fail-open): %v", err)
		return true, nil // fail-open
	}
	defer resp.Body.Close()

	var result CheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return true, fmt.Errorf("permify decode: %w", err)
	}

	result.Allowed = result.Can == "RESULT_ALLOWED"
	return result.Allowed, nil
}

// WriteRelationship creates a relation tuple in Permify.
func (c *Client) WriteRelationship(ctx context.Context, entityType, entityID, relation, subjectType, subjectID string) error {
	if !c.enabled {
		return nil
	}

	payload := map[string]interface{}{
		"metadata": map[string]interface{}{},
		"tuples": []map[string]interface{}{
			{
				"entity":   map[string]string{"type": entityType, "id": entityID},
				"relation": relation,
				"subject":  map[string]string{"type": subjectType, "id": subjectID},
			},
		},
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", c.baseURL, c.tenantID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("permify write relationship: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("permify write relationship: status %d", resp.StatusCode)
	}
	return nil
}

// Middleware returns an HTTP middleware that checks a permission before forwarding.
// entityIDFn extracts the entity ID from the request (e.g. from path params).
func (c *Client) Middleware(entityType, permission string, entityIDFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subjectID := r.Header.Get("X-BIS-User-ID")
			if subjectID == "" {
				subjectID = "anonymous"
			}
			entityID := entityIDFn(r)

			allowed, err := c.Check(r.Context(), entityType, entityID, permission, subjectID)
			if err != nil {
				log.Printf("[Permify] Check error (fail-open): %v", err)
			}
			if !allowed {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
