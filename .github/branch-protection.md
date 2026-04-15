# Branch Protection Configuration

Configure these settings in **GitHub → Settings → Branches → Add rule** for `main` and `develop`.

## `main` branch

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approvals | 2 |
| Dismiss stale pull request approvals | ✅ |
| Require review from Code Owners | ✅ |
| Require status checks to pass before merging | ✅ |
| Required status checks | `All CI Checks Passed` |
| Require branches to be up to date before merging | ✅ |
| Require conversation resolution before merging | ✅ |
| Require signed commits | ✅ |
| Require linear history | ✅ |
| Include administrators | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

## `develop` branch

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approvals | 1 |
| Require status checks to pass | ✅ |
| Required status checks | `All CI Checks Passed` |
| Allow force pushes | ❌ |

## Required GitHub Secrets

Add these in **Settings → Secrets and variables → Actions**:

### CI Secrets
| Secret | Description | Example |
|---|---|---|
| `STAGING_HOST` | Staging server IP/hostname | `staging.bis.example.com` |
| `STAGING_USER` | SSH username for staging | `deploy` |
| `STAGING_SSH_KEY` | Private SSH key for staging | PEM key content |
| `STAGING_URL` | Staging base URL | `https://staging.bis.example.com` |
| `PRODUCTION_HOST` | Production server IP/hostname | `bis.example.com` |
| `PRODUCTION_USER` | SSH username for production | `deploy` |
| `PRODUCTION_SSH_KEY` | Private SSH key for production | PEM key content |
| `PRODUCTION_URL` | Production base URL | `https://bis.example.com` |
| `SMOKE_API_TOKEN` | Session token for smoke tests | JWT value |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook | `https://hooks.slack.com/...` |

### Verification Engine Secrets
| Secret | Description | Default |
|---|---|---|
| `BIS_VERIFY_NIMC_URL` | NIMC API base URL | `https://api.nimc.gov.ng/v1` |
| `BIS_VERIFY_NIMC_KEY` | NIMC API key | — |
| `BIS_VERIFY_NIBSS_URL` | NIBSS API base URL | `https://api.nibss-plc.com.ng/v1` |
| `BIS_VERIFY_NIBSS_KEY` | NIBSS API key | — |
| `BIS_VERIFY_CAC_URL` | CAC search API URL | `https://search.cac.gov.ng/api/v1` |
| `BIS_VERIFY_CAC_KEY` | CAC API key | — |
| `BIS_VERIFY_OFAC_URL` | OFAC API base URL | `https://api.ofac.treasury.gov/v1` |
| `YOUVERIFY_API_KEY` | Youverify fallback key | — |
| `YOUVERIFY_BASE_URL` | Youverify base URL | `https://api.youverify.co/v2` |

### Infrastructure Secrets
| Secret | Description |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password (production) |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin password |
| `JWT_SECRET` | BFF session signing secret (min 32 chars) |

## CODEOWNERS

Create `.github/CODEOWNERS`:
```
# Global owners
*                   @bis-platform/core-team

# Gateway (verification engine)
services/gateway/   @bis-platform/backend-team

# Frontend
client/             @bis-platform/frontend-team

# Infrastructure
docker-compose*.yml @bis-platform/devops-team
.github/            @bis-platform/devops-team
infra/              @bis-platform/devops-team
```
