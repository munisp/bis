// Package workflows defines Temporal workflows for BIS compliance operations.
//
// Workflows:
//   - SarFilingWorkflow       — end-to-end SAR (Suspicious Activity Report) filing
//   - GoAmlFilingWorkflow     — goAML XML report generation and NFIU submission
//   - RiskProfileWorkflow     — aggregate risk profile computation for a subject
//   - KycExpiryWorkflow       — KYC record expiry monitoring and renewal reminders
//   - AmlEscalationWorkflow   — AML alert escalation through compliance tiers
package workflows

import (
	"time"

	"bis/compliance-worker/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ─── Shared retry policy ──────────────────────────────────────────────────────

var defaultRetry = temporal.RetryPolicy{
	InitialInterval:    2 * time.Second,
	BackoffCoefficient: 2.0,
	MaximumInterval:    60 * time.Second,
	MaximumAttempts:    5,
}

var actOpts = workflow.ActivityOptions{
	StartToCloseTimeout: 120 * time.Second,
	RetryPolicy:         &defaultRetry,
}

// ─── SAR Filing Workflow ──────────────────────────────────────────────────────

// SarFilingInput carries all parameters needed to file a SAR
type SarFilingInput struct {
	SarID          int    `json:"sarId"`
	TenantID       int    `json:"tenantId"`
	SubjectRef     string `json:"subjectRef"`
	SubjectName    string `json:"subjectName"`
	SarType        string `json:"sarType"`    // "STR" | "CTR" | "SAR"
	FilingOfficer  int    `json:"filingOfficer"`
	GatewayURL     string `json:"gatewayUrl"`
	ComplianceURL  string `json:"complianceUrl"`
	LakehouseURL   string `json:"lakehouseUrl"`
}

// SarFilingResult is returned when the workflow completes
type SarFilingResult struct {
	SarID          int    `json:"sarId"`
	Status         string `json:"status"` // "submitted" | "failed" | "pending_review"
	NFIUReference  string `json:"nfiuReference"`
	XMLReportPath  string `json:"xmlReportPath"`
	RiskScore      float64 `json:"riskScore"`
	SubmittedAt    string `json:"submittedAt"`
}

// SarFilingWorkflow orchestrates the complete SAR filing process
func SarFilingWorkflow(ctx workflow.Context, input SarFilingInput) (SarFilingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("SarFilingWorkflow started", "sarId", input.SarID, "subjectRef", input.SubjectRef)

	ctx = workflow.WithActivityOptions(ctx, actOpts)
	var result SarFilingResult
	result.SarID = input.SarID

	// Step 1: Validate SAR data completeness
	var validationResult activities.ValidationResult
	if err := workflow.ExecuteActivity(ctx, activities.ValidateSarData, input.SarID, input.GatewayURL).Get(ctx, &validationResult); err != nil {
		logger.Error("SAR validation failed", "error", err)
		result.Status = "failed"
		return result, err
	}
	if !validationResult.Valid {
		result.Status = "pending_review"
		return result, nil
	}

	// Step 2: Compute risk score for the subject
	var riskScore float64
	if err := workflow.ExecuteActivity(ctx, activities.ComputeSubjectRiskScore, input.SubjectRef, input.GatewayURL).Get(ctx, &riskScore); err != nil {
		logger.Warn("Risk score computation failed, using default", "error", err)
		riskScore = 50.0
	}
	result.RiskScore = riskScore

	// Step 3: Generate goAML XML report
	var xmlPath string
	if err := workflow.ExecuteActivity(ctx, activities.GenerateGoAMLReport, input.SarID, input.ComplianceURL).Get(ctx, &xmlPath); err != nil {
		logger.Error("goAML report generation failed", "error", err)
		result.Status = "failed"
		return result, err
	}
	result.XMLReportPath = xmlPath

	// Step 4: Submit to NFIU (Nigerian Financial Intelligence Unit)
	var nfiuRef string
	if err := workflow.ExecuteActivity(ctx, activities.SubmitToNFIU, input.SarID, xmlPath, input.GatewayURL).Get(ctx, &nfiuRef); err != nil {
		logger.Warn("NFIU submission failed, queuing for retry", "error", err)
		// Don't fail the workflow — queue for manual retry
		result.Status = "pending_nfiu"
		result.NFIUReference = ""
	} else {
		result.NFIUReference = nfiuRef
		result.Status = "submitted"
	}

	// Step 5: Write to Lakehouse for analytics
	_ = workflow.ExecuteActivity(ctx, activities.WriteSarToLakehouse, input.SarID, riskScore, input.LakehouseURL).Get(ctx, nil)

	// Step 6: Update SAR status in PostgreSQL
	if err := workflow.ExecuteActivity(ctx, activities.UpdateSarStatus, input.SarID, result.Status, result.NFIUReference).Get(ctx, nil); err != nil {
		logger.Warn("SAR status update failed", "error", err)
	}

	result.SubmittedAt = workflow.Now(ctx).Format(time.RFC3339)
	logger.Info("SarFilingWorkflow completed", "sarId", input.SarID, "status", result.Status)
	return result, nil
}

// ─── goAML Filing Workflow ────────────────────────────────────────────────────

// GoAmlFilingInput carries parameters for a goAML filing
type GoAmlFilingInput struct {
	FilingID      int    `json:"filingId"`
	TenantID      int    `json:"tenantId"`
	FilingType    string `json:"filingType"` // "STR" | "CTR" | "PEP" | "TF"
	SubjectRef    string `json:"subjectRef"`
	ComplianceURL string `json:"complianceUrl"`
	GatewayURL    string `json:"gatewayUrl"`
}

// GoAmlFilingResult is returned when the workflow completes
type GoAmlFilingResult struct {
	FilingID    int    `json:"filingId"`
	Status      string `json:"status"`
	XMLContent  string `json:"xmlContent"`
	SubmittedAt string `json:"submittedAt"`
}

// GoAmlFilingWorkflow orchestrates goAML report generation and submission
func GoAmlFilingWorkflow(ctx workflow.Context, input GoAmlFilingInput) (GoAmlFilingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("GoAmlFilingWorkflow started", "filingId", input.FilingID)

	ctx = workflow.WithActivityOptions(ctx, actOpts)
	var result GoAmlFilingResult
	result.FilingID = input.FilingID

	// Step 1: Fetch all related transactions and entities
	var enrichedData activities.GoAmlEnrichedData
	if err := workflow.ExecuteActivity(ctx, activities.FetchGoAmlData, input.FilingID, input.GatewayURL).Get(ctx, &enrichedData); err != nil {
		result.Status = "failed"
		return result, err
	}

	// Step 2: Generate goAML XML
	var xmlContent string
	if err := workflow.ExecuteActivity(ctx, activities.GenerateGoAMLXML, input.FilingID, enrichedData, input.ComplianceURL).Get(ctx, &xmlContent); err != nil {
		result.Status = "failed"
		return result, err
	}
	result.XMLContent = xmlContent

	// Step 3: Validate XML against goAML schema
	var schemaValid bool
	if err := workflow.ExecuteActivity(ctx, activities.ValidateGoAMLSchema, xmlContent, input.ComplianceURL).Get(ctx, &schemaValid); err != nil || !schemaValid {
		result.Status = "schema_invalid"
		return result, nil
	}

	// Step 4: Submit to goAML portal
	if err := workflow.ExecuteActivity(ctx, activities.SubmitGoAML, input.FilingID, xmlContent, input.GatewayURL).Get(ctx, nil); err != nil {
		result.Status = "submission_failed"
		return result, nil
	}

	result.Status = "submitted"
	result.SubmittedAt = workflow.Now(ctx).Format(time.RFC3339)
	return result, nil
}

// ─── Risk Profile Workflow ────────────────────────────────────────────────────

// RiskProfileInput carries parameters for risk profile computation
type RiskProfileInput struct {
	SubjectRef    string `json:"subjectRef"`
	SubjectName   string `json:"subjectName"`
	TenantID      int    `json:"tenantId"`
	Trigger       string `json:"trigger"` // "manual" | "kyc_update" | "transaction" | "sar_filing"
	GatewayURL    string `json:"gatewayUrl"`
	MLServiceURL  string `json:"mlServiceUrl"`
	LakehouseURL  string `json:"lakehouseUrl"`
}

// RiskProfileResult is the computed risk profile
type RiskProfileResult struct {
	SubjectRef          string   `json:"subjectRef"`
	CompositeRiskScore  float64  `json:"compositeRiskScore"`
	RiskTier            string   `json:"riskTier"` // "low" | "medium" | "high" | "critical"
	KycRiskScore        float64  `json:"kycRiskScore"`
	TransactionRiskScore float64 `json:"transactionRiskScore"`
	AmlRiskScore        float64  `json:"amlRiskScore"`
	SanctionsMatch      bool     `json:"sanctionsMatch"`
	PepMatch            bool     `json:"pepMatch"`
	AdverseMediaHits    int      `json:"adverseMediaHits"`
	Flags               []string `json:"flags"`
	ComputedAt          string   `json:"computedAt"`
}

// RiskProfileWorkflow aggregates risk signals from all BIS domains
func RiskProfileWorkflow(ctx workflow.Context, input RiskProfileInput) (RiskProfileResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("RiskProfileWorkflow started", "subjectRef", input.SubjectRef)

	ctx = workflow.WithActivityOptions(ctx, actOpts)
	var result RiskProfileResult
	result.SubjectRef = input.SubjectRef

	// Run all risk signal fetches in parallel
	var kycScore, txScore, amlScore float64
	var sanctionsMatch, pepMatch bool
	var adverseHits int
	var flags []string

	kycFuture := workflow.ExecuteActivity(ctx, activities.FetchKycRiskScore, input.SubjectRef, input.GatewayURL)
	txFuture := workflow.ExecuteActivity(ctx, activities.FetchTransactionRiskScore, input.SubjectRef, input.GatewayURL)
	amlFuture := workflow.ExecuteActivity(ctx, activities.FetchAmlRiskScore, input.SubjectRef, input.GatewayURL)
	sanctionsFuture := workflow.ExecuteActivity(ctx, activities.CheckSanctions, input.SubjectRef, input.GatewayURL)
	pepFuture := workflow.ExecuteActivity(ctx, activities.CheckPEP, input.SubjectRef, input.GatewayURL)
	mediaFuture := workflow.ExecuteActivity(ctx, activities.FetchAdverseMedia, input.SubjectRef, input.MLServiceURL)

	kycFuture.Get(ctx, &kycScore)
	txFuture.Get(ctx, &txScore)
	amlFuture.Get(ctx, &amlScore)
	sanctionsFuture.Get(ctx, &sanctionsMatch)
	pepFuture.Get(ctx, &pepMatch)
	mediaFuture.Get(ctx, &adverseHits)

	// Compute composite score (weighted average)
	composite := (kycScore*0.3 + txScore*0.3 + amlScore*0.4)
	if sanctionsMatch {
		composite = 95.0
		flags = append(flags, "SANCTIONS_MATCH")
	}
	if pepMatch {
		composite += 10.0
		flags = append(flags, "PEP_MATCH")
	}
	if adverseHits > 0 {
		composite += float64(adverseHits) * 2.0
		flags = append(flags, "ADVERSE_MEDIA")
	}
	if composite > 100.0 {
		composite = 100.0
	}

	tier := "low"
	switch {
	case composite >= 80:
		tier = "critical"
	case composite >= 60:
		tier = "high"
	case composite >= 40:
		tier = "medium"
	}

	result.CompositeRiskScore = composite
	result.RiskTier = tier
	result.KycRiskScore = kycScore
	result.TransactionRiskScore = txScore
	result.AmlRiskScore = amlScore
	result.SanctionsMatch = sanctionsMatch
	result.PepMatch = pepMatch
	result.AdverseMediaHits = adverseHits
	result.Flags = flags
	result.ComputedAt = workflow.Now(ctx).Format(time.RFC3339)

	// Persist risk profile to DB and Lakehouse
	_ = workflow.ExecuteActivity(ctx, activities.PersistRiskProfile, result, input.TenantID).Get(ctx, nil)
	_ = workflow.ExecuteActivity(ctx, activities.WriteRiskProfileToLakehouse, result, input.LakehouseURL).Get(ctx, nil)

	logger.Info("RiskProfileWorkflow completed", "subjectRef", input.SubjectRef, "score", composite, "tier", tier)
	return result, nil
}

// ─── KYC Expiry Workflow ──────────────────────────────────────────────────────

// KycExpiryInput carries parameters for KYC expiry monitoring
type KycExpiryInput struct {
	TenantID   int    `json:"tenantId"`
	GatewayURL string `json:"gatewayUrl"`
}

// KycExpiryWorkflow runs daily to find expiring KYC records and send renewal reminders
func KycExpiryWorkflow(ctx workflow.Context, input KycExpiryInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("KycExpiryWorkflow started", "tenantId", input.TenantID)

	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 300 * time.Second,
		RetryPolicy:         &defaultRetry,
	})

	var expiring []activities.ExpiringKycRecord
	if err := workflow.ExecuteActivity(ctx, activities.FetchExpiringKycRecords, input.TenantID, 30).Get(ctx, &expiring); err != nil {
		return err
	}

	for _, rec := range expiring {
		_ = workflow.ExecuteActivity(ctx, activities.SendKycRenewalReminder, rec).Get(ctx, nil)
	}

	logger.Info("KycExpiryWorkflow completed", "recordsProcessed", len(expiring))
	return nil
}
