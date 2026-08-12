// mtls_test.go — Unit tests for MTLSMiddleware, isTrustedCert, and related helpers.
//
// Uses crypto/x509 to generate in-memory self-signed test certificates so no
// external fixtures or files are required.  All tests run with BIS_MTLS_DISABLED
// unset (i.e. mTLS enforcement enabled) unless explicitly testing the bypass path.

package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// ─── Test certificate helpers ─────────────────────────────────────────────────

// newSelfSignedCert generates a minimal self-signed ECDSA certificate with the
// given Common Name and optional DNS SANs.  Returns the parsed *x509.Certificate.
func newSelfSignedCert(t *testing.T, cn string, dnsNames []string) *x509.Certificate {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		DNSNames:     dnsNames,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	cert, err := x509.ParseCertificate(derBytes)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert
}

// newTLSStateWithCert builds a *tls.ConnectionState that presents the given
// certificate as the peer certificate, simulating a completed mTLS handshake.
func newTLSStateWithCert(cert *x509.Certificate) *tls.ConnectionState {
	return &tls.ConnectionState{
		PeerCertificates: []*x509.Certificate{cert},
	}
}

// newTestRequest creates an *http.Request with the given TLS state attached.
func newTestRequest(t *testing.T, tlsState *tls.ConnectionState) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.TLS = tlsState
	return req
}

// okHandler is a trivial http.Handler that returns 200 OK.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// ─── isTrustedCert tests ──────────────────────────────────────────────────────

func TestIsTrustedCert_TrustedCN(t *testing.T) {
	// Use the first entry in TrustedServiceCNs as the CN.
	if len(TrustedServiceCNs) == 0 {
		t.Skip("TrustedServiceCNs is empty")
	}
	cert := newSelfSignedCert(t, TrustedServiceCNs[0], nil)
	if !isTrustedCert(cert) {
		t.Errorf("expected trusted CN %q to be accepted", TrustedServiceCNs[0])
	}
}

func TestIsTrustedCert_UntrustedCN(t *testing.T) {
	cert := newSelfSignedCert(t, "attacker.evil.com", nil)
	if isTrustedCert(cert) {
		t.Error("expected untrusted CN to be rejected")
	}
}

func TestIsTrustedCert_TrustedSAN(t *testing.T) {
	if len(TrustedServiceCNs) == 0 {
		t.Skip("TrustedServiceCNs is empty")
	}
	// CN is irrelevant; the SAN matches a trusted service name.
	cert := newSelfSignedCert(t, "some-other-cn", []string{TrustedServiceCNs[0]})
	if !isTrustedCert(cert) {
		t.Errorf("expected trusted SAN %q to be accepted", TrustedServiceCNs[0])
	}
}

func TestIsTrustedCert_UntrustedSAN(t *testing.T) {
	cert := newSelfSignedCert(t, "some-cn", []string{"evil.example.com"})
	if isTrustedCert(cert) {
		t.Error("expected untrusted SAN to be rejected")
	}
}

func TestIsTrustedCert_EmptyCert(t *testing.T) {
	// A certificate with empty CN and no SANs should always be rejected.
	cert := newSelfSignedCert(t, "", nil)
	if isTrustedCert(cert) {
		t.Error("expected empty CN cert to be rejected")
	}
}

// ─── MTLSMiddleware tests ─────────────────────────────────────────────────────

func TestMTLSMiddleware_NoCert_Returns401(t *testing.T) {
	os.Unsetenv("BIS_MTLS_DISABLED")

	handler := MTLSMiddleware(okHandler)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ping", nil)
	// req.TLS is nil — no TLS at all.
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMTLSMiddleware_TLSNoPeerCert_Returns401(t *testing.T) {
	os.Unsetenv("BIS_MTLS_DISABLED")

	handler := MTLSMiddleware(okHandler)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ping", nil)
	req.TLS = &tls.ConnectionState{} // TLS present but no peer cert
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestMTLSMiddleware_UntrustedCert_Returns403(t *testing.T) {
	os.Unsetenv("BIS_MTLS_DISABLED")

	cert := newSelfSignedCert(t, "untrusted.service", nil)
	handler := MTLSMiddleware(okHandler)
	req := newTestRequest(t, newTLSStateWithCert(cert))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

func TestMTLSMiddleware_TrustedCert_Returns200(t *testing.T) {
	if len(TrustedServiceCNs) == 0 {
		t.Skip("TrustedServiceCNs is empty")
	}
	os.Unsetenv("BIS_MTLS_DISABLED")

	cert := newSelfSignedCert(t, TrustedServiceCNs[0], nil)
	handler := MTLSMiddleware(okHandler)
	req := newTestRequest(t, newTLSStateWithCert(cert))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestMTLSMiddleware_Disabled_PassesThrough(t *testing.T) {
	t.Setenv("BIS_MTLS_DISABLED", "true")

	handler := MTLSMiddleware(okHandler)
	// No TLS at all — should pass through when disabled.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ping", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 (bypass), got %d", rr.Code)
	}
}

func TestMTLSMiddleware_TrustedSAN_Returns200(t *testing.T) {
	if len(TrustedServiceCNs) == 0 {
		t.Skip("TrustedServiceCNs is empty")
	}
	os.Unsetenv("BIS_MTLS_DISABLED")

	// CN is untrusted but SAN matches.
	cert := newSelfSignedCert(t, "irrelevant-cn", []string{TrustedServiceCNs[0]})
	handler := MTLSMiddleware(okHandler)
	req := newTestRequest(t, newTLSStateWithCert(cert))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 (trusted SAN), got %d", rr.Code)
	}
}

// ─── CA bundle loading tests ──────────────────────────────────────────────────

func TestBuildMTLSConfig_ValidCA(t *testing.T) {
	// Generate a self-signed CA cert and write it to a temp file.
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &priv.PublicKey, priv)
	if err != nil {
		t.Fatal(err)
	}

	tmp, err := os.CreateTemp("", "test-ca-*.pem")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmp.Name())

	if err := pem.Encode(tmp, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		t.Fatal(err)
	}
	tmp.Close()

	cfg, err := BuildMTLSConfig(tmp.Name())
	if err != nil {
		t.Fatalf("BuildMTLSConfig: %v", err)
	}
	if cfg.ClientAuth != tls.RequireAndVerifyClientCert {
		t.Error("expected RequireAndVerifyClientCert")
	}
	if cfg.MinVersion != tls.VersionTLS13 {
		t.Error("expected TLS 1.3 minimum")
	}
}

func TestBuildMTLSConfig_MissingFile(t *testing.T) {
	_, err := BuildMTLSConfig("/nonexistent/path/ca.pem")
	if err == nil {
		t.Error("expected error for missing CA file")
	}
}

func TestBuildMTLSConfig_EmptyFile(t *testing.T) {
	tmp, err := os.CreateTemp("", "empty-ca-*.pem")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmp.Name())
	tmp.Close()

	_, err = BuildMTLSConfig(tmp.Name())
	if err == nil {
		t.Error("expected error for empty CA file")
	}
}
