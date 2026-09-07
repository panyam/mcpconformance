#!/usr/bin/env -S npx tsx
/**
 * Emit MCP_CONFORMANCE_CONTEXT JSON for the SEP-2350 scope-challenge scenario,
 * minting client_credentials tokens from the Okta fixture at three scope tiers.
 * Byte-compatible with examples/auth-fixtures/keycloak/Makefile's tokens-context
 * target, so the scenario runs unchanged against either provider.
 *
 * Env (source okta.env first):
 *   OKTA_ISSUER         e.g. https://integrator-6641375.okta.com/oauth2/default
 *   OKTA_CLIENT_ID
 *   OKTA_CLIENT_SECRET
 *
 * Usage:
 *   source examples/auth-fixtures/okta/okta.env
 *   npx tsx examples/auth-fixtures/okta/tokens.ts
 */

const ISSUER = requireEnv('OKTA_ISSUER').replace(/\/$/, '');
const CLIENT_ID = requireEnv('OKTA_CLIENT_ID');
const CLIENT_SECRET = requireEnv('OKTA_CLIENT_SECRET');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing required env var: ${name} (did you 'source okta.env'?)`
    );
    process.exit(1);
  }
  return v;
}

async function mint(scope: string): Promise<string> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${ISSUER}/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope })
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `token request (scope="${scope}") failed: ${data.error} ${data.error_description ?? ''}`
    );
  }
  return data.access_token;
}

async function main() {
  const [insufficient, sufficient, acceptedHierarchy] = await Promise.all([
    mint('tools-read'), // valid token WITHOUT admin-write
    mint('admin-write'), // satisfies the gate
    mint('admin') // OR-hierarchy parent of admin-write
  ]);

  const context = {
    authServer: ISSUER,
    tokens: { insufficient, sufficient, acceptedHierarchy },
    requiredScope: 'admin-write',
    scopeGatedTool: 'admin_call',
    features: { acceptedScopes: true }
  };
  console.log(JSON.stringify(context));
}

main().catch((err) => {
  console.error(`tokens-context failed: ${err.message}`);
  process.exit(1);
});
