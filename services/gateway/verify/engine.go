// Package verify provides BIS's own Nigerian identity verification engine.
//
// Priority chain for each verification type:
//   1. BIS Own Engine  — direct calls to NIMC/NIBSS/CAC/OFAC APIs with BIS credentials
//   2. Youverify       — aggregator fallback (https://youverify.co) when own engine fails or is unconfigured
//   3. Explicit unavailable result — no synthetic identity or screening data is returned
//
// Engine selection is controlled by environment variables:
//   BIS_VERIFY_NIMC_URL  / BIS_VERIFY_NIMC_KEY   — BIS own NIMC endpoint
//   BIS_VERIFY_NIBSS_URL / BIS_VERIFY_NIBSS_KEY   — BIS own NIBSS endpoint
//   BIS_VERIFY_CAC_URL   / BIS_VERIFY_CAC_KEY     — BIS own CAC endpoint
//   BIS_VERIFY_OFAC_URL  / BIS_VERIFY_OFAC_KEY    — BIS own OFAC/UN/EU endpoint
//   YOUVERIFY_BASE_URL   (default: https://api.youverify.co/v2)
//   YOUVERIFY_API_KEY    — Youverify API key (fallback)

package verify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	// BIS own engine credentials
	NIMCUrl  string
	NIMCKey  string
	NIBSSUrl string
	NIBSSKey string
	CACUrl   string
	CACKey   string
	OFACUrl  string
	OFACKey  string

	// Youverify fallback
	YouverifyBaseURL string
	YouverifyAPIKey  string
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
	}
}

// ─── Result types (mirrors gateway main.go types) ─────────────────────────────

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
	Status     string `json:"status"`
	Photo      string `json:"photo,omitempty"`
	CheckedAt  string `json:"checkedAt"`
	Source     string `json:"source"` // "own", "youverify", "unavailable"
	Sandbox    bool   `json:"sandbox,omitempty"`
	Error      string `json:"error,omitempty"`
}

type BVNResult struct {
	BVN           string `json:"bvn"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	MiddleName    string `json:"middleName,omitempty"`
	DOB           string `json:"dob"`
	Phone         string `json:"phone"`
	Gender        string `json:"gender"`
	BankName      string `json:"bankName"`
	AccountNumber string `json:"accountNumber"`
	Status        string `json:"status"`
	CheckedAt     string `json:"checkedAt"`
	Source        string `json:"source"`
	Sandbox       bool   `json:"sandbox,omitempty"`
	Error         string `json:"error,omitempty"`
}

type CACResult struct {
	RCNumber      string   `json:"rcNumber"`
	CompanyName   string   `json:"companyName"`
	CompanyType   string   `json:"companyType"`
	Status        string   `json:"status"`
	IncDate       string   `json:"incorporationDate"`
	Address       string   `json:"address"`
	State         string   `json:"state"`
	Directors     []string `json:"directors"`
	CheckedAt     string   `json:"checkedAt"`
	Source        string   `json:"source"`
	Sandbox       bool     `json:"sandbox,omitempty"`
	Error         string   `json:"error,omitempty"`
}

type SanctionHit struct {
	List       string   `json:"list"`
	Name       string   `json:"name"`
	Score      float64  `json:"score"`
	EntityType string   `json:"entityType"`
	Programs   []string `json:"programs"`
	Reason     string   `json:"reason"`
}

type SanctionsResult struct {
	Queried   string        `json:"queried"`
	Hits      []SanctionHit `json:"hits"`
	Clear     bool          `json:"clear"`
	CheckedAt string        `json:"checkedAt"`
	Source    string        `json:"source"`
	Sandbox   bool          `json:"sandbox,omitempty"`
	Error     string        `json:"error,omitempty"`
}

// ─── Engine ───────────────────────────────────────────────────────────────────

type Engine struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Engine {
	return &Engine{
		cfg:    cfg,
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// post makes an authenticated POST request to a BIS own-engine endpoint.
func (e *Engine) post(ctx context.Context, baseURL, apiKey, path string, body any) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("X-BIS-Client", "bis-gateway/2.0")
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream %d: %s", resp.StatusCode, string(respBody))
	}
	return respBody, nil
}

// youverifyPost makes an authenticated POST request to the Youverify API.
func (e *Engine) youverifyPost(ctx context.Context, path string, body any) ([]byte, error) {
	if e.cfg.YouverifyAPIKey == "" {
		return nil, fmt.Errorf("youverify not configured")
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.cfg.YouverifyBaseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("token", e.cfg.YouverifyAPIKey)
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("youverify %d: %s", resp.StatusCode, string(respBody))
	}
	return respBody, nil
}

// ─── NIN ─────────────────────────────────────────────────────────────────────

// LookupNIN resolves a National Identification Number using the priority chain.
func (e *Engine) LookupNIN(ctx context.Context, nin string) NINResult {
	// 1. BIS own engine
	if e.cfg.NIMCUrl != "" && e.cfg.NIMCKey != "" {
		if result, err := e.ownNIN(ctx, nin); err == nil {
			return result
		} else {
			log.Printf("[verify] own NIN engine error for %s: %v — trying Youverify", nin, err)
		}
	}
	// 2. Youverify fallback
	if e.cfg.YouverifyAPIKey != "" {
		if result, err := e.youverifyNIN(ctx, nin); err == nil {
			return result
		} else {
			log.Printf("[verify] Youverify NIN error for %s: %v", nin, err)
		}
	}
	return NINResult{NIN: nin, Status: "UNAVAILABLE", CheckedAt: now(), Source: "unavailable", Error: "No configured NIN provider returned a verification result."}
}

func (e *Engine) ownNIN(ctx context.Context, nin string) (NINResult, error) {
	body, err := e.post(ctx, e.cfg.NIMCUrl, e.cfg.NIMCKey, "/verify", map[string]string{"nin": nin})
	if err != nil {
		return NINResult{}, err
	}
	// BIS own engine returns our canonical NINResult shape
	var r NINResult
	if err := json.Unmarshal(body, &r); err != nil {
		return NINResult{}, fmt.Errorf("parse: %w", err)
	}
	r.Source = "own"
	r.Sandbox = false
	r.CheckedAt = now()
	return r, nil
}

// youverifyNIN calls the Youverify NIN endpoint and maps to NINResult.
// Youverify API: POST /identity/ng/nin  { id: "...", isSubjectConsent: true }
func (e *Engine) youverifyNIN(ctx context.Context, nin string) (NINResult, error) {
	body, err := e.youverifyPost(ctx, "/identity/ng/nin", map[string]any{
		"id":               nin,
		"isSubjectConsent": true,
	})
	if err != nil {
		return NINResult{}, err
	}
	// Youverify response shape: { requestID, data: { firstName, lastName, ... } }
	var resp struct {
		RequestID string `json:"requestID"`
		Data      struct {
			FirstName  string `json:"firstName"`
			LastName   string `json:"lastName"`
			MiddleName string `json:"middleName"`
			DOB        string `json:"dateOfBirth"`
			Gender     string `json:"gender"`
			Phone      string `json:"mobile"`
			Address    string `json:"address"`
			StateOfOrigin string `json:"stateOfOrigin"`
			Photo      string `json:"photo"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return NINResult{}, fmt.Errorf("parse youverify NIN: %w", err)
	}
	return NINResult{
		NIN:        nin,
		FirstName:  resp.Data.FirstName,
		LastName:   resp.Data.LastName,
		MiddleName: resp.Data.MiddleName,
		DOB:        resp.Data.DOB,
		Gender:     resp.Data.Gender,
		Phone:      resp.Data.Phone,
		Address:    resp.Data.Address,
		State:      resp.Data.StateOfOrigin,
		Photo:      resp.Data.Photo,
		Status:     "VERIFIED",
		CheckedAt:  now(),
		Source:     "youverify",
		Sandbox:    false,
	}, nil
}

// ─── BVN ─────────────────────────────────────────────────────────────────────

// LookupBVN resolves a Bank Verification Number using the priority chain.
func (e *Engine) LookupBVN(ctx context.Context, bvn string) BVNResult {
	// 1. BIS own engine
	if e.cfg.NIBSSUrl != "" && e.cfg.NIBSSKey != "" {
		if result, err := e.ownBVN(ctx, bvn); err == nil {
			return result
		} else {
			log.Printf("[verify] own BVN engine error for %s: %v — trying Youverify", bvn, err)
		}
	}
	// 2. Youverify fallback
	if e.cfg.YouverifyAPIKey != "" {
		if result, err := e.youverifyBVN(ctx, bvn); err == nil {
			return result
		} else {
			log.Printf("[verify] Youverify BVN error for %s: %v", bvn, err)
		}
	}
	return BVNResult{BVN: bvn, Status: "UNAVAILABLE", CheckedAt: now(), Source: "unavailable", Error: "No configured BVN provider returned a verification result."}
}

func (e *Engine) ownBVN(ctx context.Context, bvn string) (BVNResult, error) {
	body, err := e.post(ctx, e.cfg.NIBSSUrl, e.cfg.NIBSSKey, "/verify", map[string]string{"bvn": bvn})
	if err != nil {
		return BVNResult{}, err
	}
	var r BVNResult
	if err := json.Unmarshal(body, &r); err != nil {
		return BVNResult{}, fmt.Errorf("parse: %w", err)
	}
	r.Source = "own"
	r.Sandbox = false
	r.CheckedAt = now()
	return r, nil
}

// youverifyBVN calls Youverify BVN endpoint.
// Youverify API: POST /identity/ng/bvn  { id: "...", isSubjectConsent: true }
func (e *Engine) youverifyBVN(ctx context.Context, bvn string) (BVNResult, error) {
	body, err := e.youverifyPost(ctx, "/identity/ng/bvn", map[string]any{
		"id":               bvn,
		"isSubjectConsent": true,
	})
	if err != nil {
		return BVNResult{}, err
	}
	var resp struct {
		Data struct {
			FirstName     string `json:"firstName"`
			LastName      string `json:"lastName"`
			MiddleName    string `json:"middleName"`
			DOB           string `json:"dateOfBirth"`
			Phone         string `json:"phoneNumber1"`
			Gender        string `json:"gender"`
			BankName      string `json:"enrollmentBank"`
			AccountNumber string `json:"enrollmentBranch"` // Youverify doesn't expose acct number directly
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return BVNResult{}, fmt.Errorf("parse youverify BVN: %w", err)
	}
	return BVNResult{
		BVN:           bvn,
		FirstName:     resp.Data.FirstName,
		LastName:      resp.Data.LastName,
		MiddleName:    resp.Data.MiddleName,
		DOB:           resp.Data.DOB,
		Phone:         resp.Data.Phone,
		Gender:        resp.Data.Gender,
		BankName:      resp.Data.BankName,
		AccountNumber: resp.Data.AccountNumber,
		Status:        "VERIFIED",
		CheckedAt:     now(),
		Source:        "youverify",
		Sandbox:       false,
	}, nil
}

// ─── CAC ─────────────────────────────────────────────────────────────────────

// LookupCAC resolves a CAC RC number using the priority chain.
func (e *Engine) LookupCAC(ctx context.Context, rc string) CACResult {
	// 1. BIS own engine
	if e.cfg.CACUrl != "" && e.cfg.CACKey != "" {
		if result, err := e.ownCAC(ctx, rc); err == nil {
			return result
		} else {
			log.Printf("[verify] own CAC engine error for %s: %v — trying Youverify", rc, err)
		}
	}
	// 2. Youverify fallback
	if e.cfg.YouverifyAPIKey != "" {
		if result, err := e.youverifyCAC(ctx, rc); err == nil {
			return result
		} else {
			log.Printf("[verify] Youverify CAC error for %s: %v", rc, err)
		}
	}
	return CACResult{RCNumber: rc, Status: "UNAVAILABLE", CheckedAt: now(), Source: "unavailable", Error: "No configured CAC provider returned a verification result."}
}

func (e *Engine) ownCAC(ctx context.Context, rc string) (CACResult, error) {
	body, err := e.post(ctx, e.cfg.CACUrl, e.cfg.CACKey, "/verify", map[string]string{"rcNumber": rc})
	if err != nil {
		return CACResult{}, err
	}
	var r CACResult
	if err := json.Unmarshal(body, &r); err != nil {
		return CACResult{}, fmt.Errorf("parse: %w", err)
	}
	r.Source = "own"
	r.Sandbox = false
	r.CheckedAt = now()
	return r, nil
}

// youverifyCAC calls Youverify CAC endpoint.
// Youverify API: POST /identity/ng/cac  { id: "RC123456", isSubjectConsent: true }
func (e *Engine) youverifyCAC(ctx context.Context, rc string) (CACResult, error) {
	body, err := e.youverifyPost(ctx, "/identity/ng/cac", map[string]any{
		"id":               rc,
		"isSubjectConsent": true,
	})
	if err != nil {
		return CACResult{}, err
	}
	var resp struct {
		Data struct {
			CompanyName string   `json:"companyName"`
			CompanyType string   `json:"companyType"`
			Status      string   `json:"status"`
			IncDate     string   `json:"dateOfIncorporation"`
			Address     string   `json:"address"`
			State       string   `json:"state"`
			Directors   []string `json:"directors"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return CACResult{}, fmt.Errorf("parse youverify CAC: %w", err)
	}
	return CACResult{
		RCNumber:    rc,
		CompanyName: resp.Data.CompanyName,
		CompanyType: resp.Data.CompanyType,
		Status:      resp.Data.Status,
		IncDate:     resp.Data.IncDate,
		Address:     resp.Data.Address,
		State:       resp.Data.State,
		Directors:   resp.Data.Directors,
		CheckedAt:   now(),
		Source:      "youverify",
		Sandbox:     false,
	}, nil
}

// ─── Sanctions ────────────────────────────────────────────────────────────────

// CheckSanctions screens a name against OFAC/UN/EU/CBN sanctions lists.
func (e *Engine) CheckSanctions(ctx context.Context, name string) SanctionsResult {
	// 1. BIS own engine
	if e.cfg.OFACUrl != "" && e.cfg.OFACKey != "" {
		if result, err := e.ownSanctions(ctx, name); err == nil {
			return result
		} else {
			log.Printf("[verify] own sanctions engine error for %s: %v — trying Youverify", name, err)
		}
	}
	// 2. Youverify fallback
	if e.cfg.YouverifyAPIKey != "" {
		if result, err := e.youverifySanctions(ctx, name); err == nil {
			return result
		} else {
			log.Printf("[verify] Youverify sanctions error for %s: %v", name, err)
		}
	}
	return SanctionsResult{Queried: name, Clear: false, CheckedAt: now(), Source: "unavailable", Error: "No configured sanctions provider returned a screening result."}
}

func (e *Engine) ownSanctions(ctx context.Context, name string) (SanctionsResult, error) {
	body, err := e.post(ctx, e.cfg.OFACUrl, e.cfg.OFACKey, "/screen", map[string]string{"name": name})
	if err != nil {
		return SanctionsResult{}, err
	}
	var r SanctionsResult
	if err := json.Unmarshal(body, &r); err != nil {
		return SanctionsResult{}, fmt.Errorf("parse: %w", err)
	}
	r.Source = "own"
	r.Sandbox = false
	r.CheckedAt = now()
	return r, nil
}

// youverifySanctions calls Youverify AML/sanctions screening.
// Youverify API: POST /aml/individual  { firstName, lastName, type: "individual" }
func (e *Engine) youverifySanctions(ctx context.Context, name string) (SanctionsResult, error) {
	parts := strings.Fields(name)
	firstName, lastName := "", name
	if len(parts) >= 2 {
		firstName = parts[0]
		lastName = strings.Join(parts[1:], " ")
	}
	body, err := e.youverifyPost(ctx, "/aml/individual", map[string]any{
		"firstName": firstName,
		"lastName":  lastName,
		"type":      "individual",
	})
	if err != nil {
		return SanctionsResult{}, err
	}
	var resp struct {
		Data struct {
			Hits []struct {
				ListName   string  `json:"listName"`
				FullName   string  `json:"fullName"`
				MatchScore float64 `json:"matchScore"`
				EntityType string  `json:"entityType"`
				Programs   []string `json:"programs"`
				Reason     string  `json:"reason"`
			} `json:"hits"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return SanctionsResult{}, fmt.Errorf("parse youverify sanctions: %w", err)
	}
	hits := make([]SanctionHit, 0, len(resp.Data.Hits))
	for _, h := range resp.Data.Hits {
		hits = append(hits, SanctionHit{
			List:       h.ListName,
			Name:       h.FullName,
			Score:      h.MatchScore,
			EntityType: h.EntityType,
			Programs:   h.Programs,
			Reason:     h.Reason,
		})
	}
	return SanctionsResult{
		Queried:   name,
		Hits:      hits,
		Clear:     len(hits) == 0,
		CheckedAt: now(),
		Source:    "youverify",
		Sandbox:   false,
	}, nil
}
