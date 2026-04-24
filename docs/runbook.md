# BIS Platform — Production Runbook

This runbook covers day-to-day operations, incident response, and maintenance procedures for the BIS platform in production.

---

## Quick Reference

| Action | Command |
|---|---|
| Start all services | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` |
| Stop all services | `docker compose -f docker-compose.yml -f docker-compose.prod.yml down` |
| View logs (all) | `docker compose logs -f --tail=100` |
| View logs (service) | `docker compose logs -f gateway` |
| Restart a service | `docker compose restart gateway` |
| Rolling deploy | See [Deployment](#deployment) |
| Rollback | See [Rollback](#rollback) |
| Database backup | See [Database](#database-operations) |

---

## Initial Setup

### 1. Clone and configure

```bash
git clone https://github.com/bis-platform/bis.git /opt/bis
cd /opt/bis

# Create production environment file
cp docs/environment-variables.md /tmp/env-reference.md
# Fill in all required secrets (see environment-variables.md)
# Use your secrets manager (Vault, AWS Secrets Manager, etc.)
```

### 2. TLS certificates

```bash
mkdir -p infra/nginx/ssl
# Option A: Let's Encrypt
certbot certonly --standalone -d bis.example.com
cp /etc/letsencrypt/live/bis.example.com/fullchain.pem infra/nginx/ssl/bis.crt
cp /etc/letsencrypt/live/bis.example.com/privkey.pem infra/nginx/ssl/bis.key

# Option B: Self-signed (dev/staging only)
openssl req -x509 -newkey rsa:4096 -keyout infra/nginx/ssl/bis.key \
  -out infra/nginx/ssl/bis.crt -days 365 -nodes \
  -subj "/CN=bis.example.com"
```

### 3. First-time database setup

```bash
# Start infrastructure only
docker compose up -d postgres redis kafka zookeeper keycloak temporal permify

# Wait for PostgreSQL to be ready
docker compose exec postgres pg_isready -U bis -d bis

# Run BFF migrations
docker compose run --rm bff pnpm db:push
```

### 4. Start all services

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose ps  # verify all services are healthy
```

---

## Deployment

### Automated (GitHub Actions)

Push to `main` → Docker Build workflow → Deploy workflow (staging smoke test → production rolling deploy).

### Manual rolling deploy

```bash
cd /opt/bis
export IMAGE_TAG=<sha-or-tag>
export GITHUB_REPOSITORY=bis-platform/bis

# Pull new images
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull \
  gateway bff risk-engine event-processor aml-engine

# Rolling update (gateway first — 2 replicas)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
  --no-deps --scale gateway=2 gateway
sleep 15

# Update BFF
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps bff
sleep 10

# Update remaining services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
  --no-deps risk-engine event-processor aml-engine case-manager \
  lex-intake lex-validator ml-enrichment biometric-engine \
  lakehouse-writer ollama-adapter payment-rails

# Cleanup old images
docker image prune -f --filter "until=24h"
```

---

## Rollback

### Automated rollback (GitHub Actions)

Trigger the **Deploy to Production** workflow manually with `environment=production` — the rollback job will detect the previous image tag and redeploy it.

### Manual rollback

```bash
cd /opt/bis

# Find previous image tag
PREV_TAG=$(docker image ls ghcr.io/bis-platform/bis-gateway \
  --format "{{.Tag}}" | grep -v latest | sort -r | sed -n '2p')
echo "Rolling back to: $PREV_TAG"

export IMAGE_TAG=$PREV_TAG
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
  --no-deps gateway bff risk-engine
```

---

## Health Checks

### Service health endpoints

| Service | Endpoint | Expected response |
|---|---|---|
| Gateway | `GET http://gateway:8081/health` | `{"status":"ok","sandbox":false}` |
| Risk Engine | `GET http://risk-engine:8082/health` | `{"status":"ok"}` |
| BFF | `GET /api/trpc/lookup.gatewayHealth` | tRPC batch response |
| Temporal | `GET http://temporal:7233/health` | gRPC health check |

### Check all services

```bash
# Via BFF tRPC (requires auth session)
curl -s "https://bis.example.com/api/trpc/lookup.allServicesHealth?batch=1&input={}" \
  -H "Cookie: bis_session=<token>" | jq .

# Direct container health
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"
```

---

## Database Operations

### Backup

```bash
# Full backup
docker compose exec postgres pg_dump -U bis bis | \
  gzip > /backups/bis-$(date +%Y%m%d-%H%M%S).sql.gz

# Automated daily backup (add to crontab)
0 2 * * * docker compose -f /opt/bis/docker-compose.yml exec -T postgres \
  pg_dump -U bis bis | gzip > /backups/bis-$(date +\%Y\%m\%d).sql.gz
```

### Restore

```bash
gunzip -c /backups/bis-20260414-020000.sql.gz | \
  docker compose exec -T postgres psql -U bis bis
```

### Schema migrations

```bash
# Run from BFF container
docker compose run --rm bff pnpm db:push
```

---

## Incident Response

### Service is down

```bash
# 1. Check logs
docker compose logs --tail=200 <service-name>

# 2. Check container status
docker compose ps <service-name>

# 3. Restart service
docker compose restart <service-name>

# 4. If restart fails, check resource usage
docker stats --no-stream

# 5. Force recreate
docker compose up -d --force-recreate <service-name>
```

### Gateway verification failures

```bash
# Check verification engine status via BFF
curl -s "https://bis.example.com/api/trpc/lookup.allServicesHealth?batch=1&input={}" \
  -H "Cookie: bis_session=<token>" | jq '.[] | .result.data.verificationEngine'

# Check gateway logs for NIMC/NIBSS/CAC errors
docker compose logs --tail=100 gateway | grep -E "ERROR|WARN|verify"

# Temporarily enable sandbox mode (emergency fallback)
docker compose exec gateway sh -c 'kill -USR1 1'  # triggers config reload
# Or restart with GATEWAY_SANDBOX=true
GATEWAY_SANDBOX=true docker compose up -d --no-deps gateway
```

### Kafka consumer lag

```bash
# Check consumer group lag
docker compose exec kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group bis-event-processor

# Reset consumer offset (use with caution)
docker compose exec kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group bis-event-processor \
  --reset-offsets --to-latest --execute --topic bis-events
```

### High memory usage

```bash
# Check memory per container
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Restart high-memory services
docker compose restart ml-enrichment biometric-engine

# Check for memory leaks in logs
docker compose logs --tail=500 ml-enrichment | grep -i "memory\|oom\|killed"
```

---

## Keycloak Administration

### Access admin console

```
URL: https://bis.example.com/auth/admin
Username: admin
Password: $KEYCLOAK_ADMIN_PASSWORD
```

### Create a new realm user

```bash
# Via Keycloak Admin REST API
TOKEN=$(curl -s -X POST \
  "https://bis.example.com/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=admin&password=$KEYCLOAK_ADMIN_PASSWORD" \
  | jq -r .access_token)

curl -s -X POST \
  "https://bis.example.com/auth/admin/realms/bis/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"analyst1","email":"analyst1@example.com","enabled":true}'
```

### Promote user to admin role

Use the BIS Infrastructure → Keycloak page in the web UI, or update the `role` field directly in the `users` table:

```sql
UPDATE users SET role = 'admin' WHERE email = 'analyst1@example.com';
```

---

## Temporal Administration

### Access Temporal UI

```
URL: https://bis.example.com/temporal (via nginx proxy)
     or http://localhost:8088 (direct)
```

### List running workflows

```bash
docker compose exec temporal tctl workflow list --status open
```

### Cancel a stuck workflow

```bash
docker compose exec temporal tctl workflow cancel \
  --workflow_id investigation-REF-20260414-001
```

### Query workflow state

```bash
docker compose exec temporal tctl workflow show \
  --workflow_id investigation-REF-20260414-001
```

---

## Redis Operations

### Flush a namespace

```bash
# Via BFF tRPC (preferred — uses redis.flushNamespace)
curl -X POST "https://bis.example.com/api/trpc/redis.flushNamespace" \
  -H "Cookie: bis_session=<admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"namespace":"rate_limit"}'

# Direct Redis CLI
docker compose exec redis redis-cli SCAN 0 MATCH "rate_limit:*" COUNT 1000
```

### Check Redis memory

```bash
docker compose exec redis redis-cli INFO memory | grep used_memory_human
```

---

## Log Aggregation

All services write structured JSON logs to stdout. In production, configure a log shipper:

```yaml
# docker-compose.prod.yml already sets json-file driver with rotation:
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

For centralised logging, add a Loki or Elasticsearch container and update the logging driver to `loki` or `fluentd`.

---

## Certificate Renewal

```bash
# Let's Encrypt auto-renewal (add to crontab)
0 3 1 * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/bis.example.com/fullchain.pem /opt/bis/infra/nginx/ssl/bis.crt && \
  cp /etc/letsencrypt/live/bis.example.com/privkey.pem /opt/bis/infra/nginx/ssl/bis.key && \
  docker compose -f /opt/bis/docker-compose.yml restart nginx
```

---

## Monitoring & Alerting

### Grafana dashboards

```
URL: https://bis.example.com/grafana (via nginx proxy)
     or http://localhost:3000 (direct)
Username: admin
Password: $GRAFANA_ADMIN_PASSWORD
```

Pre-built dashboards:
- **BIS Overview** — request rates, error rates, latency by service
- **Verification Engine** — NIN/BVN/CAC success rates, fallback usage
- **Kafka** — consumer lag, message throughput
- **PostgreSQL** — query latency, connection pool, slow queries

### Prometheus alerts

Alert rules are defined in `infra/prometheus/alert-rules.yml`. Key alerts:

| Alert | Condition | Severity |
|---|---|---|
| `GatewayDown` | gateway health check fails for 2m | critical |
| `BFFDown` | BFF health check fails for 2m | critical |
| `KafkaConsumerLag` | consumer lag > 10,000 for 5m | warning |
| `PostgreSQLSlowQuery` | p99 query latency > 1s | warning |
| `VerificationFallbackHigh` | Youverify fallback rate > 50% for 10m | warning |
| `DiskSpaceLow` | disk usage > 85% | warning |

---

## v65 Operations: open-appsec WAF

### Start with WAF enabled

```bash
docker compose --profile waf up -d
```

### WAF Smoke Test

```bash
./scripts/waf-smoke-test.sh http://localhost:80
```

### Switch WAF to detect-only mode (emergency)

```bash
# Edit .env
OPEN_APPSEC_MODE=detect

# Restart open-appsec
docker compose restart open-appsec
```

### View WAF blocked requests

```bash
docker compose logs open-appsec | grep "BLOCK\|DETECT"
```

### Add WAF exception (false positive)

Edit `infra/open-appsec/local_policy.yaml`:
```yaml
exceptions:
  - match:
      url: /api/trpc/your.procedure
      method: POST
    action: allow
```
Then restart: `docker compose restart open-appsec`

---

## v65 Operations: lex-matcher Service

```bash
# Start lex-matcher
docker compose up -d lex-matcher

# Health check
curl http://localhost:8090/health

# Test matching
curl -X POST http://localhost:8090/match \
  -H "Content-Type: application/json" \
  -d '{"subject_name":"JOHN DOE","candidates":[{"id":"1","name":"John Doe","type":"individual"}],"threshold":0.6}'
```

---

## v65 Operations: verifier Service

```bash
# Start verifier
docker compose up -d verifier

# Health check
curl http://localhost:8086/health

# Test NIN verification
curl -X POST http://localhost:8086/v1/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $BIS_GATEWAY_KEY" \
  -d '{"type":"nin","value":"12345678901","first_name":"JOHN","last_name":"DOE"}'
```
