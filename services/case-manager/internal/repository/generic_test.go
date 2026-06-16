// internal/repository/generic_test.go — unit tests for GenericRepo helpers
package repository

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// ─── BuildWhereClause ─────────────────────────────────────────────────────────

func TestBuildWhereClause_Empty(t *testing.T) {
	clause, args := BuildWhereClause(nil)
	if clause != "1=1" {
		t.Errorf("expected '1=1', got %q", clause)
	}
	if len(args) != 0 {
		t.Errorf("expected no args, got %v", args)
	}
}

func TestBuildWhereClause_SingleCondition(t *testing.T) {
	clause, args := BuildWhereClause(map[string]interface{}{"status": "open"})
	if clause != `"status" = $1` {
		t.Errorf("unexpected clause: %q", clause)
	}
	if len(args) != 1 || args[0] != "open" {
		t.Errorf("unexpected args: %v", args)
	}
}

func TestBuildWhereClause_MultipleConditions_Deterministic(t *testing.T) {
	// Run twice to verify deterministic ordering
	for i := 0; i < 2; i++ {
		clause, args := BuildWhereClause(map[string]interface{}{
			"status":   "open",
			"priority": "high",
		})
		// Keys sorted: "priority" < "status"
		expected := `"priority" = $1 AND "status" = $2`
		if clause != expected {
			t.Errorf("run %d: expected %q, got %q", i, expected, clause)
		}
		if len(args) != 2 {
			t.Errorf("run %d: expected 2 args, got %d", i, len(args))
		}
	}
}

func TestBuildWhereClause_ThreeConditions(t *testing.T) {
	clause, args := BuildWhereClause(map[string]interface{}{
		"a": 1,
		"b": 2,
		"c": 3,
	})
	expected := `"a" = $1 AND "b" = $2 AND "c" = $3`
	if clause != expected {
		t.Errorf("expected %q, got %q", expected, clause)
	}
	if len(args) != 3 {
		t.Errorf("expected 3 args, got %d", len(args))
	}
}

// ─── QueryFilter.Normalise ────────────────────────────────────────────────────

func TestQueryFilter_Normalise_Defaults(t *testing.T) {
	f := QueryFilter{}
	f.Normalise()
	if f.Limit != 50 {
		t.Errorf("expected Limit=50, got %d", f.Limit)
	}
	if f.Offset != 0 {
		t.Errorf("expected Offset=0, got %d", f.Offset)
	}
	if f.OrderBy != "id" {
		t.Errorf("expected OrderBy='id', got %q", f.OrderBy)
	}
	if f.OrderDir != "DESC" {
		t.Errorf("expected OrderDir='DESC', got %q", f.OrderDir)
	}
}

func TestQueryFilter_Normalise_MaxLimit(t *testing.T) {
	f := QueryFilter{Limit: 999}
	f.Normalise()
	if f.Limit != 200 {
		t.Errorf("expected Limit capped at 200, got %d", f.Limit)
	}
}

func TestQueryFilter_Normalise_NegativeOffset(t *testing.T) {
	f := QueryFilter{Offset: -5}
	f.Normalise()
	if f.Offset != 0 {
		t.Errorf("expected Offset=0, got %d", f.Offset)
	}
}

func TestQueryFilter_Normalise_InvalidOrderDir(t *testing.T) {
	f := QueryFilter{OrderDir: "RANDOM"}
	f.Normalise()
	if f.OrderDir != "DESC" {
		t.Errorf("expected OrderDir='DESC', got %q", f.OrderDir)
	}
}

func TestQueryFilter_Normalise_ValidASC(t *testing.T) {
	f := QueryFilter{OrderDir: "asc"}
	f.Normalise()
	if f.OrderDir != "ASC" {
		t.Errorf("expected OrderDir='ASC', got %q", f.OrderDir)
	}
}

// ─── PageResult ───────────────────────────────────────────────────────────────

func TestNewPageResult_HasMore_True(t *testing.T) {
	items := []string{"a", "b", "c"}
	pr := NewPageResult(items, 10, 3, 0)
	if !pr.HasMore {
		t.Error("expected HasMore=true")
	}
	if pr.Total != 10 {
		t.Errorf("expected Total=10, got %d", pr.Total)
	}
}

func TestNewPageResult_HasMore_False(t *testing.T) {
	items := []string{"a", "b"}
	pr := NewPageResult(items, 2, 10, 0)
	if pr.HasMore {
		t.Error("expected HasMore=false")
	}
}

func TestNewPageResult_NilItems_ReturnsEmpty(t *testing.T) {
	pr := NewPageResult[string](nil, 0, 50, 0)
	if pr.Items == nil {
		t.Error("expected non-nil slice")
	}
	if len(pr.Items) != 0 {
		t.Errorf("expected empty slice, got %v", pr.Items)
	}
}

func TestNewPageResult_LastPage(t *testing.T) {
	items := []string{"x"}
	pr := NewPageResult(items, 11, 10, 10)
	if pr.HasMore {
		t.Error("expected HasMore=false on last page")
	}
}

// ─── BaseRepo.ExistsBy ────────────────────────────────────────────────────────

func TestBaseRepo_ExistsBy_True(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	repo := NewBaseRepository(db, "cases")
	exists, err := repo.ExistsBy(context.Background(), "id", int64(42))
	if err != nil {
		t.Fatalf("ExistsBy: %v", err)
	}
	if !exists {
		t.Error("expected exists=true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestBaseRepo_ExistsBy_False(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	repo := NewBaseRepository(db, "cases")
	exists, err := repo.ExistsBy(context.Background(), "id", int64(99))
	if err != nil {
		t.Fatalf("ExistsBy: %v", err)
	}
	if exists {
		t.Error("expected exists=false")
	}
}

// ─── BaseRepo.CountWhere ──────────────────────────────────────────────────────

func TestBaseRepo_CountWhere(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT COUNT\(\*\)`).
		WithArgs("open").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(7))

	repo := NewBaseRepository(db, "cases")
	count, err := repo.CountWhere(context.Background(), `"status" = $1`, "open")
	if err != nil {
		t.Fatalf("CountWhere: %v", err)
	}
	if count != 7 {
		t.Errorf("expected count=7, got %d", count)
	}
}

// ─── WithTx ───────────────────────────────────────────────────────────────────

func TestWithTx_Commit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE cases`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	err = WithTx(context.Background(), db, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(context.Background(), `UPDATE cases SET id = 1`)
		return err
	})
	if err != nil {
		t.Fatalf("WithTx commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestWithTx_Rollback_OnError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectRollback()

	txErr := fmt.Errorf("intentional error")
	err = WithTx(context.Background(), db, func(tx *sql.Tx) error {
		return txErr
	})
	if err != txErr {
		t.Errorf("expected txErr, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
