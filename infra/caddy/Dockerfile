# ─── BIS Platform Caddy Edge Gateway ─────────────────────────────────────────
# Builds a custom Caddy binary with all required modules:
#   - caddy-security    : Keycloak OIDC / JWT forward-auth
#   - caddy-ratelimit   : Distributed rate limiting (Redis-backed)
#   - caddy-waf         : Additional WAF rules (defense-in-depth)
#   - caddy-redis       : Redis storage for TLS cert clustering
#   - caddy-opentelemetry: OpenTelemetry tracing
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Build custom Caddy with plugins
FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/greenpau/caddy-security \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/fabriziosalmi/caddy-waf \
    --with github.com/gamalan/caddy-tlsredis \
    --with github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy \
    --with github.com/caddyserver/caddy/v2/modules/caddytls

# Stage 2: Runtime image
FROM caddy:2-alpine

# Copy custom binary
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create required directories
RUN mkdir -p \
    /etc/caddy \
    /etc/caddy/pki \
    /var/log/caddy \
    /data/caddy \
    /config/caddy

# Copy Caddyfile and JSON config
COPY Caddyfile /etc/caddy/Caddyfile
COPY caddy.json /etc/caddy/caddy.json

# Copy WAF rules
COPY waf-rules/ /etc/caddy/waf-rules/

# Expose ports
# 80   — HTTP (redirects to HTTPS)
# 443  — HTTPS (public API + TLS)
# 8443 — Internal mTLS service mesh
# 2019 — Admin API (internal only, never exposed externally)
EXPOSE 80 443 8443 2019

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:2019/config/ || exit 1

# Run Caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
