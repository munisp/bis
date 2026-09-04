package main

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var outboxMetricStates = []string{"pending", "dispatching", "delivered", "dead_letter"}

type gatewayMetrics struct {
	registry *prometheus.Registry

	permifyChecks                  *prometheus.CounterVec
	dependencies                   *prometheus.GaugeVec
	dependencyFailures             *prometheus.CounterVec
	outboxEvents                   *prometheus.CounterVec
	outboxState                    *prometheus.GaugeVec
	outboxBacklog                  prometheus.Gauge
	outboxOldestPendingAgeSeconds  prometheus.Gauge
	outboxOldestDispatchAgeSeconds prometheus.Gauge
	outboxDispatchDuration         prometheus.Histogram
	outboxKeyRotationDue           prometheus.Gauge
	outboxKeyExpirySeconds         prometheus.Gauge
}

func newGatewayMetrics() *gatewayMetrics {
	metrics := &gatewayMetrics{
		registry: prometheus.NewRegistry(),
		permifyChecks: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "permify_checks_total",
			Help: "Fine-grained authorization decisions by outcome.",
		}, []string{"outcome"}),
		dependencies: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "control_plane_dependency_healthy",
			Help: "Whether a required gateway control-plane dependency is configured and healthy (1 healthy, 0 unhealthy).",
		}, []string{"dependency"}),
		dependencyFailures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "control_plane_dependency_fail_closed_total",
			Help: "Dependency-unavailable decisions that leave the gateway in a fail-closed state.",
		}, []string{"dependency"}),
		outboxEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_events_total",
			Help: "Transactional outbox events by state transition.",
		}, []string{"state"}),
		outboxState: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_events",
			Help: "Current transactional outbox records by authoritative PostgreSQL state.",
		}, []string{"state"}),
		outboxBacklog: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_pending_events",
			Help: "Number of gateway events awaiting Kafka delivery from PostgreSQL.",
		}),
		outboxOldestPendingAgeSeconds: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_oldest_pending_age_seconds",
			Help: "Age of the oldest pending transactional outbox event, zero when none are pending.",
		}),
		outboxOldestDispatchAgeSeconds: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_oldest_dispatching_age_seconds",
			Help: "Age of the oldest leased transactional outbox event, zero when none are dispatching.",
		}),
		outboxDispatchDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_dispatch_cycle_duration_seconds",
			Help:    "Duration of one encrypted transactional outbox dispatch cycle.",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60},
		}),
		outboxKeyRotationDue: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_key_rotation_due",
			Help: "Whether the active transactional-outbox encryption key is inside its mandatory rotation lead time (1 due, 0 current).",
		}),
		outboxKeyExpirySeconds: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_active_key_expiry_seconds",
			Help: "Seconds until the active transactional-outbox key expires; zero indicates no expiry is available.",
		}),
	}
	metrics.registry.MustRegister(
		metrics.permifyChecks,
		metrics.dependencies,
		metrics.dependencyFailures,
		metrics.outboxEvents,
		metrics.outboxState,
		metrics.outboxBacklog,
		metrics.outboxOldestPendingAgeSeconds,
		metrics.outboxOldestDispatchAgeSeconds,
		metrics.outboxDispatchDuration,
		metrics.outboxKeyRotationDue,
		metrics.outboxKeyExpirySeconds,
	)
	return metrics
}

var controlPlaneMetrics = newGatewayMetrics()

func (m *gatewayMetrics) handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{EnableOpenMetrics: true})
}

func (m *gatewayMetrics) setDependencyHealth(dependency string, healthy bool) {
	if healthy {
		m.dependencies.WithLabelValues(dependency).Set(1)
		return
	}
	m.dependencies.WithLabelValues(dependency).Set(0)
	m.dependencyFailures.WithLabelValues(dependency).Inc()
}

func (m *gatewayMetrics) setOutboxKeyPolicy(keyring *outboxKeyring) {
	if keyring == nil {
		m.outboxKeyRotationDue.Set(1)
		m.outboxKeyExpirySeconds.Set(0)
		return
	}
	if keyring.needsRotation(keyring.activeVersion) {
		m.outboxKeyRotationDue.Set(1)
	} else {
		m.outboxKeyRotationDue.Set(0)
	}
	material, found := keyring.keys[keyring.activeVersion]
	if !found || material.notAfter == nil {
		m.outboxKeyExpirySeconds.Set(0)
		return
	}
	remaining := material.notAfter.Sub(keyring.currentTime()).Seconds()
	if remaining < 0 {
		remaining = 0
	}
	m.outboxKeyExpirySeconds.Set(remaining)
}

// refreshOutboxState derives every operational backlog gauge from PostgreSQL
// after each dispatch cycle. Failures are surfaced as an unhealthy required
// dependency rather than silently retaining a stale optimistic value.
func (m *gatewayMetrics) refreshOutboxState(ctx context.Context, db *sql.DB) {
	if db == nil {
		m.setDependencyHealth("postgres_outbox", false)
		return
	}
	for _, state := range outboxMetricStates {
		m.outboxState.WithLabelValues(state).Set(0)
	}
	rows, err := db.QueryContext(ctx, `SELECT state, COUNT(*) FROM gateway_transactional_outbox GROUP BY state`)
	if err != nil {
		m.setDependencyHealth("postgres_outbox", false)
		return
	}
	defer rows.Close()
	pending := 0.0
	for rows.Next() {
		var state string
		var count float64
		if err := rows.Scan(&state, &count); err != nil {
			m.setDependencyHealth("postgres_outbox", false)
			return
		}
		m.outboxState.WithLabelValues(state).Set(count)
		if state == "pending" {
			pending = count
		}
	}
	if err := rows.Err(); err != nil {
		m.setDependencyHealth("postgres_outbox", false)
		return
	}
	m.setDependencyHealth("postgres_outbox", true)
	m.outboxBacklog.Set(pending)

	for _, state := range []struct {
		name   string
		metric prometheus.Gauge
	}{
		{name: "pending", metric: m.outboxOldestPendingAgeSeconds},
		{name: "dispatching", metric: m.outboxOldestDispatchAgeSeconds},
	} {
		var age sql.NullFloat64
		err := db.QueryRowContext(ctx, `
			SELECT EXTRACT(EPOCH FROM NOW() - MIN(created_at))
			FROM gateway_transactional_outbox WHERE state = $1`, state.name).Scan(&age)
		if err != nil {
			m.setDependencyHealth("postgres_outbox", false)
			return
		}
		if !age.Valid || age.Float64 < 0 {
			state.metric.Set(0)
		} else {
			state.metric.Set(age.Float64)
		}
	}
}

func (m *gatewayMetrics) observeOutboxDispatch(start time.Time) {
	m.outboxDispatchDuration.Observe(time.Since(start).Seconds())
}
