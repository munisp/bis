// payments.go — BIS API Gateway payment rail handlers
//
// Implements:
//   - Mojaloop ISO 20022 / ILP transfer initiation and status polling
//   - NIBSS NIP interbank transfer
//   - Stablecoin (USDC on Ethereum / cUSD on Celo) transfer via bridge
//   - Velocity alert ingest from the Rust fluvio-velocity sidecar
//
// All amounts are in the smallest denomination:
//   NGN → kobo (1 NGN = 100 kobo)
//   USD → cents (1 USD = 100 cents)
//   USDC/cUSD → 6 decimal places (1 USDC = 1_000_000 units)

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Config ───────────────────────────────────────────────────────────────────

var (
	mojaloopHubURL  = os.Getenv("MOJALOOP_HUB_URL")   // e.g. https://hub.mojaloop.io
	mojaloopDFSPID  = envOrDefault("MOJALOOP_DFSP_ID", "bis-dfsp")
	nibssNIPURL     = os.Getenv("NIBSS_NIP_URL")       // NIBSS NIP gateway base URL
	nibssNIPKey     = os.Getenv("NIBSS_NIP_KEY")       // NIBSS NIP API key
	stablecoinBridge = os.Getenv("STABLECOIN_BRIDGE_URL") // Internal bridge service URL
	stablecoinKey   = os.Getenv("STABLECOIN_API_KEY")  // Bridge API key
)

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MojaloopTransferRequest struct {
	TxRef              string `json:"txRef"`
	OriginatorAccount  string `json:"originatorAccount"`
	OriginatorName     string `json:"originatorName"`
	BeneficiaryAccount string `json:"beneficiaryAccount"`
	BeneficiaryName    string `json:"beneficiaryName"`
	BeneficiaryBankCode string `json:"beneficiaryBankCode"`
	AmountKobo         int64  `json:"amountKobo"`
	Currency           string `json:"currency"`
	Narration          string `json:"narration"`
}

type MojaloopTransferResponse struct {
	TxRef       string `json:"txRef"`
	ExternalRef string `json:"externalRef"`
	Status      string `json:"status"` // pending | completed | failed
	Mode        string `json:"mode"`   // mojaloop | nip | sandbox
	Message     string `json:"message,omitempty"`
	Sandbox     bool   `json:"sandbox,omitempty"`
}

type MojaloopStatusResponse struct {
	TxRef       string `json:"txRef"`
	ExternalRef string `json:"externalRef"`
	Status      string `json:"status"`
	CompletedAt string `json:"completedAt,omitempty"`
	FailureReason string `json:"failureReason,omitempty"`
}

type StablecoinTransferRequest struct {
	TxRef              string `json:"txRef"`
	FromAddress        string `json:"fromAddress"`
	ToAddress          string `json:"toAddress"`
	AmountUnits        string `json:"amountUnits"` // 6-decimal string, e.g. "1000000" = 1 USDC
	Currency           string `json:"currency"`    // "USDC" | "cUSD"
	Network            string `json:"network"`     // "ethereum" | "celo" | "polygon"
	Narration          string `json:"narration,omitempty"`
}

type StablecoinTransferResponse struct {
	TxRef     string `json:"txRef"`
	TxHash    string `json:"txHash"`
	Status    string `json:"status"` // pending | confirmed | failed
	Network   string `json:"network"`
	Currency  string `json:"currency"`
	GasUsed   string `json:"gasUsed,omitempty"`
	Sandbox   bool   `json:"sandbox,omitempty"`
}

type StablecoinBalanceResponse struct {
	Address  string `json:"address"`
	Currency string `json:"currency"`
	Network  string `json:"network"`
	Balance  string `json:"balance"` // 6-decimal string
	Sandbox  bool   `json:"sandbox,omitempty"`
}

type VelocityAlertRequest struct {
	AlertID   string  `json:"alert_id"`
	AccountID string  `json:"account_id"`
	RuleName  string  `json:"rule_name"`
	TxCount   int     `json:"tx_count"`
	TotalKobo int64   `json:"total_kobo"`
	WindowSec int     `json:"window_sec"`
	Score     float64 `json:"score"`
	TenantID  string  `json:"tenant_id"`
	TriggeredAt string `json:"triggered_at"`
}

// ─── Mojaloop Transfer ────────────────────────────────────────────────────────

func handleMojaloopTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	var req MojaloopTransferRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	if req.TxRef == "" || req.AmountKobo <= 0 {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "txRef and amountKobo are required")
		return
	}

	// Publish Kafka event for audit trail
	publishEvent("bis.payment.events", map[string]interface{}{
		"event_type":  "PAYMENT_INITIATED",
		"tx_ref":      req.TxRef,
		"amount_kobo": req.AmountKobo,
		"currency":    req.Currency,
		"rail":        "mojaloop",
		"source":      "bis-gateway",
	})

	if mojaloopHubURL == "" {
		// Sandbox mode — deterministic response
		log.Printf("[Mojaloop] Sandbox mode — MOJALOOP_HUB_URL not set, returning sandbox response for %s", req.TxRef)
		writeJSON(w, http.StatusAccepted, MojaloopTransferResponse{
			TxRef:       req.TxRef,
			ExternalRef: fmt.Sprintf("ML-%s-%d", req.TxRef, time.Now().UnixMilli()),
			Status:      "pending",
			Mode:        "sandbox",
			Message:     "Sandbox: set MOJALOOP_HUB_URL for live Mojaloop integration",
			Sandbox:     true,
		})
		return
	}

	// Live Mojaloop call
	body := map[string]interface{}{
		"transferId": req.TxRef,
		"payerFsp":   mojaloopDFSPID,
		"payeeFsp":   req.BeneficiaryBankCode,
		"amount": map[string]interface{}{
			"amount":   fmt.Sprintf("%.2f", float64(req.AmountKobo)/100.0),
			"currency": req.Currency,
		},
		"ilpPacket":  "",
		"condition":  "",
		"expiration": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
		"extensionList": map[string]interface{}{
			"extension": []map[string]string{
				{"key": "originatorAccount", "value": req.OriginatorAccount},
				{"key": "beneficiaryAccount", "value": req.BeneficiaryAccount},
				{"key": "narration", "value": req.Narration},
			},
		},
	}

	respBody, err := callExternalJSON(r.Context(), http.MethodPost, mojaloopHubURL+"/transfers", "", body)
	if err != nil {
		log.Printf("[Mojaloop] Transfer error for %s: %v", req.TxRef, err)
		writeError(w, http.StatusBadGateway, "MOJALOOP_ERROR", err.Error())
		return
	}

	var mlResp map[string]interface{}
	if err := json.Unmarshal(respBody, &mlResp); err != nil {
		writeError(w, http.StatusBadGateway, "MOJALOOP_PARSE_ERROR", "failed to parse Mojaloop response")
		return
	}

	status := "pending"
	if s, ok := mlResp["transferState"].(string); ok && s == "COMMITTED" {
		status = "completed"
	}

	externalRef, _ := mlResp["transferId"].(string)
	if externalRef == "" {
		externalRef = req.TxRef
	}

	writeJSON(w, http.StatusAccepted, MojaloopTransferResponse{
		TxRef:       req.TxRef,
		ExternalRef: externalRef,
		Status:      status,
		Mode:        "mojaloop",
	})
}

func handleMojaloopStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET required")
		return
	}

	// Extract txRef from path: /v1/mojaloop/status/{txRef}
	txRef := strings.TrimPrefix(r.URL.Path, "/v1/mojaloop/status/")
	if txRef == "" {
		writeError(w, http.StatusBadRequest, "MISSING_TX_REF", "txRef is required in path")
		return
	}

	if mojaloopHubURL == "" {
		writeJSON(w, http.StatusOK, MojaloopStatusResponse{
			TxRef:       txRef,
			ExternalRef: txRef,
			Status:      "pending",
		})
		return
	}

	respBody, err := callExternalJSON(r.Context(), http.MethodGet,
		fmt.Sprintf("%s/transfers/%s", mojaloopHubURL, txRef), "", nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "MOJALOOP_STATUS_ERROR", err.Error())
		return
	}

	var mlResp map[string]interface{}
	if err := json.Unmarshal(respBody, &mlResp); err != nil {
		writeError(w, http.StatusBadGateway, "MOJALOOP_PARSE_ERROR", "failed to parse response")
		return
	}

	status := "pending"
	if s, ok := mlResp["transferState"].(string); ok {
		switch s {
		case "COMMITTED":
			status = "completed"
		case "ABORTED", "REJECTED":
			status = "failed"
		}
	}

	completedAt, _ := mlResp["completedTimestamp"].(string)
	failureReason, _ := mlResp["errorInformation"].(string)

	writeJSON(w, http.StatusOK, MojaloopStatusResponse{
		TxRef:         txRef,
		ExternalRef:   txRef,
		Status:        status,
		CompletedAt:   completedAt,
		FailureReason: failureReason,
	})
}

// ─── NIBSS NIP Transfer ───────────────────────────────────────────────────────

func handleNIPTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	var req MojaloopTransferRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	publishEvent("bis.payment.events", map[string]interface{}{
		"event_type":  "PAYMENT_INITIATED",
		"tx_ref":      req.TxRef,
		"amount_kobo": req.AmountKobo,
		"currency":    "NGN",
		"rail":        "nip",
		"source":      "bis-gateway",
	})

	if nibssNIPURL == "" {
		writeJSON(w, http.StatusAccepted, MojaloopTransferResponse{
			TxRef:       req.TxRef,
			ExternalRef: fmt.Sprintf("NIP-%s-%d", req.TxRef, time.Now().UnixMilli()),
			Status:      "pending",
			Mode:        "sandbox",
			Message:     "Sandbox: set NIBSS_NIP_URL for live NIP integration",
			Sandbox:     true,
		})
		return
	}

	body := map[string]interface{}{
		"sessionId":          req.TxRef,
		"channelCode":        "1",
		"sourceAccountName":  req.OriginatorName,
		"sourceAccountNumber": req.OriginatorAccount,
		"destinationBankCode": req.BeneficiaryBankCode,
		"destinationAccountNumber": req.BeneficiaryAccount,
		"destinationAccountName": req.BeneficiaryName,
		"amount":             req.AmountKobo,
		"narration":          req.Narration,
	}

	respBody, err := callExternalJSONWithKey(r.Context(), http.MethodPost, nibssNIPURL+"/transfer", nibssNIPKey, body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "NIP_ERROR", err.Error())
		return
	}

	var nipResp map[string]interface{}
	if err := json.Unmarshal(respBody, &nipResp); err != nil {
		writeError(w, http.StatusBadGateway, "NIP_PARSE_ERROR", "failed to parse NIP response")
		return
	}

	status := "pending"
	if code, ok := nipResp["responseCode"].(string); ok && code == "00" {
		status = "completed"
	}

	sessionID, _ := nipResp["sessionId"].(string)
	if sessionID == "" {
		sessionID = req.TxRef
	}

	writeJSON(w, http.StatusAccepted, MojaloopTransferResponse{
		TxRef:       req.TxRef,
		ExternalRef: sessionID,
		Status:      status,
		Mode:        "nip",
	})
}

// ─── Stablecoin Transfer ──────────────────────────────────────────────────────

func handleStablecoinTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	var req StablecoinTransferRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	if req.TxRef == "" || req.FromAddress == "" || req.ToAddress == "" || req.AmountUnits == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "txRef, fromAddress, toAddress, amountUnits required")
		return
	}

	if req.Currency == "" {
		req.Currency = "USDC"
	}
	if req.Network == "" {
		req.Network = "ethereum"
	}

	// Publish Kafka event
	publishEvent("bis.payment.events", map[string]interface{}{
		"event_type":   "STABLECOIN_TRANSFER_INITIATED",
		"tx_ref":       req.TxRef,
		"amount_units": req.AmountUnits,
		"currency":     req.Currency,
		"network":      req.Network,
		"rail":         "stablecoin",
		"source":       "bis-gateway",
	})

	if stablecoinBridge == "" {
		// No external bridge configured — use direct on-chain settlement via blockchain.go
		txHash, isSandbox, err := ExecuteOnChainTransfer(r.Context(), req.Network, req.Currency, req.ToAddress, req.AmountUnits)
		if err != nil {
			log.Printf("[Stablecoin] On-chain transfer failed: %v — falling back to sandbox hash", err)
			txHash = fmt.Sprintf("0x%x%x", time.Now().UnixNano(), len(req.TxRef))
			isSandbox = true
		}
		log.Printf("[Stablecoin] On-chain transfer: network=%s currency=%s txHash=%s sandbox=%v", req.Network, req.Currency, txHash, isSandbox)
		writeJSON(w, http.StatusAccepted, StablecoinTransferResponse{
			TxRef:    req.TxRef,
			TxHash:   txHash,
			Status:   "pending",
			Network:  req.Network,
			Currency: req.Currency,
			Sandbox:  isSandbox,
		})
		return
	}

	// Live bridge call
	body := map[string]interface{}{
		"txRef":       req.TxRef,
		"fromAddress": req.FromAddress,
		"toAddress":   req.ToAddress,
		"amount":      req.AmountUnits,
		"currency":    req.Currency,
		"network":     req.Network,
		"narration":   req.Narration,
	}

	respBody, err := callExternalJSONWithKey(r.Context(), http.MethodPost, stablecoinBridge+"/v1/transfer", stablecoinKey, body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "STABLECOIN_ERROR", err.Error())
		return
	}

	var bridgeResp map[string]interface{}
	if err := json.Unmarshal(respBody, &bridgeResp); err != nil {
		writeError(w, http.StatusBadGateway, "STABLECOIN_PARSE_ERROR", "failed to parse bridge response")
		return
	}

	txHash, _ := bridgeResp["txHash"].(string)
	status, _ := bridgeResp["status"].(string)
	if status == "" {
		status = "pending"
	}
	gasUsed, _ := bridgeResp["gasUsed"].(string)

	writeJSON(w, http.StatusAccepted, StablecoinTransferResponse{
		TxRef:    req.TxRef,
		TxHash:   txHash,
		Status:   status,
		Network:  req.Network,
		Currency: req.Currency,
		GasUsed:  gasUsed,
	})
}

func handleStablecoinBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET required")
		return
	}

	// Path: /v1/stablecoin/balance/{address}?currency=USDC&network=ethereum
	address := strings.TrimPrefix(r.URL.Path, "/v1/stablecoin/balance/")
	if address == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ADDRESS", "wallet address required in path")
		return
	}

	currency := r.URL.Query().Get("currency")
	if currency == "" {
		currency = "USDC"
	}
	network := r.URL.Query().Get("network")
	if network == "" {
		network = "ethereum"
	}

	if stablecoinBridge == "" {
		writeJSON(w, http.StatusOK, StablecoinBalanceResponse{
			Address:  address,
			Currency: currency,
			Network:  network,
			Balance:  "0",
			Sandbox:  true,
		})
		return
	}

	url := fmt.Sprintf("%s/v1/balance/%s?currency=%s&network=%s", stablecoinBridge, address, currency, network)
	respBody, err := callExternalJSONWithKey(r.Context(), http.MethodGet, url, stablecoinKey, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "STABLECOIN_BALANCE_ERROR", err.Error())
		return
	}

	var balResp map[string]interface{}
	if err := json.Unmarshal(respBody, &balResp); err != nil {
		writeError(w, http.StatusBadGateway, "STABLECOIN_PARSE_ERROR", "failed to parse balance response")
		return
	}

	balance, _ := balResp["balance"].(string)
	writeJSON(w, http.StatusOK, StablecoinBalanceResponse{
		Address:  address,
		Currency: currency,
		Network:  network,
		Balance:  balance,
	})
}

// ─── Velocity Alert Ingest ────────────────────────────────────────────────────

func handleVelocityAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	var alert VelocityAlertRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&alert); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	defer r.Body.Close()

	log.Printf("[Velocity] Alert received: rule=%s account=%s txCount=%d score=%.2f",
		alert.RuleName, alert.AccountID, alert.TxCount, alert.Score)

	// Publish to Kafka for downstream processing
	publishEvent("bis.alerts", map[string]interface{}{
		"event_type": "VELOCITY_BREACH",
		"alert_id":   alert.AlertID,
		"account_id": alert.AccountID,
		"rule_name":  alert.RuleName,
		"tx_count":   alert.TxCount,
		"total_kobo": alert.TotalKobo,
		"window_sec": alert.WindowSec,
		"score":      alert.Score,
		"tenant_id":  alert.TenantID,
		"source":     "fluvio-velocity",
	})

	// Forward to event processor for fan-out
	go func() {
		body, _ := json.Marshal(map[string]interface{}{
			"event_type":  "VELOCITY_BREACH",
			"subject_ref": alert.AccountID,
			"severity":    velocitySeverity(alert.Score),
			"payload":     alert,
			"source":      "fluvio-velocity",
		})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, eventProcURL+"/v1/ingest", bytes.NewReader(body))
		if req != nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-BIS-Key", gatewayKey)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				log.Printf("[Velocity] Failed to forward to event processor: %v", err)
			} else {
				resp.Body.Close()
			}
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{"status": "received", "alert_id": alert.AlertID})
}

func velocitySeverity(score float64) string {
	switch {
	case score >= 0.9:
		return "critical"
	case score >= 0.7:
		return "high"
	case score >= 0.5:
		return "medium"
	default:
		return "low"
	}
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func callExternalJSON(ctx context.Context, method, url, _ string, body interface{}) ([]byte, error) {
	return callExternalJSONWithKey(ctx, method, url, "", body)
}

func callExternalJSONWithKey(ctx context.Context, method, url, apiKey string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP %s %s: %w", method, url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// ─── Stablecoin Quote ─────────────────────────────────────────────────────────

// handleStablecoinQuote returns a real-time NGN/USDC exchange rate quote.
// Falls back to a reference rate when the bridge is not configured.
func handleStablecoinQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET required")
		return
	}

	amountStr := r.URL.Query().Get("amount")
	target := r.URL.Query().Get("target")
	if target == "" {
		target = "NGN"
	}

	amount := 1.0
	if amountStr != "" {
		if _, err := fmt.Sscanf(amountStr, "%f", &amount); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_AMOUNT", "amount must be a number")
			return
		}
	}

	// Reference rate fallback (sandbox / no bridge configured)
	const referenceRateNGN = 1650.0
	if stablecoinBridge == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"rate":    referenceRateNGN,
			"source":  "reference-rate-fallback",
			"sandbox": true,
		})
		return
	}

	// Live oracle call
	url := fmt.Sprintf("%s/v1/quote?amount=%s&target=%s", stablecoinBridge, amountStr, target)
	respBody, err := callExternalJSONWithKey(r.Context(), http.MethodGet, url, stablecoinKey, nil)
	if err != nil {
		// Graceful fallback
		log.Printf("[Stablecoin] Quote oracle error: %v — using reference rate", err)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"rate":    referenceRateNGN,
			"source":  "reference-rate-fallback",
			"sandbox": true,
		})
		return
	}

	var quoteResp map[string]interface{}
	if err := json.Unmarshal(respBody, &quoteResp); err != nil {
		writeError(w, http.StatusBadGateway, "QUOTE_PARSE_ERROR", "failed to parse quote response")
		return
	}

	writeJSON(w, http.StatusOK, quoteResp)
}

// ─── Stablecoin History ───────────────────────────────────────────────────────

// handleStablecoinHistory returns on-chain transaction history for a wallet.
func handleStablecoinHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET required")
		return
	}

	// Path: /v1/stablecoin/history/{address}?currency=USDC&network=ethereum&limit=20
	address := strings.TrimPrefix(r.URL.Path, "/v1/stablecoin/history/")
	if address == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ADDRESS", "wallet address required in path")
		return
	}

	currency := r.URL.Query().Get("currency")
	if currency == "" {
		currency = "USDC"
	}
	network := r.URL.Query().Get("network")
	if network == "" {
		network = "ethereum"
	}
	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	}

	if stablecoinBridge == "" {
		// Sandbox: return empty history
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"transactions": []interface{}{},
			"sandbox":      true,
		})
		return
	}

	url := fmt.Sprintf("%s/v1/history/%s?currency=%s&network=%s&limit=%s",
		stablecoinBridge, address, currency, network, limit)
	respBody, err := callExternalJSONWithKey(r.Context(), http.MethodGet, url, stablecoinKey, nil)
	if err != nil {
		// Graceful fallback
		log.Printf("[Stablecoin] History error for %s: %v", address, err)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"transactions": []interface{}{},
			"sandbox":      true,
		})
		return
	}

	var histResp map[string]interface{}
	if err := json.Unmarshal(respBody, &histResp); err != nil {
		writeError(w, http.StatusBadGateway, "HISTORY_PARSE_ERROR", "failed to parse history response")
		return
	}

	writeJSON(w, http.StatusOK, histResp)
}
