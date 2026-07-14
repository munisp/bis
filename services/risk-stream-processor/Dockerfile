# ─── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev cmake libsasl2-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "// placeholder" > src/lib.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src
COPY src ./src
RUN cargo build --release

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y ca-certificates libsasl2-2 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/bis-risk-stream-processor /usr/local/bin/bis-risk-stream-processor
EXPOSE 8098
ENV RUST_LOG=info
ENTRYPOINT ["bis-risk-stream-processor"]
