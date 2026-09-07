KC_PORT ?= 8180
KC_BASE := http://localhost:$(KC_PORT)
REALM := mcpkit-test
TOKEN_ENDPOINT := $(KC_BASE)/realms/$(REALM)/protocol/openid-connect/token
ISSUER := $(KC_BASE)/realms/$(REALM)
CLIENT_ID := mcp-confidential
CLIENT_SECRET := mcp-test-secret-for-confidential

.PHONY: help up down wait logs tokens tokens-context prm-info clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Bring up Keycloak + import realm (waits for healthy)
	docker compose up -d --wait

down: ## Tear down Keycloak
	docker compose down -v

wait: ## Block until the realm is reachable
	@for i in $$(seq 1 60); do \
		if curl -fsS $(ISSUER)/.well-known/openid-configuration >/dev/null 2>&1; then \
			echo "Keycloak ready at $(ISSUER)"; exit 0; \
		fi; \
		echo "waiting for realm... ($$i/60)"; sleep 2; \
	done; \
	echo "Keycloak did not become ready"; exit 1

logs: ## Tail Keycloak logs
	docker compose logs -f keycloak

tokens: ## Mint two tokens (insufficient = tools-read only; sufficient = full set) and print
	@$(MAKE) -s _mint SCOPES="openid tools-read" LABEL=insufficient
	@$(MAKE) -s _mint SCOPES="openid tools-read tools-call admin-write" LABEL=sufficient

tokens-context: ## Emit MCP_CONFORMANCE_CONTEXT JSON for the scope-challenge scenario
	@INSUFFICIENT=$$(curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-d "grant_type=client_credentials" \
		-d "client_id=$(CLIENT_ID)" \
		-d "client_secret=$(CLIENT_SECRET)" \
		-d "scope=openid tools-read" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"); \
	SUFFICIENT=$$(curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-d "grant_type=client_credentials" \
		-d "client_id=$(CLIENT_ID)" \
		-d "client_secret=$(CLIENT_SECRET)" \
		-d "scope=openid tools-read tools-call admin-write" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"); \
	ACCEPTED=$$(curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-d "grant_type=client_credentials" \
		-d "client_id=$(CLIENT_ID)" \
		-d "client_secret=$(CLIENT_SECRET)" \
		-d "scope=openid admin" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"); \
	python3 -c "import json; print(json.dumps({'authServer': '$(ISSUER)', 'tokens': {'insufficient': '$$INSUFFICIENT', 'sufficient': '$$SUFFICIENT', 'acceptedHierarchy': '$$ACCEPTED'}, 'requiredScope': 'admin-write', 'scopeGatedTool': 'admin_call', 'features': {'acceptedScopes': True}}))"

prm-info: ## Print the AS info SUTs need to publish via their PRM document
	@echo "Authorization server (issuer): $(ISSUER)"
	@echo "JWKS URI:                       $(ISSUER)/protocol/openid-connect/certs"
	@echo "Token endpoint:                 $(TOKEN_ENDPOINT)"
	@echo "Audience claim:                 account (Keycloak default; check with: curl -s $(ISSUER)/.well-known/openid-configuration)"

clean: down ## Alias for down

_mint:
	@TOKEN=$$(curl -fsS -X POST $(TOKEN_ENDPOINT) \
		-d "grant_type=client_credentials" \
		-d "client_id=$(CLIENT_ID)" \
		-d "client_secret=$(CLIENT_SECRET)" \
		-d "scope=$(SCOPES)" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"); \
	echo "$(LABEL) (scope=\"$(SCOPES)\"):"; \
	echo "  $$TOKEN"
