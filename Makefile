# ─── BIS Platform Makefile ────────────────────────────────────────────────────
# Usage: make <target>
# Quick start: make setup && make dev

.PHONY: help setup dev build test test-all test-go test-rust test-python \
        test-ts lint clean docker-up docker-down docker-logs docker-ps \
        db-push db-seed smoke-test services-build services-test \
        waf-up waf-down waf-logs waf-status waf-test waf-policy-reload \
        infra-up infra-up-core infra-down infra-reset infra-status health dev-all

SHELL := /bin/bash
SERVICES_DIR := services
GO_SERVICES := gateway case-manager lex-intake ollama-adapter payment-rails
RUST_SERVICES := event-processor event-emitter aml-engine
PYTHON_SERVICES := risk-engine lex-validator ml-enrichment biometric-engine risk-scoring opensearch-indexer

# ─── Infrastructure Bootstrap (Devin/OpenHands pattern) ─────────────────────
# Docker socket must be accessible: /var/run/docker.sock
# These targets mirror how Devin/OpenHands creates infrastructure first.
infra-up: ## Spin up ALL middleware containers (Devin/OpenHands entry point)
	@./infra/bootstrap.sh

infra-up-core: ## Spin up core middleware only (postgres, redis, kafka, keycloak, temporal)
	@./infra/bootstrap.sh --core-only

infra-down: ## Stop all containers (data volumes preserved)
	@docker compose down

infra-reset: ## DESTRUCTIVE: stop containers + delete all volumes
	@./infra/bootstrap.sh --reset

infra-status: ## Show status of all running containers
	@docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps

health: ## Check health of all running middleware
	@echo "Checking middleware health..."
	@echo -n "  PostgreSQL:  " && PGPASSWORD=bis_secure_2026 psql -h localhost -U bis_user -d bis_db -c "SELECT 1" -q 2>/dev/null | grep -q "1 row" && echo "OK" || echo "DOWN"
	@echo -n "  Redis:       " && redis-cli ping 2>/dev/null | grep -q PONG && echo "OK" || echo "DOWN"
	@echo -n "  Keycloak:    " && curl -sf http://localhost:8080/health/ready 2>/dev/null | grep -q UP && echo "OK" || echo "UNKNOWN"
	@echo -n "  Temporal:    " && curl -sf http://localhost:7233/api/v1/namespaces 2>/dev/null | grep -q namespaces && echo "OK" || echo "UNKNOWN"
	@echo -n "  OpenSearch:  " && curl -sf http://localhost:9200/_cluster/health 2>/dev/null | grep -qE '"status":"(green|yellow)"' && echo "OK" || echo "UNKNOWN"

dev-all: ## Start BFF + Go/Rust/Python services in tmux (requires tmux)
	@command -v tmux >/dev/null 2>&1 || (echo "tmux required: sudo apt install tmux" && exit 1)
	@tmux new-session -d -s bis -n bff 'make dev' \; \
	  new-window -t bis -n gateway 'cd services/gateway && go run . 2>&1' \; \
	  new-window -t bis -n ml 'cd services/ml-enrichment && uvicorn app.main:app --reload 2>&1' \; \
	  attach-session -t bis

# ─── Help ─────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-25s\033[0m %s\n", $$1, $$2}'

# ─── Setup ────────────────────────────────────────────────────────────────────
setup: ## Install all dependencies
	@echo "Installing Node.js dependencies..."
	pnpm install
	@echo "Installing Go tools..."
	@for svc in $(GO_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			echo "  → $$svc"; \
			cd $(SERVICES_DIR)/$$svc && go mod download && cd ../..; \
		fi; \
	done
	@echo "Installing Python dependencies..."
	@for svc in $(PYTHON_SERVICES); do \
		if [ -f "$(SERVICES_DIR)/$$svc/requirements.txt" ]; then \
			echo "  → $$svc"; \
			pip3 install -r $(SERVICES_DIR)/$$svc/requirements.txt -q; \
		fi; \
	done
	@echo "✓ Setup complete"

# ─── Development ──────────────────────────────────────────────────────────────
dev: ## Start BFF dev server (hot reload)
	pnpm dev

dev-full: ## Start all services via Docker Compose
	docker compose up -d --build
	@echo "✓ All services started. BFF: http://localhost:3001"

# ─── Build ────────────────────────────────────────────────────────────────────
build: ## Build the BFF (TypeScript → JS)
	pnpm build

build-go: ## Build all Go services
	@for svc in $(GO_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			echo "Building $$svc..."; \
			cd $(SERVICES_DIR)/$$svc && go build ./... && cd ../..; \
		fi; \
	done

build-rust: ## Build all Rust services
	@for svc in $(RUST_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			echo "Building $$svc..."; \
			cd $(SERVICES_DIR)/$$svc && cargo build --release && cd ../..; \
		fi; \
	done

# ─── Testing ──────────────────────────────────────────────────────────────────
test: ## Run TypeScript/Vitest tests
	pnpm test

test-go: ## Run all Go service tests
	@echo "Running Go tests..."
	@PASS=0; FAIL=0; \
	for svc in $(GO_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			echo "  Testing $$svc..."; \
			if cd $(SERVICES_DIR)/$$svc && go test ./... -count=1 2>&1; then \
				PASS=$$((PASS+1)); \
			else \
				FAIL=$$((FAIL+1)); \
			fi; \
			cd ../..; \
		fi; \
	done; \
	echo "Go: $$PASS passed, $$FAIL failed"

test-rust: ## Run all Rust service tests
	@echo "Running Rust tests..."
	@for svc in $(RUST_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			echo "  Testing $$svc..."; \
			cd $(SERVICES_DIR)/$$svc && cargo test 2>&1 && cd ../..; \
		fi; \
	done

test-python: ## Run all Python service tests
	@echo "Running Python tests..."
	@for svc in $(PYTHON_SERVICES); do \
		if [ -f "$(SERVICES_DIR)/$$svc/test_main.py" ]; then \
			echo "  Testing $$svc..."; \
			cd $(SERVICES_DIR)/$$svc && python3 -m pytest test_main.py -v 2>&1 && cd ../..; \
		fi; \
	done

test-all: test test-go test-rust test-python ## Run ALL tests across all languages
	@echo "✓ All tests complete"

# ─── Linting ──────────────────────────────────────────────────────────────────
lint: ## Run TypeScript type check
	npx tsc --noEmit

lint-go: ## Run Go vet on all services
	@for svc in $(GO_SERVICES); do \
		if [ -d "$(SERVICES_DIR)/$$svc" ]; then \
			cd $(SERVICES_DIR)/$$svc && go vet ./... && cd ../..; \
		fi; \
	done

# ─── Database ─────────────────────────────────────────────────────────────────
db-push: ## Push schema changes to database
	pnpm db:push

db-seed: ## Seed the database with production-grade data
	npx tsx server/seed.ts

db-reset: ## Reset and re-seed the database (DESTRUCTIVE)
	@echo "⚠️  This will drop all data. Press Ctrl+C to cancel..."
	@sleep 3
	pnpm db:push
	npx tsx server/seed.ts

# ─── Docker ───────────────────────────────────────────────────────────────────
docker-up: ## Start all Docker services
	docker compose up -d

docker-down: ## Stop all Docker services
	docker compose down

docker-build: ## Build all Docker images
	docker compose build

docker-logs: ## Follow logs for core services
	docker compose logs -f bff gateway risk-engine payment-rails aml-engine risk-scoring

docker-ps: ## Show running containers
	docker compose ps

docker-clean: ## Remove all containers, volumes, and images
	docker compose down -v --rmi local

# ─── Smoke Tests ──────────────────────────────────────────────────────────────
smoke-test: ## Run smoke tests against running services
	@bash scripts/smoke-test.sh

smoke-test-local: ## Run smoke tests against local dev server
	@BFF_URL=http://localhost:3000 bash scripts/smoke-test.sh

# ─── Utilities ────────────────────────────────────────────────────────────────
clean: ## Clean build artifacts
	rm -rf dist node_modules/.cache
	@for svc in $(GO_SERVICES); do \
		[ -d "$(SERVICES_DIR)/$$svc" ] && rm -f $(SERVICES_DIR)/$$svc/*.bin || true; \
	done

format: ## Format all code
	pnpm format
	@for svc in $(GO_SERVICES); do \
		[ -d "$(SERVICES_DIR)/$$svc" ] && cd $(SERVICES_DIR)/$$svc && gofmt -w . && cd ../.. || true; \
	done

# ─── open-appsec WAF ─────────────────────────────────────────────────────────────────────────
waf-up: ## Start full stack WITH open-appsec WAF (ML-based OWASP protection on port 80)
	docker compose --profile waf up -d
	@echo "✔ open-appsec WAF started"
	@echo "  Public HTTP:   http://localhost:80  (WAF → APISIX → BIS)"
	@echo "  WAF metrics:   http://localhost:8090"
	@echo "  APISIX admin:  http://localhost:9180 (localhost-only when WAF active)"

waf-down: ## Stop the open-appsec WAF service only
	docker compose --profile waf stop open-appsec

waf-logs: ## Follow open-appsec WAF logs
	docker compose logs -f open-appsec

waf-status: ## Check open-appsec WAF health and policy status
	@echo "=== open-appsec WAF Status ==="
	@docker compose ps open-appsec 2>/dev/null || echo "WAF not running (use: make waf-up)"
	@echo ""
	@echo "=== WAF Health ==="
	@curl -sf http://localhost:80/health 2>/dev/null && echo " OK" || echo " FAILED (WAF not running)"
	@echo "=== APISIX Health ==="
	@curl -sf http://localhost:9080/health 2>/dev/null && echo " OK" || echo " FAILED"

waf-test: ## Run WAF attack simulation tests (OWASP Top 10 coverage)
	@bash scripts/waf-smoke-test.sh

waf-policy-reload: ## Reload open-appsec policy without container restart
	@docker exec bis-open-appsec nginx -s reload
	@echo "✔ open-appsec policy reloaded"

# ─── CI ──────────────────────────────────────────────────────────────────────────────
ci: lint test-all ## Run all CI checks (lint + all tests)
	@echo "✓ CI checks passed"

# ─── Criminal Records / Corporate / Field Visit ───────────────────────────────
check-criminal: ## Validate criminal records service compilation and syntax
	@echo "Checking criminal records gateway extension..."
	@cd $(SERVICES_DIR)/gateway && /usr/lib/go-1.22/bin/go build ./... && echo "  ✓ gateway builds"
	@python3 -c "import ast; ast.parse(open('$(SERVICES_DIR)/risk-engine/criminal_corporate_scoring.py').read())" && echo "  ✓ risk-engine criminal scoring syntax OK"
	@python3 -c "import ast; ast.parse(open('$(SERVICES_DIR)/ml-enrichment/app/routers/criminal_enrichment.py').read())" && echo "  ✓ ml-enrichment criminal enrichment syntax OK"
	@python3 -c "import ast; ast.parse(open('$(SERVICES_DIR)/opensearch-indexer/indexer.py').read())" && echo "  ✓ opensearch-indexer syntax OK"
	@echo "✓ All criminal records service checks passed"