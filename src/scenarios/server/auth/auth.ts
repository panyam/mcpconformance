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
  readonly source = { introducedIn: LATEST_SPEC_VERSION } as const;
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
 * parts) AND keeping the signature segment a structurally valid
 * base64url-encoded byte string.
 *
 * We flip a character in the MIDDLE of the signature segment — middle
 * chars represent full 6-bit base64 groups, so any flip among the
 * base64url alphabet [A-Za-z0-9_-] yields another valid 6-bit group
 * (the resulting decoded bytes simply won't match the expected
 * signature, giving a clean "signature verification failed" rather
 * than a "malformed token" parse error).
 *
 * Tampering the LAST character is unsafe: in an RS256 (256-byte)
 * signature the last base64 char encodes only the low 2 bits of the
 * final byte plus 4 padding bits — only chars whose binary is XX0000
 * (A/Q/g/w) are valid 1-byte tails. Other chars there make the
 * signature structurally invalid base64, which strict decoders reject
 * with HTTP 400 before signature verification runs.
 */
function tamperJwtSignature(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2].length === 0) {
    throw new Error(
      `cannot tamper non-JWT token (expected 3 dot-separated parts, got ${parts.length})`
    );
  }
  const sig = parts[2];
  const mid = Math.floor(sig.length / 2);
  const orig = sig[mid];
  const replacement = orig === 'A' ? 'B' : 'A';
  parts[2] = sig.slice(0, mid) + replacement + sig.slice(mid + 1);
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
  readonly source = { introducedIn: LATEST_SPEC_VERSION } as const;
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
  readonly source = { introducedIn: LATEST_SPEC_VERSION } as const;
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
          errorMessage: error instanceof Error ? error.message : String(error),
          specReferences: [MCP_AUTH_REF]
        });
      }
    }

    return checks;
  }
}

// =============================================================================
// Phase 3 — Scope step-up (SEP-2350 + RFC 6750 §3.1)
// =============================================================================

const SEP_2350_REF: SpecReference = {
  id: 'SEP-2350',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2350'
};

interface SessionInit {
  sessionId: string;
  status: number;
}

/**
 * Initialize an MCP session over Streamable HTTP. Returns the
 * `Mcp-Session-Id` header from the response. Drives the public
 * `initialize` method, which on the auth fixture is in the
 * public-methods allowlist (no auth required), but we send the token
 * anyway because realistic clients always carry their bearer token.
 */
async function initializeSession(
  serverUrl: string,
  token: string
): Promise<SessionInit> {
  const resp = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `init-${Math.random().toString(36).slice(2, 10)}`,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'auth-conformance', version: '1.0' }
      }
    })
  });
  // Drain body; we only need the session header.
  await resp.text();
  return {
    sessionId: resp.headers.get('mcp-session-id') ?? '',
    status: resp.status
  };
}

/**
 * Send a `tools/call` request on an existing session. Like
 * `postToolsCall` but additionally sets the `Mcp-Session-Id` header so
 * the dispatcher reaches scope middleware (which runs after session
 * resolution).
 */
async function postToolsCallWithSession(
  serverUrl: string,
  token: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<PostResult> {
  const resp = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'Mcp-Session-Id': sessionId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `step-up-${Math.random().toString(36).slice(2, 10)}`,
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

/**
 * Parse a single auth-param value out of an RFC 6750 WWW-Authenticate
 * header. Looks for `<key>=<value>` where value may be quoted with
 * double quotes. Returns the unquoted value or null when absent.
 *
 * Example: `Bearer error="insufficient_scope", scope="write"`
 *   getAuthParam(h, 'scope') === 'write'
 *   getAuthParam(h, 'error') === 'insufficient_scope'
 */
function getAuthParam(header: string, key: string): string | null {
  const re = new RegExp(`${key}\\s*=\\s*("([^"]*)"|([^\\s,]+))`, 'i');
  const m = header.match(re);
  if (!m) return null;
  // Match group 2 = quoted value (without quotes), group 3 = unquoted value
  return m[2] ?? m[3] ?? null;
}

export class AuthScopeStepUpScenario implements ClientScenario {
  name = 'auth-scope-step-up';
  readonly source = { introducedIn: LATEST_SPEC_VERSION } as const;
  description = `Test that an MCP server enforces per-tool scope requirements and advertises the missing scope in WWW-Authenticate per SEP-2350 + RFC 6750 §3.1.

**Server Implementation Requirements:**

When a client invokes a scope-gated method (e.g., \`tools/call\` for a
tool with declared required scopes) using a Bearer token whose
\`scope\` claim doesn't include the required scope:

- The server MUST reject the request with HTTP 403 Forbidden (RFC 6750
  §3.1 — distinct from HTTP 401 used for authentication failures).
- The 403 response MUST carry a \`WWW-Authenticate\` header with the
  \`Bearer\` scheme and:
  - \`error="insufficient_scope"\` (RFC 6750 §3.1) — the standard error
    code for scope failures.
  - \`scope="..."\` listing the missing scope (or the union of all
    scopes needed for the operation, per SEP-2350) — clients use this
    to drive scope step-up by acquiring a new token with the broader
    scope.
- When the same operation is invoked with a token whose scope claim
  includes the required scope, the server MUST allow the call past the
  scope gate (HTTP not 403).
- The advertised scope value MUST reflect the actual missing scope for
  the requested operation — different operations advertise different
  scopes.

This scenario reads three optional env vars supplying tokens at
different scope levels:

  AUTH_VALID_TOKEN       — minimal scope (\`read\` on the auth fixture)
  AUTH_READWRITE_TOKEN   — scope union for \`read\` + \`write\`
  AUTH_FULL_TOKEN        — scope union for \`read\` + \`write\` + \`admin\`

Each check emits \`INFO\` if its required token is unset.

The scenario also exercises a session-bound flow: tools/call requires
an initialized session (Mcp-Session-Id header), so each check
initializes a fresh session with its respective token before issuing
the scope-checked tools/call.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    const tokenRead = process.env.AUTH_VALID_TOKEN ?? null;
    const tokenReadWrite = process.env.AUTH_READWRITE_TOKEN ?? null;
    const tokenFull = process.env.AUTH_FULL_TOKEN ?? null;

    // Check 1: insufficient scope rejected with 403.
    let firstInsufficient: PostResult | null = null;
    {
      const id = 'auth-scope-step-up-insufficient-scope-rejected';
      const name = 'AuthScopeStepUpInsufficientScopeRejected';
      const description =
        'tools/call to a scope-gated tool with a Bearer token whose `scope` claim lacks the required scope MUST be rejected with HTTP 403 Forbidden (RFC 6750 §3.1)';
      if (tokenRead === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_VALID_TOKEN unset; cannot exercise scope-step-up rejection path. Set AUTH_VALID_TOKEN to a token whose scope claim is insufficient for `write-tool`.',
          specReferences: [SEP_2350_REF, RFC_6750_REF]
        });
      } else {
        try {
          const session = await initializeSession(serverUrl, tokenRead);
          if (!session.sessionId) {
            checks.push({
              id,
              name,
              description,
              status: 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: `initialize did not return Mcp-Session-Id (status ${session.status}); cannot drive scope check`,
              specReferences: [SEP_2350_REF]
            });
          } else {
            const r = await postToolsCallWithSession(
              serverUrl,
              tokenRead,
              session.sessionId,
              'write-tool',
              {}
            );
            firstInsufficient = r;
            const errs: string[] = [];
            if (r.status !== 403) {
              errs.push(
                `status MUST be 403 for insufficient scope; got ${r.status}`
              );
            }
            checks.push({
              id,
              name,
              description,
              status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
              specReferences: [SEP_2350_REF, RFC_6750_REF],
              details: { httpStatus: r.status }
            });
          }
        } catch (error) {
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              error instanceof Error ? error.message : String(error),
            specReferences: [SEP_2350_REF, RFC_6750_REF]
          });
        }
      }
    }

    // Check 2: 403 carries WWW-Authenticate with error="insufficient_scope".
    {
      const id = 'auth-scope-step-up-www-authenticate-error';
      const name = 'AuthScopeStepUpWwwAuthenticateError';
      const description =
        '403 response on insufficient scope MUST carry WWW-Authenticate: Bearer with error="insufficient_scope" (RFC 6750 §3.1)';
      const errs: string[] = [];
      if (firstInsufficient === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'no 403 response captured (Check 1 INFO/FAILURE); cannot validate WWW-Authenticate',
          specReferences: [RFC_6750_REF]
        });
      } else {
        const wa = firstInsufficient.wwwAuthenticate;
        if (wa === null || wa === '') {
          errs.push(
            '403 response MUST carry a WWW-Authenticate header (RFC 6750 §3.1)'
          );
        } else if (!/^bearer/i.test(wa.trim())) {
          errs.push(
            `WWW-Authenticate MUST advertise the Bearer scheme; got "${wa}"`
          );
        } else {
          const errParam = getAuthParam(wa, 'error');
          if (errParam !== 'insufficient_scope') {
            errs.push(
              `WWW-Authenticate MUST carry error="insufficient_scope" (RFC 6750 §3.1); got error=${JSON.stringify(errParam)}`
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
          specReferences: [RFC_6750_REF],
          details: { wwwAuthenticate: wa }
        });
      }
    }

    // Check 3: WWW-Authenticate advertises the missing scope.
    {
      const id = 'auth-scope-step-up-www-authenticate-advertises-scope';
      const name = 'AuthScopeStepUpWwwAuthenticateAdvertisesScope';
      const description =
        'WWW-Authenticate on insufficient-scope 403 MUST carry a `scope` parameter listing the missing scope (SEP-2350; clients use this to drive scope step-up)';
      const errs: string[] = [];
      if (firstInsufficient === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'no 403 response captured (Check 1 INFO/FAILURE); cannot validate scope advertisement',
          specReferences: [SEP_2350_REF, RFC_6750_REF]
        });
      } else {
        const wa = firstInsufficient.wwwAuthenticate ?? '';
        const scopeParam = getAuthParam(wa, 'scope');
        if (scopeParam === null || scopeParam === '') {
          errs.push(
            'WWW-Authenticate MUST carry a `scope` parameter so clients can drive step-up'
          );
        } else {
          // The advertised scope MUST contain the missing scope
          // (here: `write` for `write-tool`). Either verbatim or as
          // part of a space-separated union per SEP-2350.
          const advertised = scopeParam.split(/\s+/).filter(Boolean);
          if (!advertised.includes('write')) {
            errs.push(
              `WWW-Authenticate scope parameter MUST include the missing scope (\`write\`); got "${scopeParam}"`
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
          specReferences: [SEP_2350_REF, RFC_6750_REF],
          details: { advertisedScope: scopeParam }
        });
      }
    }

    // Check 4: sufficient scope accepted (not 403).
    {
      const id = 'auth-scope-step-up-sufficient-scope-accepted';
      const name = 'AuthScopeStepUpSufficientScopeAccepted';
      const description =
        'tools/call to a scope-gated tool with a Bearer token whose `scope` claim INCLUDES the required scope MUST NOT be rejected for scope reasons (HTTP not 403)';
      if (tokenReadWrite === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_READWRITE_TOKEN unset; cannot exercise scope-step-up acceptance path. Set AUTH_READWRITE_TOKEN to a token whose scope claim covers `read write`.',
          specReferences: [SEP_2350_REF]
        });
      } else {
        try {
          const session = await initializeSession(serverUrl, tokenReadWrite);
          if (!session.sessionId) {
            checks.push({
              id,
              name,
              description,
              status: 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: `initialize did not return Mcp-Session-Id (status ${session.status}); cannot drive scope check`,
              specReferences: [SEP_2350_REF]
            });
          } else {
            const r = await postToolsCallWithSession(
              serverUrl,
              tokenReadWrite,
              session.sessionId,
              'write-tool',
              {}
            );
            const errs: string[] = [];
            if (r.status === 403) {
              errs.push(
                `sufficient scope still rejected with 403; fixture says "${r.bodyText.slice(0, 120)}"`
              );
            }
            checks.push({
              id,
              name,
              description,
              status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
              specReferences: [SEP_2350_REF],
              details: { httpStatus: r.status }
            });
          }
        } catch (error) {
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              error instanceof Error ? error.message : String(error),
            specReferences: [SEP_2350_REF]
          });
        }
      }
    }

    // Check 5: scope advertisement varies by tool (admin-tool wants
    // `admin`, write-tool wants `write`). Sanity check that the server
    // is computing the missing scope per-operation, not advertising a
    // static placeholder.
    {
      const id = 'auth-scope-step-up-scope-varies-by-tool';
      const name = 'AuthScopeStepUpScopeVariesByTool';
      const description =
        'WWW-Authenticate `scope` parameter MUST reflect the actual scope required by the requested operation — different operations MUST advertise different scopes (SEP-2350)';
      if (tokenRead === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_VALID_TOKEN unset; cannot exercise scope-varies-by-tool sanity check.',
          specReferences: [SEP_2350_REF]
        });
      } else {
        try {
          const session = await initializeSession(serverUrl, tokenRead);
          if (!session.sessionId) {
            checks.push({
              id,
              name,
              description,
              status: 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: `initialize did not return Mcp-Session-Id (status ${session.status})`,
              specReferences: [SEP_2350_REF]
            });
          } else {
            const adminResp = await postToolsCallWithSession(
              serverUrl,
              tokenRead,
              session.sessionId,
              'admin-tool',
              {}
            );
            const errs: string[] = [];
            if (adminResp.status !== 403) {
              errs.push(
                `admin-tool with read-only token MUST return 403; got ${adminResp.status}`
              );
            } else {
              const adminScope = getAuthParam(
                adminResp.wwwAuthenticate ?? '',
                'scope'
              );
              const adminAdvertised = (adminScope ?? '')
                .split(/\s+/)
                .filter(Boolean);
              if (!adminAdvertised.includes('admin')) {
                errs.push(
                  `admin-tool advertised scope MUST include \`admin\`; got "${adminScope}"`
                );
              }
              // Compare with Check 1's write-tool advertisement.
              if (firstInsufficient !== null) {
                const writeScope = getAuthParam(
                  firstInsufficient.wwwAuthenticate ?? '',
                  'scope'
                );
                if (writeScope === adminScope) {
                  errs.push(
                    `admin-tool and write-tool advertised the same scope ("${adminScope}"); fixture is using a static placeholder rather than computing per-operation`
                  );
                }
              }
            }
            checks.push({
              id,
              name,
              description,
              status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
              timestamp: new Date().toISOString(),
              errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
              specReferences: [SEP_2350_REF],
              details: {
                adminToolScope: getAuthParam(
                  adminResp.wwwAuthenticate ?? '',
                  'scope'
                ),
                writeToolScope: getAuthParam(
                  firstInsufficient?.wwwAuthenticate ?? '',
                  'scope'
                )
              }
            });
          }
        } catch (error) {
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              error instanceof Error ? error.message : String(error),
            specReferences: [SEP_2350_REF]
          });
        }
      }
    }

    // Suppress unused-variable warning when AUTH_FULL_TOKEN isn't read
    // by this scenario directly. It's exposed for future Phase 3
    // scenarios that exercise admin-only flows.
    void tokenFull;

    return checks;
  }
}

// =============================================================================
// Phase 3b — RFC 9207 OAuth iss parameter (SEP-2468)
// =============================================================================
// Phase 3c — Enterprise-managed auth (RFC 8693 token-exchange + RFC 7523
//                                     JWT bearer)
// =============================================================================
//
// These two scenarios document the conformance surface up-front so the
// behavior is testable as soon as a fixture supports it. Today's
// reference fixture (mcpkit's examples/auth/) does not yet implement
// either RFC; the metadata-layer checks therefore emit SKIPPED with a
// link to the tracking issue, not FAILURE — that's "spec requirement,
// not yet supported by this fixture" rather than "spec violation."
//
// The flow-layer checks (driving an actual OAuth code redirect for
// RFC 9207, or a token-exchange call for RFC 8693) are stubbed as
// SKIPPED until the conformance suite grows an OAuth flow-driver.
// That driver is a meatier infrastructure decision that lands
// separately.
//
// As implementations land (mcpkit issues 380 / 381) the metadata
// checks flip from SKIPPED to SUCCESS based on the AS's advertised
// capabilities. The flow-layer checks flip when the driver lands.

const RFC_9207_REF: SpecReference = {
  id: 'RFC-9207',
  url: 'https://datatracker.ietf.org/doc/html/rfc9207'
};
const RFC_8693_REF: SpecReference = {
  id: 'RFC-8693',
  url: 'https://datatracker.ietf.org/doc/html/rfc8693'
};
const RFC_7523_REF: SpecReference = {
  id: 'RFC-7523',
  url: 'https://datatracker.ietf.org/doc/html/rfc7523'
};

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

interface AsMetadataFetch {
  body: any | null;
  chosenUrl: string | null;
  attempts: Array<{ url: string; status: number | null; error?: string }>;
}

/**
 * Discover the AS metadata for the resource at `serverUrl`. Tries the
 * resource's own origin first (RFC 8414 same-origin proxy is common);
 * if that 404s, falls back to each `authorization_servers` entry
 * advertised in the resource's PRM.
 */
async function fetchAsMetadata(serverUrl: string): Promise<AsMetadataFetch> {
  const origin = originOf(serverUrl);
  const attempts: AsMetadataFetch['attempts'] = [];

  // PRM gives us the off-origin AS candidates.
  let prmBody: any = null;
  try {
    const r = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
    if (r.status === 200 && r.body) prmBody = r.body;
  } catch {
    /* ignore — PRM unreachable, fall through to same-origin probe */
  }

  const candidates: string[] = [
    `${origin}/.well-known/oauth-authorization-server`
  ];
  if (Array.isArray(prmBody?.authorization_servers)) {
    for (const advertised of prmBody.authorization_servers) {
      if (typeof advertised !== 'string') continue;
      try {
        const advUrl = `${originOf(advertised)}/.well-known/oauth-authorization-server`;
        if (!candidates.includes(advUrl)) candidates.push(advUrl);
      } catch {
        /* skip malformed advertised URL */
      }
    }
  }

  for (const url of candidates) {
    try {
      const r = await fetchJson(url);
      attempts.push({ url, status: r.status });
      if (r.status === 200 && r.body) {
        return { body: r.body, chosenUrl: url, attempts };
      }
    } catch (error) {
      attempts.push({
        url,
        status: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { body: null, chosenUrl: null, attempts };
}

export class AuthIssParamScenario implements ClientScenario {
  name = 'auth-iss-param';
  readonly source = { introducedIn: LATEST_SPEC_VERSION } as const;
  description = `Test that an MCP server's Authorization Server implements RFC 9207 OAuth 2.0 Authorization Server Issuer Identification.

**Server Implementation Requirements:**

RFC 9207 mitigates mix-up attacks against clients that interact with
multiple Authorization Servers. The AS:

- MUST advertise \`authorization_response_iss_parameter_supported: true\`
  in its RFC 8414 metadata (RFC 9207 §3) so clients know to enforce
  iss validation.
- MUST include an \`iss\` query parameter (whose value is the AS's
  issuer identifier) on every authorization response — both successful
  redirects (with \`code\`) and error redirects.

**Phase 3b status:**

This scenario currently emits \`SKIPPED\` when the fixture's AS doesn't
advertise RFC 9207 support — that's "feature not yet supported, gap
tracked by mcpkit issue 380" rather than "spec violation." When the
AS adds the advertisement, this check flips to \`SUCCESS\`. The
end-to-end flow check (verifying \`iss\` actually appears in the
redirect) is currently stubbed as \`SKIPPED\` until the conformance
suite grows an OAuth code-flow driver.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    const meta = await fetchAsMetadata(serverUrl);

    // Check 1: AS metadata advertises RFC 9207 support.
    {
      const id = 'auth-iss-param-as-metadata-advertises-support';
      const name = 'AuthIssParamAsMetadataAdvertisesSupport';
      const description =
        'AS metadata MUST advertise `authorization_response_iss_parameter_supported: true` (RFC 9207 §3) so clients know to enforce iss validation';
      if (meta.body === null) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage: `AS metadata unreachable; cannot verify RFC 9207 advertisement. Attempts: ${JSON.stringify(meta.attempts)}`,
          specReferences: [RFC_9207_REF, RFC_8414_REF]
        });
      } else if (
        meta.body.authorization_response_iss_parameter_supported === true
      ) {
        checks.push({
          id,
          name,
          description,
          status: 'SUCCESS',
          timestamp: new Date().toISOString(),
          specReferences: [RFC_9207_REF, RFC_8414_REF],
          details: { chosenUrl: meta.chosenUrl }
        });
      } else {
        checks.push({
          id,
          name,
          description,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AS metadata does not advertise `authorization_response_iss_parameter_supported: true` — RFC 9207 not yet supported by this fixture. Tracked by mcpkit issue 380. Will flip to SUCCESS when the AS adds the advertisement.',
          specReferences: [RFC_9207_REF, RFC_8414_REF],
          details: {
            chosenUrl: meta.chosenUrl,
            advertisedValue:
              meta.body.authorization_response_iss_parameter_supported
          }
        });
      }
    }

    // Check 2: end-to-end iss in redirect — pending OAuth flow driver.
    {
      const id = 'auth-iss-param-redirect-carries-iss';
      const name = 'AuthIssParamRedirectCarriesIss';
      const description =
        'Authorization response (both successful and error redirects) MUST carry `iss` query parameter whose value is the AS issuer (RFC 9207 §2)';
      checks.push({
        id,
        name,
        description,
        status: 'SKIPPED',
        timestamp: new Date().toISOString(),
        errorMessage:
          'Driving an auth code flow to verify `iss` in the redirect requires an OAuth flow driver in the conformance test runner; not yet implemented. Will flip to SUCCESS / FAILURE when the driver lands. Tracked alongside mcpkit issue 380.',
        specReferences: [RFC_9207_REF]
      });
    }

    return checks;
  }
}

export class AuthEnterpriseManagedScenario implements ClientScenario {
  name = 'auth-enterprise-managed';
  readonly source = {
    extensionId: 'io.modelcontextprotocol/enterprise-managed-authorization'
  } as const;
  description = `Test that an MCP server's Authorization Server supports the OAuth grant types required for enterprise-managed identity flows: RFC 8693 token-exchange and RFC 7523 JWT bearer client/auth grant.

**Server Implementation Requirements:**

Enterprise-managed deployments typically chain a federated identity
JWT (issued by a corporate IdP) into an MCP-server access token via:

- **RFC 8693 OAuth 2.0 Token Exchange** —
  \`grant_type=urn:ietf:params:oauth:grant-type:token-exchange\` swaps
  one token for another (e.g., upstream IdP token → MCP-scoped token).
- **RFC 7523 JWT Bearer Grant** —
  \`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\` authorizes
  using a JWT assertion; commonly used to assert the upstream identity
  while requesting the swapped token.

The AS:

- SHOULD list both grant types in \`grant_types_supported\` so clients
  can detect support without an out-of-band agreement.
- MUST honor each grant per its respective RFC at the token endpoint.

**Phase 3c status:**

This scenario currently emits \`SKIPPED\` for both metadata-layer checks
when the fixture's AS doesn't advertise either grant — that's "feature
not yet supported, gap tracked by mcpkit issue 381" rather than "spec
violation." When the AS adds the grants, the checks flip to
\`SUCCESS\`. The end-to-end flow check (driving a real token-exchange
call and verifying the response shape) is stubbed as \`SKIPPED\` until
the conformance suite grows a token-flow driver.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];
    const meta = await fetchAsMetadata(serverUrl);

    interface GrantCase {
      id: string;
      name: string;
      description: string;
      grantUri: string;
      ref: SpecReference;
      issueRef: string;
    }

    const grantCases: GrantCase[] = [
      {
        id: 'auth-enterprise-managed-token-exchange-grant-supported',
        name: 'AuthEnterpriseManagedTokenExchangeGrantSupported',
        description: `AS metadata SHOULD advertise \`${TOKEN_EXCHANGE_GRANT}\` in \`grant_types_supported\` (RFC 8693)`,
        grantUri: TOKEN_EXCHANGE_GRANT,
        ref: RFC_8693_REF,
        issueRef: 'mcpkit issue 381'
      },
      {
        id: 'auth-enterprise-managed-jwt-bearer-grant-supported',
        name: 'AuthEnterpriseManagedJwtBearerGrantSupported',
        description: `AS metadata SHOULD advertise \`${JWT_BEARER_GRANT}\` in \`grant_types_supported\` (RFC 7523)`,
        grantUri: JWT_BEARER_GRANT,
        ref: RFC_7523_REF,
        issueRef: 'mcpkit issue 381'
      }
    ];

    for (const tc of grantCases) {
      if (meta.body === null) {
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage: `AS metadata unreachable; cannot verify ${tc.grantUri} advertisement. Attempts: ${JSON.stringify(meta.attempts)}`,
          specReferences: [tc.ref, RFC_8414_REF]
        });
        continue;
      }
      const grants = Array.isArray(meta.body.grant_types_supported)
        ? (meta.body.grant_types_supported as string[])
        : [];
      if (grants.includes(tc.grantUri)) {
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: 'SUCCESS',
          timestamp: new Date().toISOString(),
          specReferences: [tc.ref, RFC_8414_REF],
          details: { chosenUrl: meta.chosenUrl, advertisedGrants: grants }
        });
      } else {
        checks.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          errorMessage: `AS metadata does not advertise \`${tc.grantUri}\` in grant_types_supported — feature not yet supported by this fixture. Tracked by ${tc.issueRef}. Will flip to SUCCESS when the AS adds the grant. Currently advertised: ${JSON.stringify(grants)}`,
          specReferences: [tc.ref, RFC_8414_REF],
          details: { chosenUrl: meta.chosenUrl, advertisedGrants: grants }
        });
      }
    }

    // Flow-layer check — drives a real token-exchange POST when the
    // test runner provides AUTH_SUBJECT_ASSERTION_TOKEN (a JWT signed
    // by an upstream IdP the AS trusts) and AUTH_AS_TOKEN_ENDPOINT
    // (the AS's token endpoint URL — typically off-origin from the
    // resource server, so we can't infer it from `serverUrl`). When
    // either is unset, emits SKIPPED with a clear "couldn't run"
    // message rather than failing.
    {
      const id = 'auth-enterprise-managed-token-exchange-flow-shape';
      const name = 'AuthEnterpriseManagedTokenExchangeFlowShape';
      const description =
        'Token endpoint MUST honor token-exchange (RFC 8693) — POST grant_type=urn:ietf:params:oauth:grant-type:token-exchange + subject_token + subject_token_type=jwt MUST return RFC 8693 §2.2 response shape: access_token + issued_token_type + token_type=Bearer + expires_in';
      const subjectToken = process.env.AUTH_SUBJECT_ASSERTION_TOKEN ?? null;
      const tokenEndpoint = process.env.AUTH_AS_TOKEN_ENDPOINT ?? null;
      if (subjectToken === null || tokenEndpoint === null) {
        checks.push({
          id,
          name,
          description,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          errorMessage:
            'AUTH_SUBJECT_ASSERTION_TOKEN and/or AUTH_AS_TOKEN_ENDPOINT unset; cannot drive the token-exchange flow. Set both to enable this check (the test runner is responsible for obtaining a signed assertion from a trusted upstream IdP that the AS accepts, and for resolving the AS token endpoint URL — typically from the AS metadata `token_endpoint` field).',
          specReferences: [RFC_8693_REF, RFC_7523_REF]
        });
      } else {
        try {
          const form = new URLSearchParams();
          form.set('grant_type', TOKEN_EXCHANGE_GRANT);
          form.set('subject_token', subjectToken);
          form.set(
            'subject_token_type',
            'urn:ietf:params:oauth:token-type:jwt'
          );
          const resp = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString()
          });
          const bodyText = await resp.text();
          let body: any = null;
          try {
            body = JSON.parse(bodyText);
          } catch {
            /* leave null; checks below will catch malformed JSON */
          }
          const errs: string[] = [];
          if (resp.status !== 200) {
            errs.push(
              `status MUST be 200; got ${resp.status} (body: ${bodyText.slice(0, 120)})`
            );
          }
          if (body === null) {
            errs.push(
              `response MUST be valid JSON; got: ${bodyText.slice(0, 80)}`
            );
          } else {
            // RFC 8693 §2.2 — REQUIRED fields on a token-exchange response.
            if (
              typeof body.access_token !== 'string' ||
              body.access_token === ''
            ) {
              errs.push(
                'response MUST carry `access_token` (non-empty string)'
              );
            }
            if (
              typeof body.issued_token_type !== 'string' ||
              body.issued_token_type === ''
            ) {
              errs.push(
                'response MUST carry `issued_token_type` per RFC 8693 §2.2 — REQUIRED on token-exchange responses'
              );
            }
            if (typeof body.token_type !== 'string' || body.token_type === '') {
              errs.push('response MUST carry `token_type`');
            } else if (body.token_type.toLowerCase() !== 'bearer') {
              errs.push(
                `token_type SHOULD be "Bearer" for access_token issued_token_type; got "${body.token_type}"`
              );
            }
            // expires_in is RECOMMENDED (RFC 8693 §2.2). Don't fail when
            // absent, but warn so deployments notice.
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [RFC_8693_REF, RFC_7523_REF],
            details: {
              tokenEndpoint,
              httpStatus: resp.status,
              issuedTokenType: body?.issued_token_type
            }
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
            specReferences: [RFC_8693_REF, RFC_7523_REF]
          });
        }
      }
    }

    return checks;
  }
}
