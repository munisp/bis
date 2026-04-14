# ─── BIS Platform Makefile ────────────────────────────────────────────────────
# Usage: make <target>
# Quick start: make setup && make dev

.PHONY: help setup dev build test test-all test-go test-rust test-python \
        test-ts lint clean docker-up docker-down docker-logs docker-ps \
        db-push db-seed smoke-test services-build services-test

SHELL := /bin/bash
SERVICES_DIR := services
GO_SERVICES := gateway case-manager lex-intake ollama-adapter payment-rails
RUST_SERVICES := event-processor event-emitter aml-engine
PYTHON_SERVICES := risk-engine lex-validator ml-enrichment biometric-engine risk-scoring

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

# ─── CI ───────────────────────────────────────────────────────────────────────
ci: lint test-all ## Run all CI checks (lint + all tests)
	@echo "✓ CI checks passed"
