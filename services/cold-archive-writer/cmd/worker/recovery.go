package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

type inFlightBatch struct {
	ID              uuid.UUID
	Status          string
	ObjectKey       string
	ManifestKey     *string
	EncryptionKeyID *string
}

// recoverInFlightBatches makes recovery explicit and safe. It only releases a
// batch when no immutable object exists. Any possibly uploaded artifact is
// quarantined for operator verification; no data is deleted and no source row
// is cold-marked during recovery.
func (r Repository) recoverInFlightBatches(ctx context.Context, storage *minio.Client, bucket string, keyPolicy *archiveKeyPolicy, logger *slog.Logger) error {
	rows, err := r.pool.Query(ctx, `
			SELECT id, status, object_key, manifest_key, object_encryption_key_id
			FROM cold_archive_batches
		WHERE status IN ('planned', 'uploading', 'verified')
		ORDER BY created_at ASC
		FOR UPDATE`)
	if err != nil {
		return fmt.Errorf("list in-flight archive batches: %w", err)
	}
	defer rows.Close()

	var batches []inFlightBatch
	for rows.Next() {
		var batch inFlightBatch
		if err := rows.Scan(&batch.ID, &batch.Status, &batch.ObjectKey, &batch.ManifestKey, &batch.EncryptionKeyID); err != nil {
			return fmt.Errorf("scan in-flight archive batch: %w", err)
		}
		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate in-flight archive batches: %w", err)
	}

	for _, batch := range batches {
		if quarantine, reason := recoveryKeyDisposition(keyPolicy, batch.Status, batch.EncryptionKeyID); quarantine {
			if err := r.quarantineBatch(ctx, batch.ID, "archive encryption recovery blocked: "+reason); err != nil {
				return err
			}
			logger.Error("quarantined archive batch with unavailable encryption key", "batch_id", batch.ID, "object_key", batch.ObjectKey, "reason", reason)
			continue
		}
		switch batch.Status {
		case "planned":
			if err := r.releaseUnuploadedBatch(ctx, batch.ID, "recovered planned batch before object upload"); err != nil {
				return err
			}
			logger.Warn("released interrupted planned cold archive batch", "batch_id", batch.ID)
		case "uploading":
			_, err := storage.StatObject(ctx, bucket, batch.ObjectKey, minio.StatObjectOptions{})
			if minio.ToErrorResponse(err).Code == "NoSuchKey" || minio.ToErrorResponse(err).Code == "NoSuchObject" {
				if err := r.releaseUnuploadedBatch(ctx, batch.ID, "recovered upload with no immutable archive object"); err != nil {
					return err
				}
				logger.Warn("released interrupted upload with no object", "batch_id", batch.ID)
				continue
			}
			if err != nil {
				return fmt.Errorf("inspect uploaded object for batch %s: %w", batch.ID, err)
			}
			if err := r.quarantineBatch(ctx, batch.ID, "object exists after interrupted upload; verify object and manifest before manual commit"); err != nil {
				return err
			}
			logger.Error("quarantined ambiguous uploading cold archive batch", "batch_id", batch.ID, "object_key", batch.ObjectKey)
		case "verified":
			if err := r.quarantineBatch(ctx, batch.ID, "verified-but-uncommitted batch requires manual restore validation before commit or release"); err != nil {
				return err
			}
			logger.Error("quarantined ambiguous verified cold archive batch", "batch_id", batch.ID, "object_key", batch.ObjectKey)
		}
	}
	return nil
}

func (r Repository) releaseUnuploadedBatch(ctx context.Context, batchID uuid.UUID, reason string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin archive release: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE transactions SET "coldArchiveBatchId" = NULL
		WHERE "coldArchiveBatchId" = $1 AND "archivedTier" IS NULL`, batchID); err != nil {
		return fmt.Errorf("release source transaction ownership: %w", err)
	}
	command, err := tx.Exec(ctx, `
		UPDATE cold_archive_batches SET status = 'failed', error_detail = $2
		WHERE id = $1 AND status IN ('planned', 'uploading')`, batchID, reason)
	if err != nil {
		return fmt.Errorf("mark released archive batch failed: %w", err)
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("archive batch %s changed during release", batchID)
	}
	return tx.Commit(ctx)
}

func (r Repository) quarantineBatch(ctx context.Context, batchID uuid.UUID, reason string) error {
	command, err := r.pool.Exec(ctx, `
		UPDATE cold_archive_batches SET status = 'quarantined', error_detail = $2
		WHERE id = $1 AND status IN ('uploading', 'verified')`, batchID, reason)
	if err != nil {
		return fmt.Errorf("quarantine archive batch %s: %w", batchID, err)
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("archive batch %s changed before quarantine", batchID)
	}
	return nil
}

// keep pgx imported in this package as the repository methods deliberately use
// PostgreSQL transaction semantics during recovery rather than best-effort ORM calls.
var _ = pgx.TxOptions{}
