// Package screening implements the Temporal workflow for Nigerian background screening.
// Each screening order fans out to type-specific activities, collects results,
// runs auto-assessment, and triggers adverse action or completion events.
package screening

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// ScreeningOrderInput is the workflow input, published to bis.screening.orders.
type ScreeningOrderInput struct {
	OrderRef        string   `json:"order_ref"`
	CandidateRef    string   `json:"candidate_ref"`
	PackageID       int      `json:"package_id"`
	TenantID        string   `json:"tenant_id"`
	ScreeningTypes  []string `json:"screening_types"`
	NIN             string   `json:"nin,omitempty"`
	BVN             string   `json:"bvn,omitempty"`
	FullName        string   `json:"full_name"`
	DateOfBirth     string   `json:"date_of_birth,omitempty"`
	StateOfOrigin   string   `json:"state_of_origin,omitempty"`
	EngineURL       string   `json:"engine_url"`
	ScorerURL       string   `json:"scorer_url"`
	BffURL          string   `json:"bff_url"`
	Priority        string   `json:"priority"` // standard | expedited | rush
}

// ScreeningResult is the per-type result from the screening engine.
type ScreeningResult struct {
	ScreeningType string                 `json:"screening_type"`
	Outcome       string                 `json:"outcome"` // clear|consider|adverse|unverified|error
	RiskScore     float64                `json:"risk_score"`
	Summary       string                 `json:"summary"`
	Details       map[string]interface{} `json:"details"`
	Sources       []string               `json:"sources"`
	CompletedAt   string                 `json:"completed_at"`
	Error         string                 `json:"error,omitempty"`
}

// ScreeningOrderResult is the final workflow output.
type ScreeningOrderResult struct {
	OrderRef        string            `json:"order_ref"`
	OverallOutcome  string            `json:"overall_outcome"` // clear|consider|adverse
	CompositeScore  float64           `json:"composite_score"`
	Results         []ScreeningResult `json:"results"`
	AdverseItems    []string          `json:"adverse_items,omitempty"`
	RequiresAdverse bool              `json:"requires_adverse"`
	CompletedAt     string            `json:"completed_at"`
	Status          string            `json:"status"`
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

// ScreeningWorkflow orchestrates the full Nigerian background screening pipeline.
//
// Steps:
//  1. Fan out to all requested screening types in parallel
//  2. Collect results with timeout
//  3. Run ML scoring on all results
//  4. Run auto-assessment rules
//  5. If adverse items found → trigger pre-adverse action workflow
//  6. Publish completion event to bis.screening.completed
//  7. Trigger webhooks for subscribed tenants
func ScreeningWorkflow(ctx workflow.Context, input ScreeningOrderInput) (*ScreeningOrderResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("ScreeningWorkflow started", "order_ref", input.OrderRef, "types", input.ScreeningTypes)

	// Activity options — generous timeout for external API calls
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    60 * time.Second,
			MaximumAttempts:    3,
			NonRetryableErrorTypes: []string{
				"InvalidNINError",
				"InvalidBVNError",
				"ConsentNotFoundError",
			},
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// ── Step 1: Fan out to all screening types in parallel ────────────────
	var futures []workflow.Future
	for _, st := range input.ScreeningTypes {
		st := st // capture loop variable
		f := workflow.ExecuteActivity(ctx, RunScreeningActivity, input, st)
		futures = append(futures, f)
	}

	// ── Step 2: Collect results ───────────────────────────────────────────
	var results []ScreeningResult
	var adverseItems []string
	totalScore := 0.0

	for i, f := range futures {
		var result ScreeningResult
		if err := f.Get(ctx, &result); err != nil {
			logger.Warn("Screening activity failed", "type", input.ScreeningTypes[i], "error", err)
			results = append(results, ScreeningResult{
				ScreeningType: input.ScreeningTypes[i],
				Outcome:       "error",
				RiskScore:     0.5,
				Summary:       fmt.Sprintf("Screening failed: %v", err),
				CompletedAt:   workflow.Now(ctx).UTC().Format(time.RFC3339),
			})
		} else {
			results = append(results, result)
			totalScore += result.RiskScore
			if result.Outcome == "adverse" {
				adverseItems = append(adverseItems, fmt.Sprintf("%s: %s", result.ScreeningType, result.Summary))
			}
		}
	}

	// ── Step 3: ML scoring ────────────────────────────────────────────────
	var scoredResults []ScreeningResult
	if err := workflow.ExecuteActivity(ctx, BatchScoreActivity, input, results).Get(ctx, &scoredResults); err != nil {
		logger.Warn("ML scoring failed, using raw scores", "error", err)
		scoredResults = results
	}

	// ── Step 4: Auto-assessment ───────────────────────────────────────────
	compositeScore := 0.0
	if len(scoredResults) > 0 {
		for _, r := range scoredResults {
			compositeScore += r.RiskScore
		}
		compositeScore /= float64(len(scoredResults))
	}

	overallOutcome := "clear"
	if len(adverseItems) > 0 {
		overallOutcome = "adverse"
	} else if compositeScore > 0.45 {
		overallOutcome = "consider"
	}

	requiresAdverse := overallOutcome == "adverse"

	// ── Step 5: Pre-adverse action workflow (NDPR-compliant) ─────────────
	if requiresAdverse {
		adverseAO := workflow.ActivityOptions{
			StartToCloseTimeout: 10 * time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 2,
			},
		}
		adverseCtx := workflow.WithActivityOptions(ctx, adverseAO)
		if err := workflow.ExecuteActivity(adverseCtx, TriggerPreAdverseActivity, input, adverseItems).Get(adverseCtx, nil); err != nil {
			logger.Warn("Pre-adverse action trigger failed", "error", err)
		}
	}

	// ── Step 6: Persist results and publish completion event ──────────────
	orderResult := &ScreeningOrderResult{
		OrderRef:        input.OrderRef,
		OverallOutcome:  overallOutcome,
		CompositeScore:  compositeScore,
		Results:         scoredResults,
		AdverseItems:    adverseItems,
		RequiresAdverse: requiresAdverse,
		CompletedAt:     workflow.Now(ctx).UTC().Format(time.RFC3339),
		Status:          "complete",
	}

	if err := workflow.ExecuteActivity(ctx, PersistOrderResultActivity, orderResult).Get(ctx, nil); err != nil {
		logger.Warn("Failed to persist order result", "error", err)
	}

	// ── Step 7: Trigger webhooks ──────────────────────────────────────────
	webhookAO := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	webhookCtx := workflow.WithActivityOptions(ctx, webhookAO)
	if err := workflow.ExecuteActivity(webhookCtx, DeliverWebhooksActivity, input.TenantID, orderResult).Get(webhookCtx, nil); err != nil {
		logger.Warn("Webhook delivery failed", "error", err)
	}

	logger.Info("ScreeningWorkflow completed",
		"order_ref", input.OrderRef,
		"outcome", overallOutcome,
		"score", compositeScore,
	)
	return orderResult, nil
}

// ─── Activities ───────────────────────────────────────────────────────────────

// RunScreeningActivity calls the Rust screening-engine for a single screening type.
func RunScreeningActivity(ctx context.Context, input ScreeningOrderInput, screeningType string) (ScreeningResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("RunScreeningActivity", "type", screeningType, "order_ref", input.OrderRef)

	engineURL := input.EngineURL
	if engineURL == "" {
		engineURL = os.Getenv("SCREENING_ENGINE_URL")
		if engineURL == "" {
			engineURL = "http://bis-screening-engine:8085"
		}
	}

	payload := map[string]interface{}{
		"order_ref":       input.OrderRef,
		"candidate_ref":   input.CandidateRef,
		"screening_type":  screeningType,
		"nin":             input.NIN,
		"bvn":             input.BVN,
		"full_name":       input.FullName,
		"date_of_birth":   input.DateOfBirth,
		"state_of_origin": input.StateOfOrigin,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", engineURL+"/screen", strings.NewReader(string(body)))
	if err != nil {
		return ScreeningResult{ScreeningType: screeningType, Outcome: "error", Error: err.Error()}, nil
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 4 * time.Minute}
	resp, err := httpClient.Do(req)
	if err != nil {
		return ScreeningResult{ScreeningType: screeningType, Outcome: "error", Error: err.Error()}, nil
	}
	defer resp.Body.Close()

	var result ScreeningResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ScreeningResult{ScreeningType: screeningType, Outcome: "error", Error: "decode error: " + err.Error()}, nil
	}
	return result, nil
}

// BatchScoreActivity calls the Python screening-scorer for ML risk scoring.
func BatchScoreActivity(ctx context.Context, input ScreeningOrderInput, results []ScreeningResult) ([]ScreeningResult, error) {
	scorerURL := input.ScorerURL
	if scorerURL == "" {
		scorerURL = os.Getenv("SCREENING_SCORER_URL")
		if scorerURL == "" {
			scorerURL = "http://bis-screening-scorer:8086"
		}
	}

	type ScorerInput struct {
		RequestID      string          `json:"request_id"`
		OrderRef       string          `json:"order_ref"`
		ResultID       int             `json:"result_id"`
		ScreeningType  string          `json:"screening_type"`
		Outcome        string          `json:"outcome"`
		Summary        string          `json:"summary"`
		Details        map[string]interface{} `json:"details"`
		RiskScore      float64         `json:"risk_score"`
		Sources        []string        `json:"sources"`
	}

	var inputs []ScorerInput
	for i, r := range results {
		inputs = append(inputs, ScorerInput{
			RequestID:     fmt.Sprintf("%s-%d", input.OrderRef, i),
			OrderRef:      input.OrderRef,
			ResultID:      i,
			ScreeningType: r.ScreeningType,
			Outcome:       r.Outcome,
			Summary:       r.Summary,
			Details:       r.Details,
			RiskScore:     r.RiskScore,
			Sources:       r.Sources,
		})
	}

	body, _ := json.Marshal(inputs)
	req, err := http.NewRequestWithContext(ctx, "POST", scorerURL+"/batch-score", strings.NewReader(string(body)))
	if err != nil {
		return results, nil // fail open
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return results, nil // fail open
	}
	defer resp.Body.Close()

	type ScoredResult struct {
		ScreeningType      string  `json:"screening_type"`
		CompositeRiskScore float64 `json:"composite_risk_score"`
		RiskBand           string  `json:"risk_band"`
		Recommendation     string  `json:"recommendation"`
	}

	var scored []ScoredResult
	if err := json.NewDecoder(resp.Body).Decode(&scored); err != nil {
		return results, nil
	}

	// Merge ML scores back into results
	for i := range results {
		if i < len(scored) {
			results[i].RiskScore = scored[i].CompositeRiskScore
			if results[i].Details == nil {
				results[i].Details = map[string]interface{}{}
			}
			results[i].Details["risk_band"] = scored[i].RiskBand
			results[i].Details["recommendation"] = scored[i].Recommendation
		}
	}
	return results, nil
}

// TriggerPreAdverseActivity sends the NDPR-compliant pre-adverse action notice.
func TriggerPreAdverseActivity(ctx context.Context, input ScreeningOrderInput, adverseItems []string) error {
	bffURL := input.BffURL
	if bffURL == "" {
		bffURL = os.Getenv("BFF_URL")
		if bffURL == "" {
			bffURL = "http://bis-bff:3001"
		}
	}

	payload := map[string]interface{}{
		"order_ref":     input.OrderRef,
		"candidate_ref": input.CandidateRef,
		"tenant_id":     input.TenantID,
		"adverse_items": adverseItems,
		"action":        "pre_adverse",
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", bffURL+"/api/trpc/ngScreening.triggerPreAdverse", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// PersistOrderResultActivity stores the final order result via the BFF tRPC API.
func PersistOrderResultActivity(ctx context.Context, result *ScreeningOrderResult) error {
	bffURL := os.Getenv("BFF_URL")
	if bffURL == "" {
		bffURL = "http://bis-bff:3001"
	}

	body, _ := json.Marshal(result)
	req, err := http.NewRequestWithContext(ctx, "POST", bffURL+"/api/trpc/ngScreening.persistOrderResult", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// DeliverWebhooksActivity fans out webhook deliveries to all subscribed tenants.
func DeliverWebhooksActivity(ctx context.Context, tenantID string, result *ScreeningOrderResult) error {
	bffURL := os.Getenv("BFF_URL")
	if bffURL == "" {
		bffURL = "http://bis-bff:3001"
	}

	payload := map[string]interface{}{
		"tenant_id":  tenantID,
		"event_type": "screening.completed",
		"order_ref":  result.OrderRef,
		"outcome":    result.OverallOutcome,
		"score":      result.CompositeScore,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", bffURL+"/api/trpc/ngScreeningExt.deliverWebhooks", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// ─── Worker Registration ──────────────────────────────────────────────────────

// RegisterScreeningWorker registers the screening workflow and activities with Temporal.
func RegisterScreeningWorker(c client.Client) worker.Worker {
	taskQueue := os.Getenv("TEMPORAL_SCREENING_TASK_QUEUE")
	if taskQueue == "" {
		taskQueue = "bis-screening"
	}

	w := worker.New(c, taskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: 20,
		MaxConcurrentWorkflowTaskExecutionSize: 10,
	})

	w.RegisterWorkflow(ScreeningWorkflow)
	w.RegisterActivity(RunScreeningActivity)
	w.RegisterActivity(BatchScoreActivity)
	w.RegisterActivity(TriggerPreAdverseActivity)
	w.RegisterActivity(PersistOrderResultActivity)
	w.RegisterActivity(DeliverWebhooksActivity)

	return w
}

// StartScreeningWorkflow is a helper to enqueue a new screening order.
func StartScreeningWorkflow(c client.Client, input ScreeningOrderInput) (string, error) {
	taskQueue := os.Getenv("TEMPORAL_SCREENING_TASK_QUEUE")
	if taskQueue == "" {
		taskQueue = "bis-screening"
	}

	options := client.StartWorkflowOptions{
		ID:        "screening-" + input.OrderRef,
		TaskQueue: taskQueue,
		WorkflowExecutionTimeout: 24 * time.Hour,
		WorkflowRunTimeout:       4 * time.Hour,
	}

	we, err := c.ExecuteWorkflow(context.Background(), options, ScreeningWorkflow, input)
	if err != nil {
		return "", fmt.Errorf("failed to start screening workflow: %w", err)
	}
	return we.GetID(), nil
}
