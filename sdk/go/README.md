# BIS Go SDK

Official Go client for the [Background Intelligence System (BIS)](https://bis.example.ng) API.

## Installation

```bash
go get github.com/bis-platform/bis-go-sdk
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/bis-platform/bis-go-sdk/bis"
)

func main() {
    client, err := bis.NewClient(bis.Config{
        APIKey: "bis_live_your_key_here",
        // Or set BIS_API_KEY environment variable
    })
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()

    // List open investigations
    investigations, err := client.Investigations.List(ctx, bis.ListInvestigationsParams{
        Status:   "open",
        Priority: "high",
    })
    if err != nil {
        log.Fatal(err)
    }
    for _, inv := range investigations.Data {
        fmt.Printf("%s: %s — %s\n", inv.RefNumber, inv.Subject.Name, inv.Status)
    }

    // Run a QuickCheck
    result, err := client.QuickCheck.Run(ctx, map[string]interface{}{
        "name":     "John Doe",
        "phone":    "08012345678",
        "nin":      "12345678901",
        "category": "driver",
        "tier":     "standard",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Verdict: %s | Risk Score: %.1f\n", result.Verdict, result.RiskScore)
    fmt.Printf("PDF Report: %s\n", result.ReportURL)
}
```

## Error Handling

```go
_, err := client.Investigations.Get(ctx, "non-existent-id")
if err != nil {
    if bis.IsNotFound(err) {
        fmt.Println("Investigation not found")
    } else if bis.IsRateLimited(err) {
        apiErr := err.(*bis.APIError)
        fmt.Printf("Rate limited. Retry after %ds\n", apiErr.RetryAfter)
    } else if bis.IsUnauthorized(err) {
        fmt.Println("Invalid API key")
    } else {
        log.Fatal(err)
    }
}
```

## Configuration

| Field | Environment Variable | Default |
|-------|---------------------|---------|
| `APIKey` | `BIS_API_KEY` | Required |
| `BaseURL` | — | `https://bis.example.ng/api/v1` |
| `Timeout` | — | `30s` |
| `HTTPClient` | — | `&http.Client{Timeout: 30s}` |
