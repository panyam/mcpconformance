/**
 * SEP-2350 server-side scope-challenge scenario.
 *
 * Drives an MCP server through the OAuth scope-challenge handshake described
 * by SEP-2350 and RFC 6750 Section 3.1. The harness acts as a client: it
 * does the legacy initialize handshake, then sends `tools/call` with an
 * under-scoped bearer token and asserts the server returns HTTP 403 with a
 * parseable `WWW-Authenticate: Bearer ...` header advertising the required
 * scope. Retries with a properly-scoped token and asserts 2xx.
 *
 * Wire choice: legacy (protocolVersion 2025-11-25 in initialize params,
 * Mcp-Session-Id propagated on subsequent requests). SEP-2350's wire shape
 * is wire-agnostic — 403 + WWW-Authenticate is identical on legacy and
 * SEP-2575 stateless. We pick the wire every SUT in the current matrix
 * speaks, which is legacy: modelcontextprotocol/typescript-sdk PR 1624's
 * transport (the reference impl) supports protocol versions through
 * 2025-11-25 only; mcpkit accepts both wires in its default Dual mode.
 *
 * Operator-driven token issuance via `MCP_CONFORMANCE_CONTEXT`. The harness
 * does not provision an authorization server. The fixture in
 * `examples/auth-fixtures/keycloak/` is the recommended way to mint the
 * tokens this scenario consumes.
 *
 * Conditional checks for `accepted` (OR hierarchy) emit SKIPPED when the
 * operator declares the SUT does not implement that feature, so the
 * scenario can grade minimal-conforming servers without false failures.
 * The `includeGrantedScopes` opt-in is not separately tested: its
 * default-off case is observationally identical to the always-on
 * `scope-required-only` check, and its on case would require a parallel
 * SUT instance configured with the opt-in toggled, out of reach of a
 * single-SUT scenario run.
 */

import {
  ClientScenario,
  ConformanceCheck,
  LATEST_SPEC_VERSION
} from '../../types';
import type { RunContext } from '../../connection';

const SPEC_REF_SEP_2350 = {
  id: 'SEP-2350',
  url: 'https://modelcontextprotocol.io/specification/draft/basic/authorization#runtime-insufficient-scope-errors'
};

const SPEC_REF_RFC_6750 = {
  id: 'RFC-6750-3.1',
  url: 'https://datatracker.ietf.org/doc/html/rfc6750#section-3.1'
};

const SPEC_REF_RFC_9728 = {
  id: 'RFC-9728-PRM',
  url: 'https://datatracker.ietf.org/doc/html/rfc9728'
};

/**
 * Shape of `MCP_CONFORMANCE_CONTEXT` this scenario consumes. The operator
 * populates this from their authorization server (see
 * `examples/auth-fixtures/keycloak/Makefile`'s `tokens-context` target).
 */
export interface ScopeChallengeContext {
  /** Issuer URL the operator's tokens were minted against. Informational. */
  authServer?: string;
  tokens: {
    /** Bearer token whose scopes do NOT include `requiredScope`. */
    insufficient: string;
    /** Bearer token whose scopes DO include `requiredScope`. */
    sufficient: string;
    /**
     * Optional. Bearer token whose scopes include the `accepted` hierarchy
     * parent (e.g. `repo`) but not the literal `requiredScope` (e.g.
     * `repo:read`). Drives the OR-hierarchy check. When absent, the
     * accepted-hierarchy check emits SKIPPED.
     */
    acceptedHierarchy?: string;
  };
  /**
   * The scope the SUT advertises in its `WWW-Authenticate` challenge for
   * `scopeGatedTool`. Used both to call the SUT and to assert the advertised
   * value matches.
   */
  requiredScope: string;
  /** Name of the tool the SUT exposes that requires `requiredScope`. */
  scopeGatedTool: string;
  /**
   * Optional. Capability flags telling the scenario which feature checks to
   * activate. Defaults: every flag false. Each false flag drops the
   * corresponding check to SKIPPED rather than FAILURE.
   */
  features?: {
    /** SUT implements PR 1624's `accepted` OR-hierarchy. */
    acceptedScopes?: boolean;
  };
}

const CHECK_403_STATUS = 'scope-challenge-403-on-insufficient';
const CHECK_WWW_AUTH_PRESENT = 'scope-challenge-www-authenticate-present';
const CHECK_WWW_AUTH_BEARER = 'scope-challenge-www-authenticate-bearer';
const CHECK_WWW_AUTH_ERROR = 'scope-challenge-www-authenticate-error';
const CHECK_WWW_AUTH_SCOPE = 'scope-challenge-scope-advertised';
const CHECK_SCOPE_REQUIRED_ONLY = 'scope-challenge-scope-required-only';
const CHECK_PRM_LINK = 'scope-challenge-resource-metadata-link';
const CHECK_RETRY_SUCCEEDS = 'scope-challenge-passes-with-sufficient-token';
const CHECK_ACCEPTED_HIERARCHY = 'scope-challenge-accepted-or-hierarchy';
const CHECK_ACCEPTED_NOT_LEAKED =
  'scope-challenge-www-authenticate-accepted-not-leaked';

/**
 * Parsed `WWW-Authenticate: Bearer ...` challenge. `null` value for a key
 * means the auth-param was present without a value, which is non-conforming
 * but we surface it so a check can report the exact wire shape.
 */
export interface ParsedBearerChallenge {
  scheme: 'Bearer' | string;
  params: Record<string, string | null>;
}

/**
 * Parses a single `WWW-Authenticate: Bearer ...` header value into its
 * auth-params. RFC 7235 quoted-string handling: backslash escapes inside
 * double-quoted values are unescaped; unquoted values are token-shaped.
 *
 * Returns `null` if the header is not a Bearer challenge. Does not throw on
 * malformed input; surfaces what it parsed up to the failure point.
 */
export function parseBearerChallenge(
  headerValue: string
): ParsedBearerChallenge | null {
  const trimmed = headerValue.trim();
  const schemeMatch = /^(\S+)/.exec(trimmed);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1];
  if (scheme.toLowerCase() !== 'bearer') return null;

  const rest = trimmed.slice(scheme.length).trim();
  const params: Record<string, string | null> = {};

  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /[\s,]/.test(rest[i])) i++;
    if (i >= rest.length) break;

    const keyStart = i;
    while (i < rest.length && /[A-Za-z0-9!#$%&'*+\-.^_`|~]/.test(rest[i])) i++;
    const key = rest.slice(keyStart, i).toLowerCase();
    if (!key) break;

    if (rest[i] !== '=') {
      params[key] = null;
      continue;
    }
    i++;

    let value: string;
    if (rest[i] === '"') {
      i++;
      let buf = '';
      while (i < rest.length && rest[i] !== '"') {
        if (rest[i] === '\\' && i + 1 < rest.length) {
          buf += rest[i + 1];
          i += 2;
        } else {
          buf += rest[i];
          i++;
        }
      }
      if (rest[i] === '"') i++;
      value = buf;
    } else {
      const valStart = i;
      while (i < rest.length && !/[\s,]/.test(rest[i])) i++;
      value = rest.slice(valStart, i);
    }
    params[key] = value;
  }

  return { scheme: 'Bearer', params };
}

/** Splits a space-delimited OAuth scope value into a Set for set-wise compare. */
export function scopeSet(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(/\s+/).filter(Boolean));
}

/** Set-equality on two OAuth scope strings (order-independent). */
export function scopesEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = scopeSet(a);
  const sb = scopeSet(b);
  if (sa.size !== sb.size) return false;
  for (const s of sa) if (!sb.has(s)) return false;
  return true;
}

/** Raw HTTP response shape — enough for header + body inspection. */
interface RawResponse {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * Runs the legacy initialize handshake against the SUT — POST initialize,
 * capture Mcp-Session-Id from the response, send the required
 * notifications/initialized follow-up — and returns the session id. Uses
 * legacy wire (`protocolVersion: 2025-11-25` in params, not SEP-2575
 * `_meta`) because that is what modelcontextprotocol/typescript-sdk PR
 * 1624's `WebStandardStreamableHTTPServerTransport` speaks. mcpkit's Dual
 * mode accepts the legacy wire equally cleanly.
 *
 * Initialize itself takes a bearer because every SUT in the matrix
 * gates initialize behind auth (mcpkit's JWTValidator + Keycloak both
 * require a valid token on every request). A scenario that wanted to
 * exercise unauthenticated initialize would skip this helper.
 */
async function legacyInitialize(serverUrl: string, bearer: string): Promise<string> {
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_SPEC_VERSION,
      capabilities: {},
      clientInfo: { name: 'scope-challenge-scenario', version: '0.0.0' }
    }
  });
  const initRes = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${bearer}`
    },
    body: initBody
  });
  if (initRes.status !== 200) {
    throw new Error(`initialize failed: HTTP ${initRes.status}`);
  }
  const sessionId = initRes.headers.get('mcp-session-id');
  // The SUT may or may not require a session id (PR 1624 in
  // sessionIdGenerator:undefined mode does not; mcpkit's default Dual mode
  // does). Either way, we send the initialized notification before any
  // tools/call so a SUT that gates dispatch on initialized completion
  // (mcpkit) is happy. Failures here are non-fatal for SUTs that don't
  // need the notification.
  await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${bearer}`,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    })
  });
  return sessionId ?? '';
}

/**
 * Sends a `tools/call` POST against the SUT using the legacy wire (with
 * the optional Mcp-Session-Id captured during initialize) and returns the
 * raw HTTP response so the scenario can inspect status + headers without
 * an SDK client swallowing the 403. The SDK client would throw on the
 * 403 and hide the WWW-Authenticate header this scenario is grading.
 */
async function callTool(
  serverUrl: string,
  sessionId: string,
  bearer: string,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<RawResponse> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${bearer}`
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(serverUrl, { method: 'POST', headers, body });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function check(
  id: string,
  name: string,
  description: string,
  status: ConformanceCheck['status'],
  errorMessage?: string,
  details?: Record<string, unknown>
): ConformanceCheck {
  const c: ConformanceCheck = {
    id,
    name,
    description,
    status,
    timestamp: new Date().toISOString(),
    specReferences: [SPEC_REF_SEP_2350, SPEC_REF_RFC_6750]
  };
  if (errorMessage) c.errorMessage = errorMessage;
  if (details) c.details = details;
  return c;
}

function skipped(
  id: string,
  name: string,
  description: string,
  reason: string
): ConformanceCheck {
  return check(id, name, description, 'SKIPPED', reason);
}

/**
 * Reads `MCP_CONFORMANCE_CONTEXT` and validates the required fields. Returns
 * `null` (rather than throwing) when the env var is absent or missing
 * fields, so the scenario can emit a single SKIPPED check and exit cleanly
 * under CI runs that don't provision an AS.
 */
function getContext(): ScopeChallengeContext | null {
  const raw = process.env.MCP_CONFORMANCE_CONTEXT;
  if (!raw) return null;
  let parsed: ScopeChallengeContext;
  try {
    parsed = JSON.parse(raw) as ScopeChallengeContext;
  } catch {
    return null;
  }
  if (!parsed?.tokens?.insufficient || !parsed?.tokens?.sufficient) return null;
  if (!parsed.requiredScope || !parsed.scopeGatedTool) return null;
  return parsed;
}

/**
 * Server-side scope-challenge scenario for SEP-2350 and the wire shape PR
 * 1624 implements. Acts as a client to drive any MCP server that gates a
 * tool behind a required OAuth scope.
 */
export class ScopeChallengeScenario implements ClientScenario {
  readonly name = 'scope-challenge';
  readonly source = {
    introducedIn: LATEST_SPEC_VERSION
  } as const;
  readonly description = `Tests that a server returning insufficient-scope errors follows SEP-2350 and RFC 6750 §3.1: HTTP 403 with a parseable \`WWW-Authenticate: Bearer error="insufficient_scope", scope="..."\` challenge advertising the per-operation required scope, that the operation succeeds when retried with a properly-scoped token, and (when the operator opts in via context.features) that the OR-hierarchy \`accepted\` semantics behave as specified.

**Operator setup**: see \`examples/auth-fixtures/keycloak/README.md\` for the recommended Keycloak runbook. The MCP_CONFORMANCE_CONTEXT shape is documented at \`src/scenarios/server/scope-challenge.ts\`'s ScopeChallengeContext.`;

  async run(ctx: RunContext): Promise<ConformanceCheck[]> {
    const scenarioCtx = getContext();
    if (!scenarioCtx) {
      return [
        check(
          CHECK_403_STATUS,
          'scope-challenge requires MCP_CONFORMANCE_CONTEXT',
          'operator must provide tokens + requiredScope + scopeGatedTool via MCP_CONFORMANCE_CONTEXT; see examples/auth-fixtures/keycloak/README.md for the recommended setup',
          'FAILURE',
          'MCP_CONFORMANCE_CONTEXT not set or missing required fields (tokens.insufficient, tokens.sufficient, requiredScope, scopeGatedTool)'
        )
      ];
    }
    const { serverUrl } = ctx;
    const checks: ConformanceCheck[] = [];

    // Establish a session before any tools/call. The legacy wire requires
    // it; SUTs in stateless-id mode (PR 1624 sessionIdGenerator:undefined)
    // tolerate an empty session id but still need the initialize handshake
    // to recognize the protocol version. Use the sufficient token for
    // initialize since both SUTs in the matrix gate every method behind
    // auth, and initialize itself doesn't carry tool-level scope checks.
    const sessionId = await legacyInitialize(serverUrl, scenarioCtx.tokens.sufficient);

    const insufficient = await callTool(
      serverUrl,
      sessionId,
      scenarioCtx.tokens.insufficient,
      scenarioCtx.scopeGatedTool
    );

    checks.push(
      insufficient.status === 403
        ? check(
            CHECK_403_STATUS,
            'Returns 403 on insufficient scope',
            'tools/call with an under-scoped token returns HTTP 403',
            'SUCCESS'
          )
        : check(
            CHECK_403_STATUS,
            'Returns 403 on insufficient scope',
            'tools/call with an under-scoped token returns HTTP 403',
            'FAILURE',
            `expected status 403, got ${insufficient.status}`,
            { status: insufficient.status }
          )
    );

    const wwwAuth =
      insufficient.headers.get('www-authenticate');

    checks.push(
      wwwAuth
        ? check(
            CHECK_WWW_AUTH_PRESENT,
            'WWW-Authenticate header present',
            '403 response includes a WWW-Authenticate header',
            'SUCCESS'
          )
        : check(
            CHECK_WWW_AUTH_PRESENT,
            'WWW-Authenticate header present',
            '403 response includes a WWW-Authenticate header',
            'FAILURE',
            'response did not include a WWW-Authenticate header'
          )
    );

    const parsed = wwwAuth ? parseBearerChallenge(wwwAuth) : null;

    checks.push(
      parsed
        ? check(
            CHECK_WWW_AUTH_BEARER,
            'WWW-Authenticate scheme is Bearer',
            'challenge uses the Bearer auth scheme per RFC 6750',
            'SUCCESS'
          )
        : check(
            CHECK_WWW_AUTH_BEARER,
            'WWW-Authenticate scheme is Bearer',
            'challenge uses the Bearer auth scheme per RFC 6750',
            'FAILURE',
            wwwAuth
              ? `expected Bearer challenge, got: ${wwwAuth}`
              : 'no WWW-Authenticate header to inspect',
            { wwwAuthenticate: wwwAuth }
          )
    );

    const errorParam = parsed?.params['error'] ?? null;
    checks.push(
      errorParam === 'insufficient_scope'
        ? check(
            CHECK_WWW_AUTH_ERROR,
            'error="insufficient_scope" advertised',
            'challenge carries error="insufficient_scope" per RFC 6750 §3.1',
            'SUCCESS'
          )
        : check(
            CHECK_WWW_AUTH_ERROR,
            'error="insufficient_scope" advertised',
            'challenge carries error="insufficient_scope" per RFC 6750 §3.1',
            'FAILURE',
            `expected error="insufficient_scope", got ${JSON.stringify(errorParam)}`,
            { error: errorParam }
          )
    );

    const scopeParam = parsed?.params['scope'] ?? null;
    checks.push(
      scopeParam
        ? check(
            CHECK_WWW_AUTH_SCOPE,
            'scope= advertised',
            'challenge advertises a scope parameter naming the required scopes',
            'SUCCESS'
          )
        : check(
            CHECK_WWW_AUTH_SCOPE,
            'scope= advertised',
            'challenge advertises a scope parameter naming the required scopes',
            'FAILURE',
            'no scope auth-param on challenge'
          )
    );

    const advertisesRequiredOnly =
      scopeParam !== null && scopesEqual(scopeParam, scenarioCtx.requiredScope);
    checks.push(
      advertisesRequiredOnly
        ? check(
            CHECK_SCOPE_REQUIRED_ONLY,
            'scope= is per-operation required only',
            'advertised scope is the per-operation required set, not unioned with the granted/accepted sets (least-privilege)',
            'SUCCESS'
          )
        : check(
            CHECK_SCOPE_REQUIRED_ONLY,
            'scope= is per-operation required only',
            'advertised scope is the per-operation required set, not unioned with the granted/accepted sets (least-privilege)',
            'WARNING',
            scopeParam === null
              ? 'no scope param to inspect'
              : `expected scope="${scenarioCtx.requiredScope}", got scope="${scopeParam}"`,
            { scope: scopeParam, expected: scenarioCtx.requiredScope }
          )
    );

    const prmLink = parsed?.params['resource_metadata'] ?? null;
    checks.push(
      prmLink
        ? check(
            CHECK_PRM_LINK,
            'resource_metadata link advertised',
            'challenge advertises a resource_metadata URL per RFC 9728',
            'SUCCESS'
          )
        : {
            ...check(
              CHECK_PRM_LINK,
              'resource_metadata link advertised',
              'challenge advertises a resource_metadata URL per RFC 9728',
              'WARNING',
              'no resource_metadata auth-param on challenge'
            ),
            specReferences: [
              SPEC_REF_SEP_2350,
              SPEC_REF_RFC_6750,
              SPEC_REF_RFC_9728
            ]
          }
    );

    const sufficient = await callTool(
      serverUrl,
      sessionId,
      scenarioCtx.tokens.sufficient,
      scenarioCtx.scopeGatedTool
    );
    const retrySucceeds = sufficient.status >= 200 && sufficient.status < 300;
    checks.push(
      retrySucceeds
        ? check(
            CHECK_RETRY_SUCCEEDS,
            'Retry with sufficient token succeeds',
            'tools/call with a properly-scoped token returns 2xx',
            'SUCCESS'
          )
        : check(
            CHECK_RETRY_SUCCEEDS,
            'Retry with sufficient token succeeds',
            'tools/call with a properly-scoped token returns 2xx',
            'FAILURE',
            `expected 2xx, got ${sufficient.status}`,
            { status: sufficient.status, body: sufficient.body.slice(0, 500) }
          )
    );

    const features = scenarioCtx.features ?? {};

    if (features.acceptedScopes && scenarioCtx.tokens.acceptedHierarchy) {
      const acceptedResp = await callTool(
        serverUrl,
        sessionId,
        scenarioCtx.tokens.acceptedHierarchy,
        scenarioCtx.scopeGatedTool
      );
      const acceptedOk =
        acceptedResp.status >= 200 && acceptedResp.status < 300;
      checks.push(
        acceptedOk
          ? check(
              CHECK_ACCEPTED_HIERARCHY,
              'accepted hierarchy satisfies the gate',
              'a token with a parent scope listed in accepted satisfies the tool',
              'SUCCESS'
            )
          : check(
              CHECK_ACCEPTED_HIERARCHY,
              'accepted hierarchy satisfies the gate',
              'a token with a parent scope listed in accepted satisfies the tool',
              'FAILURE',
              `expected 2xx, got ${acceptedResp.status}`,
              { status: acceptedResp.status }
            )
      );

      if (acceptedResp.status === 403) {
        const acceptedChallenge = parseBearerChallenge(
          acceptedResp.headers.get('www-authenticate') ?? ''
        );
        const acceptedScope = acceptedChallenge?.params['scope'] ?? null;
        const leaked =
          acceptedScope !== null &&
          !scopesEqual(acceptedScope, scenarioCtx.requiredScope);
        checks.push(
          leaked
            ? check(
                CHECK_ACCEPTED_NOT_LEAKED,
                'accepted set not leaked into WWW-Authenticate',
                'when accepted is configured, 403 challenge advertises requiredScopes only',
                'FAILURE',
                `accepted set leaked into challenge: scope="${acceptedScope}"`,
                { scope: acceptedScope }
              )
            : check(
                CHECK_ACCEPTED_NOT_LEAKED,
                'accepted set not leaked into WWW-Authenticate',
                'when accepted is configured, 403 challenge advertises requiredScopes only',
                'SUCCESS'
              )
        );
      } else {
        checks.push(
          skipped(
            CHECK_ACCEPTED_NOT_LEAKED,
            'accepted set not leaked into WWW-Authenticate',
            'when accepted is configured, 403 challenge advertises requiredScopes only',
            'accepted-hierarchy token did not trigger a 403; nothing to inspect'
          )
        );
      }
    } else {
      const reason = features.acceptedScopes
        ? 'context.tokens.acceptedHierarchy missing'
        : 'context.features.acceptedScopes is false';
      checks.push(
        skipped(
          CHECK_ACCEPTED_HIERARCHY,
          'accepted hierarchy satisfies the gate',
          'a token with a parent scope listed in accepted satisfies the tool',
          reason
        )
      );
      checks.push(
        skipped(
          CHECK_ACCEPTED_NOT_LEAKED,
          'accepted set not leaked into WWW-Authenticate',
          'when accepted is configured, 403 challenge advertises requiredScopes only',
          reason
        )
      );
    }

    return checks;
  }
}
