// helpers.go — package-level DefaultClient for use by gateway handler files
// that cannot directly access the main.go-scoped temporalClient variable.
package temporal

import (
	"context"
	"log"
	"os"
	"sync"
)

var (
	defaultClientOnce sync.Once
	DefaultClient     *Client
)

// init lazily initialises DefaultClient from environment variables.
// This is safe to call multiple times; the sync.Once ensures a single init.
func init() {
	defaultClientOnce.Do(func() {
		host := os.Getenv("TEMPORAL_HOST")
		ns := os.Getenv("TEMPORAL_NAMESPACE")
		if ns == "" {
			ns = "bis"
		}
		c, err := NewClient(host, ns)
		if err != nil {
			log.Printf("[Temporal] DefaultClient init warning: %v — using no-op client", err)
			DefaultClient = &Client{}
			return
		}
		DefaultClient = c
	})
}

// StartWorkflowSafe is a nil-safe wrapper around DefaultClient.StartWorkflow.
// Returns "temporal-unavailable" if Temporal is not configured.
func StartWorkflowSafe(ctx context.Context, workflowType string, input interface{}) (string, error) {
	if DefaultClient == nil {
		return "temporal-unavailable", nil
	}
	return DefaultClient.StartWorkflow(ctx, workflowType, input)
}
