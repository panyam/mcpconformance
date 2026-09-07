#!/usr/bin/env -S npx tsx
/**
 * Tear down everything provision.ts created in the Okta tenant: the MCPDev app,
 * the mcpdev-cc access policy, and the custom scopes. Idempotent — skips
 * anything already gone. Leaves the tenant as it was before provisioning.
 *
 * Env: OKTA_ORG_URL, OKTA_API_TOKEN (same SSWS token used to provision).
 * Usage: npx tsx examples/auth-fixtures/okta/deprovision.ts
 */

const ORG = requireEnv('OKTA_ORG_URL').replace(/\/$/, '');
const TOKEN = requireEnv('OKTA_API_TOKEN');
const APP_LABEL = process.env.OKTA_APP_LABEL ?? 'MCPDev';
const AS_NAME = 'default';
const SCOPES = ['tools-read', 'tools-call', 'admin-write', 'admin'];
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
  path: string
): Promise<T | undefined> {
  const res = await fetch(`${ORG}/api/v1${path}`, {
    method,
    headers: { Authorization: `SSWS ${TOKEN}`, Accept: 'application/json' }
  });
  const text = await res.text();
  if (!res.ok) {
    const summary =
      (text ? JSON.parse(text) : {})?.errorSummary ?? res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${summary}`);
  }
  return text ? (JSON.parse(text) as T) : undefined;
}

interface NamedId {
  id: string;
  name?: string;
  label?: string;
}

async function main() {
  const servers = (await okta<NamedId[]>('GET', '/authorizationServers'))!;
  const as = servers.find((s) => s.name === AS_NAME);
  if (!as) {
    console.log(`No '${AS_NAME}' authorization server; nothing to tear down.`);
    return;
  }

  // App (deactivate before delete)
  const apps = (await okta<NamedId[]>(
    'GET',
    `/apps?q=${encodeURIComponent(APP_LABEL)}&limit=50`
  ))!;
  const app = apps.find((a) => a.label === APP_LABEL);
  if (app) {
    await okta('POST', `/apps/${app.id}/lifecycle/deactivate`);
    await okta('DELETE', `/apps/${app.id}`);
    console.log(`    deleted app '${APP_LABEL}' (${app.id})`);
  } else {
    console.log(`    app '${APP_LABEL}' already gone`);
  }

  // Policy (removing the policy removes its rules)
  const policies = (await okta<NamedId[]>(
    'GET',
    `/authorizationServers/${as.id}/policies`
  ))!;
  const policy = policies.find((p) => p.name === POLICY_NAME);
  if (policy) {
    await okta(
      'DELETE',
      `/authorizationServers/${as.id}/policies/${policy.id}`
    );
    console.log(`    deleted policy '${POLICY_NAME}' (${policy.id})`);
  } else {
    console.log(`    policy '${POLICY_NAME}' already gone`);
  }

  // Scopes
  const scopes = (await okta<NamedId[]>(
    'GET',
    `/authorizationServers/${as.id}/scopes`
  ))!;
  for (const name of SCOPES) {
    const s = scopes.find((x) => x.name === name);
    if (s) {
      await okta('DELETE', `/authorizationServers/${as.id}/scopes/${s.id}`);
      console.log(`    deleted scope '${name}'`);
    }
  }

  console.log('\n==> Teardown complete. (okta.env can be removed manually.)');
}

main().catch((err) => {
  console.error(`\nDeprovision failed: ${err.message}`);
  process.exit(1);
});
