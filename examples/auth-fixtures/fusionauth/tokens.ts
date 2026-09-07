#!/usr/bin/env -S npx tsx
/**
 * Emit MCP_CONFORMANCE_CONTEXT JSON for the SEP-2350 scope-challenge scenario,
 * minting client_credentials tokens from the FusionAuth fixture at three scope
 * tiers. Byte-compatible with examples/auth-fixtures/keycloak/Makefile's
 * tokens-context target and examples/auth-fixtures/okta/tokens.ts, so the
 * scenario runs unchanged against any of the three providers.
 *
 * FusionAuth uses Entity Management for client_credentials. Scopes are in the
 * form `target-entity:<target-entity-id>:<permission>`. These IDs are fixed in
 * kickstart.json so no discovery step is needed.
 *
 * The scope-challenge-server.ts SUT accepts exact bearer token strings, so the
 * internal scope format in the JWT does not affect scenario correctness. The
 * SUT still advertises `REQUIRED_SCOPE=admin-write` in its WWW-Authenticate
 * challenge regardless of what the token carries.
 *
 * Env (defaults match kickstart.json hardcoded values):
 *   FA_BASE_URL         default: http://localhost:9011
 *   FA_CLIENT_ID        default: b1b2c3d4-0003-0003-0003-000000000001 (client entity UUID)
 *   FA_CLIENT_SECRET    default: mcp-test-secret-for-client-entity
 *   FA_TARGET_ENTITY_ID default: b1b2c3d4-0002-0002-0002-000000000001 (target entity UUID)
 *
 * Usage:
 *   npx tsx examples/auth-fixtures/fusionauth/tokens.ts
 * Or via Makefile:
 *   make tokens-context
 */

const BASE_URL = (process.env.FA_BASE_URL ?? 'http://localhost:9011').replace(
  /\/$/,
  ''
);
const CLIENT_ID =
  process.env.FA_CLIENT_ID ?? 'b1b2c3d4-0003-0003-0003-000000000001';
const CLIENT_SECRET =
  process.env.FA_CLIENT_SECRET ?? 'mcp-test-secret-for-client-entity';
const TARGET_ENTITY_ID =
  process.env.FA_TARGET_ENTITY_ID ?? 'b1b2c3d4-0002-0002-0002-000000000001';

const TOKEN_ENDPOINT = `${BASE_URL}/oauth2/token`;

async function mint(permission: string): Promise<string> {
  const scope = `target-entity:${TARGET_ENTITY_ID}:${permission}`;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope
    })
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `token request (permission="${permission}") failed ${res.status}: ${data.error ?? ''} ${data.error_description ?? ''}`.trim()
    );
  }
  return data.access_token;
}

async function main() {
  const [insufficient, sufficient, acceptedHierarchy] = await Promise.all([
    mint('tools-read'), // valid token WITHOUT admin-write
    mint('admin-write'), // satisfies the scope gate
    mint('admin') // OR-hierarchy parent of admin-write
  ]);

  const context = {
    authServer: BASE_URL,
    tokens: { insufficient, sufficient, acceptedHierarchy },
    requiredScope: 'admin-write',
    scopeGatedTool: 'admin_call',
    features: { acceptedScopes: true }
  };
  console.log(JSON.stringify(context));
}

main().catch((err) => {
  console.error(`tokens-context failed: ${(err as Error).message}`);
  process.exit(1);
});
