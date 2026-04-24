# open-appsec + APISIX WAF Integration

This directory contains the configuration for integrating **open-appsec** (ML-based WAF) with **Apache APISIX** as the BIS platform's production-grade Web Application Firewall.

## Architecture

```
Internet → open-appsec WAF (port 80/443) → APISIX Gateway (9080) → BIS Services
```

open-appsec operates as an **nginx-based reverse proxy** in front of APISIX. It provides:
- **ML-based threat detection** — trained on OWASP Top 10 attack patterns
- **Zero-day protection** — behavioral analysis without signature updates
- **OWASP CRS coverage** — SQLi, XSS, RCE, LFI, path traversal, CSRF
- **API schema enforcement** — validates requests against OpenAPI spec
- **Rate limiting** — per-IP and per-user request throttling
- **Bot mitigation** — detects and blocks automated scanners

## Files

| File | Purpose |
|------|---------|
| `docker-compose.override.yml` | Adds open-appsec service to the BIS stack |
| `open-appsec.yaml` | Main open-appsec policy configuration |
| `nginx.conf` | nginx reverse proxy config for open-appsec |
| `local_policy.yaml` | Local enforcement policy (prevent/detect mode) |
| `assets/openapi.yaml` | OpenAPI schema for API schema enforcement |

## Deployment

```bash
# Start the full stack with open-appsec WAF
docker compose -f docker-compose.yml -f infra/open-appsec/docker-compose.override.yml up -d

# Check WAF status
docker logs bis-open-appsec --tail 50

# View WAF metrics
curl http://localhost:8080/open-appsec-metrics
```

## Policy Modes

| Mode | Behavior |
|------|---------|
| `prevent` | Block malicious requests (production default) |
| `detect` | Log only, do not block (staging/debug) |
| `inactive` | Disabled |

## Tuning

Edit `open-appsec.yaml` to:
- Add trusted IP ranges to `trusted_sources`
- Adjust `minimum_confidence` threshold (default: `high`)
- Add custom exceptions for known-safe patterns
- Configure `max_object_depth` for nested JSON payloads
