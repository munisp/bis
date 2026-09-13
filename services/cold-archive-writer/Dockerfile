FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/cold-archive-writer ./cmd/worker

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/cold-archive-writer /cold-archive-writer
USER nonroot:nonroot
ENTRYPOINT ["/cold-archive-writer"]
