package permify

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestCheckFailsClosedWhenUnconfigured(t *testing.T) {
	client := NewWithHTTPClient("", "tenant", "key", &http.Client{})
	allowed, err := client.Check(context.Background(), "case", "case-1", "read", "user-1")
	if allowed {
		t.Fatal("unconfigured client granted access")
	}
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
}

func TestCheckRequiresExplicitAllowedDecision(t *testing.T) {
	tests := []struct {
		name         string
		status       int
		body         string
		wantAllowed  bool
		wantErr      error
		wantAnyError bool
	}{
		{name: "allows explicit decision", status: http.StatusOK, body: `{"can":"RESULT_ALLOWED"}`, wantAllowed: true},
		{name: "denies explicit decision", status: http.StatusOK, body: `{"can":"RESULT_DENIED"}`, wantErr: ErrDenied},
		{name: "rejects unknown decision", status: http.StatusOK, body: `{"can":"RESULT_CONDITIONAL"}`, wantErr: ErrUnavailable},
		{name: "rejects malformed result", status: http.StatusOK, body: `{`, wantErr: ErrUnavailable},
		{name: "rejects provider failure", status: http.StatusServiceUnavailable, body: `{}`, wantErr: ErrUnavailable},
		{name: "rejects policy request error", status: http.StatusBadRequest, body: `{}`, wantAnyError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer api-key" {
					t.Fatalf("authorization header = %q", got)
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			allowed, err := NewWithHTTPClient(server.URL, "tenant-a", "api-key", server.Client()).Check(context.Background(), "case", "case-1", "read", "user-1")
			if allowed != tt.wantAllowed {
				t.Fatalf("allowed = %v, want %v (err = %v)", allowed, tt.wantAllowed, err)
			}
			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantAnyError && err == nil {
				t.Fatal("policy request error must not be silently allowed")
			}
			if !tt.wantAnyError && tt.wantErr == nil && err != nil {
				t.Fatalf("error = %v, want nil", err)
			}
		})
	}
}

func TestMiddlewareNeverReachesHandlerOnAuthorizationFailure(t *testing.T) {
	var reached atomic.Bool
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Store(true) })

	t.Run("missing user identity", func(t *testing.T) {
		reached.Store(false)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/cases/case-1", nil)
		NewWithHTTPClient("", "", "", nil).Middleware("case", "read", func(*http.Request) string { return "case-1" })(next).ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized || reached.Load() {
			t.Fatalf("status = %d, reached = %v; want 401 and false", rr.Code, reached.Load())
		}
	})

	t.Run("unavailable policy service", func(t *testing.T) {
		reached.Store(false)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/cases/case-1", nil)
		req.Header.Set("X-BIS-User-ID", "user-1")
		NewWithHTTPClient("", "", "", nil).Middleware("case", "read", func(*http.Request) string { return "case-1" })(next).ServeHTTP(rr, req)
		if rr.Code != http.StatusServiceUnavailable || reached.Load() {
			t.Fatalf("status = %d, reached = %v; want 503 and false", rr.Code, reached.Load())
		}
	})
}
