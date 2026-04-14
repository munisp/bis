package handlers

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	"bis/payment-rails/internal/models"

	"github.com/google/uuid"
)

// SEPAHandler processes SEPA Credit Transfer (pacs.008) and Direct Debit (pacs.003)
type SEPAHandler struct {
	kafka KafkaPublisher
}

func NewSEPAHandler(kafka KafkaPublisher) *SEPAHandler {
	return &SEPAHandler{kafka: kafka}
}

// POST /api/sepa/credit-transfer
func (h *SEPAHandler) HandleCreditTransfer(w http.ResponseWriter, r *http.Request) {
	var req models.SEPACreditTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.EndToEndID == "" {
		req.EndToEndID = fmt.Sprintf("E2E-%s", uuid.New().String()[:8])
	}
	if req.Currency == "" {
		req.Currency = "EUR"
	}
	if req.ExecutionDate.IsZero() {
		req.ExecutionDate = time.Now().UTC()
	}

	// Validate IBAN format (basic)
	if err := validateIBAN(req.DebtorIBAN); err != nil {
		writeError(w, http.StatusBadRequest, "invalid debtor IBAN: "+err.Error())
		return
	}
	if err := validateIBAN(req.CreditorIBAN); err != nil {
		writeError(w, http.StatusBadRequest, "invalid creditor IBAN: "+err.Error())
		return
	}

	// Generate pacs.008 XML
	xmlPayload := buildPacs008XML(req)

	// Publish to Kafka
	event := models.PaymentEvent{
		EventType:      "sepa.credit_transfer.submitted",
		TransactionRef: req.EndToEndID,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Status:         "submitted",
		Timestamp:      time.Now().UTC(),
	}
	h.publishEvent(r, event)

	resp := models.SEPAPaymentResponse{
		EndToEndID:     req.EndToEndID,
		Status:         "ACTC", // AcceptedTechnicalValidation
		SettlementDate: req.ExecutionDate.Add(24 * time.Hour),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"response":   resp,
		"xmlPayload": xmlPayload,
	})
}

// POST /api/sepa/direct-debit
func (h *SEPAHandler) HandleDirectDebit(w http.ResponseWriter, r *http.Request) {
	var req models.SEPACreditTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	req.PaymentType = models.SEPADirectDebit

	event := models.PaymentEvent{
		EventType:      "sepa.direct_debit.submitted",
		TransactionRef: req.EndToEndID,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Status:         "submitted",
		Timestamp:      time.Now().UTC(),
	}
	h.publishEvent(r, event)

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"endToEndId": req.EndToEndID,
		"status":     "ACTC",
		"submittedAt": time.Now().UTC(),
	})
}

// POST /api/sepa/instant
func (h *SEPAHandler) HandleInstant(w http.ResponseWriter, r *http.Request) {
	var req models.SEPACreditTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// SCT Inst: max 100,000 EUR, must settle within 10 seconds
	if req.Amount > 100_000 {
		writeError(w, http.StatusBadRequest, "SCT Inst maximum amount is EUR 100,000")
		return
	}

	event := models.PaymentEvent{
		EventType:      "sepa.instant.submitted",
		TransactionRef: req.EndToEndID,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Status:         "submitted",
		Timestamp:      time.Now().UTC(),
	}
	h.publishEvent(r, event)

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"endToEndId":     req.EndToEndID,
		"status":         "ACSC", // AcceptedSettlementCompleted (instant)
		"settlementTime": time.Now().Add(5 * time.Second).UTC(),
	})
}

// ─── pacs.008 XML Builder ─────────────────────────────────────────────────────

type Pacs008 struct {
	XMLName xml.Name `xml:"Document"`
	XMLNS   string   `xml:"xmlns,attr"`
	FIToFI  FIToFICstmrCdtTrf `xml:"FIToFICstmrCdtTrf"`
}

type FIToFICstmrCdtTrf struct {
	GrpHdr  GroupHeader   `xml:"GrpHdr"`
	CdtTrfTxInf CreditTransferTx `xml:"CdtTrfTxInf"`
}

type GroupHeader struct {
	MsgId   string `xml:"MsgId"`
	CreDtTm string `xml:"CreDtTm"`
	NbOfTxs string `xml:"NbOfTxs"`
	TtlIntrBkSttlmAmt struct {
		Ccy  string  `xml:"Ccy,attr"`
		Text float64 `xml:",chardata"`
	} `xml:"TtlIntrBkSttlmAmt"`
}

type CreditTransferTx struct {
	PmtId struct {
		EndToEndId string `xml:"EndToEndId"`
		TxId       string `xml:"TxId"`
	} `xml:"PmtId"`
	IntrBkSttlmAmt struct {
		Ccy  string  `xml:"Ccy,attr"`
		Text float64 `xml:",chardata"`
	} `xml:"IntrBkSttlmAmt"`
	Dbtr struct {
		Nm string `xml:"Nm"`
	} `xml:"Dbtr"`
	DbtrAcct struct {
		Id struct {
			IBAN string `xml:"IBAN"`
		} `xml:"Id"`
	} `xml:"DbtrAcct"`
	Cdtr struct {
		Nm string `xml:"Nm"`
	} `xml:"Cdtr"`
	CdtrAcct struct {
		Id struct {
			IBAN string `xml:"IBAN"`
		} `xml:"Id"`
	} `xml:"CdtrAcct"`
	RmtInf struct {
		Ustrd string `xml:"Ustrd"`
	} `xml:"RmtInf"`
}

func buildPacs008XML(req models.SEPACreditTransferRequest) string {
	doc := Pacs008{
		XMLNS: "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08",
	}
	doc.FIToFI.GrpHdr.MsgId = fmt.Sprintf("PACS008-%d", time.Now().UnixMilli())
	doc.FIToFI.GrpHdr.CreDtTm = time.Now().UTC().Format(time.RFC3339)
	doc.FIToFI.GrpHdr.NbOfTxs = "1"
	doc.FIToFI.GrpHdr.TtlIntrBkSttlmAmt.Ccy = req.Currency
	doc.FIToFI.GrpHdr.TtlIntrBkSttlmAmt.Text = req.Amount

	tx := &doc.FIToFI.CdtTrfTxInf
	tx.PmtId.EndToEndId = req.EndToEndID
	tx.PmtId.TxId = uuid.New().String()
	tx.IntrBkSttlmAmt.Ccy = req.Currency
	tx.IntrBkSttlmAmt.Text = req.Amount
	tx.Dbtr.Nm = req.DebtorName
	tx.DbtrAcct.Id.IBAN = req.DebtorIBAN
	tx.Cdtr.Nm = req.CreditorName
	tx.CdtrAcct.Id.IBAN = req.CreditorIBAN
	tx.RmtInf.Ustrd = req.RemittanceInfo

	out, _ := xml.MarshalIndent(doc, "", "  ")
	return string(out)
}

func validateIBAN(iban string) error {
	iban = strings.ReplaceAll(iban, " ", "")
	if len(iban) < 15 || len(iban) > 34 {
		return fmt.Errorf("IBAN length must be 15-34 characters")
	}
	// Basic country code check
	if len(iban) < 2 || iban[0] < 'A' || iban[0] > 'Z' || iban[1] < 'A' || iban[1] > 'Z' {
		return fmt.Errorf("IBAN must start with 2-letter country code")
	}
	return nil
}

func (h *SEPAHandler) publishEvent(r *http.Request, event models.PaymentEvent) {
	if h.kafka == nil {
		return
	}
	data, _ := json.Marshal(event)
	_ = h.kafka.Publish(r.Context(), "payment-events", event.TransactionRef, data)
}
