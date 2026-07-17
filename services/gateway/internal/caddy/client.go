// Package caddy provides a client for the Caddy Admin API.
// It enables the BIS gateway to dynamically update Caddy configuration,
// register new upstream routes, and monitor Caddy health — all without
// requiring a Caddy restart.
//
// Caddy Admin API reference: https://caddyserver.com/docs/api
package caddy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

// Client is a Caddy Admin API client.
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

// NewClient creates a new Caddy Admin API client.
func NewClient(adminURL string, logger *zap.Logger) *Client {
	return &Client{
		baseURL: adminURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

// ─── Health ──────────────────────────────────────────────────────────────────

// HealthResponse is the response from the Caddy Admin API health endpoint.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
}

// Health checks the Caddy Admin API health.
func (c *Client) Health(ctx context.Context) (*HealthResponse, error) {
	resp, err := c.get(ctx, "/config/")
	if err != nil {
		return nil, fmt.Errorf("caddy health check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return &HealthResponse{Status: "ok"}, nil
	}
	return &HealthResponse{Status: "degraded"}, nil
}

// ─── Config ───────────────────────────────────────────────────────────────────

// GetConfig retrieves the current Caddy configuration.
func (c *Client) GetConfig(ctx context.Context) (map[string]interface{}, error) {
	resp, err := c.get(ctx, "/config/")
	if err != nil {
		return nil, fmt.Errorf("caddy get config: %w", err)
	}
	defer resp.Body.Close()

	var config map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&config); err != nil {
		return nil, fmt.Errorf("caddy decode config: %w", err)
	}
	return config, nil
}

// LoadConfig replaces the entire Caddy configuration.
func (c *Client) LoadConfig(ctx context.Context, config map[string]interface{}) error {
	body, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("caddy marshal config: %w", err)
	}

	resp, err := c.post(ctx, "/load", body)
	if err != nil {
		return fmt.Errorf("caddy load config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy load config failed (status=%d): %s", resp.StatusCode, string(b))
	}

	c.logger.Info("caddy config loaded successfully")
	return nil
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Route represents a Caddy HTTP route.
type Route struct {
	ID      string        `json:"@id,omitempty"`
	Match   []RouteMatch  `json:"match,omitempty"`
	Handle  []RouteHandle `json:"handle,omitempty"`
	Group   string        `json:"group,omitempty"`
	Terminal bool         `json:"terminal,omitempty"`
}

// RouteMatch defines what requests a route matches.
type RouteMatch struct {
	Path   []string          `json:"path,omitempty"`
	Host   []string          `json:"host,omitempty"`
	Method []string          `json:"method,omitempty"`
	Header map[string]string `json:"header,omitempty"`
}

// RouteHandle defines how a route handles matched requests.
type RouteHandle struct {
	Handler  string      `json:"handler"`
	Upstream interface{} `json:"upstream,omitempty"`
	Routes   []Route     `json:"routes,omitempty"`
}

// ReverseProxyUpstream is an upstream for the reverse_proxy handler.
type ReverseProxyUpstream struct {
	Dial string `json:"dial"`
}

// AddRoute adds a new route to the Caddy server.
func (c *Client) AddRoute(ctx context.Context, serverName string, route Route) error {
	body, err := json.Marshal(route)
	if err != nil {
		return fmt.Errorf("caddy marshal route: %w", err)
	}

	path := fmt.Sprintf("/config/apps/http/servers/%s/routes/...", serverName)
	resp, err := c.post(ctx, path, body)
	if err != nil {
		return fmt.Errorf("caddy add route: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy add route failed (status=%d): %s", resp.StatusCode, string(b))
	}

	c.logger.Info("caddy route added", zap.String("server", serverName))
	return nil
}

// DeleteRoute removes a route from the Caddy server by its ID.
func (c *Client) DeleteRoute(ctx context.Context, routeID string) error {
	resp, err := c.delete(ctx, fmt.Sprintf("/id/%s", routeID))
	if err != nil {
		return fmt.Errorf("caddy delete route: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy delete route failed (status=%d): %s", resp.StatusCode, string(b))
	}

	c.logger.Info("caddy route deleted", zap.String("route_id", routeID))
	return nil
}

// ─── Upstream Registration ────────────────────────────────────────────────────

// ServiceRoute represents a BIS microservice route to register with Caddy.
type ServiceRoute struct {
	// ServiceName is the name of the microservice (e.g., "aml-engine")
	ServiceName string
	// PathPrefix is the URL path prefix to route (e.g., "/internal/aml-engine")
	PathPrefix string
	// UpstreamDial is the upstream address (e.g., "aml-engine:8095")
	UpstreamDial string
	// RequireAuth specifies whether Keycloak auth is required
	RequireAuth bool
	// RequireMTLS specifies whether mTLS client cert is required
	RequireMTLS bool
}

// RegisterServiceRoute registers a BIS microservice route with Caddy's internal
// mTLS server. This enables the service to be reachable via the internal mesh.
func (c *Client) RegisterServiceRoute(ctx context.Context, svc ServiceRoute) error {
	route := Route{
		ID: fmt.Sprintf("bis-internal-%s", svc.ServiceName),
		Match: []RouteMatch{
			{Path: []string{svc.PathPrefix + "/*"}},
		},
		Handle: []RouteHandle{
			{
				Handler: "subroute",
				Routes: []Route{
					{
						Handle: []RouteHandle{
							{
								Handler: "reverse_proxy",
								Upstream: map[string]interface{}{
									"upstreams": []map[string]string{
										{"dial": svc.UpstreamDial},
									},
									"headers": map[string]interface{}{
										"request": map[string]interface{}{
											"set": map[string][]string{
												"X-BIS-Internal":  {"true"},
												"X-BIS-Service":   {svc.ServiceName},
											},
										},
									},
									"transport": map[string]interface{}{
										"protocol":     "http",
										"dial_timeout": "5s",
									},
								},
							},
						},
					},
				},
			},
		},
	}

	return c.AddRoute(ctx, "internal", route)
}

// ─── Rate Limit Management ────────────────────────────────────────────────────

// RateLimitZone represents a Caddy rate limit zone configuration.
type RateLimitZone struct {
	Name      string
	Key       string
	Window    string
	MaxEvents int
}

// UpdateRateLimit dynamically updates a rate limit zone in Caddy.
// This enables the BIS platform to tighten rate limits during incidents.
func (c *Client) UpdateRateLimit(ctx context.Context, zone RateLimitZone) error {
	config := map[string]interface{}{
		"key":        zone.Key,
		"window":     zone.Window,
		"max_events": zone.MaxEvents,
	}

	body, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("caddy marshal rate limit: %w", err)
	}

	path := fmt.Sprintf("/config/apps/http/servers/public/rate_limits/%s", zone.Name)
	resp, err := c.patch(ctx, path, body)
	if err != nil {
		return fmt.Errorf("caddy update rate limit: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("caddy update rate limit failed (status=%d): %s", resp.StatusCode, string(b))
	}

	c.logger.Info("caddy rate limit updated",
		zap.String("zone", zone.Name),
		zap.Int("max_events", zone.MaxEvents),
		zap.String("window", zone.Window),
	)
	return nil
}

// ─── TLS Certificate Management ──────────────────────────────────────────────

// TLSCertInfo contains information about a managed TLS certificate.
type TLSCertInfo struct {
	Domain    string    `json:"domain"`
	NotBefore time.Time `json:"not_before"`
	NotAfter  time.Time `json:"not_after"`
	Issuer    string    `json:"issuer"`
	IsManaged bool      `json:"is_managed"`
}

// GetManagedCertificates returns information about all Caddy-managed TLS certs.
func (c *Client) GetManagedCertificates(ctx context.Context) ([]TLSCertInfo, error) {
	resp, err := c.get(ctx, "/pki/ca/local/certificates")
	if err != nil {
		return nil, fmt.Errorf("caddy get certs: %w", err)
	}
	defer resp.Body.Close()

	var certs []TLSCertInfo
	if err := json.NewDecoder(resp.Body).Decode(&certs); err != nil {
		// Not all Caddy builds expose this endpoint — return empty list
		c.logger.Warn("caddy cert list not available", zap.Error(err))
		return []TLSCertInfo{}, nil
	}
	return certs, nil
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

// MetricsResponse contains Caddy runtime metrics.
type MetricsResponse struct {
	ActiveConnections int64             `json:"active_connections"`
	TotalRequests     int64             `json:"total_requests"`
	Upstreams         map[string]string `json:"upstreams"`
}

// GetMetrics returns Caddy runtime metrics via the Admin API.
func (c *Client) GetMetrics(ctx context.Context) (*MetricsResponse, error) {
	resp, err := c.get(ctx, "/metrics")
	if err != nil {
		return nil, fmt.Errorf("caddy get metrics: %w", err)
	}
	defer resp.Body.Close()

	var metrics MetricsResponse
	if err := json.NewDecoder(resp.Body).Decode(&metrics); err != nil {
		return nil, fmt.Errorf("caddy decode metrics: %w", err)
	}
	return &metrics, nil
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func (c *Client) get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	return c.httpClient.Do(req)
}

func (c *Client) post(ctx context.Context, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path,
		bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return c.httpClient.Do(req)
}

func (c *Client) patch(ctx context.Context, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, c.baseURL+path,
		bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return c.httpClient.Do(req)
}

func (c *Client) delete(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	return c.httpClient.Do(req)
}
