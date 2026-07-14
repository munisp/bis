# ─── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /openappsec-reporter .

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12 AS runtime
COPY --from=builder /openappsec-reporter /openappsec-reporter
EXPOSE 8095
ENTRYPOINT ["/openappsec-reporter"]
