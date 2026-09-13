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

	"bis/gateway/temporal/screening"
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

// InitClient connects to the explicitly configured Temporal server.
func InitClient() error {
	temporalHost := os.Getenv("TEMPORAL_HOST")
	namespace := os.Getenv("TEMPORAL_NAMESPACE")
	if temporalHost == "" || namespace == "" {
		return fmt.Errorf("TEMPORAL_HOST and TEMPORAL_NAMESPACE must be configured")
	}
	configuredClient, err := client.Dial(client.Options{HostPort: temporalHost, Namespace: namespace})
	if err != nil {
		return fmt.Errorf("connect to Temporal at %s: %w", temporalHost, err)
	}
	temporalClient = configuredClient
	log.Printf("[Temporal] Client connected → %s", temporalHost)
	return nil
}

// ─── Workflow contract registry (WP6 FIX B) ─────────────────────────────────
//
// workflowTaskQueues is the single source of truth for which workflow types
// have a registered worker handler and on which task queue. The TypeScript
// side of this contract lives in server/temporal.manifest.json; keep both in
// sync. The HTTP bridge (handleWorkflowStart) fails closed for any workflow
// type that is not listed here.

var workflowTaskQueues = map[string]string{
	// gateway workers (this package + screening + extended)
	"InvestigationWorkflow":   "bis-investigation",
	"CriminalRecordsWorkflow": "bis-investigation",
	"CorporateCheckWorkflow":  "bis-investigation",
	"FieldVisitWorkflow":      "bis-investigation",
	"ScreeningWorkflow":       "bis-screening",
	// compliance-worker service (services/compliance-worker)
	"SarFilingWorkflow":   "bis-compliance",
	"GoAmlFilingWorkflow": "bis-compliance",
	"RiskProfileWorkflow": "bis-compliance",
	"KycExpiryWorkflow":   "bis-compliance",
}

// RegisteredWorkflowTaskQueue returns the task queue a workflow type is
// registered on, or false when no worker handles it.
func RegisteredWorkflowTaskQueue(workflowType string) (string, bool) {
	q, ok := workflowTaskQueues[workflowType]
	return q, ok
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
	// Extended investigation workflows share the bis-investigation task queue.
	RegisterExtendedWorkflows(w)
	go func() {
		if err := w.Run(worker.InterruptCh()); err != nil {
			log.Printf("[Temporal] Worker error: %v", err)
		}
	}()
	log.Println("[Temporal] Worker started on task queue: bis-investigation")
}

// StartScreeningWorker registers and starts the screening workflow worker on
// the bis-screening task queue.
func StartScreeningWorker() {
	if temporalClient == nil {
		return
	}
	w := screening.RegisterScreeningWorker(temporalClient)
	go func() {
		if err := w.Run(worker.InterruptCh()); err != nil {
			log.Printf("[Temporal] Screening worker error: %v", err)
		}
	}()
	log.Println("[Temporal] Worker started on task queue: bis-screening")
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

// NewClient establishes a Temporal client using explicit service configuration.
func NewClient(host, namespace string) (*Client, error) {
	if host == "" || namespace == "" {
		return nil, fmt.Errorf("Temporal host and namespace are required")
	}
	configuredClient, err := client.Dial(client.Options{HostPort: host, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("connect to Temporal at %s: %w", host, err)
	}
	temporalClient = configuredClient
	return &Client{}, nil
}

// WorkflowStatus describes a workflow execution and returns its Temporal
// status string (e.g. "Running", "Completed", "Terminated").
func (c *Client) WorkflowStatus(ctx context.Context, workflowID string) (string, error) {
	if temporalClient == nil {
		return "", fmt.Errorf("Temporal client is unavailable")
	}
	resp, err := temporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		return "", err
	}
	info := resp.GetWorkflowExecutionInfo()
	if info == nil {
		return "", fmt.Errorf("workflow %q has no execution info", workflowID)
	}
	return info.GetStatus().String(), nil
}

// CancelWorkflow requests cancellation of a running workflow execution.
func (c *Client) CancelWorkflow(ctx context.Context, workflowID string) error {
	if temporalClient == nil {
		return fmt.Errorf("Temporal client is unavailable")
	}
	return temporalClient.CancelWorkflow(ctx, workflowID, "")
}

// StartWorkflow starts a named workflow and returns its workflow ID.
// The task queue is resolved from the workflow contract registry; a workflow
// type with no registered worker is rejected (fail closed).
func (c *Client) StartWorkflow(ctx context.Context, workflowType string, input interface{}) (string, error) {
	workflowID, _, err := c.StartWorkflowWithOptions(ctx, workflowType, "", "", input)
	return workflowID, err
}

// StartWorkflowWithOptions starts a named workflow, honouring the requested
// workflow ID (idempotent re-starts reuse the same ID) and validating the
// requested task queue against the contract registry. It returns the
// workflow ID and the run ID of the started execution.
func (c *Client) StartWorkflowWithOptions(ctx context.Context, workflowType, taskQueue, workflowID string, input interface{}) (string, string, error) {
	if temporalClient == nil {
		return "", "", fmt.Errorf("Temporal client is unavailable")
	}
	registeredQueue, ok := RegisteredWorkflowTaskQueue(workflowType)
	if !ok {
		return "", "", fmt.Errorf("workflow type %q has no registered worker; refusing to start a phantom execution", workflowType)
	}
	if taskQueue != "" && taskQueue != registeredQueue {
		return "", "", fmt.Errorf("task queue mismatch for %q: worker is registered on %q, not %q", workflowType, registeredQueue, taskQueue)
	}
	if workflowID == "" {
		workflowID = fmt.Sprintf("%s-%d", workflowType, time.Now().UnixNano())
	}
	opts := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: registeredQueue,
	}
	run, err := temporalClient.ExecuteWorkflow(ctx, opts, workflowType, input)
	if err != nil {
		return "", "", err
	}
	return run.GetID(), run.GetRunID(), nil
}
