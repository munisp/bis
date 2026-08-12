package verify_test

import (
	"context"
	"testing"

	"bis/gateway/verify"
)

func TestNoConfiguredProviderReturnsUnavailableWithoutSyntheticData(t *testing.T) {
	engine := verify.New(verify.Config{})
	ctx := context.Background()

	nin := engine.LookupNIN(ctx, "99999999999")
	if nin.Source != "unavailable" || nin.Status != "UNAVAILABLE" || nin.Sandbox || nin.Error == "" {
		t.Fatalf("expected explicit unavailable NIN result, got %+v", nin)
	}
	if nin.FirstName != "" || nin.LastName != "" || nin.DOB != "" {
		t.Fatalf("unavailable NIN result must not contain synthetic identity data: %+v", nin)
	}

	bvn := engine.LookupBVN(ctx, "22999999999")
	if bvn.Source != "unavailable" || bvn.Status != "UNAVAILABLE" || bvn.Sandbox || bvn.Error == "" {
		t.Fatalf("expected explicit unavailable BVN result, got %+v", bvn)
	}
	if bvn.FirstName != "" || bvn.LastName != "" || bvn.BankName != "" {
		t.Fatalf("unavailable BVN result must not contain synthetic identity data: %+v", bvn)
	}

	cac := engine.LookupCAC(ctx, "RC999999")
	if cac.Source != "unavailable" || cac.Status != "UNAVAILABLE" || cac.Sandbox || cac.Error == "" {
		t.Fatalf("expected explicit unavailable CAC result, got %+v", cac)
	}
	if cac.CompanyName != "" || len(cac.Directors) != 0 {
		t.Fatalf("unavailable CAC result must not contain synthetic corporate data: %+v", cac)
	}

	sanctions := engine.CheckSanctions(ctx, "JOHN DOE")
	if sanctions.Source != "unavailable" || sanctions.Sandbox || sanctions.Error == "" {
		t.Fatalf("expected explicit unavailable sanctions result, got %+v", sanctions)
	}
	if sanctions.Clear {
		t.Fatalf("unavailable sanctions result must not be reported as clear: %+v", sanctions)
	}
}
