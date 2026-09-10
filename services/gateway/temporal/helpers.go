// helpers.go — package-level DefaultClient for use by gateway handler files
// that cannot directly access the main.go-scoped temporalClient variable.
package temporal

import (
	"context"
	"fmt"
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
		c, err := NewClient(host, ns)
		if err != nil {
			DefaultClient = nil
			return
		}
		DefaultClient = c
	})
}

// StartWorkflowSafe returns an error when Temporal infrastructure is unavailable.
func StartWorkflowSafe(ctx context.Context, workflowType string, input interface{}) (string, error) {
	if DefaultClient == nil {
		return "", fmt.Errorf("Temporal workflow infrastructure is unavailable")
	}
	return DefaultClient.StartWorkflow(ctx, workflowType, input)
}
