package models

import "time"

// ─── SWIFT ────────────────────────────────────────────────────────────────────

type SWIFTMessageType string

const (
	MsgTypeMT103    SWIFTMessageType = "MT103"
	MsgTypeMT202    SWIFTMessageType = "MT202"
	MsgTypeMT202COV SWIFTMessageType = "MT202COV"
	MsgTypeMT940    SWIFTMessageType = "MT940"
	MsgTypeMT950    SWIFTMessageType = "MT950"
)

// MT103 — Single Customer Credit Transfer
type MT103 struct {
	UETR               string    `json:"uetr"`
	SenderBIC          string    `json:"senderBic"`
	ReceiverBIC        string    `json:"receiverBic"`
	TransactionRef     string    `json:"transactionRef"`   // Field 20
	BankOpCode         string    `json:"bankOpCode"`       // Field 23B
	ValueDate          time.Time `json:"valueDate"`        // Field 32A
	Currency           string    `json:"currency"`
	Amount             float64   `json:"amount"`
	OrderingCustomer   Party     `json:"orderingCustomer"` // Field 50K
	OrderingBank       string    `json:"orderingBank"`     // Field 52A
	IntermediaryBank   string    `json:"intermediaryBank"` // Field 56A
	BeneficiaryBank    string    `json:"beneficiaryBank"`  // Field 57A
	Beneficiary        Party     `json:"beneficiary"`      // Field 59
	RemittanceInfo     string    `json:"remittanceInfo"`   // Field 70
	ChargesCode        string    `json:"chargesCode"`      // Field 71A (SHA/OUR/BEN)
	SenderCharges      float64   `json:"senderCharges"`    // Field 71F
	ReceiverCharges    float64   `json:"receiverCharges"`  // Field 71G
	RegulatoryReporting string   `json:"regulatoryReporting"` // Field 77B
}

// MT202 — Financial Institution Transfer
type MT202 struct {
	UETR             string    `json:"uetr"`
	SenderBIC        string    `json:"senderBic"`
	ReceiverBIC      string    `json:"receiverBic"`
	TransactionRef   string    `json:"transactionRef"`
	RelatedRef       string    `json:"relatedRef"`
	ValueDate        time.Time `json:"valueDate"`
	Currency         string    `json:"currency"`
	Amount           float64   `json:"amount"`
	OrderingBank     string    `json:"orderingBank"`
	BeneficiaryBank  string    `json:"beneficiaryBank"`
	IsCOV            bool      `json:"isCov"` // MT202COV flag
	UnderlyingMT103  *MT103    `json:"underlyingMt103,omitempty"`
}

type Party struct {
	Name    string `json:"name"`
	Account string `json:"account"`
	Address string `json:"address"`
	Country string `json:"country"`
}

// ─── SEPA ─────────────────────────────────────────────────────────────────────

type SEPAPaymentType string

const (
	SEPACreditTransfer SEPAPaymentType = "credit_transfer"
	SEPADirectDebit    SEPAPaymentType = "direct_debit"
	SEPAInstant        SEPAPaymentType = "instant_credit"
)

// pacs.008 — FI to FI Customer Credit Transfer
type SEPACreditTransferRequest struct {
	EndToEndID     string          `json:"endToEndId"`
	PaymentType    SEPAPaymentType `json:"paymentType"`
	Amount         float64         `json:"amount"`
	Currency       string          `json:"currency"`
	DebtorName     string          `json:"debtorName"`
	DebtorIBAN     string          `json:"debtorIban"`
	DebtorBIC      string          `json:"debtorBic"`
	CreditorName   string          `json:"creditorName"`
	CreditorIBAN   string          `json:"creditorIban"`
	CreditorBIC    string          `json:"creditorBic"`
	RemittanceInfo string          `json:"remittanceInfo"`
	ExecutionDate  time.Time       `json:"executionDate"`
}

type SEPAPaymentResponse struct {
	EndToEndID    string    `json:"endToEndId"`
	Status        string    `json:"status"`
	Reason        string    `json:"reason,omitempty"`
	SettlementDate time.Time `json:"settlementDate,omitempty"`
}

// ─── AML Screening Request ────────────────────────────────────────────────────

type AMLScreenRequest struct {
	TransactionRef     string  `json:"transactionRef"`
	Amount             float64 `json:"amount"`
	Currency           string  `json:"currency"`
	OriginatorName     string  `json:"originatorName"`
	OriginatorCountry  string  `json:"originatorCountry"`
	BeneficiaryName    string  `json:"beneficiaryName"`
	BeneficiaryCountry string  `json:"beneficiaryCountry"`
	TransactionType    string  `json:"transactionType"`
	Narration          string  `json:"narration"`
}

type AMLScreenResponse struct {
	RiskScore float64  `json:"riskScore"`
	RiskLevel string   `json:"riskLevel"`
	Flags     []string `json:"flags"`
	Blocked   bool     `json:"blocked"`
}

// ─── Kafka Events ─────────────────────────────────────────────────────────────

type PaymentEvent struct {
	EventType      string    `json:"eventType"`
	TransactionRef string    `json:"transactionRef"`
	UETR           string    `json:"uetr,omitempty"`
	Amount         float64   `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	RiskLevel      string    `json:"riskLevel,omitempty"`
	Timestamp      time.Time `json:"timestamp"`
}

// ─── Travel Rule ──────────────────────────────────────────────────────────────

type TravelRulePayload struct {
	RecordRef          string  `json:"recordRef"`
	OriginatorName     string  `json:"originatorName"`
	OriginatorAccount  string  `json:"originatorAccount"`
	OriginatorAddress  string  `json:"originatorAddress"`
	OriginatorCountry  string  `json:"originatorCountry"`
	OriginatorDOB      string  `json:"originatorDob"`
	OriginatorID       string  `json:"originatorId"`
	BeneficiaryName    string  `json:"beneficiaryName"`
	BeneficiaryAccount string  `json:"beneficiaryAccount"`
	BeneficiaryAddress string  `json:"beneficiaryAddress"`
	BeneficiaryCountry string  `json:"beneficiaryCountry"`
	Amount             float64 `json:"amount"`
	Currency           string  `json:"currency"`
	VASP               string  `json:"vasp"`
}
