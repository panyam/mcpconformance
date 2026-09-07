FA_PORT     ?= 9011
FA_BASE_URL ?= http://localhost:$(FA_PORT)
ISSUER      := $(FA_BASE_URL)
TOKEN_ENDPOINT := $(FA_BASE_URL)/oauth2/token
# Entity UUIDs match kickstart.json
CLIENT_ID      := b1b2c3d4-0003-0003-0003-000000000001
CLIENT_SECRET  := mcp-test-secret-for-client-entity
TARGET_ENTITY_ID := b1b2c3d4-0002-0002-0002-000000000001

FIXTURE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: help up down wait logs tokens tokens-context prm-info clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Bring up FusionAuth + Postgres (waits for healthy); requires FUSIONAUTH_LICENSE_KEY
	@if [ -z "$$FUSIONAUTH_LICENSE_KEY" ]; then \
		echo "Error: FUSIONAUTH_LICENSE_KEY is not set."; \
		echo "Export your FusionAuth Essentials/Enterprise license key before running make up."; \
		echo "See README.md for details."; \
		exit 1; \
	fi
	docker compose up -d --wait

down: ## Tear down FusionAuth and Postgres (removes volumes)
	docker compose down -v

wait: ## Block until FusionAuth is reachable and kickstart is complete
	@for i in $$(seq 1 60); do \
		STATUS=$$(curl -fsS -o /dev/null -w '%{http_code}' $(FA_BASE_URL)/api/status 2>/dev/null || echo 000); \
		if [ "$$STATUS" = "200" ]; then \
			echo "FusionAuth ready at $(FA_BASE_URL)"; exit 0; \
		fi; \
		echo "waiting for FusionAuth... ($$i/60, status=$$STATUS)"; sleep 3; \
	done; \
	echo "FusionAuth did not become ready in time"; exit 1

logs: ## Tail FusionAuth logs
	docker compose logs -f fusionauth

tokens: ## Mint two tokens (insufficient = tools-read only; sufficient = admin-write) and print
	@BASIC=$$(printf '%s:%s' '$(CLIENT_ID)' '$(CLIENT_SECRET)' | base64); \
	echo "insufficient (permission=\"tools-read\"):"; \
	curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-H "Authorization: Basic $$BASIC" \
		-d "grant_type=client_credentials&scope=target-entity:$(TARGET_ENTITY_ID):tools-read" \
		| python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"; \
	echo "sufficient (permission=\"admin-write\"):"; \
	curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-H "Authorization: Basic $$BASIC" \
		-d "grant_type=client_credentials&scope=target-entity:$(TARGET_ENTITY_ID):admin-write" \
		| python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"

tokens-context: ## Emit MCP_CONFORMANCE_CONTEXT JSON for the scope-challenge scenario
	@FA_BASE_URL=$(FA_BASE_URL) \
	 FA_CLIENT_ID=$(CLIENT_ID) \
	 FA_CLIENT_SECRET=$(CLIENT_SECRET) \
	 FA_TARGET_ENTITY_ID=$(TARGET_ENTITY_ID) \
	 npx tsx $(FIXTURE_DIR)tokens.ts

prm-info: ## Print the AS info SUTs need to publish via their PRM document
	@echo "Authorization server (issuer): $(ISSUER)"
	@echo "JWKS URI:                       $(FA_BASE_URL)/.well-known/jwks.json"
	@echo "Token endpoint:                 $(TOKEN_ENDPOINT)"
	@echo "OpenID configuration:           $(FA_BASE_URL)/.well-known/openid-configuration"

clean: down ## Alias for down
