package verify_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"bis/gateway/verify"
)

// ─── Sandbox tests ────────────────────────────────────────────────────────────

func TestSandboxNIN_Deterministic(t *testing.T) {
	r1 := verify.SandboxNIN("12345678901")
	r2 := verify.SandboxNIN("12345678901")
	if r1.FirstName != r2.FirstName || r1.LastName != r2.LastName {
		t.Errorf("SandboxNIN should be deterministic: got %+v vs %+v", r1, r2)
	}
	if !r1.Sandbox {
		t.Error("SandboxNIN should set Sandbox=true")
	}
	if r1.Source != "sandbox" {
		t.Errorf("expected source=sandbox, got %s", r1.Source)
	}
	if len(r1.NIN) != 11 {
		t.Errorf("NIN should be 11 chars, got %d", len(r1.NIN))
	}
	if r1.Status != "VERIFIED" {
		t.Errorf("expected VERIFIED, got %s", r1.Status)
	}
}

func TestSandboxNIN_Unique(t *testing.T) {
	r1 := verify.SandboxNIN("11111111111")
	r2 := verify.SandboxNIN("22222222222")
	if r1.FirstName == r2.FirstName && r1.LastName == r2.LastName && r1.DOB == r2.DOB {
		t.Error("different NINs should produce different results")
	}
}

func TestSandboxBVN_Deterministic(t *testing.T) {
	r1 := verify.SandboxBVN("22345678901")
	r2 := verify.SandboxBVN("22345678901")
	if r1.BankName != r2.BankName {
		t.Errorf("SandboxBVN should be deterministic")
	}
	if !r1.Sandbox {
		t.Error("SandboxBVN should set Sandbox=true")
	}
	if r1.Source != "sandbox" {
		t.Errorf("expected source=sandbox, got %s", r1.Source)
	}
}

func TestSandboxCAC_Deterministic(t *testing.T) {
	r1 := verify.SandboxCAC("RC123456")
	r2 := verify.SandboxCAC("RC123456")
	if r1.CompanyName != r2.CompanyName {
		t.Errorf("SandboxCAC should be deterministic")
	}
	if !r1.Sandbox {
		t.Error("SandboxCAC should set Sandbox=true")
	}
	if len(r1.Directors) == 0 {
		t.Error("SandboxCAC should have at least one director")
	}
}

func TestSandboxSanctions_Clear(t *testing.T) {
	// Most names should be clear (~95%)
	clearCount := 0
	names := []string{"JOHN DOE", "ALICE SMITH", "BOB JONES", "MARY WILLIAMS", "JAMES BROWN",
		"PATRICIA DAVIS", "MICHAEL MILLER", "LINDA WILSON", "WILLIAM MOORE", "BARBARA TAYLOR",
		"DAVID ANDERSON", "ELIZABETH THOMAS", "RICHARD JACKSON", "SUSAN WHITE", "JOSEPH HARRIS",
		"JESSICA MARTIN", "THOMAS THOMPSON", "SARAH GARCIA", "CHARLES MARTINEZ", "KAREN ROBINSON"}
	for _, n := range names {
		r := verify.SandboxSanctions(n)
		if r.Clear {
			clearCount++
		}
		if r.Source != "sandbox" {
			t.Errorf("expected source=sandbox, got %s", r.Source)
		}
	}
	// At least 70% should be clear (5% hit rate, but small sample)
	if clearCount < 14 {
		t.Errorf("expected at least 14/20 clear, got %d", clearCount)
	}
}

// ─── Own engine tests (mock HTTP server) ─────────────────────────────────────

func TestOwnEngineNIN_Success(t *testing.T) {
	expected := verify.NINResult{
		NIN:       "12345678901",
		FirstName: "EMEKA",
		LastName:  "OKAFOR",
		DOB:       "1985-03-15",
		Gender:    "MALE",
		Phone:     "08012345678",
		Address:   "10 Marina Street",
		State:     "Lagos",
		Status:    "VERIFIED",
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/verify" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(expected)
	}))
	defer srv.Close()

	cfg := verify.Config{
		NIMCUrl: srv.URL,
		NIMCKey: "test-key",
	}
	engine := verify.New(cfg)
	result := engine.LookupNIN(context.Background(), "12345678901")

	if result.Source != "own" {
		t.Errorf("expected source=own, got %s", result.Source)
	}
	if result.FirstName != expected.FirstName {
		t.Errorf("expected FirstName=%s, got %s", expected.FirstName, result.FirstName)
	}
	if result.Sandbox {
		t.Error("own engine result should not be sandbox")
	}
}

func TestOwnEngineNIN_FallsBackToYouverify(t *testing.T) {
	// Own engine returns 500
	ownSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer ownSrv.Close()

	// Youverify returns success
	youverifySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"requestID": "test-123",
			"data": map[string]any{
				"firstName":     "NGOZI",
				"lastName":      "IBRAHIM",
				"dateOfBirth":   "1990-06-20",
				"gender":        "FEMALE",
				"mobile":        "07012345678",
				"address":       "5 Victoria Island",
				"stateOfOrigin": "Rivers",
			},
		})
	}))
	defer youverifySrv.Close()

	cfg := verify.Config{
		NIMCUrl:          ownSrv.URL,
		NIMCKey:          "test-key",
		YouverifyBaseURL: youverifySrv.URL,
		YouverifyAPIKey:  "yv-test-key",
	}
	engine := verify.New(cfg)
	result := engine.LookupNIN(context.Background(), "12345678901")

	if result.Source != "youverify" {
		t.Errorf("expected source=youverify after own engine failure, got %s", result.Source)
	}
	if result.FirstName != "NGOZI" {
		t.Errorf("expected FirstName=NGOZI, got %s", result.FirstName)
	}
}

func TestOwnEngineNIN_FallsBackToSandbox(t *testing.T) {
	// Both own engine and youverify fail
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer failSrv.Close()

	cfg := verify.Config{
		NIMCUrl:          failSrv.URL,
		NIMCKey:          "test-key",
		YouverifyBaseURL: failSrv.URL,
		YouverifyAPIKey:  "yv-test-key",
	}
	engine := verify.New(cfg)
	result := engine.LookupNIN(context.Background(), "12345678901")

	if result.Source != "sandbox" {
		t.Errorf("expected source=sandbox after all failures, got %s", result.Source)
	}
	if !result.Sandbox {
		t.Error("final fallback should set Sandbox=true")
	}
}

func TestNoConfigFallsToSandbox(t *testing.T) {
	// No credentials configured at all
	engine := verify.New(verify.Config{})
	nin := engine.LookupNIN(context.Background(), "99999999999")
	if nin.Source != "sandbox" {
		t.Errorf("expected sandbox, got %s", nin.Source)
	}
	bvn := engine.LookupBVN(context.Background(), "22999999999")
	if bvn.Source != "sandbox" {
		t.Errorf("expected sandbox, got %s", bvn.Source)
	}
	cac := engine.LookupCAC(context.Background(), "RC999999")
	if cac.Source != "sandbox" {
		t.Errorf("expected sandbox, got %s", cac.Source)
	}
	sanctions := engine.CheckSanctions(context.Background(), "JOHN DOE")
	if sanctions.Source != "sandbox" {
		t.Errorf("expected sandbox, got %s", sanctions.Source)
	}
}

func TestYouverifyOnlyConfig(t *testing.T) {
	// Only Youverify configured (no own engine)
	youverifySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "bvn") {
			json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"firstName":     "TUNDE",
					"lastName":      "ADEYEMI",
					"dateOfBirth":   "1988-11-10",
					"gender":        "MALE",
					"phoneNumber1":  "08098765432",
					"enrollmentBank": "GTBank",
				},
			})
		} else {
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer youverifySrv.Close()

	cfg := verify.Config{
		YouverifyBaseURL: youverifySrv.URL,
		YouverifyAPIKey:  "yv-test-key",
	}
	engine := verify.New(cfg)
	result := engine.LookupBVN(context.Background(), "22345678901")

	if result.Source != "youverify" {
		t.Errorf("expected source=youverify, got %s", result.Source)
	}
	if result.FirstName != "TUNDE" {
		t.Errorf("expected FirstName=TUNDE, got %s", result.FirstName)
	}
}
