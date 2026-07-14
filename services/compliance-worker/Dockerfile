# ─── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /compliance-worker ./cmd/main.go

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12 AS runtime
COPY --from=builder /compliance-worker /compliance-worker
EXPOSE 8096
ENTRYPOINT ["/compliance-worker"]
