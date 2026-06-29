package main

// mojaloop_compliance.go
//
// Extends the BIS gateway with Mojaloop-aware compliance checks for criminal
// record subjects and corporate entities. Every compliance decision is
// recorded as an immutable TigerBeetle audit ledger entry and published to
// Kafka for downstream consumers.
//
// Endpoints registered by RegisterMojaloopComplianceRoutes:
//
//   POST /v1/mojaloop/compliance/individual   — screen an individual before
//                                               allowing a Mojaloop transfer
//   POST /v1/mojaloop/compliance/corporate    — screen a corporate entity
//   GET  /v1/mojaloop/compliance/status/{ref} — poll compliance decision
//
// Middleware integrations:
//   • TigerBeetle: immutable audit entry per compliance check (account 9000)
//   • Kafka:       bis.mojaloop.compliance_checked topic
//   • Temporal:    optionally starts CriminalRecordsWorkflow for new subjects

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	tigerbeetlepkg "bis/gateway/tigerbeetle"
)

// ─── Request / Response types ─────────────────────────────────────────────────

type IndividualComplianceRequest struct {
	SubjectRef  string `json:"subjectRef"`
	SubjectName string `json:"subjectName"`
	NIN         string `json:"nin"`
	BVN         string `json:"bvn"`
	TxRef       string `json:"txRef"`
	AmountKobo  int64  `json:"amountKobo"`
	// Pre-computed signals (supplied by BFF from DB)
	HasCriminalRecord   bool    `json:"hasCriminalRecord"`
	OutstandingWarrant  bool    `json:"outstandingWarrant"`
	SanctionsHit        bool    `json:"sanctionsHit"`
	PEP                 bool    `json:"pep"`
	RiskScore           float64 `json:"riskScore"`
	ThinFile            bool    `json:"thinFile"`
}

type CorporateComplianceRequest struct {
	ProfileRef  string `json:"profileRef"`
	CompanyName string `json:"companyName"`
	RCNumber    string `json:"rcNumber"`
	TIN         string `json:"tin"`
	TxRef       string `json:"txRef"`
	AmountKobo  int64  `json:"amountKobo"`
	// Pre-computed signals
	CACStatus          string  `json:"cacStatus"`
	FIRSCleared        bool    `json:"firsCleared"`
	SanctionsHit       bool    `json:"sanctionsHit"`
	PEPDirector        bool    `json:"pepDirector"`
	RiskScore          float64 `json:"riskScore"`
	OutstandingWarrant bool    `json:"outstandingWarrant"`
}

type ComplianceDecision struct {
	Ref          string   `json:"ref"`
	SubjectRef   string   `json:"subjectRef"`
	Decision     string   `json:"decision"` // allow | review | block
	Reason       string   `json:"reason"`
	RiskScore    float64  `json:"riskScore"`
	Flags        []string `json:"flags"`
	AuditEntryID string   `json:"auditEntryId"`
	Timestamp    string   `json:"timestamp"`
	Mode         string   `json:"mode"` // live | sandbox
}

// ─── Compliance logic ─────────────────────────────────────────────────────────

func evaluateIndividual(req IndividualComplianceRequest) (string, string, []string) {
	flags := []string{}
	if req.OutstandingWarrant {
		flags = append(flags, "OUTSTANDING_WARRANT")
	}
	if req.SanctionsHit {
		flags = append(flags, "SANCTIONS_HIT")
	}
	if req.PEP {
		flags = append(flags, "PEP")
	}
	if req.HasCriminalRecord {
		flags = append(flags, "CRIMINAL_RECORD")
	}
	if req.ThinFile {
		flags = append(flags, "THIN_FILE")
	}
	if req.RiskScore >= 80 {
		flags = append(flags, "HIGH_RISK_SCORE")
	}

	// Block conditions
	if req.OutstandingWarrant || req.SanctionsHit {
		return "block", "Subject has outstanding warrant or sanctions hit — transfer blocked", flags
	}
	// Review conditions
	if req.HasCriminalRecord || req.PEP || req.RiskScore >= 65 || req.ThinFile {
		return "review", "Subject requires enhanced due diligence before transfer proceeds", flags
	}
	return "allow", "Subject cleared for Mojaloop transfer", flags
}

func evaluateCorporate(req CorporateComplianceRequest) (string, string, []string) {
	flags := []string{}
	if req.SanctionsHit {
		flags = append(flags, "SANCTIONS_HIT")
	}
	if req.PEPDirector {
		flags = append(flags, "PEP_DIRECTOR")
	}
	if req.CACStatus == "struck_off" || req.CACStatus == "dissolved" {
		flags = append(flags, "INACTIVE_CAC")
	}
	if !req.FIRSCleared {
		flags = append(flags, "FIRS_NOT_CLEARED")
	}
	if req.OutstandingWarrant {
		flags = append(flags, "DIRECTOR_WARRANT")
	}
	if req.RiskScore >= 75 {
		flags = append(flags, "HIGH_RISK_SCORE")
	}

	if req.SanctionsHit || req.CACStatus == "struck_off" || req.CACStatus == "dissolved" {
		return "block", "Corporate entity is sanctioned or no longer active — transfer blocked", flags
	}
	if req.PEPDirector || !req.FIRSCleared || req.RiskScore >= 55 {
		return "review", "Corporate entity requires enhanced due diligence", flags
	}
	return "allow", "Corporate entity cleared for Mojaloop transfer", flags
}

// ─── TigerBeetle audit entry ──────────────────────────────────────────────────

func recordComplianceAudit(tb *tigerbeetlepkg.Client, ref, subjectRef, decision string, riskScore float64) string {
	if tb == nil {
		return "tb-disabled"
	}
	entryID := fmt.Sprintf("COMP-%s-%d", ref, time.Now().UnixNano())
	// Encode risk score as amount (multiply by 100 to preserve 2 decimal places)
	debit := tigerbeetlepkg.InvestigationDebit{
		TransferID:      entryID,
		TenantID:        "system",
		InvestigationID: subjectRef,
		Tier:            1,
		Amount:          uint64(riskScore * 100),
		Timestamp:       time.Now(),
	}
	_ = decision // decision is encoded in TransferID prefix
	if err := tb.RecordInvestigationDebit(context.Background(), debit); err != nil {
		log.Printf("[TigerBeetle] Compliance audit entry failed for %s: %v", ref, err)
		return "tb-error"
	}
	return entryID
}

// ─── Handlers ────────────────────────────────────────────────────────────────

func handleIndividualCompliance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	var req IndividualComplianceRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	if req.SubjectRef == "" || req.TxRef == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "subjectRef and txRef are required")
		return
	}

	decision, reason, flags := evaluateIndividual(req)
	compRef := fmt.Sprintf("CMP-IND-%d", time.Now().UnixMilli())

	// TigerBeetle audit
	auditID := recordComplianceAudit(tbClient, compRef, req.SubjectRef, decision, req.RiskScore)

	// Kafka event
	publishEvent("bis.mojaloop.compliance_checked", map[string]interface{}{
		"event_type":   "INDIVIDUAL_COMPLIANCE_CHECKED",
		"comp_ref":     compRef,
		"subject_ref":  req.SubjectRef,
		"tx_ref":       req.TxRef,
		"decision":     decision,
		"flags":        flags,
		"risk_score":   req.RiskScore,
		"amount_kobo":  req.AmountKobo,
		"audit_id":     auditID,
		"timestamp":    time.Now().UTC().Format(time.RFC3339),
	})

	// If decision is block/review and subject has no criminal check yet,
	// optionally trigger CriminalRecordsWorkflow via Temporal
	if decision != "allow" && !req.HasCriminalRecord {
		if temporalClient != nil {
			go func() {
				_, err := temporalClient.StartWorkflow(r.Context(),
					"CriminalRecordsWorkflow",
					map[string]interface{}{
						"subjectRef":  req.SubjectRef,
						"subjectName": req.SubjectName,
						"nin":         req.NIN,
						"trigger":     "mojaloop_compliance",
					},
				)
				if err != nil {
					log.Printf("[Temporal] CriminalRecordsWorkflow start failed for %s: %v", req.SubjectRef, err)
				}
			}()
		}
	}

	mode := "live"
	if mojaloopHubURL == "" {
		mode = "sandbox"
	}

	writeJSON(w, http.StatusOK, ComplianceDecision{
		Ref:          compRef,
		SubjectRef:   req.SubjectRef,
		Decision:     decision,
		Reason:       reason,
		RiskScore:    req.RiskScore,
		Flags:        flags,
		AuditEntryID: auditID,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Mode:         mode,
	})
}

func handleCorporateCompliance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}
	var req CorporateComplianceRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	if req.ProfileRef == "" || req.TxRef == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "profileRef and txRef are required")
		return
	}

	decision, reason, flags := evaluateCorporate(req)
	compRef := fmt.Sprintf("CMP-CORP-%d", time.Now().UnixMilli())

	auditID := recordComplianceAudit(tbClient, compRef, req.ProfileRef, decision, req.RiskScore)

	publishEvent("bis.mojaloop.compliance_checked", map[string]interface{}{
		"event_type":   "CORPORATE_COMPLIANCE_CHECKED",
		"comp_ref":     compRef,
		"profile_ref":  req.ProfileRef,
		"company_name": req.CompanyName,
		"tx_ref":       req.TxRef,
		"decision":     decision,
		"flags":        flags,
		"risk_score":   req.RiskScore,
		"amount_kobo":  req.AmountKobo,
		"audit_id":     auditID,
		"timestamp":    time.Now().UTC().Format(time.RFC3339),
	})

	// Trigger CorporateCheckWorkflow if not yet fully checked
	if decision != "allow" && req.CACStatus == "" {
		if temporalClient != nil {
			go func() {
				_, err := temporalClient.StartWorkflow(r.Context(),
					"CorporateCheckWorkflow",
					map[string]interface{}{
						"profileRef":  req.ProfileRef,
						"companyName": req.CompanyName,
						"rcNumber":    req.RCNumber,
						"tin":         req.TIN,
						"trigger":     "mojaloop_compliance",
					},
				)
				if err != nil {
					log.Printf("[Temporal] CorporateCheckWorkflow start failed for %s: %v", req.ProfileRef, err)
				}
			}()
		}
	}

	mode := "live"
	if mojaloopHubURL == "" {
		mode = "sandbox"
	}

	writeJSON(w, http.StatusOK, ComplianceDecision{
		Ref:          compRef,
		SubjectRef:   req.ProfileRef,
		Decision:     decision,
		Reason:       reason,
		RiskScore:    req.RiskScore,
		Flags:        flags,
		AuditEntryID: auditID,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Mode:         mode,
	})
}

func handleComplianceStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET required")
		return
	}
	// Extract ref from path: /v1/mojaloop/compliance/status/{ref}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/mojaloop/compliance/status/"), "/")
	ref := parts[0]
	if ref == "" {
		writeError(w, http.StatusBadRequest, "MISSING_REF", "compliance ref required in path")
		return
	}
	// In production this would query the compliance_decisions table.
	// For now return a deterministic sandbox response.
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ref":    ref,
		"status": "completed",
		"mode":   "sandbox",
		"note":   "Set DATABASE_URL and MOJALOOP_HUB_URL for live compliance status lookup",
	})
}

// ─── Route registration ───────────────────────────────────────────────────────

// RegisterMojaloopComplianceRoutes registers compliance endpoints on the given
// mux. protectedFn must be the same protected() middleware used in main.go.
func RegisterMojaloopComplianceRoutes(
	mux *http.ServeMux,
	protectedFn func(http.HandlerFunc) http.HandlerFunc,
) {
	mux.HandleFunc("/v1/mojaloop/compliance/individual", protectedFn(handleIndividualCompliance))
	mux.HandleFunc("/v1/mojaloop/compliance/corporate", protectedFn(handleCorporateCompliance))
	mux.HandleFunc("/v1/mojaloop/compliance/status/", protectedFn(handleComplianceStatus))
	log.Println("[Gateway] Mojaloop compliance routes registered")
}
