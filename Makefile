# tableX -- monorepo task runner.
#
# Every target is runnable from the repository root. Backend-only targets delegate to
# backend/Makefile so that either entry point works.

.PHONY: help setup up down reset db-shell migrate migrate-down migrate-status seed \
        backend frontend dev build test test-backend test-frontend smoke concurrency \
        lint fmt typecheck check clean tidy

SHELL := /bin/bash

DC          ?= docker compose
DB_CONTAINER ?= tablex-postgres
DB_USER     ?= postgres
DB_NAME     ?= tablex
MIGRATIONS  ?= backend/migrations/postgres
SEED_FILE   ?= backend/seeds/local_seed.sql

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

setup: ## First-run: install deps, start the database, migrate, seed
	@command -v bun >/dev/null || { echo "bun is required: https://bun.sh"; exit 1; }
	bun install
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed
	@echo
	@echo "Ready. Now run:  make dev"
	@echo "  diner  http://localhost:3000   (scan URL is printed by 'make seed')"
	@echo "  admin  http://localhost:3001   (owner@spicegarden.test / password123)"

up: ## Start Postgres and wait for it to accept queries
	$(DC) up -d postgres
	@echo -n "waiting for postgres"
	@for i in $$(seq 1 40); do \
		if $(DC) exec -T postgres pg_isready -U $(DB_USER) -d $(DB_NAME) >/dev/null 2>&1; then \
			echo " ready"; exit 0; fi; \
		echo -n "."; sleep 1; \
	done; echo " TIMED OUT"; exit 1

down: ## Stop the stack, keeping data
	$(DC) down

reset: ## Destroy the database and rebuild it from scratch
	$(DC) down -v
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed

db-shell: ## Open a psql shell
	$(DC) exec postgres psql -U $(DB_USER) -d $(DB_NAME)

migrate: ## Apply every up migration in order
	@set -e; for f in $$(ls $(MIGRATIONS)/*.up.sql | sort); do \
		printf '  applying %s\n' "$$(basename $$f)"; \
		$(DC) exec -T postgres psql -U $(DB_USER) -d $(DB_NAME) -v ON_ERROR_STOP=1 -q < "$$f"; \
	done; echo "migrations applied"

migrate-down: ## Roll back every migration, newest first
	@set -e; for f in $$(ls $(MIGRATIONS)/*.down.sql | sort -r); do \
		printf '  reverting %s\n' "$$(basename $$f)"; \
		$(DC) exec -T postgres psql -U $(DB_USER) -d $(DB_NAME) -v ON_ERROR_STOP=1 -q < "$$f"; \
	done; echo "migrations reverted"

migrate-status: ## List the tables that currently exist
	@$(DC) exec -T postgres psql -U $(DB_USER) -d $(DB_NAME) -c "\dt"

seed: ## Load the demo restaurant, menu, tables and staff login
	@test -f $(SEED_FILE) || { echo "missing $(SEED_FILE)"; exit 1; }
	@$(DC) exec -T postgres psql -U $(DB_USER) -d $(DB_NAME) -v ON_ERROR_STOP=1 -q < $(SEED_FILE)
	@echo "seeded. QR scan URLs:"
	@$(DC) exec -T postgres psql -U $(DB_USER) -d $(DB_NAME) -tAc \
		"SELECT '  Table ' || label || ':  http://localhost:3000/t/' || qr_token FROM restaurant_table ORDER BY id LIMIT 5"

backend: ## Run the API server
	$(MAKE) -C backend run

frontend: ## Run both frontends
	bun run --cwd apps/diner dev & bun run --cwd apps/admin dev; wait

dev: ## Run the API and both frontends together
	@$(MAKE) -j3 backend frontend

build: ## Build the backend binary and both frontends
	$(MAKE) -C backend build
	bun run --cwd apps/diner build
	bun run --cwd apps/admin build

test: test-backend test-frontend ## Run every test

test-backend: ## Go tests
	$(MAKE) -C backend test

test-frontend: ## Frontend unit tests
	bun test

smoke: ## End-to-end API smoke test (needs a freshly seeded db and a running server)
	./scripts/smoke.sh

concurrency: ## Race tests for order accept, number allocation and idempotency
	./scripts/concurrency.sh

typecheck: ## TypeScript across the workspace
	./node_modules/.bin/tsc --noEmit -p packages/shared/tsconfig.json
	./node_modules/.bin/tsc --noEmit -p packages/api-client/tsconfig.json
	./node_modules/.bin/tsc --noEmit -p packages/ui/tsconfig.json
	cd apps/diner && ../../node_modules/.bin/tsc --noEmit
	cd apps/admin && ../../node_modules/.bin/tsc --noEmit

lint: ## Lint everything
	$(MAKE) -C backend vet
	./node_modules/.bin/biome check .

fmt: ## Format everything
	$(MAKE) -C backend fmt
	./node_modules/.bin/biome check --write .

tidy: ## Tidy Go modules
	$(MAKE) -C backend tidy

check: fmt lint typecheck test ## The full gate, as CI runs it

clean: ## Remove build artefacts
	rm -rf backend/bin apps/*/.next apps/*/out packages/*/dist
	find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete
