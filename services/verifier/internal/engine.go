// Package internal provides the verification engine for the BIS Verifier service.
// It implements a priority chain: BIS own engine → Youverify fallback → Sandbox mock.
package internal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	NIMCUrl          string
	NIMCKey          string
	NIBSSUrl         string
	NIBSSKey         string
	CACUrl           string
	CACKey           string
	OFACUrl          string
	OFACKey          string
	YouverifyBaseURL string
	YouverifyAPIKey  string
	SandboxMode      bool
}

func ConfigFromEnv() Config {
	return Config{
		NIMCUrl:  os.Getenv("BIS_VERIFY_NIMC_URL"),
		NIMCKey:  os.Getenv("BIS_VERIFY_NIMC_KEY"),
		NIBSSUrl: os.Getenv("BIS_VERIFY_NIBSS_URL"),
		NIBSSKey: os.Getenv("BIS_VERIFY_NIBSS_KEY"),
		CACUrl:   os.Getenv("BIS_VERIFY_CAC_URL"),
		CACKey:   os.Getenv("BIS_VERIFY_CAC_KEY"),
		OFACUrl:  os.Getenv("BIS_VERIFY_OFAC_URL"),
		OFACKey:  os.Getenv("BIS_VERIFY_OFAC_KEY"),
		YouverifyBaseURL: func() string {
			if v := os.Getenv("YOUVERIFY_BASE_URL"); v != "" {
				return v
			}
			return "https://api.youverify.co/v2"
		}(),
		YouverifyAPIKey: os.Getenv("YOUVERIFY_API_KEY"),
		SandboxMode:     os.Getenv("GATEWAY_SANDBOX") == "true",
	}
}

// ─── Result Types ─────────────────────────────────────────────────────────────

type NINResult struct {
	NIN        string `json:"nin"`
	FirstName  string `json:"firstName"`
	LastName   string `json:"lastName"`
	MiddleName string `json:"middleName,omitempty"`
	DOB        string `json:"dob"`
	Gender     string `json:"gender"`
	Phone      string `json:"phone"`
	Address    string `json:"address"`
	State      string `json:"state"`
	Photo      string `json:"photo,omitempty"`
	Source     string `json:"source"`
	Sandbox    bool   `json:"sandbox"`
}

type BVNResult struct {
	BVN       string `json:"bvn"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	DOB       string `json:"dob"`
	Phone     string `json:"phone"`
	Gender    string `json:"gender"`
	Banks     []string `json:"banks,omitempty"`
	Source    string `json:"source"`
	Sandbox   bool   `json:"sandbox"`
}

type CACResult struct {
	RC          string `json:"rc"`
	CompanyName string `json:"companyName"`
	Status      string `json:"status"`
	Type        string `json:"type"`
	Address     string `json:"address"`
	State       string `json:"state"`
	DateReg     string `json:"dateRegistered"`
	Directors   []string `json:"directors,omitempty"`
	Source      string `json:"source"`
	Sandbox     bool   `json:"sandbox"`
}

type SanctionsHit struct {
	ListName    string   `json:"listName"`
	EntityName  string   `json:"entityName"`
	Score       float64  `json:"score"`
	Aliases     []string `json:"aliases,omitempty"`
	DateOfBirth string   `json:"dateOfBirth,omitempty"`
	Nationality string   `json:"nationality,omitempty"`
	Reason      string   `json:"reason,omitempty"`
}

type SanctionsResult struct {
	Name    string         `json:"name"`
	Hits    []SanctionsHit `json:"hits"`
	Clear   bool           `json:"clear"`
	Source  string         `json:"source"`
	Sandbox bool           `json:"sandbox"`
}

// ─── Engine ───────────────────────────────────────────────────────────────────

type Engine struct {
	cfg    Config
	client *http.Client
}

func NewEngine(cfg Config) *Engine {
	return &Engine{
		cfg: cfg,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

func (e *Engine) post(ctx context.Context, url, apiKey string, body, result any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("X-BIS-Client", "verifier/1.0")

	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return json.Unmarshal(raw, result)
}

// ─── NIN Lookup ───────────────────────────────────────────────────────────────

func (e *Engine) LookupNIN(ctx context.Context, nin string) (*NINResult, error) {
	if e.cfg.SandboxMode || e.cfg.NIMCUrl == "" {
		return e.sandboxNIN(nin), nil
	}
	// Try BIS own engine first
	var raw map[string]any
	err := e.post(ctx, e.cfg.NIMCUrl+"/verify", e.cfg.NIMCKey, map[string]string{"nin": nin}, &raw)
	if err == nil {
		return mapToNINResult(raw, "nimc-direct"), nil
	}
	log.Printf("[verifier] NIMC direct failed: %v — trying Youverify", err)

	// Youverify fallback
	if e.cfg.YouverifyAPIKey != "" {
		var yvResp map[string]any
		err2 := e.post(ctx, e.cfg.YouverifyBaseURL+"/identity/ng/nin", e.cfg.YouverifyAPIKey,
			map[string]string{"id": nin, "isSubjectConsent": "true"}, &yvResp)
		if err2 == nil {
			return mapToNINResult(yvResp, "youverify"), nil
		}
		log.Printf("[verifier] Youverify NIN failed: %v — using sandbox", err2)
	}
	return e.sandboxNIN(nin), nil
}

func mapToNINResult(raw map[string]any, source string) *NINResult {
	str := func(k string) string {
		if v, ok := raw[k]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	return &NINResult{
		NIN:       str("nin"),
		FirstName: str("firstName"),
		LastName:  str("lastName"),
		DOB:       str("dateOfBirth"),
		Gender:    str("gender"),
		Phone:     str("phone"),
		Address:   str("address"),
		State:     str("state"),
		Source:    source,
		Sandbox:   false,
	}
}

func (e *Engine) sandboxNIN(nin string) *NINResult {
	firstNames := []string{"Adebayo", "Chukwuemeka", "Fatima", "Ngozi", "Olumide", "Aisha", "Emeka", "Yewande"}
	lastNames := []string{"Okafor", "Adeyemi", "Ibrahim", "Nwosu", "Adeleke", "Bello", "Okonkwo", "Abubakar"}
	states := []string{"Lagos", "Abuja", "Kano", "Rivers", "Ogun", "Oyo", "Enugu", "Kaduna"}
	r := rand.New(rand.NewSource(int64(len(nin))))
	return &NINResult{
		NIN:       nin,
		FirstName: firstNames[r.Intn(len(firstNames))],
		LastName:  lastNames[r.Intn(len(lastNames))],
		DOB:       fmt.Sprintf("19%02d-%02d-%02d", 70+r.Intn(30), 1+r.Intn(12), 1+r.Intn(28)),
		Gender:    []string{"Male", "Female"}[r.Intn(2)],
		Phone:     fmt.Sprintf("0%d%08d", 7+r.Intn(3), r.Intn(100000000)),
		Address:   fmt.Sprintf("%d %s Street, %s", 1+r.Intn(200), lastNames[r.Intn(len(lastNames))], states[r.Intn(len(states))]),
		State:     states[r.Intn(len(states))],
		Source:    "sandbox",
		Sandbox:   true,
	}
}

// ─── BVN Lookup ───────────────────────────────────────────────────────────────

func (e *Engine) LookupBVN(ctx context.Context, bvn string) (*BVNResult, error) {
	if e.cfg.SandboxMode || e.cfg.NIBSSUrl == "" {
		return e.sandboxBVN(bvn), nil
	}
	var raw map[string]any
	err := e.post(ctx, e.cfg.NIBSSUrl+"/verify", e.cfg.NIBSSKey, map[string]string{"bvn": bvn}, &raw)
	if err == nil {
		return mapToBVNResult(raw, "nibss-direct"), nil
	}
	log.Printf("[verifier] NIBSS direct failed: %v — trying Youverify", err)

	if e.cfg.YouverifyAPIKey != "" {
		var yvResp map[string]any
		err2 := e.post(ctx, e.cfg.YouverifyBaseURL+"/identity/ng/bvn", e.cfg.YouverifyAPIKey,
			map[string]string{"id": bvn, "isSubjectConsent": "true"}, &yvResp)
		if err2 == nil {
			return mapToBVNResult(yvResp, "youverify"), nil
		}
		log.Printf("[verifier] Youverify BVN failed: %v — using sandbox", err2)
	}
	return e.sandboxBVN(bvn), nil
}

func mapToBVNResult(raw map[string]any, source string) *BVNResult {
	str := func(k string) string {
		if v, ok := raw[k]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	return &BVNResult{
		BVN:       str("bvn"),
		FirstName: str("firstName"),
		LastName:  str("lastName"),
		DOB:       str("dateOfBirth"),
		Phone:     str("phone"),
		Gender:    str("gender"),
		Source:    source,
		Sandbox:   false,
	}
}

func (e *Engine) sandboxBVN(bvn string) *BVNResult {
	firstNames := []string{"Adebayo", "Chukwuemeka", "Fatima", "Ngozi", "Olumide"}
	lastNames := []string{"Okafor", "Adeyemi", "Ibrahim", "Nwosu", "Adeleke"}
	banks := []string{"Access Bank", "GTBank", "Zenith Bank", "First Bank", "UBA"}
	r := rand.New(rand.NewSource(int64(len(bvn))))
	return &BVNResult{
		BVN:       bvn,
		FirstName: firstNames[r.Intn(len(firstNames))],
		LastName:  lastNames[r.Intn(len(lastNames))],
		DOB:       fmt.Sprintf("19%02d-%02d-%02d", 70+r.Intn(30), 1+r.Intn(12), 1+r.Intn(28)),
		Phone:     fmt.Sprintf("0%d%08d", 7+r.Intn(3), r.Intn(100000000)),
		Gender:    []string{"Male", "Female"}[r.Intn(2)],
		Banks:     []string{banks[r.Intn(len(banks))], banks[r.Intn(len(banks))]},
		Source:    "sandbox",
		Sandbox:   true,
	}
}

// ─── CAC Lookup ───────────────────────────────────────────────────────────────

func (e *Engine) LookupCAC(ctx context.Context, rc string) (*CACResult, error) {
	if e.cfg.SandboxMode || e.cfg.CACUrl == "" {
		return e.sandboxCAC(rc), nil
	}
	var raw map[string]any
	err := e.post(ctx, e.cfg.CACUrl+"/company", e.cfg.CACKey, map[string]string{"rc": rc}, &raw)
	if err == nil {
		return mapToCACResult(raw, "cac-direct"), nil
	}
	log.Printf("[verifier] CAC direct failed: %v — trying Youverify", err)

	if e.cfg.YouverifyAPIKey != "" {
		var yvResp map[string]any
		err2 := e.post(ctx, e.cfg.YouverifyBaseURL+"/identity/ng/cac", e.cfg.YouverifyAPIKey,
			map[string]string{"id": rc, "isSubjectConsent": "true"}, &yvResp)
		if err2 == nil {
			return mapToCACResult(yvResp, "youverify"), nil
		}
		log.Printf("[verifier] Youverify CAC failed: %v — using sandbox", err2)
	}
	return e.sandboxCAC(rc), nil
}

func mapToCACResult(raw map[string]any, source string) *CACResult {
	str := func(k string) string {
		if v, ok := raw[k]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	return &CACResult{
		RC:          str("rc"),
		CompanyName: str("companyName"),
		Status:      str("status"),
		Type:        str("type"),
		Address:     str("address"),
		State:       str("state"),
		DateReg:     str("dateRegistered"),
		Source:      source,
		Sandbox:     false,
	}
}

func (e *Engine) sandboxCAC(rc string) *CACResult {
	companies := []string{"Okafor & Sons Ltd", "Adeyemi Ventures", "Ibrahim Holdings", "Nwosu Enterprises", "Adeleke Group"}
	states := []string{"Lagos", "Abuja", "Kano", "Rivers", "Ogun"}
	types := []string{"Private Limited Company", "Public Limited Company", "Business Name", "Incorporated Trustee"}
	r := rand.New(rand.NewSource(int64(len(rc))))
	return &CACResult{
		RC:          rc,
		CompanyName: companies[r.Intn(len(companies))],
		Status:      "Active",
		Type:        types[r.Intn(len(types))],
		Address:     fmt.Sprintf("%d Victoria Island, %s", 1+r.Intn(200), states[r.Intn(len(states))]),
		State:       states[r.Intn(len(states))],
		DateReg:     fmt.Sprintf("20%02d-%02d-%02d", r.Intn(24), 1+r.Intn(12), 1+r.Intn(28)),
		Directors:   []string{"Director A", "Director B"},
		Source:      "sandbox",
		Sandbox:     true,
	}
}

// ─── Sanctions Check ──────────────────────────────────────────────────────────

func (e *Engine) CheckSanctions(ctx context.Context, name, dob, nationality string) (*SanctionsResult, error) {
	if e.cfg.SandboxMode || e.cfg.OFACUrl == "" {
		return e.sandboxSanctions(name), nil
	}
	var raw map[string]any
	err := e.post(ctx, e.cfg.OFACUrl+"/search", e.cfg.OFACKey, map[string]string{
		"name": name, "dateOfBirth": dob, "nationality": nationality,
	}, &raw)
	if err == nil {
		return mapToSanctionsResult(raw, name, "ofac-direct"), nil
	}
	log.Printf("[verifier] OFAC direct failed: %v — using sandbox", err)
	return e.sandboxSanctions(name), nil
}

func mapToSanctionsResult(raw map[string]any, name, source string) *SanctionsResult {
	result := &SanctionsResult{Name: name, Source: source, Sandbox: false}
	if hits, ok := raw["hits"].([]any); ok {
		for _, h := range hits {
			if hm, ok := h.(map[string]any); ok {
				hit := SanctionsHit{
					ListName:   fmt.Sprintf("%v", hm["listName"]),
					EntityName: fmt.Sprintf("%v", hm["entityName"]),
				}
				if s, ok := hm["score"].(float64); ok {
					hit.Score = s
				}
				result.Hits = append(result.Hits, hit)
			}
		}
	}
	result.Clear = len(result.Hits) == 0
	return result
}

func (e *Engine) sandboxSanctions(name string) *SanctionsResult {
	// Deterministic: names containing "SANCTIONED" trigger a hit for demo purposes
	if strings.Contains(strings.ToUpper(name), "SANCTIONED") {
		return &SanctionsResult{
			Name: name,
			Hits: []SanctionsHit{
				{
					ListName:   "OFAC SDN",
					EntityName: name,
					Score:      0.95,
					Reason:     "Terrorism financing (sandbox demo)",
				},
			},
			Clear:   false,
			Source:  "sandbox",
			Sandbox: true,
		}
	}
	return &SanctionsResult{
		Name:    name,
		Hits:    []SanctionsHit{},
		Clear:   true,
		Source:  "sandbox",
		Sandbox: true,
	}
}
