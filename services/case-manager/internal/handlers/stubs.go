// internal/handlers/stubs.go — Full DB-backed handlers for parties, documents, stakeholders, comments
// All handlers query the shared PostgreSQL database (camelCase column names per Drizzle schema).
package handlers

import (
"context"
"crypto/rand"
"database/sql"
"encoding/hex"
"encoding/json"
"fmt"
"net/http"
"strconv"
"time"

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
if h.parties == nil {
c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database not configured"})
return
}
ref := c.Param("ref")
db := h.parties.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
rows, err := db.QueryContext(c.Request.Context(),
`SELECT id, "caseId", role, name, nin, bvn, phone, email, address,
        "entityType", notes, "investigationRef", "addedBy", "createdAt"
 FROM case_parties WHERE "caseId" = $1 ORDER BY "createdAt" ASC`, caseID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
defer rows.Close()
type Party struct {
ID               int64   `json:"id"`
CaseID           int64   `json:"caseId"`
Role             string  `json:"role"`
Name             string  `json:"name"`
NIN              *string `json:"nin,omitempty"`
BVN              *string `json:"bvn,omitempty"`
Phone            *string `json:"phone,omitempty"`
Email            *string `json:"email,omitempty"`
Address          *string `json:"address,omitempty"`
EntityType       *string `json:"entityType,omitempty"`
Notes            *string `json:"notes,omitempty"`
InvestigationRef *string `json:"investigationRef,omitempty"`
AddedBy          *int64  `json:"addedBy,omitempty"`
CreatedAt        string  `json:"createdAt"`
}
var parties []Party
for rows.Next() {
var p Party
var createdAt time.Time
if err := rows.Scan(&p.ID, &p.CaseID, &p.Role, &p.Name, &p.NIN, &p.BVN, &p.Phone, &p.Email,
&p.Address, &p.EntityType, &p.Notes, &p.InvestigationRef, &p.AddedBy, &createdAt); err != nil {
continue
}
p.CreatedAt = createdAt.Format(time.RFC3339)
parties = append(parties, p)
}
if parties == nil {
parties = []Party{}
}
c.JSON(http.StatusOK, gin.H{"parties": parties, "ref": ref})
}

func (h *PartyHandler) AddParty(c *gin.Context) {
ref := c.Param("ref")
db := h.parties.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
var body struct {
Role             string  `json:"role" binding:"required"`
Name             string  `json:"name" binding:"required,min=2,max=200"`
NIN              *string `json:"nin"`
BVN              *string `json:"bvn"`
Phone            *string `json:"phone"`
Email            *string `json:"email"`
Address          *string `json:"address"`
EntityType       *string `json:"entityType"`
Notes            *string `json:"notes"`
InvestigationRef *string `json:"investigationRef"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
userID := getUserID(c)
var partyID int64
var createdAt time.Time
err = db.QueryRowContext(c.Request.Context(),
`INSERT INTO case_parties ("caseId", role, name, nin, bvn, phone, email, address,
                           "entityType", notes, "investigationRef", "addedBy", "createdAt")
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
 RETURNING id, "createdAt"`,
caseID, body.Role, body.Name, body.NIN, body.BVN, body.Phone, body.Email, body.Address,
body.EntityType, body.Notes, body.InvestigationRef, userID,
).Scan(&partyID, &createdAt)
if err != nil {
log.Error().Err(err).Msg("[PartyHandler] AddParty insert failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add party"})
return
}
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "party_added",
fmt.Sprintf("Party added: %s (%s)", body.Name, body.Role),
map[string]interface{}{"partyId": partyID, "name": body.Name, "role": body.Role},
userID, getUserName(c))
c.JSON(http.StatusCreated, gin.H{
"id": partyID, "caseId": caseID, "ref": ref,
"role": body.Role, "name": body.Name, "createdAt": createdAt.Format(time.RFC3339),
})
}

func (h *PartyHandler) UpdateParty(c *gin.Context) {
partyIDStr := c.Param("partyId")
partyID, err := strconv.ParseInt(partyIDStr, 10, 64)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid partyId"})
return
}
var body struct {
Role    *string `json:"role"`
Name    *string `json:"name"`
NIN     *string `json:"nin"`
BVN     *string `json:"bvn"`
Phone   *string `json:"phone"`
Email   *string `json:"email"`
Address *string `json:"address"`
Notes   *string `json:"notes"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
db := h.parties.DB()
_, err = db.ExecContext(c.Request.Context(),
`UPDATE case_parties SET
   role    = COALESCE($1, role),
   name    = COALESCE($2, name),
   nin     = COALESCE($3, nin),
   bvn     = COALESCE($4, bvn),
   phone   = COALESCE($5, phone),
   email   = COALESCE($6, email),
   address = COALESCE($7, address),
   notes   = COALESCE($8, notes)
 WHERE id = $9`,
body.Role, body.Name, body.NIN, body.BVN, body.Phone, body.Email, body.Address, body.Notes, partyID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update party"})
return
}
c.JSON(http.StatusOK, gin.H{"updated": true, "partyId": partyID})
}

func (h *PartyHandler) RemoveParty(c *gin.Context) {
partyIDStr := c.Param("partyId")
partyID, err := strconv.ParseInt(partyIDStr, 10, 64)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid partyId"})
return
}
db := h.parties.DB()
result, err := db.ExecContext(c.Request.Context(), `DELETE FROM case_parties WHERE id = $1`, partyID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove party"})
return
}
n, _ := result.RowsAffected()
if n == 0 {
c.JSON(http.StatusNotFound, gin.H{"error": "Party not found"})
return
}
c.JSON(http.StatusOK, gin.H{"removed": true, "partyId": partyID})
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

type docRow struct {
ID           int64   `json:"id"`
CaseID       int64   `json:"caseId"`
Filename     string  `json:"filename"`
MimeType     *string `json:"mimeType,omitempty"`
FileKey      string  `json:"fileKey"`
URL          string  `json:"url"`
SizeBytes    *int64  `json:"sizeBytes,omitempty"`
Category     *string `json:"category,omitempty"`
Description  *string `json:"description,omitempty"`
Confidential bool    `json:"confidential"`
UploadedBy   *int64  `json:"uploadedBy,omitempty"`
CreatedAt    string  `json:"createdAt"`
}

func scanDocRows(rows *sql.Rows) []docRow {
var docs []docRow
for rows.Next() {
var d docRow
var createdAt time.Time
if err := rows.Scan(&d.ID, &d.CaseID, &d.Filename, &d.MimeType, &d.FileKey, &d.URL,
&d.SizeBytes, &d.Category, &d.Description, &d.Confidential, &d.UploadedBy, &createdAt); err != nil {
continue
}
d.CreatedAt = createdAt.Format(time.RFC3339)
docs = append(docs, d)
}
return docs
}

const docSelectCols = `id, "caseId", filename, "mimeType", "fileKey", url, "sizeBytes",
        category, description, confidential, "uploadedBy", "createdAt"`

func (h *DocumentHandler) ListDocuments(c *gin.Context) {
if h.docs == nil {
c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database not configured"})
return
}
ref := c.Param("ref")
db := h.docs.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
rows, err := db.QueryContext(c.Request.Context(),
fmt.Sprintf(`SELECT %s FROM case_documents WHERE "caseId" = $1 ORDER BY "createdAt" DESC`, docSelectCols), caseID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
defer rows.Close()
docs := scanDocRows(rows)
if docs == nil {
docs = []docRow{}
}
c.JSON(http.StatusOK, gin.H{"documents": docs, "ref": ref})
}

func (h *DocumentHandler) ListDocumentsForStakeholder(c *gin.Context) {
ref := c.Param("ref")
db := h.docs.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
rows, err := db.QueryContext(c.Request.Context(),
fmt.Sprintf(`SELECT %s FROM case_documents WHERE "caseId" = $1 AND confidential = false ORDER BY "createdAt" DESC`, docSelectCols), caseID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
defer rows.Close()
docs := scanDocRows(rows)
if docs == nil {
docs = []docRow{}
}
c.JSON(http.StatusOK, gin.H{"documents": docs, "ref": ref})
}

func (h *DocumentHandler) UploadDocument(c *gin.Context) {
ref := c.Param("ref")
db := h.docs.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
// Accepts JSON body with pre-uploaded S3 metadata (client uploads via BFF first)
var body struct {
Filename     string  `json:"filename" binding:"required"`
MimeType     *string `json:"mimeType"`
FileKey      string  `json:"fileKey" binding:"required"`
URL          string  `json:"url" binding:"required"`
SizeBytes    *int64  `json:"sizeBytes"`
Category     *string `json:"category"`
Description  *string `json:"description"`
Confidential bool    `json:"confidential"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
userID := getUserID(c)
var docID int64
var createdAt time.Time
err = db.QueryRowContext(c.Request.Context(),
`INSERT INTO case_documents ("caseId", filename, "mimeType", "fileKey", url, "sizeBytes",
                             category, description, confidential, "uploadedBy", "createdAt")
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
 RETURNING id, "createdAt"`,
caseID, body.Filename, body.MimeType, body.FileKey, body.URL, body.SizeBytes,
body.Category, body.Description, body.Confidential, userID,
).Scan(&docID, &createdAt)
if err != nil {
log.Error().Err(err).Msg("[DocumentHandler] UploadDocument insert failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to persist document metadata"})
return
}
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "document_uploaded",
fmt.Sprintf("Document uploaded: %s", body.Filename),
map[string]interface{}{"docId": docID, "filename": body.Filename, "mimeType": body.MimeType},
userID, getUserName(c))
c.JSON(http.StatusCreated, gin.H{
"id": docID, "caseId": caseID, "ref": ref,
"filename": body.Filename, "url": body.URL, "createdAt": createdAt.Format(time.RFC3339),
})
}

func (h *DocumentHandler) DeleteDocument(c *gin.Context) {
docIDStr := c.Param("docId")
docID, err := strconv.ParseInt(docIDStr, 10, 64)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid docId"})
return
}
db := h.docs.DB()
var filename string
var caseID int64
_ = db.QueryRowContext(c.Request.Context(),
`SELECT filename, "caseId" FROM case_documents WHERE id = $1`, docID).Scan(&filename, &caseID)
result, err := db.ExecContext(c.Request.Context(), `DELETE FROM case_documents WHERE id = $1`, docID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete document"})
return
}
n, _ := result.RowsAffected()
if n == 0 {
c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
return
}
if caseID > 0 {
userID := getUserID(c)
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "document_deleted",
fmt.Sprintf("Document deleted: %s", filename),
map[string]interface{}{"docId": docID, "filename": filename},
userID, getUserName(c))
}
c.JSON(http.StatusOK, gin.H{"deleted": true, "docId": docID})
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

type stakeholderRow struct {
ID               int64   `json:"id"`
CaseID           int64   `json:"caseId"`
Role             string  `json:"role"`
Name             string  `json:"name"`
Email            string  `json:"email"`
Organisation     *string `json:"organisation,omitempty"`
CanComment       bool    `json:"canComment"`
CanViewDocuments bool    `json:"canViewDocuments"`
LastAccessedAt   *string `json:"lastAccessedAt,omitempty"`
InvitedBy        *int64  `json:"invitedBy,omitempty"`
AccessExpiresAt  *string `json:"accessExpiresAt,omitempty"`
CreatedAt        string  `json:"createdAt"`
}

func (h *StakeholderHandler) ListStakeholders(c *gin.Context) {
if h.stakeholders == nil {
c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database not configured"})
return
}
ref := c.Param("ref")
db := h.stakeholders.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
rows, err := db.QueryContext(c.Request.Context(),
`SELECT id, "caseId", role, name, email, organisation, "canComment", "canViewDocuments",
        "lastAccessedAt", "invitedBy", "accessExpiresAt", "createdAt"
 FROM case_stakeholders WHERE "caseId" = $1 ORDER BY "createdAt" ASC`, caseID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
defer rows.Close()
var stakeholders []stakeholderRow
for rows.Next() {
var s stakeholderRow
var createdAt time.Time
var lastAccessedAt, accessExpiresAt *time.Time
if err := rows.Scan(&s.ID, &s.CaseID, &s.Role, &s.Name, &s.Email, &s.Organisation,
&s.CanComment, &s.CanViewDocuments, &lastAccessedAt, &s.InvitedBy, &accessExpiresAt, &createdAt); err != nil {
continue
}
s.CreatedAt = createdAt.Format(time.RFC3339)
if lastAccessedAt != nil {
t := lastAccessedAt.Format(time.RFC3339)
s.LastAccessedAt = &t
}
if accessExpiresAt != nil {
t := accessExpiresAt.Format(time.RFC3339)
s.AccessExpiresAt = &t
}
stakeholders = append(stakeholders, s)
}
if stakeholders == nil {
stakeholders = []stakeholderRow{}
}
c.JSON(http.StatusOK, gin.H{"stakeholders": stakeholders, "ref": ref})
}

func (h *StakeholderHandler) InviteStakeholder(c *gin.Context) {
ref := c.Param("ref")
db := h.stakeholders.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
var body struct {
Role             string  `json:"role" binding:"required"`
Name             string  `json:"name" binding:"required,min=2,max=200"`
Email            string  `json:"email" binding:"required,email"`
Organisation     *string `json:"organisation"`
CanComment       bool    `json:"canComment"`
CanViewDocuments *bool   `json:"canViewDocuments"`
ExpiryDays       *int    `json:"expiryDays"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
tokenBytes := make([]byte, 32)
if _, err := rand.Read(tokenBytes); err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate access token"})
return
}
accessToken := hex.EncodeToString(tokenBytes)
expiryDays := 30
if body.ExpiryDays != nil && *body.ExpiryDays > 0 {
expiryDays = *body.ExpiryDays
}
accessExpiresAt := time.Now().Add(time.Duration(expiryDays) * 24 * time.Hour)
canViewDocs := true
if body.CanViewDocuments != nil {
canViewDocs = *body.CanViewDocuments
}
userID := getUserID(c)
var shID int64
var createdAt time.Time
err = db.QueryRowContext(c.Request.Context(),
`INSERT INTO case_stakeholders ("caseId", role, name, email, organisation, "accessToken",
                                "accessExpiresAt", "canComment", "canViewDocuments", "invitedBy", "createdAt")
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
 RETURNING id, "createdAt"`,
caseID, body.Role, body.Name, body.Email, body.Organisation, accessToken,
accessExpiresAt, body.CanComment, canViewDocs, userID,
).Scan(&shID, &createdAt)
if err != nil {
log.Error().Err(err).Msg("[StakeholderHandler] InviteStakeholder insert failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to invite stakeholder"})
return
}
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "stakeholder_invited",
fmt.Sprintf("Stakeholder invited: %s (%s)", body.Name, body.Role),
map[string]interface{}{"stakeholderId": shID, "name": body.Name, "email": body.Email, "role": body.Role},
userID, getUserName(c))
portalURL := fmt.Sprintf("%s/portal/cases/%s?token=%s", h.appBaseURL, ref, accessToken)
c.JSON(http.StatusCreated, gin.H{
"id": shID, "caseId": caseID, "ref": ref,
"name": body.Name, "email": body.Email, "role": body.Role,
"portalURL":       portalURL,
"accessExpiresAt": accessExpiresAt.Format(time.RFC3339),
"createdAt":       createdAt.Format(time.RFC3339),
})
}

func (h *StakeholderHandler) RevokeStakeholder(c *gin.Context) {
shIDStr := c.Param("stakeholderId")
shID, err := strconv.ParseInt(shIDStr, 10, 64)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid stakeholderId"})
return
}
db := h.stakeholders.DB()
result, err := db.ExecContext(c.Request.Context(),
`UPDATE case_stakeholders SET "accessToken" = NULL, "accessExpiresAt" = NULL WHERE id = $1`, shID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke stakeholder"})
return
}
n, _ := result.RowsAffected()
if n == 0 {
c.JSON(http.StatusNotFound, gin.H{"error": "Stakeholder not found"})
return
}
c.JSON(http.StatusOK, gin.H{"revoked": true, "stakeholderId": shID})
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

type commentRow struct {
ID            int64   `json:"id"`
CaseID        int64   `json:"caseId"`
Content       string  `json:"content"`
AuthorID      *int64  `json:"authorId,omitempty"`
AuthorName    *string `json:"authorName,omitempty"`
AuthorRole    *string `json:"authorRole,omitempty"`
StakeholderID *int64  `json:"stakeholderId,omitempty"`
Confidential  bool    `json:"confidential"`
EditedAt      *string `json:"editedAt,omitempty"`
CreatedAt     string  `json:"createdAt"`
UpdatedAt     string  `json:"updatedAt"`
}

func (h *CommentHandler) ListComments(c *gin.Context) {
if h.comments == nil {
c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database not configured"})
return
}
ref := c.Param("ref")
db := h.comments.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
rows, err := db.QueryContext(c.Request.Context(),
`SELECT id, "caseId", content, "authorId", "authorName", "authorRole",
        "stakeholderId", confidential, "editedAt", "createdAt", "updatedAt"
 FROM case_comments
 WHERE "caseId" = $1 AND "deletedAt" IS NULL
 ORDER BY "createdAt" ASC`, caseID)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
defer rows.Close()
var comments []commentRow
for rows.Next() {
var cm commentRow
var createdAt, updatedAt time.Time
var editedAt *time.Time
if err := rows.Scan(&cm.ID, &cm.CaseID, &cm.Content, &cm.AuthorID, &cm.AuthorName,
&cm.AuthorRole, &cm.StakeholderID, &cm.Confidential, &editedAt, &createdAt, &updatedAt); err != nil {
continue
}
cm.CreatedAt = createdAt.Format(time.RFC3339)
cm.UpdatedAt = updatedAt.Format(time.RFC3339)
if editedAt != nil {
t := editedAt.Format(time.RFC3339)
cm.EditedAt = &t
}
comments = append(comments, cm)
}
if comments == nil {
comments = []commentRow{}
}
c.JSON(http.StatusOK, gin.H{"comments": comments, "ref": ref})
}

func (h *CommentHandler) AddComment(c *gin.Context) {
ref := c.Param("ref")
db := h.comments.DB()
caseID, err := repository.GetCaseIDByRef(db, ref)
if err != nil {
if err.Error() == "not_found" {
c.JSON(http.StatusNotFound, gin.H{"error": "Case not found"})
} else {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
}
return
}
var body struct {
Content      string `json:"content" binding:"required,min=1,max=5000"`
Confidential bool   `json:"confidential"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
userID := getUserID(c)
userName := getUserName(c)
userRole, _ := c.Get("userRole")
roleStr, _ := userRole.(string)
var commentID int64
var createdAt time.Time
err = db.QueryRowContext(c.Request.Context(),
`INSERT INTO case_comments ("caseId", content, "authorId", "authorName", "authorRole",
                            confidential, "createdAt", "updatedAt")
 VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
 RETURNING id, "createdAt"`,
caseID, body.Content, userID, userName, roleStr, body.Confidential,
).Scan(&commentID, &createdAt)
if err != nil {
log.Error().Err(err).Msg("[CommentHandler] AddComment insert failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment"})
return
}
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "comment_added",
fmt.Sprintf("Comment added by %s", userName),
map[string]interface{}{"commentId": commentID, "confidential": body.Confidential},
userID, userName)
c.JSON(http.StatusCreated, gin.H{
"id": commentID, "caseId": caseID, "ref": ref,
"content": body.Content, "authorName": userName,
"confidential": body.Confidential, "createdAt": createdAt.Format(time.RFC3339),
})
}

func (h *CommentHandler) AddStakeholderComment(c *gin.Context) {
ref := c.Param("ref")
db := h.comments.DB()
token, _ := c.Get("stakeholderToken")
tokenStr, _ := token.(string)
if tokenStr == "" {
c.JSON(http.StatusUnauthorized, gin.H{"error": "Stakeholder token required"})
return
}
var shID int64
var shName string
var canComment bool
var caseID int64
err := db.QueryRowContext(c.Request.Context(),
`SELECT id, name, "canComment", "caseId" FROM case_stakeholders
 WHERE "accessToken" = $1 AND "accessExpiresAt" > NOW() LIMIT 1`, tokenStr,
).Scan(&shID, &shName, &canComment, &caseID)
if err == sql.ErrNoRows {
c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired stakeholder token"})
return
}
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
return
}
if !canComment {
c.JSON(http.StatusForbidden, gin.H{"error": "This stakeholder does not have comment permission"})
return
}
var caseRef string
_ = db.QueryRowContext(c.Request.Context(), `SELECT ref FROM cases WHERE id = $1`, caseID).Scan(&caseRef)
if caseRef != ref {
c.JSON(http.StatusForbidden, gin.H{"error": "Token does not match this case"})
return
}
var body struct {
Content string `json:"content" binding:"required,min=1,max=5000"`
}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
var commentID int64
var createdAt time.Time
err = db.QueryRowContext(c.Request.Context(),
`INSERT INTO case_comments ("caseId", content, "authorName", "authorRole",
                            "stakeholderId", confidential, "createdAt", "updatedAt")
 VALUES ($1,$2,$3,'stakeholder',$4,false,NOW(),NOW())
 RETURNING id, "createdAt"`,
caseID, body.Content, shName, shID,
).Scan(&commentID, &createdAt)
if err != nil {
log.Error().Err(err).Msg("[CommentHandler] AddStakeholderComment insert failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment"})
return
}
_, _ = db.ExecContext(c.Request.Context(),
`UPDATE case_stakeholders SET "lastAccessedAt" = NOW() WHERE id = $1`, shID)
_ = h.timeline.InsertEvent(c.Request.Context(), caseID, "comment_added",
fmt.Sprintf("Stakeholder comment from %s", shName),
map[string]interface{}{"commentId": commentID, "stakeholderId": shID},
nil, shName)
c.JSON(http.StatusCreated, gin.H{
"id": commentID, "caseId": caseID, "ref": ref,
"content": body.Content, "authorName": shName,
"confidential": false, "createdAt": createdAt.Format(time.RFC3339),
})
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
Async:    true,
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

// ensure json is used
var _ = json.Marshal
