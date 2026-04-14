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

// ─── Stub handler tests (PartyHandler, DocumentHandler, etc.) ─────────────────

func TestPartyHandler_ListParties(t *testing.T) {
	r := gin.New()
	h := &PartyHandler{}
	r.GET("/api/v1/cases/:ref/parties", h.ListParties)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/parties", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	var body map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&body)
	if body["ref"] != "CASE-001" {
		t.Errorf("expected ref=CASE-001, got %v", body["ref"])
	}
}

func TestDocumentHandler_ListDocuments(t *testing.T) {
	r := gin.New()
	h := &DocumentHandler{}
	r.GET("/api/v1/cases/:ref/documents", h.ListDocuments)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/documents", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestStakeholderHandler_ListStakeholders(t *testing.T) {
	r := gin.New()
	h := &StakeholderHandler{}
	r.GET("/api/v1/cases/:ref/stakeholders", h.ListStakeholders)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/stakeholders", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestCommentHandler_ListComments(t *testing.T) {
	r := gin.New()
	h := &CommentHandler{}
	r.GET("/api/v1/cases/:ref/comments", h.ListComments)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/CASE-001/comments", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}
