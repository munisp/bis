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

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, "OK:%s — Queued offline. Will sync when connected.", localRef)
}
