#!/usr/bin/env node
/**
 * Release-gate verifier for OBS-001. It performs read-only HTTPS requests and
 * writes only sanitized pass/fail evidence. Missing values fail before any
 * network I/O; the script never logs bearer or gateway credentials.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const expectedGatewayMetrics = [
  'bis_gateway_control_plane_dependency_healthy',
  'bis_gateway_control_plane_dependency_fail_closed_total',
  'bis_gateway_permify_checks_total',
  'bis_gateway_transactional_outbox_events_total',
  'bis_gateway_transactional_outbox_events',
  'bis_gateway_transactional_outbox_pending_events',
  'bis_gateway_transactional_outbox_oldest_pending_age_seconds',
  'bis_gateway_transactional_outbox_oldest_dispatching_age_seconds',
  'bis_gateway_transactional_outbox_dispatch_cycle_duration_seconds',
  'bis_gateway_transactional_outbox_key_rotation_due',
  'bis_gateway_transactional_outbox_active_key_expiry_seconds',
];

const expectedAlertNames = [
  'BISGatewayMetricsScrapeFailed',
  'BISArchivePushgatewayScrapeFailed',
  'BISGatewayDependencyUnavailable',
  'BISOutboxOldestPendingTooOld',
  'BISOutboxDispatchLeaseStuck',
  'BISOutboxDeliveryStalled',
  'BISColdArchiveQuarantinedBatch',
  'BISColdArchiveKMSUploadFailure',
  'BISColdArchiveKMSRotationDue',
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseHttps(name, value, environment) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  const host = url.hostname.toLowerCase();
  if (environment === 'staging' && (host.includes('production') || host.startsWith('prod.') || host.endsWith('.prod'))) {
    throw new Error(`${name} appears to reference production while BIS_ENV is staging`);
  }
  return url;
}

function endpoint(base, pathname) {
  return new URL(pathname, `${base.origin}/`).toString();
}

async function responseJson(response, operation) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${operation} returned malformed JSON with HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  return body;
}

async function query(prometheusUrl, expression) {
  const response = await fetch(endpoint(prometheusUrl, `/api/v1/query?query=${encodeURIComponent(expression)}`), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await responseJson(response, 'Prometheus instant query');
  if (body.status !== 'success') throw new Error('Prometheus instant query did not return success');
  return body.data?.result ?? [];
}

function nonZeroVector(result) {
  return Array.isArray(result) && result.some((entry) => Number(entry?.value?.[1]) > 0);
}

async function writeEvidence(path, evidence) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  let environment;
  let prometheusUrl;
  let gatewayMetricsUrl;
  let alertmanagerUrl;
  let gatewayKey;
  try {
    environment = required('BIS_ENV');
    if (environment !== 'staging' && environment !== 'production') throw new Error('BIS_ENV must be staging or production');
    prometheusUrl = parseHttps('OBS_PROMETHEUS_URL', required('OBS_PROMETHEUS_URL'), environment);
    gatewayMetricsUrl = parseHttps('OBS_GATEWAY_METRICS_URL', required('OBS_GATEWAY_METRICS_URL'), environment);
    alertmanagerUrl = parseHttps('OBS_ALERTMANAGER_URL', required('OBS_ALERTMANAGER_URL'), environment);
    gatewayKey = required('OBS_GATEWAY_KEY');
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : 'invalid OBS-001 configuration'}\n`);
    process.exitCode = 2;
    return;
  }

  const evidencePath = resolve(process.env.OBS001_EVIDENCE_PATH ?? 'artifacts/obs001-promotion/verification.json');
  const evidence = {
    completedAt: null,
    environment,
    protectedGatewayMetrics: false,
    gatewayMetricsPresent: [],
    prometheusScrapesHealthy: false,
    alertRulesPresent: [],
    alertmanagerHealthy: false,
    criticalAlerts: [],
  };

  try {
    const gatewayResponse = await fetch(gatewayMetricsUrl, {
      headers: { 'X-BIS-Key': gatewayKey, accept: 'application/openmetrics-text; version=1.0.0; charset=utf-8' },
      signal: AbortSignal.timeout(15_000),
    });
    const gatewayMetrics = await gatewayResponse.text();
    if (!gatewayResponse.ok) throw new Error(`protected gateway metrics returned HTTP ${gatewayResponse.status}`);
    const missingGatewayMetrics = expectedGatewayMetrics.filter((metric) => !gatewayMetrics.includes(metric));
    if (missingGatewayMetrics.length > 0) throw new Error(`protected gateway metrics are missing: ${missingGatewayMetrics.join(', ')}`);
    evidence.protectedGatewayMetrics = true;
    evidence.gatewayMetricsPresent = expectedGatewayMetrics;

    const gatewayScrape = await query(prometheusUrl, 'up{job="go-gateway-control-plane"}');
    const archiveScrape = await query(prometheusUrl, 'up{job="cold-archive-pushgateway"}');
    if (!nonZeroVector(gatewayScrape) || !nonZeroVector(archiveScrape)) {
      throw new Error('Prometheus does not report both protected gateway and archive Pushgateway scrapes as healthy');
    }
    evidence.prometheusScrapesHealthy = true;

    const rulesResponse = await fetch(endpoint(prometheusUrl, '/api/v1/rules?type=alert'), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const rules = await responseJson(rulesResponse, 'Prometheus rules query');
    const loadedAlertNames = new Set(
      (rules.data?.groups ?? []).flatMap((group) => (group.rules ?? []).map((rule) => rule.name)).filter(Boolean),
    );
    const missingAlerts = expectedAlertNames.filter((name) => !loadedAlertNames.has(name));
    if (missingAlerts.length > 0) throw new Error(`Prometheus did not load required OBS-001 alerts: ${missingAlerts.join(', ')}`);
    evidence.alertRulesPresent = expectedAlertNames;

    const alertsResponse = await fetch(endpoint(prometheusUrl, '/api/v1/alerts'), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const alerts = await responseJson(alertsResponse, 'Prometheus alerts query');
    const criticalAlerts = (alerts.data?.alerts ?? [])
      .filter((alert) => alert.state === 'firing' && alert.labels?.severity === 'critical')
      .map((alert) => String(alert.labels?.alertname ?? 'unnamed-critical-alert'));
    evidence.criticalAlerts = criticalAlerts;
    if (criticalAlerts.length > 0) throw new Error(`critical OBS-001 alerts are firing: ${criticalAlerts.join(', ')}`);

    const alertmanagerResponse = await fetch(endpoint(alertmanagerUrl, '/api/v2/status'), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    await responseJson(alertmanagerResponse, 'Alertmanager status query');
    evidence.alertmanagerHealthy = true;
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidencePath, evidence);
    process.stdout.write(`PASS OBS-001 promotion verification; evidence=${evidencePath}\n`);
  } catch (error) {
    evidence.completedAt = new Date().toISOString();
    evidence.failure = error instanceof Error ? error.message : 'unknown OBS-001 verification failure';
    await writeEvidence(evidencePath, evidence).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL OBS-001 promotion verification: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
