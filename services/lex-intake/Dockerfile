# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

# Copy module files first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build a statically-linked binary (CGO required for sqlite3)
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-w -s -extldflags '-static'" \
    -o lex-intake .

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.19

# Security: run as non-root user
RUN addgroup -S lexintake && adduser -S lexintake -G lexintake

# Install ca-certificates for HTTPS outbound calls
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/lex-intake .

# Create data directory for SQLite offline queue
RUN mkdir -p /data && chown lexintake:lexintake /data

USER lexintake

# Expose HTTP port
EXPOSE 8090

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8090/health || exit 1

# Environment variables (override at runtime)
ENV LEX_PORT=8090 \
    LEX_DB_PATH=/data/lex_offline.db \
    LEX_BIS_API_URL=https://your-bis-instance.manus.space \
    LEX_BIS_API_KEY="" \
    LEX_SYNC_INTERVAL=300 \
    LEX_MAX_QUEUE_SIZE=10000

ENTRYPOINT ["/app/lex-intake"]
