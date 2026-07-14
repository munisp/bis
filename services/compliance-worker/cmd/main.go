// BIS Compliance Worker — Temporal Worker
//
// Registers and runs all BIS compliance Temporal workflows and activities:
//   - SarFilingWorkflow
//   - GoAmlFilingWorkflow
//   - RiskProfileWorkflow
//   - KycExpiryWorkflow
//
// Also exposes a health endpoint on port 8096.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"bis/compliance-worker/internal/activities"
	"bis/compliance-worker/internal/workflows"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	temporalHost := envOr("TEMPORAL_HOST", "localhost:7233")
	temporalNS := envOr("TEMPORAL_NAMESPACE", "bis-platform")
	taskQueue := envOr("TEMPORAL_TASK_QUEUE", "bis-compliance")
	healthPort := envOr("COMPLIANCE_WORKER_PORT", "8096")

	// ── Temporal client ──────────────────────────────────────────────────────
	c, err := client.Dial(client.Options{
		HostPort:  temporalHost,
		Namespace: temporalNS,
	})
	if err != nil {
		log.Printf("[ComplianceWorker] Temporal unavailable (%v) — running in dev mode", err)
		// In dev mode, start health server only
		startHealthServer(healthPort, false)
		return
	}
	defer c.Close()

	// ── Worker ───────────────────────────────────────────────────────────────
	w := worker.New(c, taskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:     20,
		MaxConcurrentWorkflowTaskExecutionSize: 10,
	})

	// Register workflows
	w.RegisterWorkflow(workflows.SarFilingWorkflow)
	w.RegisterWorkflow(workflows.GoAmlFilingWorkflow)
	w.RegisterWorkflow(workflows.RiskProfileWorkflow)
	w.RegisterWorkflow(workflows.KycExpiryWorkflow)

	// Register activities
	w.RegisterActivity(activities.ValidateSarData)
	w.RegisterActivity(activities.ComputeSubjectRiskScore)
	w.RegisterActivity(activities.GenerateGoAMLReport)
	w.RegisterActivity(activities.SubmitToNFIU)
	w.RegisterActivity(activities.WriteSarToLakehouse)
	w.RegisterActivity(activities.UpdateSarStatus)
	w.RegisterActivity(activities.FetchGoAmlData)
	w.RegisterActivity(activities.GenerateGoAMLXML)
	w.RegisterActivity(activities.ValidateGoAMLSchema)
	w.RegisterActivity(activities.SubmitGoAML)
	w.RegisterActivity(activities.FetchKycRiskScore)
	w.RegisterActivity(activities.FetchTransactionRiskScore)
	w.RegisterActivity(activities.FetchAmlRiskScore)
	w.RegisterActivity(activities.CheckSanctions)
	w.RegisterActivity(activities.CheckPEP)
	w.RegisterActivity(activities.FetchAdverseMedia)
	w.RegisterActivity(activities.PersistRiskProfile)
	w.RegisterActivity(activities.WriteRiskProfileToLakehouse)
	w.RegisterActivity(activities.FetchExpiringKycRecords)
	w.RegisterActivity(activities.SendKycRenewalReminder)

	log.Printf("[ComplianceWorker] Starting on task queue '%s' (namespace: %s)", taskQueue, temporalNS)

	// Start health server in background
	go startHealthServer(healthPort, true)

	// Run worker (blocks until shutdown)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("[ComplianceWorker] Worker failed: %v", err)
	}
}

func startHealthServer(port string, temporalConnected bool) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":             "ok",
			"service":            "bis-compliance-worker",
			"version":            "1.0.0",
			"temporal_connected": temporalConnected,
			"timestamp":          time.Now().UTC().Format(time.RFC3339),
		})
	})
	log.Printf("[ComplianceWorker] Health server on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Printf("[ComplianceWorker] Health server failed: %v", err)
	}
}
