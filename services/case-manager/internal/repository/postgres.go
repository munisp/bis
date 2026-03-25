// internal/repository/postgres.go — PostgreSQL connection and base repository
package repository

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// NewPostgresDB opens a PostgreSQL connection pool and verifies connectivity.
func NewPostgresDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("db.Ping: %w", err)
	}
	return db, nil
}
