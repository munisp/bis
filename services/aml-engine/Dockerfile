# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM rust:1.78-alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Cache dependencies with a dummy main to avoid recompiling all deps on code changes
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
RUN cargo build --release

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates curl tzdata libgcc && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

# Binary name matches [[bin]] name in Cargo.toml: "bis-aml-engine"
COPY --from=builder /app/target/release/bis-aml-engine /usr/local/bin/bis-aml-engine

USER appuser

# Port matches default in src/main.rs (PORT env var, default 8085)
EXPOSE 8085

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8085/health || exit 1

ENTRYPOINT ["/usr/local/bin/bis-aml-engine"]
