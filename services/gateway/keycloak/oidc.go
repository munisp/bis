package keycloak

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Claims represents the JWT claims from Keycloak.
type Claims struct {
	Sub               string   `json:"sub"`
	Email             string   `json:"email"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
	Roles             []string `json:"roles"`
	RealmRoles        []string `json:"realm_access_roles"`
}

var (
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauthCfg *oauth2.Config
)

// Init initialises the Keycloak OIDC provider. Call once at startup.
// Falls back gracefully if KEYCLOAK_URL is not set (dev mode).
func Init() {
	keycloakURL := os.Getenv("KEYCLOAK_URL")
	realm := os.Getenv("KEYCLOAK_REALM")
	clientID := os.Getenv("KEYCLOAK_CLIENT_ID")
	clientSecret := os.Getenv("KEYCLOAK_CLIENT_SECRET")

	if keycloakURL == "" || realm == "" {
		log.Println("[Keycloak] KEYCLOAK_URL or KEYCLOAK_REALM not set — OIDC middleware disabled (dev mode)")
		return
	}

	issuerURL := fmt.Sprintf("%s/realms/%s", keycloakURL, realm)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var err error
	provider, err = oidc.NewProvider(ctx, issuerURL)
	if err != nil {
		log.Printf("[Keycloak] Failed to discover OIDC provider at %s: %v — continuing without OIDC", issuerURL, err)
		provider = nil
		return
	}

	verifier = provider.Verifier(&oidc.Config{ClientID: clientID})
	oauthCfg = &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email", "roles"},
	}
	log.Printf("[Keycloak] OIDC provider ready → %s", issuerURL)
}

// VerifyToken validates a Bearer token from the Authorization header.
// Returns (claims, nil) on success, or (nil, error) on failure.
func VerifyToken(ctx context.Context, rawToken string) (*Claims, error) {
	if verifier == nil {
		// Dev mode: accept any token prefixed "dev-" and return mock claims
		if strings.HasPrefix(rawToken, "dev-") {
			return &Claims{Sub: "dev-user", Email: "dev@bis.ng", Name: "Dev User", Roles: []string{"analyst"}}, nil
		}
		return nil, fmt.Errorf("OIDC verifier not initialised")
	}
	idToken, err := verifier.Verify(ctx, rawToken)
	if err != nil {
		return nil, fmt.Errorf("token verification failed: %w", err)
	}
	var claims Claims
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("claims extraction failed: %w", err)
	}
	return &claims, nil
}

// Middleware is an http.Handler middleware that validates the Bearer token.
// On success it injects X-BIS-User-Sub and X-BIS-User-Email headers.
// On failure it returns 401 JSON.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow health checks through without auth
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		// Internal service key bypass (for service-to-service calls)
		if r.Header.Get("X-BIS-Key") == os.Getenv("BIS_GATEWAY_KEY") {
			next.ServeHTTP(w, r)
			return
		}
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing bearer token"})
			return
		}
		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := VerifyToken(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		r.Header.Set("X-BIS-User-Sub", claims.Sub)
		r.Header.Set("X-BIS-User-Email", claims.Email)
		r.Header.Set("X-BIS-User-Name", claims.Name)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// ─── Struct wrapper for dependency injection ──────────────────────────────────

// OIDCClient is a thin wrapper around the package-level Keycloak functions.
type OIDCClient struct{}

// NewOIDCClient initialises the Keycloak OIDC provider and returns an OIDCClient.
func NewOIDCClient(keycloakURL, realm, clientID string) (*OIDCClient, error) {
	if keycloakURL != "" {
		os.Setenv("KEYCLOAK_URL", keycloakURL)
	}
	if realm != "" {
		os.Setenv("KEYCLOAK_REALM", realm)
	}
	if clientID != "" {
		os.Setenv("KEYCLOAK_CLIENT_ID", clientID)
	}
	Init()
	return &OIDCClient{}, nil
}

// ValidateToken validates a Bearer token.
func (c *OIDCClient) ValidateToken(ctx context.Context, rawToken string) error {
	_, err := VerifyToken(ctx, rawToken)
	return err
}
