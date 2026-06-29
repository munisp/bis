package temporal

// workflows_extended.go
//
// Three new Temporal workflows that close the P0–P2 gaps identified in the
// platform audit:
//
//   CriminalRecordsWorkflow  — agency polling → ingest → risk score → alert
//   CorporateCheckWorkflow   — CAC → FIRS → directors → sanctions → score
//   FieldVisitWorkflow       — dispatch → GPS check-in → findings → close
//
// All workflows are registered in StartWorker() alongside the existing
// InvestigationWorkflow.  Each workflow is idempotent: re-triggering with the
// same ref is a no-op (Temporal deduplicates by workflow ID).

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ─── Shared retry policy ──────────────────────────────────────────────────────

var defaultRetry = temporal.RetryPolicy{
	InitialInterval:    2 * time.Second,
	BackoffCoefficient: 2.0,
	MaximumInterval:    30 * time.Second,
	MaximumAttempts:    5,
}

var actOpts = workflow.ActivityOptions{
	StartToCloseTimeout: 60 * time.Second,
	RetryPolicy:         &defaultRetry,
}

// ─── CriminalRecordsWorkflow ──────────────────────────────────────────────────

// CriminalRecordsInput carries all parameters needed to run the workflow.
type CriminalRecordsInput struct {
	RequestRef  string `json:"requestRef"`
	SubjectRef  string `json:"subjectRef"`
	SubjectName string `json:"subjectName"`
	NIN         string `json:"nin"`
	BVN         string `json:"bvn"`
	Agencies    []string `json:"agencies"` // e.g. ["NPF","EFCC","ICPC"]
	GatewayURL  string `json:"gatewayUrl"`
	RiskURL     string `json:"riskUrl"`
	Trigger     string `json:"trigger"` // "manual" | "mojaloop_compliance" | "investigation"
}

// CriminalRecordsResult is returned when the workflow completes.
type CriminalRecordsResult struct {
	RequestRef    string                   `json:"requestRef"`
	RecordsFound  int                      `json:"recordsFound"`
	WarrantActive bool                     `json:"warrantActive"`
	RiskScore     float64                  `json:"riskScore"`
	RiskTier      string                   `json:"riskTier"`
	Status        string                   `json:"status"` // completed | flagged | review
	AgencyResults map[string]interface{}   `json:"agencyResults"`
}

// CriminalRecordsWorkflow orchestrates multi-agency criminal record collection.
//
//	Workflow ID: criminal-records-{requestRef}
//	Task Queue:  bis-investigation
func CriminalRecordsWorkflow(ctx workflow.Context, input CriminalRecordsInput) (CriminalRecordsResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CriminalRecordsWorkflow started", "ref", input.RequestRef, "trigger", input.Trigger)

	result := CriminalRecordsResult{
		RequestRef:    input.RequestRef,
		AgencyResults: make(map[string]interface{}),
	}

	ctx = workflow.WithActivityOptions(ctx, actOpts)

	// Step 1: Poll each requested agency in parallel
	agencies := input.Agencies
	if len(agencies) == 0 {
		agencies = []string{"NPF", "EFCC", "ICPC"} // default set
	}

	type agencyResult struct {
		agency string
		data   map[string]interface{}
		err    error
	}
	futures := make([]workflow.Future, len(agencies))
	for i, ag := range agencies {
		ag := ag // capture
		futures[i] = workflow.ExecuteActivity(ctx, PollAgencyActivity, input, ag)
	}
	for i, f := range agencies {
		var agData map[string]interface{}
		if err := futures[i].Get(ctx, &agData); err != nil {
			logger.Warn("Agency poll failed", "agency", f, "error", err)
			result.AgencyResults[f] = map[string]interface{}{"error": err.Error()}
		} else {
			result.AgencyResults[f] = agData
			// Count records
			if count, ok := agData["recordCount"].(float64); ok {
				result.RecordsFound += int(count)
			}
			// Check for active warrant
			if warrant, ok := agData["activeWarrant"].(bool); ok && warrant {
				result.WarrantActive = true
			}
		}
	}

	// Step 2: Ingest records into BIS DB via gateway
	var ingestResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, IngestCriminalRecordsActivity, input, result.AgencyResults).Get(ctx, &ingestResult); err != nil {
		logger.Warn("Criminal records ingest failed", "error", err)
	}

	// Step 3: Score risk
	scoreInput := map[string]interface{}{
		"subjectRef":    input.SubjectRef,
		"subjectName":   input.SubjectName,
		"criminalSignals": map[string]interface{}{
			"recordsFound":  result.RecordsFound,
			"warrantActive": result.WarrantActive,
			"agencies":      agencies,
		},
	}
	var scoreResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ScoreRiskActivity, scoreInput, input.RiskURL).Get(ctx, &scoreResult); err != nil {
		logger.Warn("Risk scoring failed", "error", err)
		result.RiskScore = 50
		result.RiskTier = "medium"
	} else {
		if v, ok := scoreResult["composite_score"].(float64); ok {
			result.RiskScore = v
		}
		if v, ok := scoreResult["risk_tier"].(string); ok {
			result.RiskTier = v
		}
	}

	// Step 4: Alert if warrant or critical risk
	if result.WarrantActive || result.RiskTier == "critical" {
		_ = workflow.ExecuteActivity(ctx, SendCriminalAlertActivity, input, result).Get(ctx, nil)
		result.Status = "flagged"
	} else if result.RiskTier == "high" || result.RiskTier == "medium" {
		result.Status = "review"
	} else {
		result.Status = "completed"
	}

	logger.Info("CriminalRecordsWorkflow completed",
		"ref", input.RequestRef,
		"records", result.RecordsFound,
		"warrant", result.WarrantActive,
		"score", result.RiskScore,
		"status", result.Status,
	)
	return result, nil
}

// ─── CorporateCheckWorkflow ───────────────────────────────────────────────────

type CorporateCheckInput struct {
	ProfileRef  string `json:"profileRef"`
	CompanyName string `json:"companyName"`
	RCNumber    string `json:"rcNumber"`
	TIN         string `json:"tin"`
	GatewayURL  string `json:"gatewayUrl"`
	RiskURL     string `json:"riskUrl"`
	Trigger     string `json:"trigger"`
}

type CorporateCheckResult struct {
	ProfileRef   string                 `json:"profileRef"`
	CACStatus    string                 `json:"cacStatus"`
	FIRSCleared  bool                   `json:"firsCleared"`
	DirectorsPEP bool                   `json:"directorsPEP"`
	SanctionsHit bool                   `json:"sanctionsHit"`
	RiskScore    float64                `json:"riskScore"`
	RiskTier     string                 `json:"riskTier"`
	Status       string                 `json:"status"`
	Checks       map[string]interface{} `json:"checks"`
}

// CorporateCheckWorkflow runs CAC → FIRS → Directors → Sanctions in sequence,
// then scores and optionally alerts.
//
//	Workflow ID: corporate-check-{profileRef}
//	Task Queue:  bis-investigation
func CorporateCheckWorkflow(ctx workflow.Context, input CorporateCheckInput) (CorporateCheckResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CorporateCheckWorkflow started", "ref", input.ProfileRef)

	result := CorporateCheckResult{
		ProfileRef: input.ProfileRef,
		Checks:     make(map[string]interface{}),
	}

	ctx = workflow.WithActivityOptions(ctx, actOpts)

	// Step 1: CAC registry lookup
	var cacData map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, CACLookupActivity, input).Get(ctx, &cacData); err != nil {
		logger.Warn("CAC lookup failed", "error", err)
		result.Checks["cac"] = map[string]interface{}{"error": err.Error()}
	} else {
		result.Checks["cac"] = cacData
		if status, ok := cacData["status"].(string); ok {
			result.CACStatus = status
		}
	}

	// Step 2: FIRS tax clearance
	var firsData map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, FIRSClearanceActivity, input).Get(ctx, &firsData); err != nil {
		logger.Warn("FIRS clearance failed", "error", err)
		result.Checks["firs"] = map[string]interface{}{"error": err.Error()}
	} else {
		result.Checks["firs"] = firsData
		if cleared, ok := firsData["cleared"].(bool); ok {
			result.FIRSCleared = cleared
		}
	}

	// Step 3: Directors PEP check (parallel with sanctions)
	dirFuture := workflow.ExecuteActivity(ctx, DirectorsPEPActivity, input)
	sanFuture := workflow.ExecuteActivity(ctx, CorporateSanctionsActivity, input)

	var dirData map[string]interface{}
	if err := dirFuture.Get(ctx, &dirData); err != nil {
		logger.Warn("Directors PEP check failed", "error", err)
		result.Checks["directors"] = map[string]interface{}{"error": err.Error()}
	} else {
		result.Checks["directors"] = dirData
		if pep, ok := dirData["pepFound"].(bool); ok {
			result.DirectorsPEP = pep
		}
	}

	var sanData map[string]interface{}
	if err := sanFuture.Get(ctx, &sanData); err != nil {
		logger.Warn("Corporate sanctions check failed", "error", err)
		result.Checks["sanctions"] = map[string]interface{}{"error": err.Error()}
	} else {
		result.Checks["sanctions"] = sanData
		if hit, ok := sanData["hit"].(bool); ok {
			result.SanctionsHit = hit
		}
	}

	// Step 4: Score
	scoreInput := map[string]interface{}{
		"profileRef":  input.ProfileRef,
		"companyName": input.CompanyName,
		"corporateSignals": map[string]interface{}{
			"cacStatus":    result.CACStatus,
			"firsCleared":  result.FIRSCleared,
			"directorsPEP": result.DirectorsPEP,
			"sanctionsHit": result.SanctionsHit,
		},
	}
	var scoreResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ScoreRiskActivity, scoreInput, input.RiskURL).Get(ctx, &scoreResult); err != nil {
		result.RiskScore = 50
		result.RiskTier = "medium"
	} else {
		if v, ok := scoreResult["composite_score"].(float64); ok {
			result.RiskScore = v
		}
		if v, ok := scoreResult["risk_tier"].(string); ok {
			result.RiskTier = v
		}
	}

	// Step 5: Determine status
	if result.SanctionsHit || result.CACStatus == "struck_off" {
		result.Status = "flagged"
	} else if result.DirectorsPEP || !result.FIRSCleared || result.RiskTier == "high" {
		result.Status = "review"
	} else {
		result.Status = "completed"
	}

	logger.Info("CorporateCheckWorkflow completed",
		"ref", input.ProfileRef,
		"cac", result.CACStatus,
		"firs", result.FIRSCleared,
		"sanctions", result.SanctionsHit,
		"score", result.RiskScore,
	)
	return result, nil
}

// ─── FieldVisitWorkflow ───────────────────────────────────────────────────────

type FieldVisitInput struct {
	TaskRef        string  `json:"taskRef"`
	AgentRef       string  `json:"agentRef"`
	InvestigationRef string `json:"investigationRef"`
	SubjectRef     string  `json:"subjectRef"`
	Address        string  `json:"address"`
	GatewayURL     string  `json:"gatewayUrl"`
	DeadlineHours  int     `json:"deadlineHours"` // 0 = no deadline
}

type FieldVisitResult struct {
	TaskRef          string  `json:"taskRef"`
	Status           string  `json:"status"` // completed | failed | timeout
	CheckedIn        bool    `json:"checkedIn"`
	CheckedOut       bool    `json:"checkedOut"`
	AddressConfirmed bool    `json:"addressConfirmed"`
	SubjectPresent   bool    `json:"subjectPresent"`
	PhotoCount       int     `json:"photoCount"`
	RiskAdjustment   float64 `json:"riskAdjustment"` // +/- applied to investigation score
}

// FieldVisitWorkflow manages the full lifecycle of a field visit task:
// dispatch → GPS check-in (with deadline) → findings submission → close.
//
//	Workflow ID: field-visit-{taskRef}
//	Task Queue:  bis-investigation
func FieldVisitWorkflow(ctx workflow.Context, input FieldVisitInput) (FieldVisitResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("FieldVisitWorkflow started", "taskRef", input.TaskRef, "agent", input.AgentRef)

	result := FieldVisitResult{TaskRef: input.TaskRef}

	ctx = workflow.WithActivityOptions(ctx, actOpts)

	// Step 1: Dispatch task to agent (update DB status to dispatched)
	if err := workflow.ExecuteActivity(ctx, DispatchFieldTaskActivity, input).Get(ctx, nil); err != nil {
		logger.Error("Field task dispatch failed", "error", err)
		result.Status = "failed"
		return result, nil
	}

	// Step 2: Wait for GPS check-in signal or deadline
	deadline := 48 * time.Hour
	if input.DeadlineHours > 0 {
		deadline = time.Duration(input.DeadlineHours) * time.Hour
	}

	checkInCh := workflow.GetSignalChannel(ctx, "field-visit-checkin")
	var checkInData map[string]interface{}

	timerCtx, cancelTimer := workflow.WithCancel(ctx)
	timerFuture := workflow.NewTimer(timerCtx, deadline)

	selector := workflow.NewSelector(ctx)
	selector.AddFuture(timerFuture, func(f workflow.Future) {
		logger.Warn("FieldVisit deadline reached without check-in", "taskRef", input.TaskRef)
	})
	selector.AddReceive(checkInCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &checkInData)
		cancelTimer()
		result.CheckedIn = true
		logger.Info("Agent checked in", "taskRef", input.TaskRef, "data", checkInData)
	})
	selector.Select(ctx)

	if !result.CheckedIn {
		// Deadline expired — mark as timed out and escalate
		_ = workflow.ExecuteActivity(ctx, EscalateFieldVisitActivity, input, "deadline_exceeded").Get(ctx, nil)
		result.Status = "timeout"
		return result, nil
	}

	// Step 3: Wait for findings submission signal
	findingsCh := workflow.GetSignalChannel(ctx, "field-visit-findings")
	var findingsData map[string]interface{}

	findingsTimer, cancelFindingsTimer := workflow.WithCancel(ctx)
	findingsTimerFuture := workflow.NewTimer(findingsTimer, 4*time.Hour)

	findingsSel := workflow.NewSelector(ctx)
	findingsSel.AddFuture(findingsTimerFuture, func(f workflow.Future) {
		logger.Warn("Findings submission deadline reached", "taskRef", input.TaskRef)
	})
	findingsSel.AddReceive(findingsCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &findingsData)
		cancelFindingsTimer()
		result.CheckedOut = true
		if confirmed, ok := findingsData["addressConfirmed"].(bool); ok {
			result.AddressConfirmed = confirmed
		}
		if present, ok := findingsData["subjectPresent"].(bool); ok {
			result.SubjectPresent = present
		}
		if photos, ok := findingsData["photoCount"].(float64); ok {
			result.PhotoCount = int(photos)
		}
	})
	findingsSel.Select(ctx)

	// Step 4: Close the task and compute risk adjustment
	if err := workflow.ExecuteActivity(ctx, CloseFieldTaskActivity, input, findingsData).Get(ctx, nil); err != nil {
		logger.Warn("Field task close failed", "error", err)
	}

	// Risk adjustment: confirmed address + subject present = -10 (reduces risk)
	// Unconfirmed or subject absent = +15 (increases risk)
	if result.AddressConfirmed && result.SubjectPresent {
		result.RiskAdjustment = -10.0
	} else if !result.AddressConfirmed {
		result.RiskAdjustment = +15.0
	}

	result.Status = "completed"
	logger.Info("FieldVisitWorkflow completed",
		"taskRef", input.TaskRef,
		"addressConfirmed", result.AddressConfirmed,
		"subjectPresent", result.SubjectPresent,
		"riskAdjustment", result.RiskAdjustment,
	)
	return result, nil
}

// ─── Extended Activities ──────────────────────────────────────────────────────

// PollAgencyActivity calls the gateway's criminal records endpoint for one agency.
func PollAgencyActivity(ctx context.Context, input CriminalRecordsInput, agency string) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	url := fmt.Sprintf("%s/v1/criminal-records/poll/%s?subjectRef=%s&nin=%s",
		input.GatewayURL, agency, input.SubjectRef, input.NIN)
	return gatewayGet(ctx, input.GatewayURL, url[len(input.GatewayURL):])
}

// IngestCriminalRecordsActivity persists agency results via the gateway.
func IngestCriminalRecordsActivity(ctx context.Context, input CriminalRecordsInput, agencyResults map[string]interface{}) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	body := map[string]interface{}{
		"requestRef":    input.RequestRef,
		"subjectRef":    input.SubjectRef,
		"agencyResults": agencyResults,
	}
	return riskPost(ctx, input.GatewayURL, "/v1/criminal-records/ingest", body)
}

// SendCriminalAlertActivity notifies the owner when a warrant or critical risk is found.
func SendCriminalAlertActivity(ctx context.Context, input CriminalRecordsInput, result CriminalRecordsResult) error {
	_ = activity.GetInfo(ctx)
	body := map[string]interface{}{
		"type":       "criminal_alert",
		"requestRef": input.RequestRef,
		"subjectRef": input.SubjectRef,
		"warrant":    result.WarrantActive,
		"riskScore":  result.RiskScore,
		"riskTier":   result.RiskTier,
	}
	_, err := riskPost(ctx, input.GatewayURL, "/v1/alerts/criminal", body)
	return err
}

// CACLookupActivity calls the CAC registry check endpoint.
func CACLookupActivity(ctx context.Context, input CorporateCheckInput) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/cac/%s", input.RCNumber))
}

// FIRSClearanceActivity calls the FIRS tax clearance endpoint.
func FIRSClearanceActivity(ctx context.Context, input CorporateCheckInput) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/firs/%s", input.TIN))
}

// DirectorsPEPActivity checks all directors for PEP status.
func DirectorsPEPActivity(ctx context.Context, input CorporateCheckInput) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/corporate/%s/directors-pep", input.RCNumber))
}

// CorporateSanctionsActivity screens the company name against sanctions lists.
func CorporateSanctionsActivity(ctx context.Context, input CorporateCheckInput) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/sanctions/%s", input.CompanyName))
}

// DispatchFieldTaskActivity updates the field task status to dispatched.
func DispatchFieldTaskActivity(ctx context.Context, input FieldVisitInput) error {
	_ = activity.GetInfo(ctx)
	body := map[string]interface{}{
		"taskRef": input.TaskRef,
		"status":  "dispatched",
	}
	_, err := riskPost(ctx, input.GatewayURL, "/v1/field-tasks/dispatch", body)
	return err
}

// EscalateFieldVisitActivity creates an escalation alert for overdue field tasks.
func EscalateFieldVisitActivity(ctx context.Context, input FieldVisitInput, reason string) error {
	_ = activity.GetInfo(ctx)
	body := map[string]interface{}{
		"taskRef":          input.TaskRef,
		"agentRef":         input.AgentRef,
		"investigationRef": input.InvestigationRef,
		"reason":           reason,
	}
	_, err := riskPost(ctx, input.GatewayURL, "/v1/field-tasks/escalate", body)
	return err
}

// CloseFieldTaskActivity marks a field task as completed with findings.
func CloseFieldTaskActivity(ctx context.Context, input FieldVisitInput, findings map[string]interface{}) error {
	_ = activity.GetInfo(ctx)
	body := map[string]interface{}{
		"taskRef":  input.TaskRef,
		"status":   "completed",
		"findings": findings,
	}
	_, err := riskPost(ctx, input.GatewayURL, "/v1/field-tasks/close", body)
	return err
}

// ─── Worker registration ──────────────────────────────────────────────────────

// RegisterExtendedWorkflows adds the three new workflows and their activities
// to the Temporal worker. Call this from StartWorker() after registering the
// base InvestigationWorkflow.
func RegisterExtendedWorkflows(w interface{ RegisterWorkflow(interface{}); RegisterActivity(interface{}, ...interface{}) }) {
	w.RegisterWorkflow(CriminalRecordsWorkflow)
	w.RegisterWorkflow(CorporateCheckWorkflow)
	w.RegisterWorkflow(FieldVisitWorkflow)

	w.RegisterActivity(PollAgencyActivity)
	w.RegisterActivity(IngestCriminalRecordsActivity)
	w.RegisterActivity(SendCriminalAlertActivity)
	w.RegisterActivity(CACLookupActivity)
	w.RegisterActivity(FIRSClearanceActivity)
	w.RegisterActivity(DirectorsPEPActivity)
	w.RegisterActivity(CorporateSanctionsActivity)
	w.RegisterActivity(DispatchFieldTaskActivity)
	w.RegisterActivity(EscalateFieldVisitActivity)
	w.RegisterActivity(CloseFieldTaskActivity)
}
