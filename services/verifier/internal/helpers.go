// Package internal — shared helper utilities for the verifier microservice.
package internal

import "os"

// envOrDefault returns the value of the named environment variable,
// or the provided default if the variable is unset or empty.
func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
