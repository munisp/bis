package caddy_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"

	"github.com/munisp/bis/services/gateway/internal/caddy"
)

// mockCaddyServer creates a test HTTP server simulating the Caddy Admin API.
func mockCaddyServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	// GET /config/ — returns current config
	mux.HandleFunc("/config/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"apps": map[string]interface{}{
					"http": map[string]interface{}{
						"servers": map[string]interface{}{},
					},
				},
			})
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	// POST /load — loads new config
	mux.HandleFunc("/load", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	// POST /config/apps/http/servers/internal/routes/... — adds route
	mux.HandleFunc("/config/apps/http/servers/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	// DELETE /id/{routeID} — deletes route
	mux.HandleFunc("/id/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	// PATCH /config/apps/http/servers/public/rate_limits/{zone} — updates rate limit
	mux.HandleFunc("/config/apps/http/servers/public/rate_limits/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPatch {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	// GET /pki/ca/local/certificates — returns cert list
	mux.HandleFunc("/pki/ca/local/certificates", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{
			{
				"domain":     "bis.localhost",
				"not_before": "2025-01-01T00:00:00Z",
				"not_after":  "2026-01-01T00:00:00Z",
				"issuer":     "BIS Internal CA",
				"is_managed": true,
			},
		})
	})

	return httptest.NewServer(mux)
}

func TestHealth(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	health, err := client.Health(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "ok", health.Status)
}

func TestGetConfig(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	config, err := client.GetConfig(context.Background())
	require.NoError(t, err)
	assert.NotNil(t, config)
	assert.Contains(t, config, "apps")
}

func TestLoadConfig(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	err := client.LoadConfig(context.Background(), map[string]interface{}{
		"apps": map[string]interface{}{},
	})
	require.NoError(t, err)
}

func TestAddRoute(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	route := caddy.Route{
		ID: "test-route",
		Match: []caddy.RouteMatch{
			{Path: []string{"/test/*"}},
		},
		Handle: []caddy.RouteHandle{
			{Handler: "reverse_proxy"},
		},
	}
	err := client.AddRoute(context.Background(), "internal", route)
	require.NoError(t, err)
}

func TestDeleteRoute(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	err := client.DeleteRoute(context.Background(), "test-route-id")
	require.NoError(t, err)
}

func TestRegisterServiceRoute(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	err := client.RegisterServiceRoute(context.Background(), caddy.ServiceRoute{
		ServiceName:  "aml-engine",
		PathPrefix:   "/internal/aml-engine",
		UpstreamDial: "aml-engine:8095",
		RequireAuth:  true,
		RequireMTLS:  true,
	})
	require.NoError(t, err)
}

func TestUpdateRateLimit(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	err := client.UpdateRateLimit(context.Background(), caddy.RateLimitZone{
		Name:      "api_global",
		Key:       "{remote_host}",
		Window:    "1m",
		MaxEvents: 500, // tightened during incident
	})
	require.NoError(t, err)
}

func TestGetManagedCertificates(t *testing.T) {
	srv := mockCaddyServer(t)
	defer srv.Close()

	client := caddy.NewClient(srv.URL, zaptest.NewLogger(t))
	certs, err := client.GetManagedCertificates(context.Background())
	require.NoError(t, err)
	assert.Len(t, certs, 1)
	assert.Equal(t, "bis.localhost", certs[0].Domain)
}

func TestHealthUnreachable(t *testing.T) {
	// Test that Health returns an error when Caddy is unreachable
	client := caddy.NewClient("http://localhost:19999", zaptest.NewLogger(t))
	_, err := client.Health(context.Background())
	assert.Error(t, err)
}
