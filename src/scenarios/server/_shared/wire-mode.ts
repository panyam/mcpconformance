/**
 * Wire-mode selection helpers shared by server-conformance harnesses.
 *
 * MCP defines two HTTP wire shapes that SDKs may implement:
 *
 *   - **legacy**: session-based — `initialize` handshake, `Mcp-Session-Id`
 *     on every follow-up, no per-request `_meta` envelope. Predates
 *     SEP-2575.
 *   - **stateless** (SEP-2575): no initialize, no session id, every
 *     request body carries `_meta.io.modelcontextprotocol/*` and the
 *     `MCP-Protocol-Version` header pins the negotiated version per
 *     request.
 *
 * SEP-2663 / SEP-2322 behavior is wire-independent in spec, so the
 * harnesses run every scenario against both wires by default. SDKs
 * that only implement one wire pin via `MCP_WIRE_MODES=legacy` or
 * `MCP_WIRE_MODES=stateless`.
 *
 * SEP-2575 (Accepted) removes the `initialize` handshake on
 * `DRAFT-2026-v1` and later. A spec-conformant client on those
 * versions does not call `initialize` — every request is
 * self-contained with a `_meta` envelope. Running the legacy wire
 * against a draft protocol version is therefore a logical
 * contradiction: we'd be asserting "I speak the post-handshake
 * version" while doing the handshake the version removed. Use
 * `effectiveWireModes(protocolVersion)` to drop the legacy wire on
 * draft so the harness only emits spec-permitted traffic.
 *
 * Hoisted out of the per-suite harnesses so tasks and mrtr share the
 * exact same parsing + default set; either suite advancing on one
 * dimension automatically picks the other up.
 */

import { DRAFT_PROTOCOL_VERSION } from '../../../types';

export type WireMode = 'legacy' | 'stateless';

const VALID_MODES: ReadonlySet<WireMode> = new Set(['legacy', 'stateless']);

export const DEFAULT_WIRE_MODES: readonly WireMode[] = ['legacy', 'stateless'];

/**
 * Protocol versions for which SEP-2575 has removed the `initialize`
 * handshake. The legacy wire is filtered out by
 * `effectiveWireModes()` when the suite targets one of these. Widen
 * when a future dated release picks SEP-2575 up.
 */
export const POST_SEP_2575_VERSIONS: ReadonlySet<string> = new Set([
  DRAFT_PROTOCOL_VERSION
]);

/**
 * Read `MCP_WIRE_MODES` from the environment. Comma-separated;
 * recognized values are `legacy` and `stateless`. Unknown tokens are
 * dropped; an empty / unset / fully-invalid value falls back to the
 * default (both wires).
 */
export function parseWireModes(): WireMode[] {
  const raw = process.env.MCP_WIRE_MODES;
  if (!raw) return [...DEFAULT_WIRE_MODES];
  const modes = raw
    .split(',')
    .map((s) => s.trim().toLowerCase() as WireMode)
    .filter((m) => VALID_MODES.has(m));
  return modes.length > 0 ? modes : [...DEFAULT_WIRE_MODES];
}

/**
 * Wire modes the harness is allowed to drive against a given
 * protocol version. On versions where SEP-2575 has removed the
 * initialize handshake (`POST_SEP_2575_VERSIONS`), the legacy wire
 * is filtered out — generating it would produce traffic the spec
 * doesn't sanction and would mask servers that correctly enforce
 * the per-request `_meta` MUST.
 *
 * If the user explicitly pinned `MCP_WIRE_MODES=legacy` against
 * such a version, the filter would leave an empty list; we warn
 * and fall back to `['stateless']` so the suite still runs.
 */
export function effectiveWireModes(protocolVersion: string): WireMode[] {
  const requested = parseWireModes();
  if (!POST_SEP_2575_VERSIONS.has(protocolVersion)) return requested;
  const filtered = requested.filter((m) => m !== 'legacy');
  if (filtered.length === 0) {
    console.warn(
      `MCP_WIRE_MODES=${process.env.MCP_WIRE_MODES} pinned legacy-only ` +
        `against ${protocolVersion}; SEP-2575 removed the legacy ` +
        `initialize handshake on this version. Falling back to ['stateless'].`
    );
    return ['stateless'];
  }
  return filtered;
}
