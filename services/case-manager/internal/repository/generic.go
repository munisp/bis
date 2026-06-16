// internal/repository/generic.go — Typed repository interface and shared helpers.
//
// TypedRepo[T] provides a type-safe CRUD interface for any database entity.
// The existing GenericRepo struct in cases.go is a lightweight sub-entity helper;
// TypedRepo is the higher-level interface for full CRUD repositories.
package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ─── Typed Repository Interface ───────────────────────────────────────────────

// TypedRepo is a type-safe CRUD interface for a single entity type T.
// All methods accept a context for cancellation and deadline propagation.
type TypedRepo[T any] interface {
	// FindByID retrieves a single entity by its primary key.
	// Returns (nil, nil) when the entity does not exist.
	FindByID(ctx context.Context, id int64) (*T, error)

	// FindAll retrieves all entities matching the given filter.
	// Returns an empty slice (not nil) when no entities match.
	FindAll(ctx context.Context, filter QueryFilter) ([]T, int, error)

	// Create inserts a new entity and returns the persisted version.
	Create(ctx context.Context, entity T) (*T, error)

	// Update replaces the entity identified by id with the provided data.
	// Returns (nil, nil) when the entity does not exist.
	Update(ctx context.Context, id int64, entity T) (*T, error)

	// Delete removes the entity identified by id.
	// Returns nil when the entity does not exist (idempotent).
	Delete(ctx context.Context, id int64) error

	// Exists returns true if an entity with the given id exists.
	Exists(ctx context.Context, id int64) (bool, error)
}

// ─── Query Filter ─────────────────────────────────────────────────────────────

// QueryFilter holds common pagination and filtering parameters.
type QueryFilter struct {
	// Limit caps the number of results returned (default: 50, max: 200).
	Limit int
	// Offset skips the first N results for pagination.
	Offset int
	// OrderBy specifies the column to sort by (default: "id").
	OrderBy string
	// OrderDir is "ASC" or "DESC" (default: "DESC").
	OrderDir string
	// Conditions is a map of column → value for exact-match WHERE clauses.
	Conditions map[string]interface{}
}

// Normalise applies defaults and validates the filter.
func (f *QueryFilter) Normalise() {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 200 {
		f.Limit = 200
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	if f.OrderBy == "" {
		f.OrderBy = "id"
	}
	dir := strings.ToUpper(f.OrderDir)
	if dir != "ASC" && dir != "DESC" {
		f.OrderDir = "DESC"
	} else {
		f.OrderDir = dir
	}
}

// ─── Base Repository ──────────────────────────────────────────────────────────

// BaseRepository provides common database helpers shared by all concrete repositories.
// It is distinct from the existing GenericRepo struct (which is a lightweight
// sub-entity helper for parties, documents, timeline, etc.).
type BaseRepository struct {
	db    *sql.DB
	table string // quoted table name, e.g. `"cases"`
}

// NewBaseRepository creates a new BaseRepository for the given table.
func NewBaseRepository(db *sql.DB, table string) BaseRepository {
	return BaseRepository{db: db, table: fmt.Sprintf("%q", table)}
}

// DB returns the underlying *sql.DB for raw queries.
func (r *BaseRepository) DB() *sql.DB {
	return r.db
}

// Table returns the quoted table name.
func (r *BaseRepository) Table() string {
	return r.table
}

// ExistsBy checks whether a row exists matching the given column = value.
func (r *BaseRepository) ExistsBy(ctx context.Context, column string, value interface{}) (bool, error) {
	query := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE %q = $1)`, r.table, column)
	var exists bool
	err := r.db.QueryRowContext(ctx, query, value).Scan(&exists)
	return exists, err
}

// CountWhere returns the number of rows matching the given WHERE clause.
// whereClause should be a valid SQL fragment like `"status" = $1 AND "priority" = $2`.
func (r *BaseRepository) CountWhere(ctx context.Context, whereClause string, args ...interface{}) (int, error) {
	query := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, r.table, whereClause)
	var count int
	err := r.db.QueryRowContext(ctx, query, args...).Scan(&count)
	return count, err
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

// BuildWhereClause converts a Conditions map into a parameterised WHERE clause.
// Returns the clause string and the ordered args slice.
// Columns are double-quoted to handle camelCase names safely.
func BuildWhereClause(conditions map[string]interface{}) (string, []interface{}) {
	if len(conditions) == 0 {
		return "1=1", nil
	}
	parts := make([]string, 0, len(conditions))
	args := make([]interface{}, 0, len(conditions))
	idx := 1
	// Collect and sort keys for deterministic output
	keys := make([]string, 0, len(conditions))
	for k := range conditions {
		keys = append(keys, k)
	}
	// Insertion sort (avoids importing "sort" for a small slice)
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%q = $%d", k, idx))
		args = append(args, conditions[k])
		idx++
	}
	return strings.Join(parts, " AND "), args
}

// WithTx executes fn inside a database transaction.
// The transaction is committed if fn returns nil, rolled back otherwise.
func WithTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ─── Pagination Helper ────────────────────────────────────────────────────────

// PageResult wraps a slice of results with pagination metadata.
type PageResult[T any] struct {
	Items   []T  `json:"items"`
	Total   int  `json:"total"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"hasMore"`
}

// NewPageResult constructs a PageResult from the raw query results.
func NewPageResult[T any](items []T, total, limit, offset int) PageResult[T] {
	if items == nil {
		items = []T{}
	}
	return PageResult[T]{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		HasMore: offset+len(items) < total,
	}
}
