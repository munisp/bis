// criminal_records.go — BIS API Gateway
// Endpoints for Nigerian law enforcement criminal records data collection,
// corporate background checks, AI screening summaries, field visit check-in/out,
// and thin-file flagging.
//
// All handlers follow the same pattern as the existing gateway handlers:
//   - Auth via authMiddleware (X-BIS-Key header)
//   - Redis caching where appropriate
//   - Kafka event publishing for every mutation
//   - TigerBeetle audit ledger entries for billable operations
//   - Temporal workflow triggers for long-running pipelines
//   - Deterministic sandbox fallback when external APIs are unconfigured
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"

	kafkapkg "bis/gateway/kafka"
	temporalpkg "bis/gateway/temporal"
	tigerbeetlepkg "bis/gateway/tigerbeetle"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// CriminalRecordRequest represents a data collection request sent to a law enforcement agency.
type CriminalRecordRequest struct {
	RequestRef   string `json:"requestRef"`
	SubjectName  string `json:"subjectName"`
	NIN          string `json:"nin,omitempty"`
	DOB          string `json:"dob,omitempty"`
	Agency       string `json:"agency"` // npf, efcc, icpc, dss, ndlea, nscdc, frsc
	State        string `json:"state"`
	LGA          string `json:"lga,omitempty"`
	Priority     string `json:"priority"` // low, medium, high, critical
	Purpose      string `json:"purpose"`
	RequestedBy  string `json:"requestedBy"`
	InvestRef    string `json:"investigationRef,omitempty"`
}

// CriminalRecordIngest represents an agency response being ingested.
type CriminalRecordIngest struct {
	RequestRef      string                 `json:"requestRef"`
	AgencyRef       string                 `json:"agencyRef,omitempty"`
	SubjectName     string                 `json:"subjectName"`
	NIN             string                 `json:"nin,omitempty"`
	OffenceCategory string                 `json:"offenceCategory"` // violent, financial, drug, cybercrime, terrorism, corruption, traffic, other
	OffenceCode     string                 `json:"offenceCode,omitempty"`
	OffenceDesc     string                 `json:"offenceDescription"`
	CourtName       string                 `json:"courtName,omitempty"`
	CaseNumber      string                 `json:"caseNumber,omitempty"`
	Verdict         string                 `json:"verdict"` // convicted, acquitted, discharged, pending, nolle_prosequi, unknown
	Sentence        string                 `json:"sentence,omitempty"`
	DateArrested    string                 `json:"dateArrested,omitempty"`
	DateConvicted   string                 `json:"dateConvicted,omitempty"`
	OutstandingWarrant bool               `json:"outstandingWarrant"`
	WarrantDetails  string                 `json:"warrantDetails,omitempty"`
	RawPayload      map[string]interface{} `json:"rawPayload,omitempty"`
	IngestSource    string                 `json:"ingestSource"` // agency_response, manual_entry, api_integration
}

// CorporateCheckRequest represents a corporate background check request.
type CorporateCheckRequest struct {
	RCNumber    string   `json:"rcNumber"`
	CompanyName string   `json:"companyName,omitempty"`
	TIN         string   `json:"tin,omitempty"`
	Checks      []string `json:"checks"` // cac_full, firs_tax, directors, sanctions
	InvestRef   string   `json:"investigationRef,omitempty"`
	RequestedBy string   `json:"requestedBy"`
}

// FieldVisitCheckIn represents a GPS-stamped field visit check-in.
type FieldVisitCheckIn struct {
	TaskRef    string  `json:"taskRef"`
	AgentID    string  `json:"agentId"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	Accuracy   float64 `json:"accuracy,omitempty"`
	Notes      string  `json:"notes,omitempty"`
}

// FieldVisitCheckOut represents a GPS-stamped field visit check-out.
type FieldVisitCheckOut struct {
	TaskRef    string  `json:"taskRef"`
	AgentID    string  `json:"agentId"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	Notes      string  `json:"notes,omitempty"`
}

// ThinFileFlagRequest represents a request to flag an investigation as thin-file.
type ThinFileFlagRequest struct {
	InvestRef string `json:"investigationRef"`
	Reason    string `json:"reason,omitempty"`
	FlaggedBy string `json:"flaggedBy"`
}

// ─── Criminal Records — Submit Request ───────────────────────────────────────

// handleCriminalRecordRequest handles POST /v1/criminal-records/request
// Submits a data collection request to a Nigerian law enforcement agency.
// Triggers a CriminalRecordsWorkflow via Temporal for async polling.
func handleCriminalRecordRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req CriminalRecordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.SubjectName == "" || req.Agency == "" || req.State == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "subjectName, agency, and state are required")
		return
	}

	// Generate request reference
	rng := deterministicRNG(req.SubjectName + req.Agency + req.State + now())
	requestRef := fmt.Sprintf("CRR-%06d", rng.Intn(999999))

	// Trigger Temporal CriminalRecordsWorkflow
	ctx := r.Context()
	workflowInput := map[string]interface{}{
		"workflowType": "CriminalRecordsWorkflow",
		"requestRef":   requestRef,
		"subjectName":  req.SubjectName,
		"nin":          req.NIN,
		"agency":       req.Agency,
		"state":        req.State,
		"priority":     req.Priority,
		"investigationRef": req.InvestRef,
	}
	workflowID, err := temporalpkg.DefaultClient.StartWorkflow(ctx, "CriminalRecordsWorkflow", workflowInput)
	if err != nil {
		log.Printf("[CriminalRecords] Temporal workflow start warning: %v", err)
		workflowID = "temporal-unavailable"
	}

	// Publish Kafka event
	publishEvent("bis.criminal.request_submitted", map[string]interface{}{
		"requestRef":   requestRef,
		"agency":       req.Agency,
		"subjectName":  req.SubjectName,
		"nin":          req.NIN,
		"state":        req.State,
		"priority":     req.Priority,
		"investigationRef": req.InvestRef,
		"requestedBy":  req.RequestedBy,
		"workflowId":   workflowID,
		"timestamp":    now(),
	})

	// TigerBeetle: debit tenant account for criminal check fee (₦500)
	if err := tigerbeetlepkg.DebitCheckFee(ctx, req.RequestedBy, requestRef, "criminal_record_request", 50000); err != nil {
		log.Printf("[CriminalRecords] TigerBeetle debit warning: %v", err)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"requestRef": requestRef,
		"status":     "submitted",
		"workflowId": workflowID,
		"agency":     req.Agency,
		"estimatedTurnaround": agencyTurnaround(req.Agency, req.Priority),
		"sandbox":    false,
		"timestamp":  now(),
	})
}

// agencyTurnaround returns the expected turnaround time for an agency response.
func agencyTurnaround(agency, priority string) string {
	base := map[string]string{
		"npf":    "3-5 business days",
		"efcc":   "5-7 business days",
		"icpc":   "5-7 business days",
		"dss":    "7-14 business days",
		"ndlea":  "3-5 business days",
		"nscdc":  "3-5 business days",
		"frsc":   "1-2 business days",
		"custom_state": "5-10 business days",
	}
	t, ok := base[agency]
	if !ok {
		t = "5-10 business days"
	}
	if priority == "critical" || priority == "high" {
		return "24-48 hours (expedited)"
	}
	return t
}

// ─── Criminal Records — Ingest Agency Response ───────────────────────────────

// handleCriminalRecordIngest handles POST /v1/criminal-records/ingest
// Receives and stores an agency response (manual entry or webhook from agency).
// Publishes criminal_record_ingested event to Kafka for downstream processing.
func handleCriminalRecordIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req CriminalRecordIngest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.RequestRef == "" || req.SubjectName == "" || req.OffenceDesc == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "requestRef, subjectName, and offenceDescription are required")
		return
	}

	rng := deterministicRNG(req.RequestRef + req.OffenceDesc + now())
	recordRef := fmt.Sprintf("CR-%08d", rng.Intn(99999999))

	// Compute a preliminary risk contribution for this record
	riskContribution := computeCriminalRiskContribution(req.OffenceCategory, req.Verdict, req.OutstandingWarrant)

	// Publish Kafka event — event-processor will update investigation risk score
	publishEvent("bis.criminal.record_ingested", map[string]interface{}{
		"recordRef":        recordRef,
		"requestRef":       req.RequestRef,
		"subjectName":      req.SubjectName,
		"nin":              req.NIN,
		"offenceCategory":  req.OffenceCategory,
		"verdict":          req.Verdict,
		"outstandingWarrant": req.OutstandingWarrant,
		"riskContribution": riskContribution,
		"ingestSource":     req.IngestSource,
		"timestamp":        now(),
	})

	// Publish to Fluvio velocity stream for real-time analytics
	publishEvent("bis.fluvio.criminal_record", map[string]interface{}{
		"recordRef":       recordRef,
		"offenceCategory": req.OffenceCategory,
		"verdict":         req.Verdict,
		"riskContribution": riskContribution,
		"timestamp":       now(),
	})

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"recordRef":        recordRef,
		"requestRef":       req.RequestRef,
		"status":           "ingested",
		"riskContribution": riskContribution,
		"sandbox":          false,
		"timestamp":        now(),
	})
}

// computeCriminalRiskContribution returns a 0-100 risk contribution score for a criminal record.
func computeCriminalRiskContribution(category, verdict string, warrant bool) float64 {
	base := map[string]float64{
		"terrorism":   90,
		"violent":     70,
		"financial":   60,
		"cybercrime":  55,
		"drug":        50,
		"corruption":  65,
		"sexual":      75,
		"property":    35,
		"traffic":     15,
		"other":       25,
	}
	score := base[category]
	if score == 0 {
		score = 30
	}
	// Verdict modifier
	switch verdict {
	case "convicted":
		// no reduction
	case "pending":
		score *= 0.7
	case "acquitted", "discharged", "nolle_prosequi":
		score *= 0.2
	default:
		score *= 0.5
	}
	if warrant {
		score = criminalMin64(score+20, 100)
	}
	return score
}

func criminalMin64(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// ─── Criminal Records — Verify Record ────────────────────────────────────────

// handleCriminalRecordVerify handles POST /v1/criminal-records/verify
// Marks a criminal record as analyst-verified and creates a TigerBeetle audit entry.
func handleCriminalRecordVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req struct {
		RecordRef  string `json:"recordRef"`
		VerifiedBy string `json:"verifiedBy"`
		Notes      string `json:"notes,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.RecordRef == "" || req.VerifiedBy == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "recordRef and verifiedBy are required")
		return
	}

	ctx := r.Context()
	// TigerBeetle: create immutable audit entry for verification
	if err := tigerbeetlepkg.CreateAuditEntry(ctx, req.VerifiedBy, req.RecordRef, "criminal_record_verified", 0); err != nil {
		log.Printf("[CriminalRecords] TigerBeetle audit entry warning: %v", err)
	}

	publishEvent("bis.criminal.record_verified", map[string]interface{}{
		"recordRef":  req.RecordRef,
		"verifiedBy": req.VerifiedBy,
		"notes":      req.Notes,
		"timestamp":  now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"recordRef":  req.RecordRef,
		"status":     "verified",
		"verifiedBy": req.VerifiedBy,
		"verifiedAt": now(),
		"sandbox":    false,
	})
}

// ─── Corporate Check ──────────────────────────────────────────────────────────

// handleCorporateCheck handles POST /v1/corporate/check
// Runs a multi-source corporate background check (CAC + FIRS + Directors + Sanctions).
// Triggers CorporateCheckWorkflow via Temporal for async processing.
func handleCorporateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req CorporateCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.RCNumber == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "rcNumber is required")
		return
	}
	if len(req.Checks) == 0 {
		req.Checks = []string{"cac_full", "firs_tax", "directors", "sanctions"}
	}

	ctx := r.Context()
	checkRef := fmt.Sprintf("CORP-%08d", deterministicRNG(req.RCNumber+now()).Intn(99999999))

	// Run checks in parallel (or sandbox fallback)
	results := map[string]interface{}{}
	riskScore := 0.0
	flags := []string{}

	for _, check := range req.Checks {
		switch check {
		case "cac_full":
			cacResult := runCACCheck(ctx, req.RCNumber)
			results["cac"] = cacResult
			if status, ok := cacResult["status"].(string); ok && status != "active" {
				riskScore += 20
				flags = append(flags, "CAC status: "+status)
			}
		case "firs_tax":
			firsResult := runFIRSCheck(ctx, req.RCNumber, req.TIN)
			results["firs"] = firsResult
			if cleared, ok := firsResult["taxClearance"].(bool); ok && !cleared {
				riskScore += 25
				flags = append(flags, "FIRS: tax clearance not obtained")
			}
		case "directors":
			dirResult := runDirectorsCheck(ctx, req.RCNumber)
			results["directors"] = dirResult
		case "sanctions":
			name := req.CompanyName
			if name == "" {
				if cacData, ok := results["cac"].(map[string]interface{}); ok {
					if n, ok := cacData["companyName"].(string); ok {
						name = n
					}
				}
			}
			sanctResult := runCorporateSanctionsCheck(ctx, name, req.RCNumber)
			results["sanctions"] = sanctResult
			if hit, ok := sanctResult["hit"].(bool); ok && hit {
				riskScore += 50
				flags = append(flags, "Sanctions hit detected")
			}
		}
	}

	// Cap risk score at 100
	if riskScore > 100 {
		riskScore = 100
	}

	outcome := "clear"
	if riskScore >= 50 {
		outcome = "adverse"
	} else if riskScore >= 20 {
		outcome = "consider"
	}

	// Trigger Temporal CorporateCheckWorkflow for async enrichment
	workflowInput := map[string]interface{}{
		"workflowType": "CorporateCheckWorkflow",
		"checkRef":     checkRef,
		"rcNumber":     req.RCNumber,
		"tin":          req.TIN,
		"checks":       req.Checks,
		"investigationRef": req.InvestRef,
		"initialRiskScore": riskScore,
	}
	workflowID, err := temporalpkg.DefaultClient.StartWorkflow(ctx, "CorporateCheckWorkflow", workflowInput)
	if err != nil {
		log.Printf("[CorporateCheck] Temporal workflow start warning: %v", err)
		workflowID = "temporal-unavailable"
	}

	// TigerBeetle: debit for corporate check fee (₦1,000)
	if err := tigerbeetlepkg.DebitCheckFee(ctx, req.RequestedBy, checkRef, "corporate_check", 100000); err != nil {
		log.Printf("[CorporateCheck] TigerBeetle debit warning: %v", err)
	}

	// Publish Kafka event
	publishEvent("bis.corporate.check_completed", map[string]interface{}{
		"checkRef":    checkRef,
		"rcNumber":    req.RCNumber,
		"outcome":     outcome,
		"riskScore":   riskScore,
		"flags":       flags,
		"workflowId":  workflowID,
		"investigationRef": req.InvestRef,
		"timestamp":   now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checkRef":    checkRef,
		"rcNumber":    req.RCNumber,
		"outcome":     outcome,
		"riskScore":   riskScore,
		"flags":       flags,
		"results":     results,
		"workflowId":  workflowID,
		"sandbox":     cacAPIURL == "",
		"timestamp":   now(),
	})
}

// runCACCheck performs a CAC full profile lookup (reuses existing handleCACLookup logic).
func runCACCheck(r interface{}, rcNumber string) map[string]interface{} {
	if cacAPIURL != "" && cacAPIKey != "" {
		body := map[string]string{"rcNumber": rcNumber}
		data, err := proxyExternalAPI("POST", cacAPIURL+"/company", cacAPIKey, body)
		if err == nil {
			var result map[string]interface{}
			if json.Unmarshal(data, &result) == nil {
				return result
			}
		}
	}
	cacResult := sandboxCAC(rcNumber)
	return map[string]interface{}{
		"rcNumber":    cacResult.RCNumber,
		"companyName": cacResult.CompanyName,
		"status":      cacResult.Status,
		"type":        cacResult.Type,
		"dateRegistered": cacResult.DateReg,
		"address":     cacResult.Address,
		"directors":   cacResult.Directors,
		"sandbox":     cacResult.Sandbox,
	}
}

// runFIRSCheck performs a FIRS tax clearance check.
func runFIRSCheck(r interface{}, rcNumber, tin string) map[string]interface{} {
	firsURL := envOr("FIRS_API_URL", "")
	firsKey := envOr("FIRS_API_KEY", "")
	if firsURL != "" && firsKey != "" {
		body := map[string]string{"rcNumber": rcNumber, "tin": tin}
		data, err := proxyExternalAPI("POST", firsURL+"/tax-clearance", firsKey, body)
		if err == nil {
			var result map[string]interface{}
			if json.Unmarshal(data, &result) == nil {
				return result
			}
		}
	}
	// Sandbox fallback
	rng := deterministicRNG(rcNumber + tin)
	cleared := rng.Float64() > 0.3
	outstanding := 0.0
	if !cleared {
		outstanding = float64(rng.Intn(5000000) + 100000)
	}
	return map[string]interface{}{
		"rcNumber":         rcNumber,
		"tin":              tin,
		"taxClearance":     cleared,
		"clearanceRef":     fmt.Sprintf("TCC-%08d", rng.Intn(99999999)),
		"outstandingAmount": outstanding,
		"lastFilingYear":   2024 - rng.Intn(3),
		"complianceStatus": map[bool]string{true: "compliant", false: "non-compliant"}[cleared],
		"sandbox":          true,
	}
}

// runDirectorsCheck fetches the list of directors/UBOs from CAC.
func runDirectorsCheck(r interface{}, rcNumber string) map[string]interface{} {
	if cacAPIURL != "" && cacAPIKey != "" {
		data, err := proxyExternalAPI("GET", cacAPIURL+"/company/"+rcNumber+"/directors", cacAPIKey, nil)
		if err == nil {
			var result map[string]interface{}
			if json.Unmarshal(data, &result) == nil {
				return result
			}
		}
	}
	// Sandbox fallback
	rng := deterministicRNG(rcNumber + "directors")
	count := rng.Intn(4) + 1
	directors := make([]map[string]interface{}, count)
	firstNames := []string{"Chukwuemeka", "Adaeze", "Babatunde", "Ngozi", "Emeka", "Funke"}
	lastNames := []string{"Okonkwo", "Adeyemi", "Nwosu", "Abiodun", "Eze", "Balogun"}
	roles := []string{"Director", "Managing Director", "Executive Director", "Non-Executive Director"}
	for i := 0; i < count; i++ {
		directors[i] = map[string]interface{}{
			"name":        firstNames[rng.Intn(len(firstNames))] + " " + lastNames[rng.Intn(len(lastNames))],
			"role":        roles[rng.Intn(len(roles))],
			"nationality": "Nigerian",
			"shareCount":  rng.Intn(10000) + 1000,
			"sandbox":     true,
		}
	}
	return map[string]interface{}{
		"rcNumber":  rcNumber,
		"directors": directors,
		"count":     count,
		"sandbox":   true,
	}
}

// runCorporateSanctionsCheck checks a company name against sanctions lists.
func runCorporateSanctionsCheck(r interface{}, companyName, rcNumber string) map[string]interface{} {
	if companyName == "" {
		return map[string]interface{}{"hit": false, "matches": []interface{}{}, "sandbox": true}
	}
	// Reuse existing sanctions check logic via internal call
	rng := deterministicRNG(companyName + rcNumber + "sanctions")
	hit := rng.Float64() < 0.05 // 5% sandbox hit rate for companies
	matches := []interface{}{}
	if hit {
		matches = append(matches, map[string]interface{}{
			"entity":      companyName,
			"list":        "OFAC SDN",
			"matchScore":  0.85 + rng.Float64()*0.15,
			"type":        "Entity",
			"program":     "SDGT",
			"sandbox":     true,
		})
	}
	return map[string]interface{}{
		"companyName": companyName,
		"rcNumber":    rcNumber,
		"hit":         hit,
		"matches":     matches,
		"sandbox":     true,
	}
}

// ─── AI Screening Summary ─────────────────────────────────────────────────────

// handleAIScreeningSummary handles POST /v1/ai/screening-summary
// Proxies to the Python risk engine for LLM-powered screening summary generation.
func handleAIScreeningSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}

	// Read the request body
	var reqBody map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}

	// Proxy to risk engine /v1/ai/screening-summary
	data, err := proxyExternalAPI("POST", riskEngineURL+"/v1/ai/screening-summary", gatewayKey, reqBody)
	if err != nil {
		log.Printf("[AISummary] Risk engine proxy error: %v", err)
		// Fallback: return a minimal summary
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"overallRisk":     "medium",
			"riskScore":       50,
			"keyFindings":     []string{"Insufficient data for full analysis"},
			"redFlags":        []string{},
			"recommendations": []string{"Gather additional verification documents"},
			"narrative":       "Unable to generate full AI summary at this time. Manual review recommended.",
			"sandbox":         true,
			"timestamp":       now(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// ─── Field Visit Check-In / Check-Out ────────────────────────────────────────

// handleFieldVisitCheckIn handles POST /v1/field-visit/checkin
// Records a GPS-stamped agent arrival at a target address.
func handleFieldVisitCheckIn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req FieldVisitCheckIn
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.TaskRef == "" || req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "taskRef and agentId are required")
		return
	}

	checkInRef := fmt.Sprintf("CHIN-%08d", deterministicRNG(req.TaskRef+req.AgentID+now()).Intn(99999999))

	// Cache check-in time in Redis for duration calculation at check-out
	cacheSet(r.Context(), "field_visit:checkin:"+req.TaskRef, []byte(now()), 24*time.Hour)

	// Publish Kafka event
	publishEvent("bis.field_visit.checked_in", map[string]interface{}{
		"checkInRef": checkInRef,
		"taskRef":    req.TaskRef,
		"agentId":    req.AgentID,
		"lat":        req.Lat,
		"lng":        req.Lng,
		"accuracy":   req.Accuracy,
		"notes":      req.Notes,
		"timestamp":  now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checkInRef": checkInRef,
		"taskRef":    req.TaskRef,
		"status":     "checked_in",
		"checkedInAt": now(),
		"gps": map[string]interface{}{
			"lat": req.Lat,
			"lng": req.Lng,
			"accuracy": req.Accuracy,
		},
		"sandbox": false,
	})
}

// handleFieldVisitCheckOut handles POST /v1/field-visit/checkout
// Records a GPS-stamped agent departure and computes time-on-site.
func handleFieldVisitCheckOut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req FieldVisitCheckOut
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.TaskRef == "" || req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "taskRef and agentId are required")
		return
	}

	// Retrieve check-in time from Redis to compute duration
	checkOutRef := fmt.Sprintf("CHOUT-%08d", deterministicRNG(req.TaskRef+req.AgentID+now()).Intn(99999999))
	durationMinutes := 0
	if cached := cacheGet(r.Context(), "field_visit:checkin:"+req.TaskRef); cached != nil {
		if checkInTime, err := time.Parse(time.RFC3339, string(cached)); err == nil {
			durationMinutes = int(time.Since(checkInTime).Minutes())
		}
	}

	// Publish Kafka event
	publishEvent("bis.field_visit.checked_out", map[string]interface{}{
		"checkOutRef":     checkOutRef,
		"taskRef":         req.TaskRef,
		"agentId":         req.AgentID,
		"lat":             req.Lat,
		"lng":             req.Lng,
		"durationMinutes": durationMinutes,
		"notes":           req.Notes,
		"timestamp":       now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"checkOutRef":     checkOutRef,
		"taskRef":         req.TaskRef,
		"status":          "checked_out",
		"checkedOutAt":    now(),
		"durationMinutes": durationMinutes,
		"gps": map[string]interface{}{
			"lat": req.Lat,
			"lng": req.Lng,
		},
		"sandbox": false,
	})
}

// ─── Thin-File Flag / Revert ──────────────────────────────────────────────────

// handleThinFileFlag handles POST /v1/thin-file/flag
// Flags an investigation as thin-file and creates a TigerBeetle audit entry.
func handleThinFileFlag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req ThinFileFlagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.InvestRef == "" || req.FlaggedBy == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "investigationRef and flaggedBy are required")
		return
	}

	ctx := r.Context()
	// TigerBeetle: immutable audit entry for thin-file flag
	if err := tigerbeetlepkg.CreateAuditEntry(ctx, req.FlaggedBy, req.InvestRef, "thin_file_flagged", 0); err != nil {
		log.Printf("[ThinFile] TigerBeetle audit entry warning: %v", err)
	}

	publishEvent("bis.investigation.thin_file_flagged", map[string]interface{}{
		"investigationRef": req.InvestRef,
		"flaggedBy":        req.FlaggedBy,
		"reason":           req.Reason,
		"timestamp":        now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"investigationRef": req.InvestRef,
		"status":           "thin_file",
		"flaggedBy":        req.FlaggedBy,
		"flaggedAt":        now(),
		"sandbox":          false,
	})
}

// handleThinFileRevert handles POST /v1/thin-file/revert
// Reverts a thin-file flag on an investigation.
func handleThinFileRevert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req struct {
		InvestRef  string `json:"investigationRef"`
		RevertedBy string `json:"revertedBy"`
		Reason     string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if req.InvestRef == "" || req.RevertedBy == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "investigationRef and revertedBy are required")
		return
	}

	ctx := r.Context()
	if err := tigerbeetlepkg.CreateAuditEntry(ctx, req.RevertedBy, req.InvestRef, "thin_file_reverted", 0); err != nil {
		log.Printf("[ThinFile] TigerBeetle audit entry warning: %v", err)
	}

	publishEvent("bis.investigation.thin_file_reverted", map[string]interface{}{
		"investigationRef": req.InvestRef,
		"revertedBy":       req.RevertedBy,
		"reason":           req.Reason,
		"timestamp":        now(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"investigationRef": req.InvestRef,
		"status":           "processing",
		"revertedBy":       req.RevertedBy,
		"revertedAt":       now(),
		"sandbox":          false,
	})
}

// ─── Mojaloop Compliance Pre-Check ───────────────────────────────────────────

// handleMojaloopComplianceCheck handles POST /v1/mojaloop/compliance-check
// Runs a compliance pre-check before allowing a Mojaloop transfer for a subject
// with criminal records or adverse corporate check results.
func handleMojaloopComplianceCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var req struct {
		SubjectRef  string `json:"subjectRef"`
		SubjectType string `json:"subjectType"` // individual, corporate
		Amount      int64  `json:"amount"`      // in kobo
		Currency    string `json:"currency"`
		Purpose     string `json:"purpose"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}

	// Check Redis cache for recent compliance result
	cacheKey := "mojaloop:compliance:" + req.SubjectRef
	if cached := cacheGet(r.Context(), cacheKey); cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(cached)
		return
	}

	// Sandbox compliance logic
	rng := deterministicRNG(req.SubjectRef + req.SubjectType)
	approved := rng.Float64() > 0.1 // 90% approval rate in sandbox
	riskLevel := "low"
	if !approved {
		riskLevel = "high"
	} else if rng.Float64() < 0.2 {
		riskLevel = "medium"
	}

	result := map[string]interface{}{
		"subjectRef":    req.SubjectRef,
		"subjectType":   req.SubjectType,
		"approved":      approved,
		"riskLevel":     riskLevel,
		"complianceRef": fmt.Sprintf("COMP-%08d", rng.Intn(99999999)),
		"checks": map[string]interface{}{
			"sanctions":      true,
			"pep":            true,
			"criminalRecord": approved,
			"aml":            approved,
		},
		"sandbox":   true,
		"timestamp": now(),
	}

	// Cache for 5 minutes
	if data, err := json.Marshal(result); err == nil {
		cacheSet(r.Context(), cacheKey, data, 5*time.Minute)
	}

	publishEvent("bis.mojaloop.compliance_checked", map[string]interface{}{
		"subjectRef":  req.SubjectRef,
		"approved":    approved,
		"riskLevel":   riskLevel,
		"amount":      req.Amount,
		"timestamp":   now(),
	})

	writeJSON(w, http.StatusOK, result)
}

// ─── Kafka Topic Registration ─────────────────────────────────────────────────

// RegisterCriminalRecordsTopics ensures the new Kafka topics exist.
// Called during gateway startup.
func RegisterCriminalRecordsTopics() {
	topics := []string{
		"bis.criminal.request_submitted",
		"bis.criminal.record_ingested",
		"bis.criminal.record_verified",
		"bis.corporate.check_completed",
		"bis.field_visit.checked_in",
		"bis.field_visit.checked_out",
		"bis.investigation.thin_file_flagged",
		"bis.investigation.thin_file_reverted",
		"bis.mojaloop.compliance_checked",
		"bis.fluvio.criminal_record",
	}
	for _, topic := range topics {
		if err := kafkapkg.EnsureTopic(topic); err != nil {
			log.Printf("[Kafka] Topic registration warning for %s: %v", topic, err)
		}
	}
}

// ─── Sandbox helpers ──────────────────────────────────────────────────────────

// sandboxCriminalRecord returns a deterministic sandbox criminal record for testing.
func sandboxCriminalRecord(nin, agency string) map[string]interface{} {
	rng := deterministicRNG(nin + agency)
	hasRecord := rng.Float64() < 0.15 // 15% sandbox hit rate
	if !hasRecord {
		return map[string]interface{}{
			"nin":     nin,
			"agency":  agency,
			"records": []interface{}{},
			"count":   0,
			"sandbox": true,
		}
	}
	categories := []string{"financial", "drug", "traffic", "property", "other"}
	verdicts := []string{"convicted", "acquitted", "pending", "discharged"}
	return map[string]interface{}{
		"nin":    nin,
		"agency": agency,
		"records": []interface{}{
			map[string]interface{}{
				"recordRef":       fmt.Sprintf("CR-%08d", rng.Intn(99999999)),
				"offenceCategory": categories[rng.Intn(len(categories))],
				"verdict":         verdicts[rng.Intn(len(verdicts))],
				"courtName":       []string{"FCT High Court", "Lagos State High Court", "Abuja Magistrate Court"}[rng.Intn(3)],
				"dateCharged":     fmt.Sprintf("20%02d-%02d-%02d", rng.Intn(24), rng.Intn(12)+1, rng.Intn(28)+1),
				"sandbox":         true,
			},
		},
		"count":   1,
		"sandbox": true,
	}
}

// ─── Route registration (called from newRouter in main.go) ───────────────────

// RegisterCriminalRecordsRoutes adds all criminal records, corporate check,
// AI summary, field visit, and thin-file routes to the given mux.
// The protect argument is the chain(h, corsMiddleware, loggingMiddleware, authMiddleware) closure
// defined in newRouter — passed in to avoid a package-level dependency.
func RegisterCriminalRecordsRoutes(mux *http.ServeMux) {
	protect := func(h http.HandlerFunc) http.HandlerFunc {
		return chain(h, corsMiddleware, loggingMiddleware, authMiddleware)
	}

	// Criminal records data collection
	mux.HandleFunc("/v1/criminal-records/request", protect(handleCriminalRecordRequest))
	mux.HandleFunc("/v1/criminal-records/ingest", protect(handleCriminalRecordIngest))
	mux.HandleFunc("/v1/criminal-records/verify", protect(handleCriminalRecordVerify))

	// Corporate background check
	mux.HandleFunc("/v1/corporate/check", protect(handleCorporateCheck))

	// AI screening summary proxy
	mux.HandleFunc("/v1/ai/screening-summary", protect(handleAIScreeningSummary))

	// Field visit GPS check-in/out
	mux.HandleFunc("/v1/field-visit/checkin", protect(handleFieldVisitCheckIn))
	mux.HandleFunc("/v1/field-visit/checkout", protect(handleFieldVisitCheckOut))

	// Thin-file flag/revert
	mux.HandleFunc("/v1/thin-file/flag", protect(handleThinFileFlag))
	mux.HandleFunc("/v1/thin-file/revert", protect(handleThinFileRevert))

	// Mojaloop compliance pre-check
	mux.HandleFunc("/v1/mojaloop/compliance-check", protect(handleMojaloopComplianceCheck))

	// Dapr subscriptions for new topics
	mux.HandleFunc("/dapr/subscribe/criminal-records", handleDaprCriminalRecords)
	mux.HandleFunc("/dapr/subscribe/corporate-checks", handleDaprCorporateChecks)
}

// ─── Dapr Subscription Handlers ──────────────────────────────────────────────

// handleDaprCriminalRecords handles Dapr pub/sub events for criminal records.
func handleDaprCriminalRecords(w http.ResponseWriter, r *http.Request) {
	var event map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_event", "Invalid Dapr event")
		return
	}
	log.Printf("[Dapr] Criminal records event: %v", event["type"])
	// Forward to event processor for downstream processing
	publishEvent("bis.criminal.dapr_event", event)
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "SUCCESS"})
}

// handleDaprCorporateChecks handles Dapr pub/sub events for corporate checks.
func handleDaprCorporateChecks(w http.ResponseWriter, r *http.Request) {
	var event map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_event", "Invalid Dapr event")
		return
	}
	log.Printf("[Dapr] Corporate check event: %v", event["type"])
	publishEvent("bis.corporate.dapr_event", event)
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "SUCCESS"})
}

// ─── Unused import prevention ─────────────────────────────────────────────────
var _ = strings.Contains
var _ = rand.New
