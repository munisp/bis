package main

// dlq.go — Kafka Dead-Letter Queue (DLQ) and SSRF allowlist for BIS API Gateway
//
// DLQ design:
//   - publishEvent() now calls publishEventWithDLQ() which retries once on failure.
//   - On second failure the message is written to the DLQ topic: bis.dlq.<original-topic>
//   - A background goroutine (startDLQReplay) reads from DLQ and retries every 30 s.
//   - DLQ messages are stored in Redis as a list (bis:dlq:<topic>) when Kafka is
//     completely unavailable, so they survive restarts.
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

// inMemoryDLQ is a fallback when both Kafka and Redis are unavailable.
var (
	inMemoryDLQ   []dlqMessage
	inMemoryDLQMu sync.Mutex
)

// publishEventWithDLQ is the production-safe replacement for publishEvent.
// It retries once inline; on second failure it routes to the DLQ.
func publishEventWithDLQ(topic string, payload any) {
	if kafkaProducer == nil {
		enqueueDLQ(topic, payload, 0)
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[DLQ] Marshal error for topic %s: %v", topic, err)
		return
	}
	// First attempt
	if err := kafkaProducer.Publish(topic, data); err == nil {
		return
	}
	// Retry once after 200 ms
	time.Sleep(200 * time.Millisecond)
	if err := kafkaProducer.Publish(topic, data); err == nil {
		return
	}
	// Both attempts failed — route to DLQ
	log.Printf("[DLQ] Routing to DLQ after 2 failures: topic=%s", topic)
	enqueueDLQ(topic, payload, 1)
}

// enqueueDLQ stores a message in the DLQ (Kafka DLQ topic → Redis → in-memory).
func enqueueDLQ(topic string, payload any, attempts int) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
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
			return
		}
	}

	// Fall back to Redis list
	if redisClient != nil {
		key := dlqRedisKey + topic
		if err := redisClient.LPush(key, string(envelope)); err == nil {
			log.Printf("[DLQ] Message stored in Redis DLQ key %s", key)
			return
		}
	}

	// Last resort: in-memory queue
	inMemoryDLQMu.Lock()
	inMemoryDLQ = append(inMemoryDLQ, msg)
	inMemoryDLQMu.Unlock()
	log.Printf("[DLQ] Message stored in-memory DLQ (topic=%s, total=%d)", topic, len(inMemoryDLQ))
}

// startDLQReplay runs a background goroutine that replays DLQ messages.
func startDLQReplay() {
	go func() {
		ticker := time.NewTicker(dlqRetryInterval)
		defer ticker.Stop()
		for range ticker.C {
			replayInMemoryDLQ()
			replayRedisDLQ()
		}
	}()
	log.Printf("[DLQ] Replay goroutine started (interval=%s)", dlqRetryInterval)
}

func replayInMemoryDLQ() {
	inMemoryDLQMu.Lock()
	if len(inMemoryDLQ) == 0 {
		inMemoryDLQMu.Unlock()
		return
	}
	pending := make([]dlqMessage, len(inMemoryDLQ))
	copy(pending, inMemoryDLQ)
	inMemoryDLQ = inMemoryDLQ[:0]
	inMemoryDLQMu.Unlock()

	var failed []dlqMessage
	for _, msg := range pending {
		if msg.Attempts >= dlqMaxRetries {
			log.Printf("[DLQ] Dropping message after %d attempts: topic=%s", msg.Attempts, msg.Topic)
			continue
		}
		if kafkaProducer == nil {
			msg.Attempts++
			failed = append(failed, msg)
			continue
		}
		if err := kafkaProducer.Publish(msg.Topic, msg.Payload); err != nil {
			msg.Attempts++
			failed = append(failed, msg)
			log.Printf("[DLQ] Replay failed (attempt %d): topic=%s err=%v", msg.Attempts, msg.Topic, err)
		} else {
			log.Printf("[DLQ] Replay succeeded: topic=%s", msg.Topic)
		}
	}
	if len(failed) > 0 {
		inMemoryDLQMu.Lock()
		inMemoryDLQ = append(failed, inMemoryDLQ...)
		inMemoryDLQMu.Unlock()
	}
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
