# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig

# Copy manifests first for layer caching
COPY Cargo.toml Cargo.lock* ./

# Create a dummy main.rs to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# Copy actual source
COPY src ./src

# Build the actual binary (touch to force rebuild)
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl libgcc

WORKDIR /app

COPY --from=builder /app/target/release/event-emitter .

RUN addgroup -S bisapp && adduser -S bisapp -G bisapp
USER bisapp

EXPOSE 8093

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8093/health || exit 1

ENTRYPOINT ["/app/event-emitter"]
