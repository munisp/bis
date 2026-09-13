package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/push"
)

var archiveBatchStates = []string{"planned", "uploading", "verified", "committed", "failed", "quarantined"}

type archiveMetrics struct {
	registry          *prometheus.Registry
	runs              *prometheus.CounterVec
	duration          prometheus.Histogram
	records           prometheus.Counter
	lastSuccess       prometheus.Gauge
	dependencies      *prometheus.GaugeVec
	batches           *prometheus.GaugeVec
	kmsUploads        *prometheus.CounterVec
	kmsKeyRotationDue prometheus.Gauge
	kmsKeyExpiry      prometheus.Gauge
}

func newArchiveMetrics() *archiveMetrics {
	metrics := &archiveMetrics{
		registry: prometheus.NewRegistry(),
		runs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "runs_total",
			Help: "Cold archive runs by terminal outcome.",
		}, []string{"outcome"}),
		duration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "run_duration_seconds",
			Help:    "End-to-end cold archive run duration.",
			Buckets: prometheus.DefBuckets,
		}),
		records: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "records_archived_total",
			Help: "Transactions durably committed to verified Parquet cold archives.",
		}),
		lastSuccess: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "last_success_timestamp_seconds",
			Help: "Unix timestamp of the most recent successful cold archive run.",
		}),
		dependencies: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "dependency_healthy",
			Help: "Whether an archive-worker dependency was reached during the current run (1 healthy, 0 unavailable).",
		}, []string{"dependency"}),
		batches: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "batches",
			Help: "Cold archive batches by authoritative PostgreSQL lifecycle state.",
		}, []string{"state"}),
		kmsUploads: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "kms_uploads_total",
			Help: "Archive data and encrypted-manifest object uploads by outcome.",
		}, []string{"outcome"}),
		kmsKeyRotationDue: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "kms_key_rotation_due",
			Help: "Whether the active archive KMS key is within the mandatory rotation lead time (1 due, 0 current).",
		}),
		kmsKeyExpiry: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "cold_archive", Name: "active_kms_key_expiry_seconds",
			Help: "Seconds until active archive KMS key expiry; zero indicates no usable expiry registration.",
		}),
	}
	metrics.registry.MustRegister(
		metrics.runs,
		metrics.duration,
		metrics.records,
		metrics.lastSuccess,
		metrics.dependencies,
		metrics.batches,
		metrics.kmsUploads,
		metrics.kmsKeyRotationDue,
		metrics.kmsKeyExpiry,
	)
	return metrics
}

func (m *archiveMetrics) setDependencyHealth(dependency string, healthy bool) {
	if healthy {
		m.dependencies.WithLabelValues(dependency).Set(1)
		return
	}
	m.dependencies.WithLabelValues(dependency).Set(0)
}

func (m *archiveMetrics) setKeyPolicy(policy *archiveKeyPolicy) {
	if policy == nil || policy.rotationDue() {
		m.kmsKeyRotationDue.Set(1)
	} else {
		m.kmsKeyRotationDue.Set(0)
	}
	if policy == nil {
		m.kmsKeyExpiry.Set(0)
		return
	}
	expiresAt, found := policy.expiries[policy.activeKeyID]
	if !found {
		m.kmsKeyExpiry.Set(0)
		return
	}
	remaining := expiresAt.Sub(policy.currentTime()).Seconds()
	if remaining < 0 {
		remaining = 0
	}
	m.kmsKeyExpiry.Set(remaining)
}

func (m *archiveMetrics) refreshBatchState(ctx context.Context, pool *pgxpool.Pool) {
	if pool == nil {
		m.setDependencyHealth("postgres", false)
		return
	}
	for _, state := range archiveBatchStates {
		m.batches.WithLabelValues(state).Set(0)
	}
	rows, err := pool.Query(ctx, `SELECT status, COUNT(*) FROM cold_archive_batches GROUP BY status`)
	if err != nil {
		m.setDependencyHealth("postgres", false)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var count float64
		if err := rows.Scan(&state, &count); err != nil {
			m.setDependencyHealth("postgres", false)
			return
		}
		m.batches.WithLabelValues(state).Set(count)
	}
	if rows.Err() != nil {
		m.setDependencyHealth("postgres", false)
		return
	}
	m.setDependencyHealth("postgres", true)
}

func (m *archiveMetrics) observeRun(start time.Time, err error) {
	m.duration.Observe(time.Since(start).Seconds())
	if err != nil {
		m.runs.WithLabelValues("failed").Inc()
		return
	}
	m.runs.WithLabelValues("succeeded").Inc()
	m.lastSuccess.SetToCurrentTime()
}

func (m *archiveMetrics) push(pushgatewayURL, job string) error {
	if strings.TrimSpace(pushgatewayURL) == "" {
		return nil
	}
	parsed, err := url.Parse(pushgatewayURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return fmt.Errorf("BIS_ARCHIVE_PUSHGATEWAY_URL must be a valid HTTPS URL")
	}
	return push.New(pushgatewayURL, job).Gatherer(m.registry).Push()
}
