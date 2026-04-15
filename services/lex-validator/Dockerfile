# lex-validator — Python stdlib-only microservice
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="BIS Lex Validator"
LABEL org.opencontainers.image.description="LEX submission validation and deduplication service"
LABEL org.opencontainers.image.source="https://github.com/bis-platform/bis"

# Security: run as non-root
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser

WORKDIR /app

# No external dependencies — stdlib only
COPY main.py .

RUN chown -R appuser:appgroup /app
USER appuser

ENV PORT=8097 \
    REDIS_URL=redis://redis:6379 \
    GATEWAY_URL=http://gateway:8081 \
    LOG_LEVEL=INFO

EXPOSE 8097

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "from urllib.request import urlopen; urlopen('http://localhost:${PORT:-8097}/health')" || exit 1

CMD ["python3", "main.py"]
