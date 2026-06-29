// internal/repository/cases.go — Case CRUD repository
package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Case mirrors the cases table in the BIS PostgreSQL schema.
type Case struct {
	ID                  int64           `db:"id" json:"id"`
	Ref                 string          `db:"ref" json:"ref"`
	Title               string          `db:"title" json:"title"`
	Type                string          `db:"type" json:"type"`
	Status              string          `db:"status" json:"status"`
	Priority            string          `db:"priority" json:"priority"`
	Summary             *string         `db:"summary" json:"summary,omitempty"`
	LegalBasis          *string         `db:"legal_basis" json:"legalBasis,omitempty"`
	Jurisdiction        *string         `db:"jurisdiction" json:"jurisdiction,omitempty"`
	RegulatoryFramework *string         `db:"regulatory_framework" json:"regulatoryFramework,omitempty"`
	LeadAnalystID       *int64          `db:"lead_analyst_id" json:"leadAnalystId,omitempty"`
	TenantID            *int64          `db:"tenant_id" json:"tenantId,omitempty"`
	InvestigationRefs   json.RawMessage `db:"investigation_refs" json:"investigationRefs"`
	Tags                json.RawMessage `db:"tags" json:"tags"`
	DueAt               *time.Time      `db:"due_at" json:"dueAt,omitempty"`
	ClosedAt            *time.Time      `db:"closed_at" json:"closedAt,omitempty"`
	ClosureReason       *string         `db:"closure_reason" json:"closureReason,omitempty"`
	RiskScore           *int            `db:"risk_score" json:"riskScore,omitempty"`
	CreatedBy           *int64          `db:"created_by" json:"createdBy,omitempty"`
	CreatedAt           time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt           time.Time       `db:"updated_at" json:"updatedAt"`
}

// ListCasesFilter defines query parameters for listing cases.
type ListCasesFilter struct {
	Status   string
	Priority string
	Type     string
	Search   string
	Limit    int
	Offset   int
}

// CaseRepository provides data access for the cases table.
type CaseRepository struct {
	db *sql.DB
}

// NewCaseRepository creates a new CaseRepository.
func NewCaseRepository(db *sql.DB) *CaseRepository {
	return &CaseRepository{db: db}
}

// DB returns the underlying *sql.DB for direct queries in handlers.
func (r *CaseRepository) DB() *sql.DB { return r.db }

// List returns cases matching the given filter.
func (r *CaseRepository) List(ctx context.Context, f ListCasesFilter) ([]Case, int, error) {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 200 {
		f.Limit = 200
	}

	where := []string{"1=1"}
	args := []interface{}{}
	idx := 1

	if f.Status != "" {
		where = append(where, fmt.Sprintf(`"status" = $%d`, idx))
		args = append(args, f.Status)
		idx++
	}
	if f.Priority != "" {
		where = append(where, fmt.Sprintf(`"priority" = $%d`, idx))
		args = append(args, f.Priority)
		idx++
	}
	if f.Type != "" {
		where = append(where, fmt.Sprintf(`"type" = $%d`, idx))
		args = append(args, f.Type)
		idx++
	}
	if f.Search != "" {
		where = append(where, fmt.Sprintf(`("title" ILIKE $%d OR "summary" ILIKE $%d)`, idx, idx))
		args = append(args, "%"+f.Search+"%")
		idx++
	}

	whereClause := strings.Join(where, " AND ")

	// Count
	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM cases WHERE %s`, whereClause)
	if err := r.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count: %w", err)
	}

	// Data
	dataQ := fmt.Sprintf(`
		SELECT id, ref, title, type, status, priority, summary, legal_basis, jurisdiction,
		       regulatory_framework, lead_analyst_id, tenant_id, investigation_refs, tags,
		       due_at, closed_at, closure_reason, risk_score, created_by, created_at, updated_at
		FROM cases
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, idx, idx+1)
	args = append(args, f.Limit, f.Offset)

	rows, err := r.db.QueryContext(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	var cases []Case
	for rows.Next() {
		var c Case
		if err := rows.Scan(
			&c.ID, &c.Ref, &c.Title, &c.Type, &c.Status, &c.Priority,
			&c.Summary, &c.LegalBasis, &c.Jurisdiction, &c.RegulatoryFramework,
			&c.LeadAnalystID, &c.TenantID, &c.InvestigationRefs, &c.Tags,
			&c.DueAt, &c.ClosedAt, &c.ClosureReason, &c.RiskScore,
			&c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan: %w", err)
		}
		cases = append(cases, c)
	}
	return cases, total, rows.Err()
}

// GetByRef returns a single case by its reference string.
func (r *CaseRepository) GetByRef(ctx context.Context, ref string) (*Case, error) {
	q := `
		SELECT id, ref, title, type, status, priority, summary, legal_basis, jurisdiction,
		       regulatory_framework, lead_analyst_id, tenant_id, investigation_refs, tags,
		       due_at, closed_at, closure_reason, risk_score, created_by, created_at, updated_at
		FROM cases WHERE ref = $1 LIMIT 1
	`
	var c Case
	err := r.db.QueryRowContext(ctx, q, ref).Scan(
		&c.ID, &c.Ref, &c.Title, &c.Type, &c.Status, &c.Priority,
		&c.Summary, &c.LegalBasis, &c.Jurisdiction, &c.RegulatoryFramework,
		&c.LeadAnalystID, &c.TenantID, &c.InvestigationRefs, &c.Tags,
		&c.DueAt, &c.ClosedAt, &c.ClosureReason, &c.RiskScore,
		&c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetByRef: %w", err)
	}
	return &c, nil
}

// CreateCaseInput holds the fields required to create a new case.
type CreateCaseInput struct {
	Ref                 string
	Title               string
	Type                string
	Priority            string
	Summary             *string
	LegalBasis          *string
	Jurisdiction        *string
	RegulatoryFramework *string
	LeadAnalystID       *int64
	TenantID            *int64
	InvestigationRefs   []string
	Tags                []string
	DueAt               *time.Time
	CreatedBy           *int64
}

// Create inserts a new case record.
func (r *CaseRepository) Create(ctx context.Context, input CreateCaseInput) (*Case, error) {
	refs, _ := json.Marshal(input.InvestigationRefs)
	tags, _ := json.Marshal(input.Tags)

	q := `
		INSERT INTO cases (ref, title, type, status, priority, summary, legal_basis, jurisdiction,
		                   regulatory_framework, lead_analyst_id, tenant_id, investigation_refs, tags,
		                   due_at, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
		RETURNING id, ref, title, type, status, priority, summary, legal_basis, jurisdiction,
		          regulatory_framework, lead_analyst_id, tenant_id, investigation_refs, tags,
		          due_at, closed_at, closure_reason, risk_score, created_by, created_at, updated_at
	`
	var c Case
	err := r.db.QueryRowContext(ctx, q,
		input.Ref, input.Title, input.Type, input.Priority,
		input.Summary, input.LegalBasis, input.Jurisdiction, input.RegulatoryFramework,
		input.LeadAnalystID, input.TenantID, refs, tags, input.DueAt, input.CreatedBy,
	).Scan(
		&c.ID, &c.Ref, &c.Title, &c.Type, &c.Status, &c.Priority,
		&c.Summary, &c.LegalBasis, &c.Jurisdiction, &c.RegulatoryFramework,
		&c.LeadAnalystID, &c.TenantID, &c.InvestigationRefs, &c.Tags,
		&c.DueAt, &c.ClosedAt, &c.ClosureReason, &c.RiskScore,
		&c.CreatedBy, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("Create: %w", err)
	}
	return &c, nil
}

// UpdateStatus transitions a case to a new status.
func (r *CaseRepository) UpdateStatus(ctx context.Context, ref, status string, closureReason *string) error {
	var closedAt *time.Time
	if status == "closed" || status == "archived" {
		now := time.Now()
		closedAt = &now
	}
	_, err := r.db.ExecContext(ctx,
		`UPDATE cases SET status=$1, closed_at=$2, closure_reason=$3, updated_at=NOW() WHERE ref=$4`,
		status, closedAt, closureReason, ref,
	)
	return err
}

// ── Stub repositories for parties, documents, timeline, stakeholders, comments ──

// NewPartyRepository creates a stub party repository (full implementation follows same pattern).
func NewPartyRepository(db *sql.DB) *GenericRepo { return &GenericRepo{db: db, table: "case_parties"} }

// NewDocumentRepository creates a stub document repository.
func NewDocumentRepository(db *sql.DB) *GenericRepo {
	return &GenericRepo{db: db, table: "case_documents"}
}

// NewTimelineRepository creates a stub timeline repository.
func NewTimelineRepository(db *sql.DB) *GenericRepo {
	return &GenericRepo{db: db, table: "case_timeline"}
}

// NewStakeholderRepository creates a stub stakeholder repository.
func NewStakeholderRepository(db *sql.DB) *GenericRepo {
	return &GenericRepo{db: db, table: "case_stakeholders"}
}

// NewCommentRepository creates a stub comment repository.
func NewCommentRepository(db *sql.DB) *GenericRepo {
	return &GenericRepo{db: db, table: "case_comments"}
}

// GenericRepo is a placeholder repository that holds a DB reference for sub-entities.
// Each sub-entity (parties, documents, etc.) follows the same pattern as CaseRepository.
type GenericRepo struct {
	db    *sql.DB
	table string
}

// DB returns the underlying *sql.DB for direct queries in handlers.
func (r *GenericRepo) DB() *sql.DB { return r.db }

// GetCaseIDByRef resolves a case ref to its numeric primary key.
func GetCaseIDByRef(db *sql.DB, ref string) (int64, error) {
	var id int64
	err := db.QueryRow(`SELECT id FROM cases WHERE ref = $1 LIMIT 1`, ref).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("not_found")
	}
	return id, err
}

// InsertEvent inserts a timeline event for a case.
func (r *GenericRepo) InsertEvent(ctx context.Context, caseID int64, eventType, title string, detail interface{}, actorID *int64, actorName string) error {
	detailJSON, _ := json.Marshal(detail)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO case_timeline ("caseId", "eventType", title, detail, "actorId", "actorName", "createdAt")
		 VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
		caseID, eventType, title, detailJSON, actorID, actorName,
	)
	return err
}
