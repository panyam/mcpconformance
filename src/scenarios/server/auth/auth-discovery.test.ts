import { describe, test, expect, afterEach } from 'vitest';
import { testContext } from '../../../connection/testing';
import { AuthOAuthDiscoveryScenario } from './auth';
import type { ConformanceCheck } from '../../../types';

/**
 * Pins how auth-oauth-discovery grades the two PRM well-known locations
 * (RFC 9728 §3.1 path URL, MCP 2025-11-25 root fallback) without a live
 * fixture: global fetch is replaced by a route table.
 */

const ORIGIN = 'http://mock-auth-server.local';

interface Route {
  status?: number;
  contentType?: string;
  body: unknown;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockRoutes(routes: Record<string, Route>) {
  global.fetch = (async (url: any) => {
    const route = routes[new URL(String(url)).pathname];
    const status = route ? (route.status ?? 200) : 404;
    const contentType = route
      ? (route.contentType ?? 'application/json')
      : 'text/plain';
    const text = route ? JSON.stringify(route.body) : 'not found';
    return {
      status,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === 'content-type' ? contentType : null
      },
      text: async () => text
    } as unknown as Response;
  }) as typeof fetch;
}

const AS_METADATA: Route = {
  body: {
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}/authorize`,
    token_endpoint: `${ORIGIN}/token`
  }
};

function prm(resource: string): Route {
  return { body: { resource, authorization_servers: [ORIGIN] } };
}

function check(checks: ConformanceCheck[], id: string): ConformanceCheck {
  const found = checks.filter((c) => c.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('auth-oauth-discovery — PRM well-known locations', () => {
  test('path-only server for a pathed resource passes', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource/mcp': prm(`${ORIGIN}/mcp`),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );

    const root = check(checks, 'auth-oauth-discovery-prm-root');
    expect(root.status).toBe('SUCCESS');
    expect(String(root.details?.note)).toContain('not required');
    expect(check(checks, 'auth-oauth-discovery-prm-path-based').status).toBe(
      'SUCCESS'
    );
    expect(check(checks, 'auth-oauth-discovery-as-metadata').status).toBe(
      'SUCCESS'
    );
    expect(
      checks.filter((c) => c.status === 'FAILURE' || c.status === 'WARNING')
    ).toEqual([]);
  });

  test('root-only server for a root resource passes', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource': prm(`${ORIGIN}/`),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/`)
    );

    expect(check(checks, 'auth-oauth-discovery-prm-root').status).toBe(
      'SUCCESS'
    );
    expect(check(checks, 'auth-oauth-discovery-prm-path-based').status).toBe(
      'INFO'
    );
    expect(check(checks, 'auth-oauth-discovery-prm-content-type').status).toBe(
      'SUCCESS'
    );
    expect(
      checks.filter((c) => c.status === 'FAILURE' || c.status === 'WARNING')
    ).toEqual([]);
  });

  test('root document carrying the path identifier is flagged (RFC 9728 §3.3)', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource/mcp': prm(`${ORIGIN}/mcp`),
      '/.well-known/oauth-protected-resource': prm(`${ORIGIN}/mcp`),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );

    const root = check(checks, 'auth-oauth-discovery-prm-root');
    expect(root.status).toBe('WARNING');
    expect(root.errorMessage).toContain('RFC 9728 §3.3');
    expect(root.errorMessage).toContain(`"${ORIGIN}/mcp"`);
    expect(check(checks, 'auth-oauth-discovery-prm-path-based').status).toBe(
      'SUCCESS'
    );
  });

  test('root document with the root identifier passes alongside the path document', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource/mcp': prm(`${ORIGIN}/mcp`),
      '/.well-known/oauth-protected-resource': prm(ORIGIN),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );
    expect(check(checks, 'auth-oauth-discovery-prm-root').status).toBe(
      'SUCCESS'
    );
  });

  test('pathed resource with neither document fails', async () => {
    mockRoutes({
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );
    expect(check(checks, 'auth-oauth-discovery-prm-root').status).toBe(
      'FAILURE'
    );
    expect(check(checks, 'auth-oauth-discovery-prm-path-based').status).toBe(
      'FAILURE'
    );
    expect(check(checks, 'auth-oauth-discovery-prm-content-type').status).toBe(
      'FAILURE'
    );
  });

  test('content-type is read from the path URL first', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource/mcp': {
        ...prm(`${ORIGIN}/mcp`),
        contentType: 'text/html'
      },
      '/.well-known/oauth-protected-resource': prm(ORIGIN),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );
    const ct = check(checks, 'auth-oauth-discovery-prm-content-type');
    expect(ct.status).toBe('FAILURE');
    expect(ct.details?.url).toBe(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp`
    );
  });

  test('content-type falls back to the root URL when the path URL is absent', async () => {
    mockRoutes({
      '/.well-known/oauth-protected-resource': prm(`${ORIGIN}/mcp`),
      '/.well-known/oauth-authorization-server': AS_METADATA
    });
    const checks = await new AuthOAuthDiscoveryScenario().run(
      testContext(`${ORIGIN}/mcp`)
    );
    const ct = check(checks, 'auth-oauth-discovery-prm-content-type');
    expect(ct.status).toBe('SUCCESS');
    expect(ct.details?.url).toBe(
      `${ORIGIN}/.well-known/oauth-protected-resource`
    );
  });
});
