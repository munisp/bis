// internal/handlers/stubs.go — Stub handlers for parties, documents, stakeholders, comments
// Each follows the same pattern as cases.go; full implementations are identical in structure.
package handlers

import (
	"context"
	"net/http"

	"github.com/bis-platform/case-manager/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
	"github.com/segmentio/kafka-go"
)

// ── Party Handler ─────────────────────────────────────────────────────────────

type PartyHandler struct {
	parties  *repository.GenericRepo
	timeline *repository.GenericRepo
}

func NewPartyHandler(parties, timeline *repository.GenericRepo) *PartyHandler {
	return &PartyHandler{parties: parties, timeline: timeline}
}

func (h *PartyHandler) ListParties(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"parties": []interface{}{}, "ref": c.Param("ref")})
}

func (h *PartyHandler) AddParty(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"added": true, "ref": c.Param("ref"), "party": body})
}

func (h *PartyHandler) UpdateParty(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"updated": true, "partyId": c.Param("partyId")})
}

func (h *PartyHandler) RemoveParty(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"removed": true, "partyId": c.Param("partyId")})
}

// ── Document Handler ──────────────────────────────────────────────────────────

type DocumentHandler struct {
	docs     *repository.GenericRepo
	timeline *repository.GenericRepo
	s3Bucket string
	s3Region string
}

func NewDocumentHandler(docs, timeline *repository.GenericRepo, s3Bucket, s3Region string) *DocumentHandler {
	return &DocumentHandler{docs: docs, timeline: timeline, s3Bucket: s3Bucket, s3Region: s3Region}
}

func (h *DocumentHandler) ListDocuments(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"documents": []interface{}{}, "ref": c.Param("ref")})
}

func (h *DocumentHandler) ListDocumentsForStakeholder(c *gin.Context) {
	// Filter out confidential documents for stakeholders
	c.JSON(http.StatusOK, gin.H{"documents": []interface{}{}, "ref": c.Param("ref")})
}

func (h *DocumentHandler) UploadDocument(c *gin.Context) {
	// In production: parse multipart form, upload to S3, persist metadata
	c.JSON(http.StatusCreated, gin.H{"uploaded": true, "ref": c.Param("ref")})
}

func (h *DocumentHandler) DeleteDocument(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"deleted": true, "docId": c.Param("docId")})
}

// ── Stakeholder Handler ───────────────────────────────────────────────────────

type StakeholderHandler struct {
	stakeholders *repository.GenericRepo
	timeline     *repository.GenericRepo
	appBaseURL   string
}

func NewStakeholderHandler(stakeholders, timeline *repository.GenericRepo, appBaseURL string) *StakeholderHandler {
	return &StakeholderHandler{stakeholders: stakeholders, timeline: timeline, appBaseURL: appBaseURL}
}

func (h *StakeholderHandler) ListStakeholders(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"stakeholders": []interface{}{}, "ref": c.Param("ref")})
}

func (h *StakeholderHandler) InviteStakeholder(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// In production: generate secure access token, send email, persist record
	c.JSON(http.StatusCreated, gin.H{
		"invited":   true,
		"ref":       c.Param("ref"),
		"portalURL": h.appBaseURL + "/portal/cases/" + c.Param("ref"),
	})
}

func (h *StakeholderHandler) RevokeStakeholder(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"revoked": true, "stakeholderId": c.Param("stakeholderId")})
}

// ── Comment Handler ───────────────────────────────────────────────────────────

type CommentHandler struct {
	comments     *repository.GenericRepo
	timeline     *repository.GenericRepo
	stakeholders *repository.GenericRepo
}

func NewCommentHandler(comments, timeline, stakeholders *repository.GenericRepo) *CommentHandler {
	return &CommentHandler{comments: comments, timeline: timeline, stakeholders: stakeholders}
}

func (h *CommentHandler) ListComments(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"comments": []interface{}{}, "ref": c.Param("ref")})
}

func (h *CommentHandler) AddComment(c *gin.Context) {
	var body struct {
		Content      string `json:"content" binding:"required"`
		Confidential bool   `json:"confidential"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"added": true, "ref": c.Param("ref"), "content": body.Content})
}

func (h *CommentHandler) AddStakeholderComment(c *gin.Context) {
	// Stakeholders can only add non-confidential comments
	var body struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"added": true, "ref": c.Param("ref"), "content": body.Content})
}

// ── Kafka Producer ────────────────────────────────────────────────────────────

// KafkaProducer wraps a kafka-go writer for event emission.
type KafkaProducer struct {
	writer *kafka.Writer
}

// NewKafkaProducer creates a new Kafka producer for the given brokers and topic.
func NewKafkaProducer(brokers []string, topic string) *KafkaProducer {
	w := &kafka.Writer{
		Addr:     kafka.TCP(brokers...),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
		Async:    true, // Non-blocking — events are best-effort
	}
	return &KafkaProducer{writer: w}
}

// WriteMessage publishes a message to Kafka.
func (p *KafkaProducer) WriteMessage(ctx context.Context, msg kafka.Message) error {
	if p.writer == nil {
		return nil
	}
	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		log.Warn().Err(err).Msg("[Kafka] WriteMessage failed")
		return err
	}
	return nil
}

// Close shuts down the Kafka writer.
func (p *KafkaProducer) Close() {
	if p.writer != nil {
		if err := p.writer.Close(); err != nil {
			log.Warn().Err(err).Msg("[Kafka] Close failed")
		}
	}
}
