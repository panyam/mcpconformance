#!/usr/bin/env -S npx tsx
/**
 * Provision an Okta "default" custom authorization server + a client_credentials
 * app so the SEP-2350 scope-challenge conformance scenario can mint scoped
 * tokens against a real Okta tenant. Idempotent: re-running reuses existing
 * scopes / app / policy by name.
 *
 * Env:
 *   OKTA_ORG_URL    e.g. https://integrator-6641375.okta.com   (bare host, no /oauth2/default)
 *   OKTA_API_TOKEN  an SSWS admin API token (Security -> API -> Tokens)
 *
 * The SSWS token is only needed for provisioning. Revoke it afterwards; the
 * conformance scenario itself uses only the client_id/secret this script prints.
 *
 * Usage: npx tsx examples/auth-fixtures/okta/provision.ts
 *
 * On success writes examples/auth-fixtures/okta/okta.env (gitignored, mode 600)
 * with ISSUER + CLIENT_ID + a freshly-minted CLIENT_SECRET.
 */
import { writeFileSync } from 'node:fs';

const ORG = requireEnv('OKTA_ORG_URL').replace(/\/$/, '');
const TOKEN = requireEnv('OKTA_API_TOKEN');
const APP_LABEL = process.env.OKTA_APP_LABEL ?? 'MCPDev';
const AS_NAME = 'default';
const SCOPES = ['tools-read', 'tools-call', 'admin-write', 'admin'] as const;
const POLICY_NAME = 'mcpdev-cc';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function okta<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${ORG}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `SSWS ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const summary =
      (
        data as {
          errorSummary?: string;
          errorCauses?: { errorSummary: string }[];
        }
      )?.errorSummary ?? res.statusText;
    const causes = (
      data as { errorCauses?: { errorSummary: string }[] }
    )?.errorCauses
      ?.map((c) => c.errorSummary)
      .join('; ');
    throw new Error(
      `${method} ${path} -> ${res.status}: ${summary}${causes ? ` (${causes})` : ''}`
    );
  }
  return data as T;
}

interface NamedId {
  id: string;
  name?: string;
  label?: string;
  status?: string;
}

interface AppSecret extends NamedId {
  client_secret?: string;
}

async function deactivateAndDelete(
  appId: string,
  secretId: string,
  status?: string
) {
  if (status === 'ACTIVE') {
    await okta(
      'POST',
      `/apps/${appId}/credentials/secrets/${secretId}/lifecycle/deactivate`
    );
  }
  await okta('DELETE', `/apps/${appId}/credentials/secrets/${secretId}`);
}

/**
 * Leave the app with exactly one ACTIVE secret whose value we know, and return
 * it. Okta caps client secrets at 2, so we prune to make room, mint a fresh
 * one, then delete every older secret. Idempotent across re-runs.
 */
async function resetSecret(appId: string): Promise<string> {
  let secrets = await okta<AppSecret[]>(
    'GET',
    `/apps/${appId}/credentials/secrets`
  );
  // Make room if at the cap (2) — drop the oldest first.
  while (secrets.length >= 2) {
    const victim = secrets.find((s) => s.status !== 'ACTIVE') ?? secrets[0];
    await deactivateAndDelete(appId, victim.id, victim.status);
    secrets = await okta<AppSecret[]>(
      'GET',
      `/apps/${appId}/credentials/secrets`
    );
  }
  const created = await okta<AppSecret>(
    'POST',
    `/apps/${appId}/credentials/secrets`
  );
  if (!created.client_secret)
    throw new Error('secret creation returned no client_secret value');
  // Delete all older secrets, leaving only the fresh one.
  const remaining = await okta<AppSecret[]>(
    'GET',
    `/apps/${appId}/credentials/secrets`
  );
  for (const s of remaining) {
    if (s.id !== created.id) await deactivateAndDelete(appId, s.id, s.status);
  }
  return created.client_secret;
}

async function main() {
  // ---- Locate the default authorization server ----
  console.log(`==> Locating '${AS_NAME}' authorization server`);
  const servers = await okta<NamedId[]>('GET', '/authorizationServers');
  const as = servers.find((s) => s.name === AS_NAME);
  if (!as) throw new Error(`No authorization server named '${AS_NAME}'`);
  console.log(`    AS id: ${as.id}`);

  // ---- 1. Custom scopes ----
  console.log('==> Ensuring custom scopes');
  const existingScopes = await okta<NamedId[]>(
    'GET',
    `/authorizationServers/${as.id}/scopes`
  );
  for (const name of SCOPES) {
    const found = existingScopes.find((s) => s.name === name);
    if (found) {
      console.log(`    scope '${name}' already exists (${found.id})`);
    } else {
      const created = await okta<NamedId>(
        'POST',
        `/authorizationServers/${as.id}/scopes`,
        {
          name,
          description: 'MCP conformance test scope',
          consent: 'IMPLICIT',
          metadataPublish: 'ALL_CLIENTS'
        }
      );
      console.log(`    scope '${name}' created (${created.id})`);
    }
  }

  // ---- 2. client_credentials app ----
  console.log(`==> Ensuring app '${APP_LABEL}'`);
  const apps = await okta<NamedId[]>(
    'GET',
    `/apps?q=${encodeURIComponent(APP_LABEL)}&limit=50`
  );
  let appId = apps.find((a) => a.label === APP_LABEL)?.id;
  if (appId) {
    console.log(`    app already exists (${appId}) — reusing`);
  } else {
    const created = await okta<NamedId>('POST', '/apps', {
      name: 'oidc_client',
      label: APP_LABEL,
      signOnMode: 'OPENID_CONNECT',
      credentials: {
        oauthClient: { token_endpoint_auth_method: 'client_secret_basic' }
      },
      settings: {
        oauthClient: {
          application_type: 'service',
          grant_types: ['client_credentials'],
          response_types: ['token']
        }
      }
    });
    appId = created.id;
    console.log(`    app created (${appId})`);
  }

  const app = await okta<{
    credentials: { oauthClient: { client_id: string } };
  }>('GET', `/apps/${appId}`);
  const clientId = app.credentials.oauthClient.client_id;

  console.log('==> Resetting client secret (prune to one known-good secret)');
  const clientSecret = await resetSecret(appId);
  console.log('    fresh secret minted; older secrets removed');

  // ---- 3. Dedicated access policy + rule for this client ----
  console.log(`==> Ensuring access policy '${POLICY_NAME}'`);
  const policies = await okta<NamedId[]>(
    'GET',
    `/authorizationServers/${as.id}/policies`
  );
  let policyId = policies.find((p) => p.name === POLICY_NAME)?.id;
  if (policyId) {
    console.log(`    policy already exists (${policyId})`);
  } else {
    const created = await okta<NamedId>(
      'POST',
      `/authorizationServers/${as.id}/policies`,
      {
        type: 'OAUTH_AUTHORIZATION_POLICY',
        status: 'ACTIVE',
        name: POLICY_NAME,
        description: 'MCP conformance client_credentials',
        conditions: { clients: { include: [clientId] } }
      }
    );
    policyId = created.id;
    console.log(`    policy created (${policyId})`);
  }

  const ruleBody = {
    type: 'RESOURCE_ACCESS',
    status: 'ACTIVE',
    name: 'mcpdev-cc-rule',
    conditions: {
      grantTypes: { include: ['client_credentials'] },
      scopes: { include: [...SCOPES] }
    },
    actions: {
      token: {
        accessTokenLifetimeMinutes: 60,
        refreshTokenLifetimeMinutes: 0,
        refreshTokenWindowMinutes: 10080
      }
    }
  };
  const rules = await okta<NamedId[]>(
    'GET',
    `/authorizationServers/${as.id}/policies/${policyId}/rules`
  );
  const existingRule = rules.find((r) => r.name === 'mcpdev-cc-rule');
  if (existingRule) {
    await okta(
      'PUT',
      `/authorizationServers/${as.id}/policies/${policyId}/rules/${existingRule.id}`,
      ruleBody
    );
    console.log(`    policy rule updated (scopes: ${SCOPES.join(', ')})`);
  } else {
    await okta(
      'POST',
      `/authorizationServers/${as.id}/policies/${policyId}/rules`,
      ruleBody
    );
    console.log(`    policy rule created (scopes: ${SCOPES.join(', ')})`);
  }

  // ---- Output: write gitignored okta.env ----
  const issuer = `${ORG}/oauth2/${AS_NAME}`;
  const envPath = new URL('./okta.env', import.meta.url);
  const envBody = [
    '# Gitignored. Okta fixture config for the SEP-2350 scope-challenge scenario.',
    '# Regenerate with: npx tsx examples/auth-fixtures/okta/provision.ts',
    `export OKTA_ISSUER="${issuer}"`,
    `export OKTA_CLIENT_ID="${clientId}"`,
    `export OKTA_CLIENT_SECRET="${clientSecret}"`,
    ''
  ].join('\n');
  writeFileSync(envPath, envBody, { mode: 0o600 });

  console.log('\n==> Done. Wrote okta.env (mode 600):');
  console.log(`    ISSUER=${issuer}`);
  console.log(`    CLIENT_ID=${clientId}`);
  console.log('    CLIENT_SECRET=<written to okta.env>');
  console.log(
    '\n    Next: source okta.env && npx tsx examples/auth-fixtures/okta/tokens.ts'
  );
}

main().catch((err) => {
  console.error(`\nProvisioning failed: ${err.message}`);
  process.exit(1);
});
