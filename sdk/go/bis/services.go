package bis

import (
	"context"
	"net/url"
	"strconv"
)

// ── Common types ─────────────────────────────────────────────────────────────

type PaginatedResponse[T any] struct {
	Data       []T `json:"data"`
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

// ── Investigations ────────────────────────────────────────────────────────────

type Investigation struct {
	ID         string  `json:"id"`
	RefNumber  string  `json:"refNumber"`
	Subject    Subject `json:"subject"`
	Status     string  `json:"status"`
	Priority   string  `json:"priority"`
	RiskScore  float64 `json:"riskScore"`
	AssignedTo string  `json:"assignedTo,omitempty"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
}

type Subject struct {
	Name  string `json:"name"`
	NIN   string `json:"nin,omitempty"`
	BVN   string `json:"bvn,omitempty"`
	Phone string `json:"phone,omitempty"`
}

type ListInvestigationsParams struct {
	Status   string
	Priority string
	Search   string
	Page     int
	Limit    int
}

type InvestigationsService struct{ client *Client }

func (s *InvestigationsService) List(ctx context.Context, p ListInvestigationsParams) (*PaginatedResponse[Investigation], error) {
	params := url.Values{}
	if p.Status != "" {
		params.Set("status", p.Status)
	}
	if p.Priority != "" {
		params.Set("priority", p.Priority)
	}
	if p.Search != "" {
		params.Set("search", p.Search)
	}
	if p.Page > 0 {
		params.Set("page", strconv.Itoa(p.Page))
	}
	if p.Limit > 0 {
		params.Set("limit", strconv.Itoa(p.Limit))
	}
	var result PaginatedResponse[Investigation]
	return &result, s.client.do(ctx, "GET", "/investigations", params, nil, &result)
}

func (s *InvestigationsService) Get(ctx context.Context, id string) (*Investigation, error) {
	var result Investigation
	return &result, s.client.do(ctx, "GET", "/investigations/"+id, nil, nil, &result)
}

func (s *InvestigationsService) Create(ctx context.Context, data map[string]interface{}) (*Investigation, error) {
	var result Investigation
	return &result, s.client.do(ctx, "POST", "/investigations", nil, data, &result)
}

// ── KYC ──────────────────────────────────────────────────────────────────────

type KYCRecord struct {
	ID         string `json:"id"`
	SubjectID  string `json:"subjectId"`
	NIN        string `json:"nin"`
	BVN        string `json:"bvn,omitempty"`
	Status     string `json:"status"`
	RiskLevel  string `json:"riskLevel"`
	VerifiedAt string `json:"verifiedAt,omitempty"`
}

type KYCService struct{ client *Client }

func (s *KYCService) List(ctx context.Context, status string, page int) (*PaginatedResponse[KYCRecord], error) {
	params := url.Values{}
	if status != "" {
		params.Set("status", status)
	}
	if page > 0 {
		params.Set("page", strconv.Itoa(page))
	}
	var result PaginatedResponse[KYCRecord]
	return &result, s.client.do(ctx, "GET", "/kyc", params, nil, &result)
}

func (s *KYCService) Submit(ctx context.Context, nin, bvn, documentType string) (*KYCRecord, error) {
	body := map[string]string{"nin": nin}
	if bvn != "" {
		body["bvn"] = bvn
	}
	if documentType != "" {
		body["documentType"] = documentType
	}
	var result KYCRecord
	return &result, s.client.do(ctx, "POST", "/kyc", nil, body, &result)
}

// ── Alerts ────────────────────────────────────────────────────────────────────

type Alert struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Severity  string `json:"severity"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	IsRead    bool   `json:"isRead"`
	CreatedAt string `json:"createdAt"`
}

type AlertsService struct{ client *Client }

func (s *AlertsService) List(ctx context.Context, severity, alertType string, isRead *bool) (*PaginatedResponse[Alert], error) {
	params := url.Values{}
	if severity != "" {
		params.Set("severity", severity)
	}
	if alertType != "" {
		params.Set("type", alertType)
	}
	if isRead != nil {
		params.Set("isRead", strconv.FormatBool(*isRead))
	}
	var result PaginatedResponse[Alert]
	return &result, s.client.do(ctx, "GET", "/alerts", params, nil, &result)
}

func (s *AlertsService) MarkRead(ctx context.Context, alertID string) error {
	return s.client.do(ctx, "POST", "/alerts/"+alertID+"/read", nil, nil, nil)
}

// ── Transactions ──────────────────────────────────────────────────────────────

type Transaction struct {
	ID              string  `json:"id"`
	Reference       string  `json:"reference"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	SenderAccount   string  `json:"senderAccount"`
	ReceiverAccount string  `json:"receiverAccount"`
	Channel         string  `json:"channel"`
	Status          string  `json:"status"`
	AMLScore        float64 `json:"amlScore"`
	CreatedAt       string  `json:"createdAt"`
}

type TransactionsService struct{ client *Client }

func (s *TransactionsService) List(ctx context.Context, params url.Values) (*PaginatedResponse[Transaction], error) {
	var result PaginatedResponse[Transaction]
	return &result, s.client.do(ctx, "GET", "/transactions", params, nil, &result)
}

func (s *TransactionsService) Flag(ctx context.Context, id, reason string) (*Transaction, error) {
	body := map[string]string{}
	if reason != "" {
		body["reason"] = reason
	}
	var result Transaction
	return &result, s.client.do(ctx, "POST", "/transactions/"+id+"/flag", nil, body, &result)
}

func (s *TransactionsService) Block(ctx context.Context, id string) (*Transaction, error) {
	var result Transaction
	return &result, s.client.do(ctx, "POST", "/transactions/"+id+"/block", nil, nil, &result)
}

// ── SAR ───────────────────────────────────────────────────────────────────────

type SARFiling struct {
	ID             string  `json:"id"`
	FilingRef      string  `json:"filingRef"`
	ReportType     string  `json:"reportType"`
	Status         string  `json:"status"`
	SubjectName    string  `json:"subjectName"`
	AmountInvolved float64 `json:"amountInvolved"`
	Currency       string  `json:"currency"`
	FiledAt        string  `json:"filedAt,omitempty"`
}

type SARService struct{ client *Client }

func (s *SARService) List(ctx context.Context) (*PaginatedResponse[SARFiling], error) {
	var result PaginatedResponse[SARFiling]
	return &result, s.client.do(ctx, "GET", "/sar", nil, nil, &result)
}

func (s *SARService) Submit(ctx context.Context, data map[string]interface{}) (*SARFiling, error) {
	var result SARFiling
	return &result, s.client.do(ctx, "POST", "/sar", nil, data, &result)
}

// ── QuickCheck ────────────────────────────────────────────────────────────────

type QuickCheckResult struct {
	RequestID   string                 `json:"requestId"`
	Subject     Subject                `json:"subject"`
	Verdict     string                 `json:"verdict"`
	RiskScore   float64                `json:"riskScore"`
	Checks      map[string]string      `json:"checks"`
	ReportURL   string                 `json:"reportUrl"`
	CompletedAt string                 `json:"completedAt"`
}

type QuickCheckService struct{ client *Client }

func (s *QuickCheckService) Run(ctx context.Context, data map[string]interface{}) (*QuickCheckResult, error) {
	var result QuickCheckResult
	return &result, s.client.do(ctx, "POST", "/quickcheck", nil, data, &result)
}

// ── LEX ───────────────────────────────────────────────────────────────────────

type LexSubmission struct {
	SubmissionRef   string  `json:"submissionRef"`
	AgencyCode      string  `json:"agencyCode"`
	State           string  `json:"state"`
	IncidentType    string  `json:"incidentType"`
	Status          string  `json:"status"`
	ValidationScore float64 `json:"validationScore"`
	CreatedAt       string  `json:"createdAt"`
}

type LEXService struct{ client *Client }

func (s *LEXService) List(ctx context.Context, state, status, incidentType string) (*PaginatedResponse[LexSubmission], error) {
	params := url.Values{}
	if state != "" {
		params.Set("state", state)
	}
	if status != "" {
		params.Set("status", status)
	}
	if incidentType != "" {
		params.Set("incidentType", incidentType)
	}
	var result PaginatedResponse[LexSubmission]
	return &result, s.client.do(ctx, "GET", "/lex/submissions", params, nil, &result)
}

func (s *LEXService) Submit(ctx context.Context, data map[string]interface{}) (*LexSubmission, error) {
	var result LexSubmission
	return &result, s.client.do(ctx, "POST", "/lex/submissions", nil, data, &result)
}

// ── Analytics ─────────────────────────────────────────────────────────────────

type AnalyticsService struct{ client *Client }

func (s *AnalyticsService) TransferVolume(ctx context.Context, period, dateFrom, dateTo string) (map[string]interface{}, error) {
	params := url.Values{}
	if period != "" {
		params.Set("period", period)
	}
	if dateFrom != "" {
		params.Set("dateFrom", dateFrom)
	}
	if dateTo != "" {
		params.Set("dateTo", dateTo)
	}
	var result map[string]interface{}
	return result, s.client.do(ctx, "GET", "/analytics/transfers", params, nil, &result)
}
