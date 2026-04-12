// sms_gateway.go — SMS gateway handlers for Africa's Talking and Termii
//
// Africa's Talking webhook format (POST /sms/at):
//   from=+2348012345678&to=12345&text=LEX+NPF-LA-001+1234+ARREST+LA+suspect+narrative&date=...
//
// Termii webhook format (POST /sms/termii):
//   {"from":"+2348012345678","to":"12345","text":"LEX NPF-LA-001 1234 ARREST LA narrative","id":"..."}
//
// Structured SMS format (both providers):
//   LEX <agencyCode> <pin> <incidentType> <stateCode> <narrative...>
//   Example: LEX NPF-LA-001 123456 ARREST LA Suspect arrested at Mile 2 market
//
// Short state codes: LA=Lagos, AB=Abuja, KN=Kano, RS=Rivers, OY=Oyo, etc.
//
// Response: plain text "OK:<localRef>" or "ERR:<reason>" (feature-phone compatible)
// Outbound: after successful submission, a return SMS is sent to the officer's phone.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// ─── State Code Map ───────────────────────────────────────────────────────────

var stateCodeMap = map[string]string{
	"AB": "abia",
	"AD": "adamawa",
	"AK": "akwa_ibom",
	"AN": "anambra",
	"BA": "bauchi",
	"BY": "bayelsa",
	"BE": "benue",
	"BO": "borno",
	"CR": "cross_river",
	"DE": "delta",
	"EB": "ebonyi",
	"ED": "edo",
	"EK": "ekiti",
	"EN": "enugu",
	"GO": "gombe",
	"IM": "imo",
	"JI": "jigawa",
	"KD": "kaduna",
	"KN": "kano",
	"KT": "katsina",
	"KE": "kebbi",
	"KO": "kogi",
	"KW": "kwara",
	"LA": "lagos",
	"NA": "nasarawa",
	"NI": "niger",
	"OG": "ogun",
	"ON": "ondo",
	"OS": "osun",
	"OY": "oyo",
	"PL": "plateau",
	"RI": "rivers",
	"SO": "sokoto",
	"TA": "taraba",
	"YO": "yobe",
	"ZA": "zamfara",
	"FC": "fct_abuja",
}

// ─── SMS Parser ───────────────────────────────────────────────────────────────

type ParsedSMS struct {
	AgencyCode   string
	PIN          string
	IncidentType string
	StateCode    string
	StateFull    string
	Narrative    string
	SenderPhone  string
	Channel      string
	RawText      string
}

// parseSMSText parses the structured SMS format:
// LEX <agencyCode> <pin> <incidentType> <stateCode> <narrative...>
func parseSMSText(text, senderPhone, channel string) (*ParsedSMS, error) {
	// Normalise: trim, collapse whitespace, uppercase prefix
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > 1600 {
		return nil, fmt.Errorf("message too long (max 1600 chars)")
	}

	parts := strings.Fields(text)
	if len(parts) < 6 {
		return nil, fmt.Errorf("expected: LEX <agencyCode> <pin> <type> <state> <narrative...>, got %d parts", len(parts))
	}

	prefix := strings.ToUpper(parts[0])
	if prefix != "LEX" {
		return nil, fmt.Errorf("message must start with LEX keyword, got: %q", parts[0])
	}

	agencyCode := strings.ToUpper(parts[1])
	pin := parts[2]
	incidentType := strings.ToUpper(parts[3])
	stateCode := strings.ToUpper(parts[4])
	narrative := strings.Join(parts[5:], " ")

	// Validate state code
	stateFull, ok := stateCodeMap[stateCode]
	if !ok {
		return nil, fmt.Errorf("unknown state code %q — use 2-letter code e.g. LA=Lagos, KN=Kano", stateCode)
	}

	// Validate incident type (basic allowlist)
	validTypes := map[string]bool{
		"ARREST": true, "THEFT": true, "ASSAULT": true, "KIDNAP": true,
		"MURDER": true, "ROBBERY": true, "FRAUD": true, "DRUG": true,
		"TERRORISM": true, "ARSON": true, "RAPE": true, "VANDALISM": true,
		"MISSING": true, "ACCIDENT": true, "OTHER": true,
	}
	if !validTypes[incidentType] {
		incidentType = "OTHER" // default to OTHER for unrecognised types
	}

	// Validate PIN format (4-8 digits)
	if len(pin) < 4 || len(pin) > 8 {
		return nil, fmt.Errorf("PIN must be 4-8 digits")
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return nil, fmt.Errorf("PIN must contain only digits")
		}
	}

	return &ParsedSMS{
		AgencyCode:   agencyCode,
		PIN:          pin,
		IncidentType: incidentType,
		StateCode:    stateCode,
		StateFull:    stateFull,
		Narrative:    narrative,
		SenderPhone:  senderPhone,
		Channel:      channel,
		RawText:      text,
	}, nil
}

// ─── Africa's Talking Webhook ─────────────────────────────────────────────────

// POST /sms/at
// Africa's Talking sends form-encoded POST:
//
//	from=+2348012345678&to=12345&text=LEX+NPF-LA-001+1234+ARREST+LA+narrative&date=2026-04-11+10:00:00
func (s *Server) handleATWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Africa's Talking sends application/x-www-form-urlencoded
	if err := r.ParseForm(); err != nil {
		log.Printf("[sms/at] ParseForm error: %v", err)
		http.Error(w, "invalid form data", http.StatusBadRequest)
		return
	}

	from := r.FormValue("from")
	text := r.FormValue("text")
	msgID := r.FormValue("id")

	log.Printf("[sms/at] Received from=%s id=%s text=%q", from, msgID, text)

	s.processSMSSubmission(w, from, text, "at_sms", msgID)
}

// ─── Termii Webhook ───────────────────────────────────────────────────────────

// POST /sms/termii
// Termii sends JSON:
//
//	{"from":"+2348012345678","to":"12345","text":"LEX NPF-LA-001 1234 ARREST LA narrative","id":"..."}
type termiiWebhookBody struct {
	From string `json:"from"`
	To   string `json:"to"`
	Text string `json:"text"`
	ID   string `json:"id"`
}

func (s *Server) handleTermiiWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body termiiWebhookBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		log.Printf("[sms/termii] JSON decode error: %v", err)
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("[sms/termii] Received from=%s id=%s text=%q", body.From, body.ID, body.Text)

	s.processSMSSubmission(w, body.From, body.Text, "termii_sms", body.ID)
}

// ─── Shared SMS Processing ────────────────────────────────────────────────────

func (s *Server) processSMSSubmission(w http.ResponseWriter, senderPhone, text, channel, externalID string) {
	parsed, err := parseSMSText(text, senderPhone, channel)
	if err != nil {
		log.Printf("[sms] Parse error from %s: %v", senderPhone, err)
		// Return a short plain-text error (feature-phone compatible)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "ERR:FORMAT — %s\nSend: LEX <agencyCode> <pin> <type> <state> <narrative>", err.Error())
		return
	}

	// Rate limit by sender phone (not submitter ID for SMS — phone is the identity)
	rateLimitKey := senderPhone
	if rateLimitKey == "" {
		rateLimitKey = parsed.AgencyCode
	}
	allowed, count, err := s.store.CheckRateLimit(rateLimitKey, 10) // 10 SMS per day per number
	if err != nil || !allowed {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "ERR:LIMIT — Daily SMS limit reached (%d/10). Try again tomorrow.", count)
		return
	}

	// Build payload (same schema as JSON submissions)
	payload, _ := json.Marshal(map[string]any{
		"submitterId":   parsed.AgencyCode + ":" + senderPhone, // composite ID for SMS
		"agencyCode":    parsed.AgencyCode,
		"pin":           parsed.PIN,
		"incidentType":  strings.ToLower(parsed.IncidentType),
		"incidentState": parsed.StateFull,
		"narrative":     parsed.Narrative,
		"senderPhone":   senderPhone,
		"channel":       channel,
		"externalId":    externalID,
		"rawSMS":        parsed.RawText,
		"submittedAt":   time.Now().UTC().Format(time.RFC3339),
	})

	localRef := fmt.Sprintf("LEX-SMS-%s-%d", strings.ToUpper(parsed.AgencyCode), time.Now().UnixMilli())
	pinHash := fmt.Sprintf("sha256:%s:%s", parsed.AgencyCode, parsed.PIN)

	// Try immediate BIS sync
	if s.bis.Ping() {
		bisRef, err := s.bis.Submit(string(payload))
		if err == nil {
			s.store.Enqueue(localRef, parsed.AgencyCode, parsed.AgencyCode, pinHash, string(payload))
			log.Printf("[sms] Synced immediately → BIS ref %s", bisRef)
			// ── Outbound confirmation SMS ──────────────────────────────────────
			if senderPhone != "" {
				confirmMsg := fmt.Sprintf("BIS LEX: Submission received. Ref: %s. Agency: %s. Type: %s. State: %s. Keep this ref for tracking.",
					bisRef, parsed.AgencyCode, parsed.IncidentType, strings.ToUpper(parsed.StateCode))
				go func() {
					result := SendOutboundSMS(senderPhone, confirmMsg)
					if result.Success {
						log.Printf("[sms/outbound] Confirmation sent to %s (msgId=%s)", senderPhone, result.MessageID)
					} else {
						log.Printf("[sms/outbound] Confirmation failed to %s: %s", senderPhone, result.Error)
					}
				}()
			}
			w.Header().Set("Content-Type", "text/plain")
			fmt.Fprintf(w, "OK:%s — Submission received. BIS ref: %s", localRef, bisRef)
			return
		}
		log.Printf("[sms] BIS sync failed, queuing: %v", err)
	}

	// Queue for later
	if err := s.store.Enqueue(localRef, parsed.AgencyCode, parsed.AgencyCode, pinHash, string(payload)); err != nil {
		log.Printf("[sms] Enqueue error: %v", err)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, "ERR:QUEUE — Failed to queue submission. Please try again.")
		return
	}

	log.Printf("[sms] Queued offline: %s (state=%s, type=%s)", localRef, parsed.StateFull, parsed.IncidentType)
	// Outbound confirmation for queued submission
	if senderPhone != "" {
		confirmMsg := fmt.Sprintf("BIS LEX: Submission queued (offline). Local ref: %s. Agency: %s. Will sync when connected.",
			localRef, parsed.AgencyCode)
		go func() {
			result := SendOutboundSMS(senderPhone, confirmMsg)
			if result.Success {
				log.Printf("[sms/outbound] Queued confirmation sent to %s", senderPhone)
			} else {
				log.Printf("[sms/outbound] Queued confirmation failed to %s: %s", senderPhone, result.Error)
			}
		}()
	}
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, "OK:%s — Queued offline. Will sync when connected.", localRef)
}

// ─── Outbound SMS Confirmation ────────────────────────────────────────────────
// SendOutboundSMS sends a return SMS to the officer's phone with the submission
// reference number. Supports Africa's Talking and Termii providers.
// Provider is selected via the SMS_PROVIDER env var (default: africas_talking).
// Failures are logged but do not affect the submission result.

// OutboundSMSResult captures the result of an outbound SMS attempt.
type OutboundSMSResult struct {
	Provider  string
	MessageID string
	Success   bool
	Error     string
}

// SendOutboundSMS sends a confirmation SMS to the given phone number.
// It is fire-and-forget — errors are logged but not propagated.
func SendOutboundSMS(toPhone, message string) OutboundSMSResult {
	provider := os.Getenv("SMS_PROVIDER")
	if provider == "" {
		provider = "africas_talking"
	}
	switch provider {
	case "termii":
		return sendTermiiOutbound(toPhone, message)
	default:
		return sendATOutbound(toPhone, message)
	}
}

// sendATOutbound sends via Africa's Talking SMS API.
func sendATOutbound(toPhone, message string) OutboundSMSResult {
	apiKey := os.Getenv("AT_API_KEY")
	username := os.Getenv("AT_USERNAME")
	senderID := os.Getenv("AT_SENDER_ID")
	if senderID == "" {
		senderID = "BIS-LEX"
	}
	if apiKey == "" || username == "" {
		log.Printf("[sms/at/outbound] AT_API_KEY or AT_USERNAME not set — skipping outbound SMS")
		return OutboundSMSResult{Provider: "africas_talking", Success: false, Error: "credentials not configured"}
	}
	endpoint := "https://api.africastalking.com/version1/messaging"
	data := url.Values{}
	data.Set("username", username)
	data.Set("to", toPhone)
	data.Set("message", message)
	data.Set("from", senderID)
	req, err := http.NewRequest("POST", endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		log.Printf("[sms/at/outbound] request build error: %v", err)
		return OutboundSMSResult{Provider: "africas_talking", Success: false, Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("apiKey", apiKey)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[sms/at/outbound] HTTP error: %v", err)
		return OutboundSMSResult{Provider: "africas_talking", Success: false, Error: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("[sms/at/outbound] Sent to %s: %s", toPhone, string(body))
		return OutboundSMSResult{Provider: "africas_talking", Success: true, MessageID: string(body)}
	}
	log.Printf("[sms/at/outbound] Failed status=%d body=%s", resp.StatusCode, string(body))
	return OutboundSMSResult{Provider: "africas_talking", Success: false, Error: fmt.Sprintf("status %d", resp.StatusCode)}
}

// sendTermiiOutbound sends via Termii SMS API.
func sendTermiiOutbound(toPhone, message string) OutboundSMSResult {
	apiKey := os.Getenv("TERMII_API_KEY")
	senderID := os.Getenv("TERMII_SENDER_ID")
	if senderID == "" {
		senderID = "BIS-LEX"
	}
	if apiKey == "" {
		log.Printf("[sms/termii/outbound] TERMII_API_KEY not set — skipping outbound SMS")
		return OutboundSMSResult{Provider: "termii", Success: false, Error: "credentials not configured"}
	}
	endpoint := "https://api.ng.termii.com/api/sms/send"
	payload, _ := json.Marshal(map[string]any{
		"to":      toPhone,
		"from":    senderID,
		"sms":     message,
		"type":    "plain",
		"channel": "generic",
		"api_key": apiKey,
	})
	req, err := http.NewRequest("POST", endpoint, strings.NewReader(string(payload)))
	if err != nil {
		log.Printf("[sms/termii/outbound] request build error: %v", err)
		return OutboundSMSResult{Provider: "termii", Success: false, Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[sms/termii/outbound] HTTP error: %v", err)
		return OutboundSMSResult{Provider: "termii", Success: false, Error: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("[sms/termii/outbound] Sent to %s: %s", toPhone, string(body))
		return OutboundSMSResult{Provider: "termii", Success: true, MessageID: string(body)}
	}
	log.Printf("[sms/termii/outbound] Failed status=%d body=%s", resp.StatusCode, string(body))
	return OutboundSMSResult{Provider: "termii", Success: false, Error: fmt.Sprintf("status %d", resp.StatusCode)}
}
