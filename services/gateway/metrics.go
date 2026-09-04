package main

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type gatewayMetrics struct {
	registry *prometheus.Registry

	permifyChecks        *prometheus.CounterVec
	dependencies         *prometheus.GaugeVec
	outboxEvents         *prometheus.CounterVec
	outboxBacklog        prometheus.Gauge
	outboxKeyRotationDue prometheus.Gauge
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
		outboxEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_events_total",
			Help: "Transactional outbox events by state transition.",
		}, []string{"state"}),
		outboxBacklog: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_pending_events",
			Help: "Number of gateway events awaiting Kafka delivery from PostgreSQL.",
		}),
		outboxKeyRotationDue: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "bis", Subsystem: "gateway", Name: "transactional_outbox_key_rotation_due",
			Help: "Whether the active transactional-outbox encryption key is inside its mandatory rotation lead time (1 due, 0 current).",
		}),
	}
	metrics.registry.MustRegister(metrics.permifyChecks, metrics.dependencies, metrics.outboxEvents, metrics.outboxBacklog, metrics.outboxKeyRotationDue)
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
}
