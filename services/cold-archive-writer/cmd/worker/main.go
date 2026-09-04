// Command cold-archive-writer creates verified Parquet cold archives from the
// PostgreSQL transactions table. It is intended for a single scheduled run; an
// advisory lock prevents concurrent archive runs from selecting the same rows.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/reader"
	"github.com/xitongsys/parquet-go/writer"
)

const (
	schemaVersion   = "bis.transaction.cold.v1"
	workerLockName  = "bis_cold_archive_v1"
	archiveStatuses = "completed,failed,reversed,blocked"
)

type Config struct {
	DatabaseURL    string
	S3Endpoint     string
	S3AccessKey    string
	S3SecretKey    string
	S3Bucket       string
	S3Region       string
	PushgatewayURL string
	BatchSize      int
	ColdAgeDays    int
	TempDir        string
}

func requireEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}

func positiveIntEnv(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return parsed, nil
}

func loadConfig() (Config, error) {
	var config Config
	var err error
	if config.DatabaseURL, err = requireEnv("DATABASE_URL"); err != nil {
		return Config{}, err
	}
	if !strings.HasPrefix(config.DatabaseURL, "postgres://") && !strings.HasPrefix(config.DatabaseURL, "postgresql://") {
		return Config{}, errors.New("DATABASE_URL must be a PostgreSQL URL")
	}
	if config.S3Endpoint, err = requireEnv("BIS_ARCHIVE_S3_ENDPOINT"); err != nil {
		return Config{}, err
	}
	if strings.HasPrefix(config.S3Endpoint, "http://") {
		return Config{}, errors.New("BIS_ARCHIVE_S3_ENDPOINT must use TLS (https://)")
	}
	config.S3Endpoint = strings.TrimPrefix(config.S3Endpoint, "https://")
	config.S3Endpoint = strings.TrimSuffix(config.S3Endpoint, "/")
	if config.S3AccessKey, err = requireEnv("BIS_ARCHIVE_S3_ACCESS_KEY"); err != nil {
		return Config{}, err
	}
	if config.S3SecretKey, err = requireEnv("BIS_ARCHIVE_S3_SECRET_KEY"); err != nil {
		return Config{}, err
	}
	if config.S3Bucket, err = requireEnv("BIS_ARCHIVE_S3_BUCKET"); err != nil {
		return Config{}, err
	}
	if config.S3Region, err = requireEnv("BIS_ARCHIVE_S3_REGION"); err != nil {
		return Config{}, err
	}
	config.PushgatewayURL = strings.TrimSpace(os.Getenv("BIS_ARCHIVE_PUSHGATEWAY_URL"))
	if strings.EqualFold(os.Getenv("BIS_ENV"), "production") && config.PushgatewayURL == "" {
		return Config{}, errors.New("BIS_ARCHIVE_PUSHGATEWAY_URL is required in production")
	}
	if config.BatchSize, err = positiveIntEnv("BIS_COLD_ARCHIVE_BATCH_SIZE", 5000); err != nil {
		return Config{}, err
	}
	if config.BatchSize > 10000 {
		return Config{}, errors.New("BIS_COLD_ARCHIVE_BATCH_SIZE must not exceed 10000")
	}
	if config.ColdAgeDays, err = positiveIntEnv("BIS_COLD_ARCHIVE_AGE_DAYS", 365); err != nil {
		return Config{}, err
	}
	config.TempDir = strings.TrimSpace(os.Getenv("BIS_COLD_ARCHIVE_TMP_DIR"))
	if config.TempDir == "" {
		config.TempDir = os.TempDir()
	}
	return config, nil
}

// TransactionArchiveV1 is deliberately decimal-preserving: amount is serialized
// as PostgreSQL numeric text, not float64, so archival does not introduce monetary
// rounding changes.
type TransactionArchiveV1 struct {
	SchemaVersion       string  `parquet:"name=schema_version, type=BYTE_ARRAY, convertedtype=UTF8"`
	ArchiveBatchID      string  `parquet:"name=archive_batch_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionID       int32   `parquet:"name=transaction_id, type=INT32"`
	TenantID            *int32  `parquet:"name=tenant_id, type=INT32, repetitiontype=OPTIONAL"`
	TransactionRef      string  `parquet:"name=transaction_ref, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionType     string  `parquet:"name=transaction_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	Status              string  `parquet:"name=status, type=BYTE_ARRAY, convertedtype=UTF8"`
	AmountDecimal       string  `parquet:"name=amount_decimal, type=BYTE_ARRAY, convertedtype=UTF8"`
	Currency            string  `parquet:"name=currency, type=BYTE_ARRAY, convertedtype=UTF8"`
	OriginatorName      string  `parquet:"name=originator_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	OriginatorAccount   *string `parquet:"name=originator_account, type=BYTE_ARRAY, convertedtype=UTF8, repetitiontype=OPTIONAL"`
	BeneficiaryName     string  `parquet:"name=beneficiary_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	BeneficiaryAccount  *string `parquet:"name=beneficiary_account, type=BYTE_ARRAY, convertedtype=UTF8, repetitiontype=OPTIONAL"`
	AMLScore            *string `parquet:"name=aml_score, type=BYTE_ARRAY, convertedtype=UTF8, repetitiontype=OPTIONAL"`
	CreatedAtMicrosUTC  int64   `parquet:"name=created_at_micros_utc, type=INT64, convertedtype=TIMESTAMP_MICROS"`
	ArchivedAtMicrosUTC int64   `parquet:"name=archived_at_micros_utc, type=INT64, convertedtype=TIMESTAMP_MICROS"`
}

type ArchiveBatch struct {
	ID           uuid.UUID
	ObjectKey    string
	ManifestKey  string
	RowCount     int
	UpperCreated time.Time
}

type ArchiveManifest struct {
	SchemaVersion          string    `json:"schemaVersion"`
	ArchiveBatchID         string    `json:"archiveBatchId"`
	ObjectKey              string    `json:"objectKey"`
	ObjectVersionID        string    `json:"objectVersionId,omitempty"`
	ManifestKey            string    `json:"manifestKey"`
	RowCount               int       `json:"rowCount"`
	ByteCount              int64     `json:"byteCount"`
	SHA256                 string    `json:"sha256"`
	SourceQueryFingerprint string    `json:"sourceQueryFingerprint"`
	CreatedAt              time.Time `json:"createdAt"`
}

type Repository struct{ pool *pgxpool.Pool }

func (r Repository) acquireLock(ctx context.Context) (bool, error) {
	var locked bool
	if err := r.pool.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", workerLockName).Scan(&locked); err != nil {
		return false, fmt.Errorf("acquire archive lock: %w", err)
	}
	return locked, nil
}

func (r Repository) releaseLock(ctx context.Context) {
	_, _ = r.pool.Exec(ctx, "SELECT pg_advisory_unlock(hashtext($1))", workerLockName)
}

func (r Repository) requireNoInflightBatch(ctx context.Context) error {
	var count int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM cold_archive_batches WHERE status IN ('planned', 'uploading', 'verified')`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check inflight archive batches: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("%d cold archive batch(es) require recovery before a new batch may be planned", count)
	}
	return nil
}

func (r Repository) planBatch(ctx context.Context, ageDays, limit int) (*ArchiveBatch, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin archive batch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT id, "createdAt"
		FROM transactions
		WHERE "archivedTier" IS NULL
		  AND "coldArchiveBatchId" IS NULL
		  AND "createdAt" < NOW() - ($1::text || ' days')::interval
		  AND status::text = ANY(string_to_array($2, ','))
		ORDER BY id
		FOR UPDATE SKIP LOCKED
		LIMIT $3`, ageDays, archiveStatuses, limit)
	if err != nil {
		return nil, fmt.Errorf("select cold archive candidates: %w", err)
	}
	defer rows.Close()

	ids := make([]int32, 0, limit)
	var upperCreated time.Time
	for rows.Next() {
		var id int32
		var createdAt time.Time
		if err := rows.Scan(&id, &createdAt); err != nil {
			return nil, fmt.Errorf("scan cold archive candidate: %w", err)
		}
		ids = append(ids, id)
		if createdAt.After(upperCreated) {
			upperCreated = createdAt
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cold archive candidates: %w", err)
	}
	if len(ids) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit empty archive selection: %w", err)
		}
		return nil, nil
	}

	batchID := uuid.New()
	objectKey := fmt.Sprintf("cold/%s/%s.parquet", schemaVersion, batchID)
	manifestKey := fmt.Sprintf("cold/%s/manifests/%s.json", schemaVersion, batchID)
	fingerprintBytes := sha256.Sum256([]byte("transactions-cold-v1|" + archiveStatuses))
	fingerprint := hex.EncodeToString(fingerprintBytes[:])
	_, err = tx.Exec(ctx, `
		INSERT INTO cold_archive_batches (id, schema_version, status, upper_created_at, row_count, object_key, source_query_fingerprint)
		VALUES ($1, $2, 'planned', $3, $4, $5, $6)`, batchID, schemaVersion, upperCreated, len(ids), objectKey, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("insert cold archive batch: %w", err)
	}
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO cold_archive_batch_items (batch_id, transaction_id) VALUES ($1, $2)`, batchID, id); err != nil {
			return nil, fmt.Errorf("insert cold archive item %d: %w", id, err)
		}
	}
	command, err := tx.Exec(ctx, `UPDATE transactions SET "coldArchiveBatchId" = $1 WHERE id = ANY($2) AND "coldArchiveBatchId" IS NULL`, batchID, ids)
	if err != nil {
		return nil, fmt.Errorf("mark cold archive candidates: %w", err)
	}
	if command.RowsAffected() != int64(len(ids)) {
		return nil, fmt.Errorf("archive candidate ownership mismatch: updated %d of %d", command.RowsAffected(), len(ids))
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit cold archive batch: %w", err)
	}
	return &ArchiveBatch{ID: batchID, ObjectKey: objectKey, ManifestKey: manifestKey, RowCount: len(ids), UpperCreated: upperCreated}, nil
}

func (r Repository) markUploading(ctx context.Context, batchID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE cold_archive_batches SET status = 'uploading', uploaded_at = NOW() WHERE id = $1 AND status = 'planned'`, batchID)
	return err
}

func (r Repository) markFailed(ctx context.Context, batchID uuid.UUID, cause error) {
	_, _ = r.pool.Exec(ctx, `UPDATE cold_archive_batches SET status = 'failed', error_detail = $2 WHERE id = $1 AND status <> 'committed'`, batchID, cause.Error())
}

func (r Repository) commitVerified(ctx context.Context, batch ArchiveBatch, manifest ArchiveManifest) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin archive commit: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	command, err := tx.Exec(ctx, `
		UPDATE cold_archive_batches
		SET status = 'verified', sha256_hex = $2, byte_count = $3, object_version_id = $4, manifest_key = $5, verified_at = NOW()
		WHERE id = $1 AND status = 'uploading'`, batch.ID, manifest.SHA256, manifest.ByteCount, manifest.ObjectVersionID, manifest.ManifestKey)
	if err != nil {
		return fmt.Errorf("mark archive verified: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("archive batch state changed before verification commit")
	}
	command, err = tx.Exec(ctx, `
		UPDATE transactions
		SET "archivedTier" = 'cold', "archivedAt" = NOW()
		WHERE "coldArchiveBatchId" = $1 AND "archivedTier" IS NULL`, batch.ID)
	if err != nil {
		return fmt.Errorf("mark transactions cold archived: %w", err)
	}
	if command.RowsAffected() != int64(batch.RowCount) {
		return fmt.Errorf("cold archive commit ownership mismatch: updated %d of %d", command.RowsAffected(), batch.RowCount)
	}
	command, err = tx.Exec(ctx, `UPDATE cold_archive_batches SET status = 'committed', committed_at = NOW() WHERE id = $1 AND status = 'verified'`, batch.ID)
	if err != nil {
		return fmt.Errorf("commit archive batch: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("archive batch did not enter committed state")
	}
	return tx.Commit(ctx)
}

func writeParquet(ctx context.Context, repository Repository, batch ArchiveBatch, tempPath string) (int64, string, error) {
	fileWriter, err := local.NewLocalFileWriter(tempPath)
	if err != nil {
		return 0, "", fmt.Errorf("open parquet temp file: %w", err)
	}
	parquetWriter, err := writer.NewParquetWriter(fileWriter, new(TransactionArchiveV1), 1)
	if err != nil {
		_ = fileWriter.Close()
		return 0, "", fmt.Errorf("create parquet writer: %w", err)
	}
	parquetWriter.CompressionType = 1 // SNAPPY
	parquetWriter.RowGroupSize = 64 * 1024 * 1024
	parquetWriter.PageSize = 8 * 1024

	rows, err := repository.pool.Query(ctx, `
		SELECT t.id, t."tenantId", t."txRef", t.type::text, t.status::text, t.amount::numeric::text,
		       t.currency, t."originatorName", t."originatorAccount", t."beneficiaryName", t."beneficiaryAccount",
		       t."amlScore"::numeric::text, t."createdAt"
		FROM transactions t
		JOIN cold_archive_batch_items items ON items.transaction_id = t.id
		WHERE items.batch_id = $1
		ORDER BY t.id`, batch.ID)
	if err != nil {
		_ = parquetWriter.WriteStop()
		_ = fileWriter.Close()
		return 0, "", fmt.Errorf("read archive batch: %w", err)
	}
	count := 0
	archiveTimestamp := time.Now().UTC().UnixMicro()
	for rows.Next() {
		var record TransactionArchiveV1
		var createdAt time.Time
		if err := rows.Scan(&record.TransactionID, &record.TenantID, &record.TransactionRef, &record.TransactionType, &record.Status, &record.AmountDecimal,
			&record.Currency, &record.OriginatorName, &record.OriginatorAccount, &record.BeneficiaryName, &record.BeneficiaryAccount, &record.AMLScore, &createdAt); err != nil {
			rows.Close()
			_ = parquetWriter.WriteStop()
			_ = fileWriter.Close()
			return 0, "", fmt.Errorf("scan archive transaction: %w", err)
		}
		record.SchemaVersion = schemaVersion
		record.ArchiveBatchID = batch.ID.String()
		record.CreatedAtMicrosUTC = createdAt.UTC().UnixMicro()
		record.ArchivedAtMicrosUTC = archiveTimestamp
		if err := parquetWriter.Write(record); err != nil {
			rows.Close()
			_ = parquetWriter.WriteStop()
			_ = fileWriter.Close()
			return 0, "", fmt.Errorf("write parquet record: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		_ = parquetWriter.WriteStop()
		_ = fileWriter.Close()
		return 0, "", fmt.Errorf("iterate archive rows: %w", err)
	}
	rows.Close()
	if count != batch.RowCount {
		_ = parquetWriter.WriteStop()
		_ = fileWriter.Close()
		return 0, "", fmt.Errorf("parquet row count %d differs from planned count %d", count, batch.RowCount)
	}
	if err := parquetWriter.WriteStop(); err != nil {
		_ = fileWriter.Close()
		return 0, "", fmt.Errorf("finalize parquet file: %w", err)
	}
	if err := fileWriter.Close(); err != nil {
		return 0, "", fmt.Errorf("close parquet temp file: %w", err)
	}

	readerFile, err := local.NewLocalFileReader(tempPath)
	if err != nil {
		return 0, "", fmt.Errorf("open parquet verifier: %w", err)
	}
	parquetReader, err := reader.NewParquetReader(readerFile, new(TransactionArchiveV1), 1)
	if err != nil {
		_ = readerFile.Close()
		return 0, "", fmt.Errorf("open parquet verifier: %w", err)
	}
	verifiedCount := int(parquetReader.GetNumRows())
	if _, err := parquetReader.ReadByNumber(min(10, verifiedCount)); err != nil {
		parquetReader.ReadStop()
		_ = readerFile.Close()
		return 0, "", fmt.Errorf("read parquet sample: %w", err)
	}
	parquetReader.ReadStop()
	if err := readerFile.Close(); err != nil {
		return 0, "", fmt.Errorf("close parquet verifier: %w", err)
	}
	if verifiedCount != batch.RowCount {
		return 0, "", fmt.Errorf("parquet footer row count %d differs from planned count %d", verifiedCount, batch.RowCount)
	}

	file, err := os.Open(tempPath)
	if err != nil {
		return 0, "", fmt.Errorf("open parquet hash input: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	bytesWritten, err := io.Copy(hash, file)
	if err != nil {
		return 0, "", fmt.Errorf("hash parquet file: %w", err)
	}
	return bytesWritten, hex.EncodeToString(hash.Sum(nil)), nil
}

func uploadFile(ctx context.Context, client *minio.Client, config Config, key, path, checksum string) (string, error) {
	if _, err := client.StatObject(ctx, config.S3Bucket, key, minio.StatObjectOptions{}); err == nil {
		return "", fmt.Errorf("archive object already exists: %s", key)
	}
	result, err := client.FPutObject(ctx, config.S3Bucket, key, path, minio.PutObjectOptions{
		ContentType: "application/vnd.apache.parquet",
		UserMetadata: map[string]string{
			"schema-version": schemaVersion,
			"sha256":         checksum,
		},
	})
	if err != nil {
		return "", fmt.Errorf("upload parquet object: %w", err)
	}
	stat, err := client.StatObject(ctx, config.S3Bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("verify parquet object: %w", err)
	}
	localInfo, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("stat parquet temp file: %w", err)
	}
	if stat.Size != localInfo.Size() {
		return "", fmt.Errorf("archive object size %d differs from local size %d", stat.Size, localInfo.Size())
	}
	objectChecksum := stat.UserMetadata["X-Amz-Meta-Sha256"]
	if objectChecksum == "" {
		objectChecksum = stat.UserMetadata["sha256"]
	}
	if objectChecksum != checksum {
		return "", errors.New("archive object SHA-256 metadata mismatch")
	}
	return result.VersionID, nil
}

func uploadManifest(ctx context.Context, client *minio.Client, config Config, manifest ArchiveManifest) error {
	if _, err := client.StatObject(ctx, config.S3Bucket, manifest.ManifestKey, minio.StatObjectOptions{}); err == nil {
		return fmt.Errorf("archive manifest already exists: %s", manifest.ManifestKey)
	}
	body, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal archive manifest: %w", err)
	}
	_, err = client.PutObject(ctx, config.S3Bucket, manifest.ManifestKey, strings.NewReader(string(body)), int64(len(body)), minio.PutObjectOptions{ContentType: "application/json", UserMetadata: map[string]string{"schema-version": schemaVersion, "sha256": manifest.SHA256}})
	if err != nil {
		return fmt.Errorf("upload archive manifest: %w", err)
	}
	stat, err := client.StatObject(ctx, config.S3Bucket, manifest.ManifestKey, minio.StatObjectOptions{})
	if err != nil {
		return fmt.Errorf("verify archive manifest: %w", err)
	}
	if stat.Size != int64(len(body)) {
		return fmt.Errorf("archive manifest size %d differs from expected %d", stat.Size, len(body))
	}
	return nil
}

func run(ctx context.Context, config Config, logger *slog.Logger) error {
	pool, err := pgxpool.New(ctx, config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect PostgreSQL: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}
	repository := Repository{pool: pool}
	locked, err := repository.acquireLock(ctx)
	if err != nil {
		return err
	}
	if !locked {
		logger.Info("cold archive skipped; another worker holds the lock")
		return nil
	}
	defer repository.releaseLock(context.Background())
	storage, err := minio.New(config.S3Endpoint, &minio.Options{Creds: credentials.NewStaticV4(config.S3AccessKey, config.S3SecretKey, ""), Secure: true, Region: config.S3Region})
	if err != nil {
		return fmt.Errorf("create object store client: %w", err)
	}
	exists, err := storage.BucketExists(ctx, config.S3Bucket)
	if err != nil {
		return fmt.Errorf("check archive bucket: %w", err)
	}
	if !exists {
		return fmt.Errorf("archive bucket %q does not exist; buckets and retention policy must be pre-provisioned", config.S3Bucket)
	}
	if err := repository.recoverInFlightBatches(ctx, storage, config.S3Bucket, logger); err != nil {
		return err
	}
	if err := repository.requireNoInflightBatch(ctx); err != nil {
		return err
	}

	batch, err := repository.planBatch(ctx, config.ColdAgeDays, config.BatchSize)
	if err != nil {
		return err
	}
	if batch == nil {
		logger.Info("cold archive completed; no eligible transactions")
		return nil
	}
	logger.Info("planned cold archive batch", "batch_id", batch.ID, "rows", batch.RowCount, "object_key", batch.ObjectKey)
	if err := repository.markUploading(ctx, batch.ID); err != nil {
		return fmt.Errorf("mark batch uploading: %w", err)
	}

	tempPath := filepath.Join(config.TempDir, "bis-cold-archive-"+batch.ID.String()+".parquet")
	defer os.Remove(tempPath)
	byteCount, checksum, err := writeParquet(ctx, repository, *batch, tempPath)
	if err != nil {
		repository.markFailed(ctx, batch.ID, err)
		return err
	}
	versionID, err := uploadFile(ctx, storage, config, batch.ObjectKey, tempPath, checksum)
	if err != nil {
		repository.markFailed(ctx, batch.ID, err)
		return err
	}
	fingerprintBytes := sha256.Sum256([]byte("transactions-cold-v1|" + archiveStatuses))
	manifest := ArchiveManifest{SchemaVersion: schemaVersion, ArchiveBatchID: batch.ID.String(), ObjectKey: batch.ObjectKey, ObjectVersionID: versionID, ManifestKey: batch.ManifestKey, RowCount: batch.RowCount, ByteCount: byteCount, SHA256: checksum, SourceQueryFingerprint: hex.EncodeToString(fingerprintBytes[:]), CreatedAt: time.Now().UTC()}
	if err := uploadManifest(ctx, storage, config, manifest); err != nil {
		repository.markFailed(ctx, batch.ID, err)
		return err
	}
	if err := repository.commitVerified(ctx, *batch, manifest); err != nil {
		repository.markFailed(ctx, batch.ID, err)
		return err
	}
	logger.Info("cold archive committed", "batch_id", batch.ID, "rows", batch.RowCount, "bytes", byteCount, "object_key", batch.ObjectKey, "sha256", checksum)
	return nil
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	config, err := loadConfig()
	if err != nil {
		logger.Error("cold archive configuration invalid", "error", err)
		os.Exit(1)
	}
	metrics := newArchiveMetrics()
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	err = run(ctx, config, logger)
	metrics.observeRun(startedAt, err)
	if pushErr := metrics.push(config.PushgatewayURL, "bis-cold-archive-writer"); pushErr != nil {
		logger.Error("cold archive metrics export failed", "error", pushErr)
		if err == nil && strings.EqualFold(os.Getenv("BIS_ENV"), "production") {
			err = pushErr
		}
	}
	if err != nil {
		logger.Error("cold archive failed", "error", err)
		os.Exit(1)
	}
}
