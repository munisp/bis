// internal/handlers/cases.go — HTTP handlers for case management
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bis-platform/case-manager/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/segmentio/kafka-go"
)

// CaseHandler handles HTTP requests for case management.
type CaseHandler struct {
	cases    *repository.CaseRepository
	timeline *repository.GenericRepo
	kafka    *KafkaProducer
}

// NewCaseHandler creates a new CaseHandler.
func NewCaseHandler(cases *repository.CaseRepository, timeline *repository.GenericRepo, kafka *KafkaProducer) *CaseHandler {
	return &CaseHandler{cases: cases, timeline: timeline, kafka: kafka}
}

// ListCases handles GET /api/v1/cases
func (h *CaseHandler) ListCases(c *gin.Context) {
	filter := repository.ListCasesFilter{
		Status:   c.Query("status"),
		Priority: c.Query("priority"),
		Type:     c.Query("type"),
		Search:   c.Query("search"),
		Limit:    parseIntQuery(c, "limit", 50),
		Offset:   parseIntQuery(c, "offset", 0),
	}

	cases, total, err := h.cases.List(c.Request.Context(), filter)
	if err != nil {
		log.Error().Err(err).Msg("ListCases failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list cases"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"cases":  cases,
		"total":  total,
		"limit":  filter.Limit,
		"offset": filter.Offset,
	})
}

// GetCase handles GET /api/v1/cases/:ref
func (h *CaseHandler) GetCase(c *gin.Context) {
	ref := c.Param("ref")
	caseRecord, err := h.cases.GetByRef(c.Request.Context(), ref)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}
	if caseRecord == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
		return
	}
	c.JSON(http.StatusOK, caseRecord)
}

// GetCaseForStakeholder handles GET /api/v1/portal/cases/:ref (read-only, no confidential fields)
func (h *CaseHandler) GetCaseForStakeholder(c *gin.Context) {
	ref := c.Param("ref")
	caseRecord, err := h.cases.GetByRef(c.Request.Context(), ref)
	if err != nil || caseRecord == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
		return
	}
	// Strip sensitive fields for stakeholder view
	c.JSON(http.StatusOK, gin.H{
		"ref":       caseRecord.Ref,
		"title":     caseRecord.Title,
		"type":      caseRecord.Type,
		"status":    caseRecord.Status,
		"priority":  caseRecord.Priority,
		"summary":   caseRecord.Summary,
		"createdAt": caseRecord.CreatedAt,
		"updatedAt": caseRecord.UpdatedAt,
	})
}

// CreateCaseRequest is the request body for creating a case.
type CreateCaseRequest struct {
	Title               string   `json:"title" binding:"required,min=3,max=300"`
	Type                string   `json:"type" binding:"required"`
	Priority            string   `json:"priority"`
	Summary             *string  `json:"summary"`
	LegalBasis          *string  `json:"legalBasis"`
	Jurisdiction        *string  `json:"jurisdiction"`
	RegulatoryFramework *string  `json:"regulatoryFramework"`
	InvestigationRefs   []string `json:"investigationRefs"`
	Tags                []string `json:"tags"`
	DueAt               *string  `json:"dueAt"`
}

// CreateCase handles POST /api/v1/cases
func (h *CaseHandler) CreateCase(c *gin.Context) {
	var req CreateCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate case reference
	ref := fmt.Sprintf("CASE-%d-%s", time.Now().Year(),
		strings.ToUpper(uuid.New().String()[:8]))

	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}

	var dueAt *time.Time
	if req.DueAt != nil {
		t, err := time.Parse(time.RFC3339, *req.DueAt)
		if err == nil {
			dueAt = &t
		}
	}

	userID := getUserID(c)
	input := repository.CreateCaseInput{
		Ref:                 ref,
		Title:               req.Title,
		Type:                req.Type,
		Priority:            priority,
		Summary:             req.Summary,
		LegalBasis:          req.LegalBasis,
		Jurisdiction:        req.Jurisdiction,
		RegulatoryFramework: req.RegulatoryFramework,
		InvestigationRefs:   req.InvestigationRefs,
		Tags:                req.Tags,
		DueAt:               dueAt,
		CreatedBy:           userID,
	}

	created, err := h.cases.Create(c.Request.Context(), input)
	if err != nil {
		log.Error().Err(err).Msg("CreateCase failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create case"})
		return
	}

	// Emit Kafka event
	h.emitEvent(c.Request.Context(), "case.created", map[string]interface{}{
		"ref":    created.Ref,
		"title":  created.Title,
		"type":   created.Type,
		"userId": userID,
	})

	// Write timeline event
	_ = h.timeline.InsertEvent(c.Request.Context(), created.ID, "case_created",
		fmt.Sprintf("Case %s created", created.Ref), nil, userID, getUserName(c))

	c.JSON(http.StatusCreated, created)
}

// UpdateCase handles PATCH /api/v1/cases/:ref
func (h *CaseHandler) UpdateCase(c *gin.Context) {
	ref := c.Param("ref")
	existing, err := h.cases.GetByRef(c.Request.Context(), ref)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
		return
	}
	var body struct {
		Title               *string  `json:"title"`
		Priority            *string  `json:"priority"`
		Summary             *string  `json:"summary"`
		LegalBasis          *string  `json:"legalBasis"`
		Jurisdiction        *string  `json:"jurisdiction"`
		RegulatoryFramework *string  `json:"regulatoryFramework"`
		DueAt               *string  `json:"dueAt"`
		RiskScore           *int     `json:"riskScore"`
		Tags                []string `json:"tags"`
		InvestigationRefs   []string `json:"investigationRefs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build SET clause dynamically for non-nil fields only
	setParts := []string{`"updatedAt" = NOW()`}
	args := []interface{}{}
	idx := 1

	if body.Title != nil {
		setParts = append(setParts, fmt.Sprintf(`title = $%d`, idx))
		args = append(args, *body.Title)
		idx++
	}
	if body.Priority != nil {
		setParts = append(setParts, fmt.Sprintf(`priority = $%d`, idx))
		args = append(args, *body.Priority)
		idx++
	}
	if body.Summary != nil {
		setParts = append(setParts, fmt.Sprintf(`summary = $%d`, idx))
		args = append(args, *body.Summary)
		idx++
	}
	if body.LegalBasis != nil {
		setParts = append(setParts, fmt.Sprintf(`legal_basis = $%d`, idx))
		args = append(args, *body.LegalBasis)
		idx++
	}
	if body.Jurisdiction != nil {
		setParts = append(setParts, fmt.Sprintf(`jurisdiction = $%d`, idx))
		args = append(args, *body.Jurisdiction)
		idx++
	}
	if body.RegulatoryFramework != nil {
		setParts = append(setParts, fmt.Sprintf(`regulatory_framework = $%d`, idx))
		args = append(args, *body.RegulatoryFramework)
		idx++
	}
	if body.RiskScore != nil {
		setParts = append(setParts, fmt.Sprintf(`risk_score = $%d`, idx))
		args = append(args, *body.RiskScore)
		idx++
	}
	if body.DueAt != nil {
		parsed, parseErr := time.Parse(time.RFC3339, *body.DueAt)
		if parseErr == nil {
			setParts = append(setParts, fmt.Sprintf(`due_at = $%d`, idx))
			args = append(args, parsed)
			idx++
		}
	}
	if body.Tags != nil {
		tagsJSON, _ := json.Marshal(body.Tags)
		setParts = append(setParts, fmt.Sprintf(`tags = $%d`, idx))
		args = append(args, tagsJSON)
		idx++
	}
	if body.InvestigationRefs != nil {
		refsJSON, _ := json.Marshal(body.InvestigationRefs)
		setParts = append(setParts, fmt.Sprintf(`investigation_refs = $%d`, idx))
		args = append(args, refsJSON)
		idx++
	}

	if len(args) == 0 {
		// Nothing to update — return current record
		c.JSON(http.StatusOK, existing)
		return
	}

	args = append(args, ref)
	q := fmt.Sprintf(`UPDATE cases SET %s WHERE ref = $%d`,
		strings.Join(setParts, ", "), idx)
	if _, execErr := h.cases.DB().ExecContext(c.Request.Context(), q, args...); execErr != nil {
		log.Error().Err(execErr).Str("ref", ref).Msg("UpdateCase failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update case"})
		return
	}

	// Write timeline event
	_ = h.timeline.InsertEvent(c.Request.Context(), existing.ID, "case_updated",
		fmt.Sprintf("Case %s updated", ref),
		map[string]interface{}{"fields": len(args) - 1},
		getUserID(c), getUserName(c))

	updated, _ := h.cases.GetByRef(c.Request.Context(), ref)
	if updated == nil {
		c.JSON(http.StatusOK, gin.H{"ref": ref, "updated": true})
		return
	}
	c.JSON(http.StatusOK, updated)
}

// ArchiveCase handles DELETE /api/v1/cases/:ref
func (h *CaseHandler) ArchiveCase(c *gin.Context) {
	ref := c.Param("ref")
	if err := h.cases.UpdateStatus(c.Request.Context(), ref, "archived", nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive case"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ref": ref, "status": "archived"})
}

// UpdateCaseStatus handles POST /api/v1/cases/:ref/status
func (h *CaseHandler) UpdateCaseStatus(c *gin.Context) {
	ref := c.Param("ref")
	var body struct {
		Status        string  `json:"status" binding:"required"`
		ClosureReason *string `json:"closureReason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := h.cases.GetByRef(c.Request.Context(), ref)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
		return
	}

	if err := h.cases.UpdateStatus(c.Request.Context(), ref, body.Status, body.ClosureReason); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	// Emit Kafka event
	h.emitEvent(c.Request.Context(), "case.status_changed", map[string]interface{}{
		"ref":       ref,
		"oldStatus": existing.Status,
		"newStatus": body.Status,
		"userId":    getUserID(c),
	})

	// Write timeline event
	_ = h.timeline.InsertEvent(c.Request.Context(), existing.ID, "status_changed",
		fmt.Sprintf("Status changed: %s → %s", existing.Status, body.Status),
		map[string]string{"from": existing.Status, "to": body.Status},
		getUserID(c), getUserName(c))

	c.JSON(http.StatusOK, gin.H{"ref": ref, "status": body.Status})
}

// GetTimeline handles GET /api/v1/cases/:ref/timeline
func (h *CaseHandler) GetTimeline(c *gin.Context) {
	ref := c.Param("ref")
	db := h.timeline.DB()
	caseID, err := repository.GetCaseIDByRef(db, ref)
	if err != nil {
		if err.Error() == "not_found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		}
		return
	}
	rows, qErr := db.QueryContext(c.Request.Context(),
		`SELECT id, "caseId", "eventType", title, detail, "actorId", "actorName", "createdAt"
		 FROM case_timeline WHERE "caseId" = $1 ORDER BY "createdAt" ASC`, caseID)
	if qErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}
	defer rows.Close()
	type TimelineEvent struct {
		ID        int64           `json:"id"`
		CaseID    int64           `json:"caseId"`
		EventType string          `json:"eventType"`
		Title     string          `json:"title"`
		Detail    json.RawMessage `json:"detail"`
		ActorID   *int64          `json:"actorId,omitempty"`
		ActorName string          `json:"actorName"`
		CreatedAt string          `json:"createdAt"`
	}
	var events []TimelineEvent
	for rows.Next() {
		var ev TimelineEvent
		var createdAt time.Time
		if scanErr := rows.Scan(&ev.ID, &ev.CaseID, &ev.EventType, &ev.Title,
			&ev.Detail, &ev.ActorID, &ev.ActorName, &createdAt); scanErr != nil {
			continue
		}
		ev.CreatedAt = createdAt.Format(time.RFC3339)
		events = append(events, ev)
	}
	if events == nil {
		events = []TimelineEvent{}
	}
	c.JSON(http.StatusOK, gin.H{"ref": ref, "events": events})
}

// GetTimelineForStakeholder handles GET /api/v1/portal/cases/:ref/timeline
func (h *CaseHandler) GetTimelineForStakeholder(c *gin.Context) {
	h.GetTimeline(c)
}

// ── Kafka helper ──────────────────────────────────────────────────────────────

func (h *CaseHandler) emitEvent(ctx context.Context, eventType string, payload interface{}) {
	if h.kafka == nil {
		return
	}
	data, _ := json.Marshal(map[string]interface{}{
		"type":      eventType,
		"payload":   payload,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	if err := h.kafka.WriteMessage(ctx, kafka.Message{
		Key:   []byte(eventType),
		Value: data,
	}); err != nil {
		log.Warn().Err(err).Str("event", eventType).Msg("Kafka emit failed")
	}
}

// ── Utility helpers ───────────────────────────────────────────────────────────

func parseIntQuery(c *gin.Context, key string, def int) int {
	v := c.Query(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getUserID(c *gin.Context) *int64 {
	if v, exists := c.Get("userID"); exists {
		if id, ok := v.(int64); ok {
			return &id
		}
	}
	return nil
}

func getUserName(c *gin.Context) string {
	if v, exists := c.Get("userName"); exists {
		if name, ok := v.(string); ok {
			return name
		}
	}
	return "system"
}
