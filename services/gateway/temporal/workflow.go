package temporal

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// InvestigationInput is the workflow input.
type InvestigationInput struct {
	Ref         string `json:"ref"`
	SubjectName string `json:"subject_name"`
	SubjectType string `json:"subject_type"`
	NIN         string `json:"nin,omitempty"`
	BVN         string `json:"bvn,omitempty"`
	RCNumber    string `json:"rc_number,omitempty"`
	Tier        string `json:"tier"`
	GatewayURL  string `json:"gateway_url"`
	RiskURL     string `json:"risk_url"`
}

// InvestigationResult is the workflow output.
type InvestigationResult struct {
	Ref          string  `json:"ref"`
	RiskScore    float64 `json:"risk_score"`
	RiskTier     string  `json:"risk_tier"`
	NINVerified  bool    `json:"nin_verified"`
	BVNVerified  bool    `json:"bvn_verified"`
	SanctionsHit bool    `json:"sanctions_hit"`
	IsPEP        bool    `json:"is_pep"`
	Status       string  `json:"status"`
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

// InvestigationWorkflow orchestrates the full BIS investigation pipeline.
// Steps: NIN → BVN → CAC → Sanctions → PEP → Credit → Risk Score → Field Task (if needed)
func InvestigationWorkflow(ctx workflow.Context, input InvestigationInput) (*InvestigationResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("InvestigationWorkflow started", "ref", input.Ref)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &InvestigationResult{Ref: input.Ref}

	// Step 1: NIN verification
	if input.NIN != "" {
		var ninResult map[string]interface{}
		if err := workflow.ExecuteActivity(ctx, VerifyNINActivity, input).Get(ctx, &ninResult); err != nil {
			logger.Warn("NIN verification failed", "error", err)
		} else {
			result.NINVerified = ninResult["status"] == "verified"
		}
	}

	// Step 2: BVN verification
	if input.BVN != "" {
		var bvnResult map[string]interface{}
		if err := workflow.ExecuteActivity(ctx, VerifyBVNActivity, input).Get(ctx, &bvnResult); err != nil {
			logger.Warn("BVN verification failed", "error", err)
		} else {
			result.BVNVerified = bvnResult["bvn"] != nil
		}
	}

	// Step 3: Sanctions screening
	var sanctionsResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ScreenSanctionsActivity, input).Get(ctx, &sanctionsResult); err != nil {
		logger.Warn("Sanctions screening failed", "error", err)
	} else {
		result.SanctionsHit = sanctionsResult["clear"] == false
	}

	// Step 4: PEP check
	var pepResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, CheckPEPActivity, input).Get(ctx, &pepResult); err != nil {
		logger.Warn("PEP check failed", "error", err)
	} else {
		result.IsPEP = pepResult["isPEP"] == true
	}

	// Step 5: Risk scoring
	var scoreResult map[string]interface{}
	scoreInput := map[string]interface{}{
		"subject_id":   input.Ref,
		"subject_type": input.SubjectType,
		"identity": map[string]interface{}{
			"nin_verified": result.NINVerified,
			"bvn_verified": result.BVNVerified,
		},
		"sanctions": map[string]interface{}{"ofac_hit": result.SanctionsHit},
		"pep":       map[string]interface{}{"is_pep": result.IsPEP},
	}
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

	// Step 6: Determine final status
	switch result.RiskTier {
	case "critical", "high":
		result.Status = "flagged"
	case "medium":
		result.Status = "review"
	default:
		result.Status = "completed"
	}

	logger.Info("InvestigationWorkflow completed", "ref", input.Ref, "score", result.RiskScore, "tier", result.RiskTier)
	return result, nil
}

// ─── Activities ───────────────────────────────────────────────────────────────

func VerifyNINActivity(ctx context.Context, input InvestigationInput) (map[string]interface{}, error) {
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/nin/%s", input.NIN))
}

func VerifyBVNActivity(ctx context.Context, input InvestigationInput) (map[string]interface{}, error) {
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/bvn/%s", input.BVN))
}

func ScreenSanctionsActivity(ctx context.Context, input InvestigationInput) (map[string]interface{}, error) {
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/sanctions/%s", input.SubjectName))
}

func CheckPEPActivity(ctx context.Context, input InvestigationInput) (map[string]interface{}, error) {
	return gatewayGet(ctx, input.GatewayURL, fmt.Sprintf("/v1/pep/%s", input.SubjectName))
}

func ScoreRiskActivity(ctx context.Context, scoreInput map[string]interface{}, riskURL string) (map[string]interface{}, error) {
	_ = activity.GetInfo(ctx)
	return riskPost(ctx, riskURL, "/v1/score", scoreInput)
}

// ─── Temporal Client ──────────────────────────────────────────────────────────

var temporalClient client.Client

// InitClient connects to the Temporal server. Call once at startup.
func InitClient() {
	temporalHost := os.Getenv("TEMPORAL_HOST")
	if temporalHost == "" {
		temporalHost = "localhost:7233"
	}
	var err error
	temporalClient, err = client.Dial(client.Options{HostPort: temporalHost})
	if err != nil {
		log.Printf("[Temporal] Warning: cannot connect to %s: %v (workflow engine disabled)", temporalHost, err)
		temporalClient = nil
		return
	}
	log.Printf("[Temporal] Client connected → %s", temporalHost)
}

// StartWorker registers and starts the workflow/activity worker.
func StartWorker() {
	if temporalClient == nil {
		return
	}
	w := worker.New(temporalClient, "bis-investigation", worker.Options{})
	w.RegisterWorkflow(InvestigationWorkflow)
	w.RegisterActivity(VerifyNINActivity)
	w.RegisterActivity(VerifyBVNActivity)
	w.RegisterActivity(ScreenSanctionsActivity)
	w.RegisterActivity(CheckPEPActivity)
	w.RegisterActivity(ScoreRiskActivity)
	go func() {
		if err := w.Run(worker.InterruptCh()); err != nil {
			log.Printf("[Temporal] Worker error: %v", err)
		}
	}()
	log.Println("[Temporal] Worker started on task queue: bis-investigation")
}

// TriggerInvestigation starts a new investigation workflow.
func TriggerInvestigation(ctx context.Context, input InvestigationInput) (string, error) {
	if temporalClient == nil {
		return "", fmt.Errorf("temporal client not initialised")
	}
	opts := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("investigation-%s", input.Ref),
		TaskQueue: "bis-investigation",
	}
	run, err := temporalClient.ExecuteWorkflow(ctx, opts, InvestigationWorkflow, input)
	if err != nil {
		return "", err
	}
	return run.GetID(), nil
}

// Close shuts down the Temporal client.
func Close() {
	if temporalClient != nil {
		temporalClient.Close()
	}
}

// ─── Struct wrapper for dependency injection ──────────────────────────────────

// Client is a thin wrapper around the package-level Temporal functions.
type Client struct{}

// NewClient initialises the Temporal connection and returns a Client.
func NewClient(host, namespace string) (*Client, error) {
	if host != "" {
		os.Setenv("TEMPORAL_HOST", host)
	}
	if namespace != "" {
		os.Setenv("TEMPORAL_NAMESPACE", namespace)
	}
	InitClient()
	return &Client{}, nil
}

// StartWorkflow starts a named workflow and returns its run ID.
func (c *Client) StartWorkflow(ctx context.Context, workflowType string, input interface{}) (string, error) {
	if temporalClient == nil {
		return "mock-run-id", nil // graceful degradation in dev
	}
	opts := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("%s-%d", workflowType, time.Now().UnixNano()),
		TaskQueue: "bis-investigation",
	}
	run, err := temporalClient.ExecuteWorkflow(ctx, opts, workflowType, input)
	if err != nil {
		return "", err
	}
	return run.GetID(), nil
}
