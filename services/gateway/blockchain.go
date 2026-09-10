package main

// blockchain.go — Read-only stablecoin balance queries for the BIS API Gateway
//
// Implements direct RPC calls to:
//   - Celo Alfajores / Mainnet (cUSD, ERC-20 compatible)
//   - Ethereum Sepolia / Mainnet (USDC, Circle ERC-20)
//   - Polygon Amoy / Mainnet (USDC bridged)
//   - Stellar Testnet / Mainnet (USDC, Stellar asset)
//
// Architecture:
//   - This module performs read-only balance lookups against configured public RPC endpoints.
//   - Settlement is delegated exclusively to the configured custody/settlement bridge.
//
// EVM networks (Celo, Ethereum, Polygon) use raw JSON-RPC over HTTPS.
// Stellar uses the Horizon REST API.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Network Config ───────────────────────────────────────────────────────────

type EVMNetwork struct {
	Name    string
	ChainID int64
	RPCURL  string
	// ERC-20 contract addresses for each stablecoin
	Contracts map[string]string // currency → contract address
}

var evmNetworks = map[string]EVMNetwork{
	"celo": {
		Name:    "Celo",
		ChainID: 42220, // mainnet; 44787 = Alfajores testnet
		RPCURL:  envOrBlockchain("CELO_RPC_URL", "https://forno.celo.org"),
		Contracts: map[string]string{
			"cUSD": "0x765DE816845861e75A25fCA122bb6898B8B1282a", // Celo mainnet cUSD
		},
	},
	"ethereum": {
		Name:    "Ethereum",
		ChainID: 1, // mainnet; 11155111 = Sepolia testnet
		RPCURL:  envOrBlockchain("ETH_RPC_URL", "https://cloudflare-eth.com"),
		Contracts: map[string]string{
			"USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum mainnet USDC
		},
	},
	"polygon": {
		Name:    "Polygon",
		ChainID: 137, // mainnet; 80002 = Amoy testnet
		RPCURL:  envOrBlockchain("POLYGON_RPC_URL", "https://polygon-rpc.com"),
		Contracts: map[string]string{
			"USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon mainnet USDC (native)
		},
	},
}

// Stellar Horizon API base URL
var stellarHorizonURL = envOrBlockchain("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org")

// USDC issuer on Stellar
const stellarUSDCIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

func envOrBlockchain(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── EVM JSON-RPC Client ──────────────────────────────────────────────────────

type jsonRPCRequest struct {
	JSONRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
	ID      int           `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func evmCall(ctx context.Context, rpcURL, method string, params []interface{}) (json.RawMessage, error) {
	reqBody, _ := json.Marshal(jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      1,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpcURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("RPC call failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("parse RPC response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp.Result, nil
}

// ─── ERC-20 Balance Query ─────────────────────────────────────────────────────

// erc20BalanceOf calls balanceOf(address) on an ERC-20 contract.
// Returns the balance as a hex string (wei units).
func erc20BalanceOf(ctx context.Context, network, contractAddr, walletAddr string) (string, error) {
	net, ok := evmNetworks[network]
	if !ok {
		return "", fmt.Errorf("unsupported network: %s", network)
	}

	// ABI-encode: balanceOf(address) = 0x70a08231 + padded address
	paddedAddr := strings.TrimPrefix(walletAddr, "0x")
	if len(paddedAddr) < 40 {
		return "", fmt.Errorf("invalid wallet address")
	}
	// Pad to 32 bytes
	data := "0x70a08231" + fmt.Sprintf("%064s", paddedAddr)

	params := []interface{}{
		map[string]string{
			"to":   contractAddr,
			"data": data,
		},
		"latest",
	}

	result, err := evmCall(ctx, net.RPCURL, "eth_call", params)
	if err != nil {
		return "", err
	}

	var hexBalance string
	if err := json.Unmarshal(result, &hexBalance); err != nil {
		return "", fmt.Errorf("parse balance: %w", err)
	}

	// Convert hex to decimal string
	hexBalance = strings.TrimPrefix(hexBalance, "0x")
	if hexBalance == "" {
		return "0", nil
	}
	n := new(big.Int)
	n.SetString(hexBalance, 16)
	return n.String(), nil
}

// ─── On-chain Balance Query (public entry point) ──────────────────────────────

// QueryOnChainBalance returns the stablecoin balance for a wallet address.
// Used by handleStablecoinBalance when STABLECOIN_BRIDGE_URL is not set.
func QueryOnChainBalance(ctx context.Context, network, currency, address string) (string, bool, error) {
	if network == "stellar" || network == "nigeria" {
		// Stellar: query Horizon for USDC balance
		accountURL := fmt.Sprintf("%s/accounts/%s", stellarHorizonURL, address)
		respBody, err := httpGet(ctx, accountURL)
		if err != nil {
			return "", false, fmt.Errorf("query Stellar balance: %w", err)
		}
		var account struct {
			Balances []struct {
				Balance     string `json:"balance"`
				AssetCode   string `json:"asset_code"`
				AssetIssuer string `json:"asset_issuer"`
			} `json:"balances"`
		}
		if err := json.Unmarshal(respBody, &account); err != nil {
			return "", false, fmt.Errorf("parse Stellar balance: %w", err)
		}
		for _, b := range account.Balances {
			if b.AssetCode == "USDC" && b.AssetIssuer == stellarUSDCIssuer {
				// Convert from Stellar 7-decimal to USDC 6-decimal
				return convertStellarToUSDCUnits(b.Balance), false, nil
			}
		}
		return "0", false, nil
	}

	// EVM networks
	net, ok := evmNetworks[network]
	if !ok {
		return "", false, fmt.Errorf("unsupported network: %s", network)
	}
	contractAddr, ok := net.Contracts[currency]
	if !ok {
		return "", false, fmt.Errorf("unsupported currency %s on %s", currency, network)
	}

	balance, err := erc20BalanceOf(ctx, network, contractAddr, address)
	if err != nil {
		return "", false, fmt.Errorf("query %s %s balance: %w", network, currency, err)
	}
	return balance, false, nil
}

// convertStellarToUSDCUnits converts a Stellar decimal balance with seven fractional
// digits into integer USDC units with six fractional digits.
func convertStellarToUSDCUnits(stellarBalance string) string {
	parts := strings.Split(stellarBalance, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "0"
	}
	fraction := parts[1]
	if len(fraction) > 6 {
		fraction = fraction[:6]
	}
	for len(fraction) < 6 {
		fraction += "0"
	}
	units := new(big.Int)
	if _, ok := units.SetString(parts[0]+fraction, 10); !ok {
		return "0"
	}
	return units.String()
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

func httpGet(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
