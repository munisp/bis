package main

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/push"
)

type archiveMetrics struct {
	registry    *prometheus.Registry
	runs        *prometheus.CounterVec
	duration    prometheus.Histogram
	records     prometheus.Counter
	lastSuccess prometheus.Gauge
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
	}
	metrics.registry.MustRegister(metrics.runs, metrics.duration, metrics.records, metrics.lastSuccess)
	return metrics
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
