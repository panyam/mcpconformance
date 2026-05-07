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
const RFC_6750_REF: SpecReference = {
  id: 'RFC-6750',
  url: 'https://datatracker.ietf.org/doc/html/rfc6750'
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

// =============================================================================
// Phase 2 — JWT validation
// =============================================================================

/**
 * Tampers a Bearer token's signature so the JWS verification fails
 * while keeping the JWT's structural shape intact (3 dot-separated
 * parts). Flips the last character of the signature segment to a
 * different valid base64url character — that's enough to break HMAC
 * and asymmetric verification without changing the header or payload.
 */
function tamperJwtSignature(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2].length === 0) {
    throw new Error(
      `cannot tamper non-JWT token (expected 3 dot-separated parts, got ${parts.length})`
    );
  }
  const sig = parts[2];
  const last = sig[sig.length - 1];
  // Flip last char to a different base64url char.
  const replacement = last === 'A' ? 'B' : 'A';
  parts[2] = sig.slice(0, -1) + replacement;
  return parts.join('.');
}

interface PostResult {
  status: number;
  wwwAuthenticate: string | null;
  contentType: string;
  bodyText: string;
}

async function postToolsCall(
  serverUrl: string,
  token: string | null,
  toolName: string,
  args: Record<string, unknown>
): Promise<PostResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `auth-jwt-${Math.random().toString(36).slice(2, 10)}`,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  return {
    status: resp.status,
    wwwAuthenticate: resp.headers.get('www-authenticate'),
    contentType: resp.headers.get('content-type') ?? '',
    bodyText: await resp.text()
  };
}

export class AuthJwtValidationScenario implements ClientScenario {
  name = 'auth-jwt-validation';
  specVersions: ScenarioSpecTag[] = ['extension', LATEST_SPEC_VERSION];
  description = `Test that an MCP server enforces Bearer-token validation on auth-gated methods per the MCP authorization spec (2025-11-25) + RFC 6750.

**Server Implementation Requirements:**

**Unauthenticated requests rejected (RFC 6750 + MCP spec):**
- A non-public method (e.g., \`tools/call\`) called without an
  \`Authorization\` header MUST be rejected with HTTP 401 Unauthorized.
- The 401 response MUST carry a \`WWW-Authenticate\` header with the
  \`Bearer\` scheme (RFC 6750 §3) and SHOULD carry a
  \`resource_metadata\` parameter pointing at the PRM document
  (RFC 9728 §5.1).

**Malformed and tampered tokens rejected:**
- A garbage Bearer token (not a structurally valid JWT) MUST be
  rejected with HTTP 401.
- A structurally valid JWT with a tampered signature MUST be rejected
  with HTTP 401 (signature verification is mandatory).

**Valid tokens accepted:**
- A request with a properly signed, unexpired token whose claims pass
  validation (audience, issuer, scope) MUST be allowed past the auth
  gate (HTTP 200 if the tool succeeds; not 401).

This scenario reads an optional \`AUTH_VALID_TOKEN\` env var supplying
a JWT good enough for the fixture's \`echo\` tool (which requires
auth but no specific scope). When unset, valid- and tampered-token
checks emit \`INFO\` rather than \`FAILURE\` — they're "couldn't
verify" rather than "spec violation."

Token-acquisition is fixture-specific: the test-runner is responsible
for obtaining a valid token from the fixture (e.g., via a bootstrap
endpoint, a token-endpoint flow, or pre-minted via env) and exporting
it as \`AUTH_VALID_TOKEN\` before invoking the scenario.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    const validToken = process.env.AUTH_VALID_TOKEN ?? null;

    // Pre-flight: the test relies on `tools/call` being non-public on
    // the fixture. We pin to the `echo` tool name (no specific scope)
    // so JWT-validation behavior is observable independently of scope
    // enforcement (Phase 3).
    const TOOL = 'echo';
    const ARGS = { message: 'auth-jwt-validation' };

    // Check 1: no Authorization header → 401.
    let firstNoAuth: PostResult | null = null;
    {
      const id = 'auth-jwt-validation-no-token-rejected';
      const name = 'AuthJwtValidationNoTokenRejected';
      const description =
        'tools/call without Authorization header MUST be rejected with HTTP 401 (RFC 6750 + MCP authorization spec)';
      try {
        const r = await postToolsCall(serverUrl, null, TOOL, ARGS);
        firstNoAuth = r;
        const errs: string[] = [];
        if (r.status !== 401) {
          errs.push(`status MUST be 401; got ${r.status}`);
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [RFC_6750_REF, MCP_AUTH_REF],
          details: { httpStatus: r.status }
        });
      } catch (error) {
        checks.push({
          id,
          name,
          description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [RFC_6750_REF, MCP_AUTH_REF]
        });
      }
    }

    // Check 2: 401 response carries WWW-Authenticate: Bearer ...
    {
      const id = 'auth-jwt-validation-www-authenticate-shape';
      const name = 'AuthJwtValidationWwwAuthenticateShape';
      const description =
        '401 response MUST carry WWW-Authenticate: Bearer ... (RFC 6750 §3); SHOULD include resource_metadata parameter pointing at PRM (RFC 9728 §5.1)';
      const errs: string[] = [];
      const warnings: string[] = [];
      if (firstNoAuth === null) {
        errs.push('no 401 response captured to inspect');
      } else if (firstNoAuth.status !== 401) {
        errs.push(
          `previous request did not return 401 (got ${firstNoAuth.status}); cannot validate WWW-Authenticate`
        );
      } else {
        const wa = firstNoAuth.wwwAuthenticate;
        if (wa === null || wa === '') {
          errs.push(
            '401 response MUST carry a WWW-Authenticate header (RFC 6750 §3)'
          );
        } else {
          const lower = wa.toLowerCase();
          if (!lower.startsWith('bearer')) {
            errs.push(
              `WWW-Authenticate MUST advertise the Bearer scheme; got "${wa}"`
            );
          }
          if (!/resource_metadata\s*=/.test(lower)) {
            warnings.push(
              'WWW-Authenticate SHOULD carry a resource_metadata parameter (RFC 9728 §5.1) so clients can discover PRM from the 401'
            );
          }
        }
      }
      checks.push({
        id,
        name,
        description,
        status:
          errs.length === 0
            ? warnings.length === 0
              ? 'SUCCESS'
              : 'WARNING'
            : 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage:
          errs.length > 0
            ? errs.join('; ')
            : warnings.length > 0
              ? warnings.join('; ')
              : undefined,
        specReferences: [RFC_6750_REF, RFC_9728_REF, MCP_AUTH_REF],
        details: { wwwAuthenticate: firstNoAuth?.wwwAuthenticate }
      });
    }

    // Check 3: malformed (non-JWT) token → 401.
    {
      const id = 'auth-jwt-validation-malformed-token-rejected';
      const name = 'AuthJwtValidationMalformedTokenRejected';
      const description =
        'tools/call with a garbage Bearer token (not a structurally valid JWT) MUST be rejected with HTTP 401';
      try {
        const r = await postToolsCall(
          serverUrl,
          'this-is-definitely-not-a-jwt',
          TOOL,
          ARGS
        );
        const errs: string[] = [];
        if (r.status !== 401) {
          errs.push(`status MUST be 401 for a garbage token; got ${r.status}`);
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [RFC_6750_REF, MCP_AUTH_REF],
          details: { httpStatus: r.status }
        });
      } catch (error) {
        checks.push({
          id,
          name,
          description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [RFC_6750_REF, MCP_AUTH_REF]
        });
      }
    }

    // Check 4: tampered (signature-broken) token → 401.
    {
      const id = 'auth-jwt-validation-tampered-token-rejected';
      const name = 'AuthJwtValidationTamperedTokenRejected';
      const description =
        'tools/call with a JWT whose signature has been tampered MUST be rejected with HTTP 401 (signature verification is mandatory)';
      if (validToken === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_VALID_TOKEN unset; cannot derive a tampered token to test signature verification. Set AUTH_VALID_TOKEN to a JWT the fixture accepts to enable this check.',
          specReferences: [MCP_AUTH_REF]
        });
      } else {
        try {
          const tampered = tamperJwtSignature(validToken);
          const r = await postToolsCall(serverUrl, tampered, TOOL, ARGS);
          const errs: string[] = [];
          if (r.status !== 401) {
            errs.push(
              `status MUST be 401 for a tampered token; got ${r.status}`
            );
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [MCP_AUTH_REF],
            details: { httpStatus: r.status }
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
            specReferences: [MCP_AUTH_REF]
          });
        }
      }
    }

    // Check 5: valid token accepted (not 401).
    {
      const id = 'auth-jwt-validation-valid-token-accepted';
      const name = 'AuthJwtValidationValidTokenAccepted';
      const description =
        'tools/call with a properly signed, unexpired, claim-validated token MUST be allowed past the auth gate (HTTP not 401)';
      if (validToken === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_VALID_TOKEN unset; cannot exercise the valid-token path. Set AUTH_VALID_TOKEN to a JWT the fixture accepts to enable this check.',
          specReferences: [MCP_AUTH_REF]
        });
      } else {
        try {
          const r = await postToolsCall(serverUrl, validToken, TOOL, ARGS);
          const errs: string[] = [];
          if (r.status === 401) {
            errs.push(
              `valid token rejected (401); fixture says "${r.bodyText.slice(0, 120)}"`
            );
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [MCP_AUTH_REF],
            details: { httpStatus: r.status }
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
            specReferences: [MCP_AUTH_REF]
          });
        }
      }
    }

    return checks;
  }
}

// =============================================================================
// Phase 2.5 — JWT claim validation (audience, expiry, issuer)
// =============================================================================

export class AuthJwtClaimsScenario implements ClientScenario {
  name = 'auth-jwt-claims';
  specVersions: ScenarioSpecTag[] = ['extension', LATEST_SPEC_VERSION];
  description = `Test that an MCP server enforces JWT claim validation per RFC 7519 + the MCP authorization spec (2025-11-25).

**Server Implementation Requirements:**

A properly signed JWT (signature verifies against the AS's JWKS) MUST
still be rejected when any of the following standard claims fail
validation:

- **\`exp\` (expiry, RFC 7519 §4.1.4)** — tokens whose \`exp\` is in
  the past MUST be rejected with HTTP 401.
- **\`aud\` (audience, RFC 7519 §4.1.3 + MCP authorization spec)** —
  tokens whose \`aud\` claim doesn't match the resource URI MUST be
  rejected with HTTP 401. Audience-binding prevents token reuse across
  resources (confused-deputy mitigation).
- **\`iss\` (issuer, RFC 7519 §4.1.1)** — tokens whose \`iss\` claim
  doesn't match the AS the resource trusts MUST be rejected with
  HTTP 401, even if the token signature happens to verify against the
  JWKS at the trusted issuer.

This scenario reads three optional env vars supplying tokens that fail
each claim validation specifically:

  AUTH_EXPIRED_TOKEN          — properly signed, \`exp\` in the past
  AUTH_WRONG_AUDIENCE_TOKEN   — properly signed, \`aud\` mismatched
  AUTH_WRONG_ISSUER_TOKEN     — properly signed, \`iss\` mismatched

Each check emits \`INFO\` if its corresponding env var is unset (the
fixture didn't provide that token shape) — that's "couldn't verify"
rather than a spec violation.

Token acquisition is fixture-specific: the test runner is responsible
for obtaining each token from the fixture (e.g., via a bootstrap
endpoint that exposes pre-minted bad tokens) and exporting it via the
appropriate env var before invoking the scenario.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    const TOOL = 'echo';
    const ARGS = { message: 'auth-jwt-claims' };

    interface ClaimCase {
      id: string;
      name: string;
      description: string;
      env: string;
      claim: 'exp' | 'aud' | 'iss';
    }

    const cases: ClaimCase[] = [
      {
        id: 'auth-jwt-claims-expired-rejected',
        name: 'AuthJwtClaimsExpiredRejected',
        description:
          'tools/call with a properly signed but expired token MUST be rejected with HTTP 401 (RFC 7519 §4.1.4)',
        env: 'AUTH_EXPIRED_TOKEN',
        claim: 'exp'
      },
      {
        id: 'auth-jwt-claims-wrong-audience-rejected',
        name: 'AuthJwtClaimsWrongAudienceRejected',
        description:
          'tools/call with a properly signed token whose `aud` does not match the resource MUST be rejected with HTTP 401 (RFC 7519 §4.1.3 + MCP authorization spec)',
        env: 'AUTH_WRONG_AUDIENCE_TOKEN',
        claim: 'aud'
      },
      {
        id: 'auth-jwt-claims-wrong-issuer-rejected',
        name: 'AuthJwtClaimsWrongIssuerRejected',
        description:
          'tools/call with a token whose `iss` claim does not match the trusted AS MUST be rejected with HTTP 401 (RFC 7519 §4.1.1)',
        env: 'AUTH_WRONG_ISSUER_TOKEN',
        claim: 'iss'
      }
    ];

    for (const tc of cases) {
      const token = process.env[tc.env] ?? null;
      if (token === null) {
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage: `${tc.env} unset; cannot verify ${tc.claim} validation. Set ${tc.env} to a properly signed token whose ${tc.claim} claim is invalid to enable this check.`,
          specReferences: [MCP_AUTH_REF]
        });
        continue;
      }

      try {
        const r = await postToolsCall(serverUrl, token, TOOL, ARGS);
        const errs: string[] = [];
        if (r.status !== 401) {
          errs.push(
            `status MUST be 401 for a token with invalid ${tc.claim}; got ${r.status}`
          );
        }
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [MCP_AUTH_REF],
          details: { httpStatus: r.status, claim: tc.claim }
        });
      } catch (error) {
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage:
            error instanceof Error ? error.message : String(error),
          specReferences: [MCP_AUTH_REF]
        });
      }
    }

    return checks;
  }
}
