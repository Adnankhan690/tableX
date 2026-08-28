# tableX backend.

.PHONY: run build test test-race coverage coverage-html fmt vet lint tidy migrate-new check

CONFIG ?= config/local.yml

# Secrets live in the repo-root .env, which is gitignored. config/local.yml is checked in and
# carries only the shape and the non-secret local values, so anything that must not be
# committed -- R2 credentials, a real JWT secret, the platform token -- belongs in .env.
#
# NOTHING IN THE GO CODE READS A .env FILE. config.Load reads defaults, then the YAML, then
# the process environment; it has no dotenv step and deliberately so, because a server in
# production is handed real environment variables. That leaves this target as the only thing
# that can bridge the two locally -- and without it, a value set in .env never reaches the
# process and the feature it configures silently stays switched off, which is a bad hour to
# spend when the .env looks obviously correct.
ENV_FILE ?= ../.env

run: ## Run the API server, loading secrets from the repo-root .env if present
	@if [ -f $(ENV_FILE) ]; then set -a; . $(ENV_FILE); set +a; fi; \
	go run ./cmd/server --config $(CONFIG)

build: ## Build the server binary
	go build -o bin/tablex ./cmd/server

test: ## Run tests
	go test ./... -count=1

test-race: ## Run tests with the race detector
	# The realtime hub and the order-placement locking are the two places a data race would
	# actually bite, and neither shows up without -race.
	go test ./... -count=1 -race

coverage: ## Report coverage over the layers that carry logic
	@go test ./internal/... -covermode=atomic -coverprofile=coverage.out >/dev/null
	@go tool cover -func=coverage.out | tail -1

coverage-html: coverage ## Write an HTML coverage report
	go tool cover -html=coverage.out -o coverage.html
	@echo "coverage.html"

fmt: ## Format
	gofmt -w .

vet: ## Vet
	go vet ./...

lint: fmt vet ## Format and vet (golangci-lint if installed)
	@command -v golangci-lint >/dev/null && golangci-lint run ./... || echo "golangci-lint not installed, skipped"

tidy: ## Tidy modules
	go mod tidy

migrate-new: ## Create a numbered migration pair
	@read -p "Migration name (snake_case): " name; \
	seq=$$(ls migrations/postgres/*.up.sql 2>/dev/null | wc -l | tr -d ' '); \
	n=$$(printf "%03d" $$((seq + 1))); \
	up="migrations/postgres/$${n}_$${name}.up.sql"; \
	down="migrations/postgres/$${n}_$${name}.down.sql"; \
	printf -- "-- %s\n\n" "$$name" > $$up; \
	printf -- "-- revert %s\n\n" "$$name" > $$down; \
	echo "created $$up"; echo "created $$down"

check: fmt vet test ## The backend gate
