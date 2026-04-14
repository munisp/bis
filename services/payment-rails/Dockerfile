# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /payment-rails ./cmd/server/main.go

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates curl tzdata && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /payment-rails /usr/local/bin/payment-rails

USER appuser
EXPOSE 8094

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8094/health || exit 1

ENTRYPOINT ["/usr/local/bin/payment-rails"]
