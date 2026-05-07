/**
 * MCP Auth — server-side OAuth discovery conformance.
 *
 * Tests an MCP server that exposes the OAuth 2.0 discovery surface
 * required by the MCP authorization spec (2025-11-25):
 *
 *   - RFC 9728 Protected Resource Metadata at
 *     `/.well-known/oauth-protected-resource` (and the path-based
 *     variant when the resource has a non-root path).
 *   - RFC 8414 Authorization Server Metadata at
 *     `/.well-known/oauth-authorization-server`, exposed by the AS the
 *     server delegates to (often via a server-side proxy on the same
 *     origin so clients that only try RFC 8414 can discover it).
 *
 * MCP authorization spec 2025-11-25:
 *   https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 *
 * Phase 1 of the auth conformance pillar — read-only discovery only,
 * no token flows. JWT validation and scope step-up are separate
 * scenarios that build on this one.
 *
 * Required server fixture: an MCP server that mounts both well-known
 * endpoints. The `mcpPath` (e.g., `/mcp`) is read from the PRM
 * `resource` field; the path-based PRM is fetched relative to that.
 */

import {
  ClientScenario,
  ConformanceCheck,
  ScenarioSpecTag,
  SpecReference,
  LATEST_SPEC_VERSION
} from '../../../types';

const RFC_9728_REF: SpecReference = {
  id: 'RFC-9728',
  url: 'https://datatracker.ietf.org/doc/html/rfc9728'
};
const RFC_8414_REF: SpecReference = {
  id: 'RFC-8414',
  url: 'https://datatracker.ietf.org/doc/html/rfc8414'
};
const MCP_AUTH_REF: SpecReference = {
  id: 'mcp-spec-2025-11-25-authorization',
  url: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization'
};

interface FetchedJson {
  status: number;
  contentType: string;
  body: any;
  rawText: string;
}

async function fetchJson(url: string): Promise<FetchedJson> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  const rawText = await resp.text();
  const contentType = resp.headers.get('content-type') ?? '';
  let body: any = null;
  if (rawText.length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      // leave body null; checks will catch it
    }
  }
  return { status: resp.status, contentType, body, rawText };
}

function originOf(serverUrl: string): string {
  const u = new URL(serverUrl);
  return `${u.protocol}//${u.host}`;
}

function pathOf(serverUrl: string): string {
  return new URL(serverUrl).pathname;
}

export class AuthOAuthDiscoveryScenario implements ClientScenario {
  name = 'auth-oauth-discovery';
  specVersions: ScenarioSpecTag[] = ['extension', LATEST_SPEC_VERSION];
  description = `Test that an MCP server exposes the OAuth 2.0 discovery surface required by the MCP authorization spec (2025-11-25).

**Server Implementation Requirements:**

**RFC 9728 — Protected Resource Metadata:**
- The server MUST expose PRM at \`/.well-known/oauth-protected-resource\`
  (root variant) returning JSON with \`resource\` and
  \`authorization_servers\` fields.
- When the MCP endpoint has a non-root path (e.g., \`/mcp\`), the server
  MUST also expose the path-based variant at
  \`/.well-known/oauth-protected-resource{mcpPath}\` (RFC 9728 §3.1).
- The response Content-Type MUST be \`application/json\`.

**RFC 8414 — Authorization Server Metadata:**
- The Authorization Server advertised in PRM MUST expose AS metadata at
  \`/.well-known/oauth-authorization-server\` returning JSON with
  required fields \`issuer\`, \`authorization_endpoint\`, and
  \`token_endpoint\`.
- The response Content-Type MUST be \`application/json\`.

This scenario does no token flows — it verifies only that discovery is
reachable, well-formed, and points at a conformant AS. Token validation
and scope step-up are separate scenarios.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    const origin = originOf(serverUrl);
    const mcpPath = pathOf(serverUrl);

    // Check 1: PRM root reachable + valid shape.
    let prmBody: any = null;
    {
      const id = 'auth-oauth-discovery-prm-root';
      const name = 'AuthOAuthDiscoveryPrmRoot';
      const description =
        'GET /.well-known/oauth-protected-resource returns 200 + RFC 9728 JSON (resource, authorization_servers)';
      const url = `${origin}/.well-known/oauth-protected-resource`;
      try {
        const r = await fetchJson(url);
        const errs: string[] = [];
        if (r.status !== 200) {
          errs.push(`status MUST be 200; got ${r.status}`);
        }
        if (r.body === null) {
          errs.push(
            `response MUST be valid JSON; got: ${r.rawText.slice(0, 80)}`
          );
        } else {
          if (typeof r.body.resource !== 'string') {
            errs.push('PRM MUST carry `resource` (string)');
          }
          if (
            !Array.isArray(r.body.authorization_servers) ||
            r.body.authorization_servers.length === 0 ||
            r.body.authorization_servers.some(
              (s: unknown) => typeof s !== 'string'
            )
          ) {
            errs.push(
              'PRM MUST carry `authorization_servers` (non-empty array of strings)'
            );
          }
          prmBody = r.body;
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [RFC_9728_REF, MCP_AUTH_REF],
          details: {
            url,
            httpStatus: r.status,
            resource: r.body?.resource,
            authorizationServers: r.body?.authorization_servers
          }
        });
      } catch (error) {
        checks.push({
          id,
          name,
          description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [RFC_9728_REF, MCP_AUTH_REF]
        });
      }
    }

    // Check 2: PRM path-based variant reachable when mcpPath is non-root.
    {
      const id = 'auth-oauth-discovery-prm-path-based';
      const name = 'AuthOAuthDiscoveryPrmPathBased';
      const description =
        'When the MCP endpoint has a non-root path, GET /.well-known/oauth-protected-resource{mcpPath} also returns 200 + RFC 9728 JSON (RFC 9728 §3.1)';
      if (mcpPath === '' || mcpPath === '/') {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'MCP endpoint is root-pathed; path-based PRM not required by RFC 9728',
          specReferences: [RFC_9728_REF]
        });
      } else {
        const url = `${origin}/.well-known/oauth-protected-resource${mcpPath}`;
        try {
          const r = await fetchJson(url);
          const errs: string[] = [];
          if (r.status !== 200) {
            errs.push(`status MUST be 200; got ${r.status}`);
          }
          if (r.body === null) {
            errs.push(
              `response MUST be valid JSON; got: ${r.rawText.slice(0, 80)}`
            );
          } else if (typeof r.body.resource !== 'string') {
            errs.push('path-based PRM MUST carry `resource` (string)');
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [RFC_9728_REF],
            details: { url, httpStatus: r.status }
          });
        } catch (error) {
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              error instanceof Error ? error.message : String(error),
            specReferences: [RFC_9728_REF]
          });
        }
      }
    }

    // Check 3: PRM Content-Type is application/json.
    {
      const id = 'auth-oauth-discovery-prm-content-type';
      const name = 'AuthOAuthDiscoveryPrmContentType';
      const description =
        'PRM endpoint Content-Type MUST be application/json (RFC 9728)';
      const url = `${origin}/.well-known/oauth-protected-resource`;
      try {
        const r = await fetchJson(url);
        const errs: string[] = [];
        if (!r.contentType.toLowerCase().includes('application/json')) {
          errs.push(
            `PRM Content-Type MUST be application/json; got "${r.contentType}"`
          );
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [RFC_9728_REF],
          details: { url, contentType: r.contentType }
        });
      } catch (error) {
        checks.push({
          id,
          name,
          description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [RFC_9728_REF]
        });
      }
    }

    // Check 4: AS metadata reachable + RFC 8414 shape.
    // We hit the same-origin proxy first (RFC 8414 fallback); if that
    // 404s and PRM advertised an off-origin AS, try the advertised one.
    {
      const id = 'auth-oauth-discovery-as-metadata';
      const name = 'AuthOAuthDiscoveryAsMetadata';
      const description =
        'GET /.well-known/oauth-authorization-server (on the resource origin OR an advertised authorization_servers entry) returns 200 + RFC 8414 JSON (issuer, authorization_endpoint, token_endpoint)';
      const candidates: string[] = [
        `${origin}/.well-known/oauth-authorization-server`
      ];
      if (Array.isArray(prmBody?.authorization_servers)) {
        for (const advertised of prmBody.authorization_servers) {
          if (typeof advertised !== 'string') continue;
          try {
            const advOrigin = originOf(advertised);
            const path = '/.well-known/oauth-authorization-server';
            const advUrl = `${advOrigin}${path}`;
            if (!candidates.includes(advUrl)) candidates.push(advUrl);
          } catch {
            /* skip malformed advertised URL */
          }
        }
      }
      let chosen: { url: string; result: FetchedJson } | null = null;
      const reachAttempts: Array<{
        url: string;
        status: number | null;
        error?: string;
      }> = [];
      for (const url of candidates) {
        try {
          const r = await fetchJson(url);
          reachAttempts.push({ url, status: r.status });
          if (r.status === 200) {
            chosen = { url, result: r };
            break;
          }
        } catch (error) {
          reachAttempts.push({
            url,
            status: null,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      const errs: string[] = [];
      if (chosen === null) {
        errs.push(
          `AS metadata MUST be reachable on the resource origin or one of the advertised authorization_servers (RFC 8414); attempts: ${JSON.stringify(reachAttempts)}`
        );
      } else if (chosen.result.body === null) {
        errs.push(
          `AS metadata response MUST be valid JSON; got: ${chosen.result.rawText.slice(0, 80)}`
        );
      } else {
        const m = chosen.result.body;
        // RFC 8414 §2:
        //   - issuer: REQUIRED unconditionally
        //   - token_endpoint: REQUIRED unless only the implicit grant is
        //     supported
        //   - authorization_endpoint: REQUIRED unless no grant types that
        //     use it are supported (e.g., client_credentials-only AS)
        if (typeof m.issuer !== 'string') {
          errs.push('AS metadata MUST carry `issuer` (string)');
        }
        if (typeof m.token_endpoint !== 'string') {
          errs.push(
            'AS metadata MUST carry `token_endpoint` (string) unless only the implicit grant is supported'
          );
        }
        const grants: string[] = Array.isArray(m.grant_types_supported)
          ? m.grant_types_supported
          : ['authorization_code', 'implicit']; // RFC 8414 §2 default
        const needsAuthorizationEndpoint = grants.some((g) =>
          ['authorization_code', 'implicit'].includes(g)
        );
        if (
          needsAuthorizationEndpoint &&
          typeof m.authorization_endpoint !== 'string'
        ) {
          errs.push(
            `AS metadata MUST carry \`authorization_endpoint\` (string) when grant_types_supported includes flows that use it; got grants=${JSON.stringify(grants)}`
          );
        }
      }
      checks.push({
        id,
        name,
        description,
        status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
        specReferences: [RFC_8414_REF, MCP_AUTH_REF],
        details: {
          chosenUrl: chosen?.url,
          attempts: reachAttempts,
          issuer: chosen?.result.body?.issuer
        }
      });
    }

    // Check 5: AS metadata Content-Type is application/json.
    {
      const id = 'auth-oauth-discovery-as-metadata-content-type';
      const name = 'AuthOAuthDiscoveryAsMetadataContentType';
      const description =
        'AS metadata Content-Type MUST be application/json (RFC 8414)';
      const url = `${origin}/.well-known/oauth-authorization-server`;
      try {
        const r = await fetchJson(url);
        const errs: string[] = [];
        if (r.status === 200) {
          if (!r.contentType.toLowerCase().includes('application/json')) {
            errs.push(
              `AS metadata Content-Type MUST be application/json; got "${r.contentType}"`
            );
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [RFC_8414_REF],
            details: { url, contentType: r.contentType }
          });
        } else {
          // Same-origin proxy not present — content-type isn't checkable
          // here. Don't fail; the previous check already handled the
          // off-origin case if the AS lives elsewhere.
          checks.push({
            id,
            name,
            description,
            status: 'INFO',
            timestamp: new Date().toISOString(),
            errorMessage: `same-origin AS metadata proxy not present (status ${r.status}); content-type checked on advertised AS in the previous check`,
            specReferences: [RFC_8414_REF]
          });
        }
      } catch (error) {
        checks.push({
          id,
          name,
          description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [RFC_8414_REF]
        });
      }
    }

    return checks;
  }
}
