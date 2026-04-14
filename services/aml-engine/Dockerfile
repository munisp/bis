# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM rust:1.78-alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
RUN cargo build --release

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates curl tzdata libgcc && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/target/release/aml-engine /usr/local/bin/aml-engine

USER appuser
EXPOSE 8095

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8095/health || exit 1

ENTRYPOINT ["/usr/local/bin/aml-engine"]
