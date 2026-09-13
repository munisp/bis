package main

// dlq.go — Kafka Dead-Letter Queue (DLQ) and SSRF allowlist for BIS API Gateway
//
// DLQ design:
//   - publishEvent() now calls publishEventWithDLQ() which retries once on failure.
//   - On second failure the message is written to the DLQ topic: bis.dlq.<original-topic>
//   - A background goroutine (startDLQReplay) reads from a durable DLQ and retries every 30 s.
//   - If neither Kafka nor Redis can persist a DLQ message, the caller receives an
//     explicit error and must not acknowledge a durable business operation.
//
// SSRF allowlist design:
//   - validateOutboundURL() checks every outbound HTTP target against an allowlist
//     of approved host:port patterns loaded from OUTBOUND_ALLOWLIST env var.
//   - Mojaloop, NIP, and stablecoin handlers call validateOutboundURL before proxying.

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// ─── DLQ ─────────────────────────────────────────────────────────────────────

const dlqTopicPrefix = "bis.dlq."
const dlqRedisKey = "bis:dlq:"
const dlqMaxRetries = 3
const dlqRetryInterval = 30 * time.Second

// dlqMessage is the envelope stored in the DLQ.
type dlqMessage struct {
	Topic     string          `json:"topic"`
	Payload   json.RawMessage `json:"payload"`
	Attempts  int             `json:"attempts"`
	FirstFail int64           `json:"first_fail_unix"`
}

// publishEventWithDLQ is the production-safe replacement for publishEvent.
// It retries once inline, then persists to a durable DLQ. A caller receives an
// error when neither the primary topic nor a durable DLQ acknowledges the event.
func publishEventWithDLQ(topic string, payload any) error {
	if kafkaProducer == nil {
		return enqueueDLQ(topic, payload, 0)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal event for topic %s: %w", topic, err)
	}
	if err := kafkaProducer.Publish(topic, data); err == nil {
		return nil
	}
	time.Sleep(200 * time.Millisecond)
	if err := kafkaProducer.Publish(topic, data); err == nil {
		return nil
	}
	log.Printf("[DLQ] Routing to durable DLQ after 2 failures: topic=%s", topic)
	if err := enqueueDLQ(topic, payload, 1); err != nil {
		return fmt.Errorf("primary and DLQ publish failed for %s: %w", topic, err)
	}
	return nil
}

// enqueueDLQ stores a message in a durable DLQ (Kafka topic or Redis list).
// It never accepts an in-memory fallback for a durable business event.
func enqueueDLQ(topic string, payload any, attempts int) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal DLQ payload: %w", err)
	}
	msg := dlqMessage{
		Topic:     topic,
		Payload:   data,
		Attempts:  attempts,
		FirstFail: time.Now().Unix(),
	}
	envelope, _ := json.Marshal(msg)

	// Try Kafka DLQ topic first
	if kafkaProducer != nil {
		dlqTopic := dlqTopicPrefix + topic
		if err := kafkaProducer.Publish(dlqTopic, envelope); err == nil {
			log.Printf("[DLQ] Message stored in Kafka DLQ topic %s", dlqTopic)
			return nil
		}
	}

	// Fall back to Redis list
	if redisClient != nil {
		key := dlqRedisKey + topic
		if err := redisClient.LPush(key, string(envelope)); err == nil {
			log.Printf("[DLQ] Message stored in Redis DLQ key %s", key)
			return nil
		}
	}
	return fmt.Errorf("durable DLQ unavailable for topic %s", topic)
}

// startDLQReplay runs a background goroutine that replays DLQ messages.
func startDLQReplay() {
	go func() {
		ticker := time.NewTicker(dlqRetryInterval)
		defer ticker.Stop()
		for range ticker.C {
			replayRedisDLQ()
		}
	}()
	log.Printf("[DLQ] Replay goroutine started (interval=%s)", dlqRetryInterval)
}

func replayRedisDLQ() {
	if redisClient == nil || kafkaProducer == nil {
		return
	}
	// We don't know which topics are in Redis DLQ, so we use a known set
	topics := []string{
		"bis.gateway.nin_lookup", "bis.gateway.bvn_lookup", "bis.gateway.cac_lookup",
		"bis.gateway.sanctions_check", "bis.gateway.pep_check", "bis.gateway.credit_check",
		"bis.payment.nip", "bis.payment.mojaloop", "bis.stablecoin.transfer",
	}
	for _, topic := range topics {
		key := dlqRedisKey + topic
		for i := 0; i < 100; i++ {
			val, err := redisClient.RPop(key)
			if err != nil || val == "" {
				break
			}
			var msg dlqMessage
			if err := json.Unmarshal([]byte(val), &msg); err != nil {
				continue
			}
			if err := kafkaProducer.Publish(msg.Topic, msg.Payload); err != nil {
				// Re-enqueue with incremented attempts
				msg.Attempts++
				if msg.Attempts < dlqMaxRetries {
					envelope, _ := json.Marshal(msg)
					_ = redisClient.LPush(key, string(envelope))
				}
			}
		}
	}
}

// ─── SSRF Allowlist ───────────────────────────────────────────────────────────

// outboundAllowlist is the set of approved host:port patterns for outbound HTTP.
// Populated from OUTBOUND_ALLOWLIST env var (comma-separated host:port or host patterns).
var outboundAllowlist []string
var outboundAllowlistOnce sync.Once

func loadOutboundAllowlist() []string {
	outboundAllowlistOnce.Do(func() {
		raw := os.Getenv("OUTBOUND_ALLOWLIST")
		if raw == "" {
			// Secure defaults: only known internal services
			raw = strings.Join([]string{
				// Mojaloop Hub
				"hub.mojaloop.io:443",
				"sandbox.mojaloop.io:443",
				// NIP / NIBSS
				"nibss-plc.com.ng:443",
				"api.nibss-plc.com.ng:443",
				// Celo / Stellar stablecoin nodes
				"forno.celo.org:443",
				"horizon.stellar.org:443",
				"horizon-testnet.stellar.org:443",
				// Internal services (Docker network)
				"payment-rails:8080",
				"aml-engine:8080",
				"ml-enrichment:8000",
				"biometric-engine:8000",
				"case-manager:8080",
			}, ",")
		}
		for _, entry := range strings.Split(raw, ",") {
			entry = strings.TrimSpace(entry)
			if entry != "" {
				outboundAllowlist = append(outboundAllowlist, entry)
			}
		}
		log.Printf("[SSRF] Outbound allowlist loaded: %d entries", len(outboundAllowlist))
	})
	return outboundAllowlist
}

// validateOutboundURL checks that the target URL is in the approved allowlist.
// Returns an error if the URL is not allowed (SSRF protection).
func validateOutboundURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	// Reject non-http(s) schemes
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("scheme %q not allowed (only http/https)", parsed.Scheme)
	}

	// Resolve host
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	// Block private / loopback addresses (except in dev mode)
	if os.Getenv("GATEWAY_DEV_MODE") != "true" {
		if isPrivateHost(host) {
			// Allow Docker-internal service names (no dots, no IP)
			if net.ParseIP(host) != nil {
				return fmt.Errorf("outbound to private IP %s is not allowed", host)
			}
		}
	}

	// Check allowlist
	allowlist := loadOutboundAllowlist()
	target := host + ":" + port
	for _, allowed := range allowlist {
		// Exact match or suffix match (e.g. "mojaloop.io:443" matches "hub.mojaloop.io:443")
		if allowed == target {
			return nil
		}
		if strings.HasPrefix(allowed, ".") && strings.HasSuffix(target, allowed) {
			return nil
		}
		// Wildcard subdomain: *.mojaloop.io:443
		if strings.HasPrefix(allowed, "*.") {
			suffix := allowed[1:] // ".mojaloop.io:443"
			if strings.HasSuffix(target, suffix) {
				return nil
			}
		}
	}
	return fmt.Errorf("outbound URL %q (resolved: %s) is not in the SSRF allowlist", rawURL, target)
}

// isPrivateHost returns true for RFC-1918 / loopback / link-local addresses.
func isPrivateHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false // hostname — allow (will be checked against allowlist)
	}
	private := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "::1/128", "169.254.0.0/16",
	}
	for _, cidr := range private {
		_, network, _ := net.ParseCIDR(cidr)
		if network != nil && network.Contains(ip) {
			return true
		}
	}
	return false
}
