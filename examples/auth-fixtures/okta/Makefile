# Okta fixture for auth conformance scenarios (SEP-2350 scope-challenge).
#
# Unlike the keycloak fixture there is no `up`/`down` — Okta is SaaS, nothing to
# boot. Setup is a one-time `provision` against a real tenant; `tokens-context`
# then mints the MCP_CONFORMANCE_CONTEXT blob the scenario consumes (same
# contract as keycloak's tokens-context).
#
# Requires (provision/clean): OKTA_ORG_URL + OKTA_API_TOKEN (SSWS admin token).
# tokens-context reads okta.env, written by provision.
.PHONY: help provision tokens-context clean

FIXTURE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

provision: ## Provision scopes + client_credentials app + policy; writes okta.env
	@npx tsx $(FIXTURE_DIR)provision.ts

tokens-context: ## Emit MCP_CONFORMANCE_CONTEXT JSON (source okta.env first, or via this target)
	@set -a; . $(FIXTURE_DIR)okta.env; set +a; npx tsx $(FIXTURE_DIR)tokens.ts

clean: ## Tear down the app, policy, and scopes from the tenant
	@npx tsx $(FIXTURE_DIR)deprovision.ts
