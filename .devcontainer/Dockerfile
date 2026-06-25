FROM ubuntu:24.04

# ── Non-interactive apt ───────────────────────────────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    # Essentials
    curl wget git ca-certificates gnupg lsb-release sudo \
    # Build tools
    build-essential pkg-config libssl-dev libpq-dev \
    # Utilities
    jq yq unzip zip socat netcat-openbsd postgresql-client redis-tools \
    # Python
    python3 python3-pip python3-venv python3-dev \
    # Misc
    bc less procps psmisc net-tools \
    && rm -rf /var/lib/apt/lists/*

# ── Docker CLI (for Docker-in-Docker socket mount) ────────────────────────────
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# ── Go 1.22 ───────────────────────────────────────────────────────────────────
ARG GO_VERSION=1.22.4
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:$PATH"
ENV GOPATH="/go"
ENV PATH="$GOPATH/bin:$PATH"

# ── Rust (stable) ─────────────────────────────────────────────────────────────
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:$PATH"

# ── Node.js 22 + pnpm ─────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@latest \
    && rm -rf /var/lib/apt/lists/*

# ── Python ML dependencies ────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir --break-system-packages \
    fastapi uvicorn[standard] scikit-learn joblib numpy pandas \
    kafka-python redis boto3 opensearch-py httpx pydantic

# ── Temporal CLI ──────────────────────────────────────────────────────────────
RUN curl -sSf https://temporal.download/cli.sh | sh \
    && mv temporal /usr/local/bin/temporal 2>/dev/null || true

# ── Create non-root user ──────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash -G sudo,docker bis \
    && echo "bis ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER bis
WORKDIR /workspace

# ── Shell config ──────────────────────────────────────────────────────────────
RUN echo 'export PATH="/usr/local/go/bin:/root/.cargo/bin:$PATH"' >> ~/.bashrc \
    && echo 'alias dc="docker compose"' >> ~/.bashrc \
    && echo 'alias infra-up="./infra/bootstrap.sh"' >> ~/.bashrc \
    && echo 'alias infra-down="docker compose down"' >> ~/.bashrc

CMD ["/bin/bash"]
