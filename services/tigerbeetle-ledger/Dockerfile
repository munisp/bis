# ─── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "// placeholder" > src/lib.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src
COPY src ./src
RUN cargo build --release

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/bis-tigerbeetle-ledger /usr/local/bin/bis-tigerbeetle-ledger
EXPOSE 8097
ENV RUST_LOG=info
ENTRYPOINT ["bis-tigerbeetle-ledger"]
