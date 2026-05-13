package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ─── parseIntQuery tests ──────────────────────────────────────────────────────

func TestParseIntQuery_Default(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		val := parseIntQuery(c, "limit", 50)
		c.JSON(http.StatusOK, gin.H{"val": val})
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["val"] != float64(50) {
		t.Errorf("expected default 50, got %v", body["val"])
	}
}

func TestParseIntQuery_Provided(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		val := parseIntQuery(c, "limit", 50)
		c.JSON(http.StatusOK, gin.H{"val": val})
	})
	req := httptest.NewRequest(http.MethodGet, "/test?limit=25", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["val"] != float64(25) {
		t.Errorf("expected 25, got %v", body["val"])
	}
}

func TestParseIntQuery_InvalidFallsToDefault(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		val := parseIntQuery(c, "limit", 50)
		c.JSON(http.StatusOK, gin.H{"val": val})
	})
	req := httptest.NewRequest(http.MethodGet, "/test?limit=notanumber", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["val"] != float64(50) {
		t.Errorf("expected default 50 for invalid input, got %v", body["val"])
	}
}

// ─── getUserID tests ──────────────────────────────────────────────────────────

func TestGetUserID_NotSet(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		uid := getUserID(c)
		if uid != nil {
			c.JSON(http.StatusOK, gin.H{"uid": *uid})
		} else {
			c.JSON(http.StatusOK, gin.H{"uid": nil})
		}
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["uid"] != nil {
		t.Errorf("expected nil uid, got %v", body["uid"])
	}
}

func TestGetUserID_Set(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		c.Set("userID", int64(42))
		uid := getUserID(c)
		if uid != nil {
			c.JSON(http.StatusOK, gin.H{"uid": *uid})
		} else {
			c.JSON(http.StatusOK, gin.H{"uid": nil})
		}
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["uid"] != float64(42) {
		t.Errorf("expected uid=42, got %v", body["uid"])
	}
}

// ─── getUserName tests ────────────────────────────────────────────────────────

func TestGetUserName_NotSet(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		name := getUserName(c)
		c.JSON(http.StatusOK, gin.H{"name": name})
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["name"] != "system" {
		t.Errorf("expected 'system' default, got %v", body["name"])
	}
}

func TestGetUserName_Set(t *testing.T) {
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		c.Set("userName", "alice")
		name := getUserName(c)
		c.JSON(http.StatusOK, gin.H{"name": name})
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["name"] != "alice" {
		t.Errorf("expected 'alice', got %v", body["name"])
	}
}

// ─── Sub-entity handler tests (PartyHandler, DocumentHandler, etc.) ─────────────
// These tests verify that the handlers respond correctly when no DB is configured
// (repo == nil). In production, handlers are constructed with NewXxxHandler(db, ...).
// When the repo is nil, handlers return 503 Service Unavailable — a safe degradation.

func TestPartyHandler_ListParties_NoDB(t *testing.T) {
	r := gin.New()
	h := &PartyHandler{} // no DB — simulates misconfigured deployment
	r.GET("/api/v1/cases/:ref/parties", h.ListParties)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/parties", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	// Without a DB the handler should return 503, not panic
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when no DB configured, got %d", rr.Code)
	}
}

func TestDocumentHandler_ListDocuments_NoDB(t *testing.T) {
	r := gin.New()
	h := &DocumentHandler{}
	r.GET("/api/v1/cases/:ref/documents", h.ListDocuments)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/documents", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when no DB configured, got %d", rr.Code)
	}
}

func TestStakeholderHandler_ListStakeholders_NoDB(t *testing.T) {
	r := gin.New()
	h := &StakeholderHandler{}
	r.GET("/api/v1/cases/:ref/stakeholders", h.ListStakeholders)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/stakeholders", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when no DB configured, got %d", rr.Code)
	}
}

func TestCommentHandler_ListComments_NoDB(t *testing.T) {
	r := gin.New()
	h := &CommentHandler{}
	r.GET("/api/v1/cases/:ref/comments", h.ListComments)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/comments", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when no DB configured, got %d", rr.Code)
	}
}
