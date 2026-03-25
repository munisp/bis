FROM rust:1.77-slim AS builder
WORKDIR /app

# Install librdkafka-dev for native rdkafka Kafka consumer
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libsasl2-dev \
    libzstd-dev \
    cmake \
    build-essential \
    librdkafka-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
# Cache dependencies layer
RUN mkdir src && echo "fn main(){}" > src/main.rs \
    && cargo build --release \
    && rm src/main.rs

COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    ca-certificates \
    librdkafka1 \
    libsasl2-2 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/bis-event-processor .
ENV EVENT_PROCESSOR_PORT=8083
ENV KAFKA_BROKERS=kafka:9092
EXPOSE 8083
CMD ["./bis-event-processor"]
