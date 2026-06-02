/**
 * Spec-version → wire mapping for the server-conformance harnesses.
 *
 * MCP defines two HTTP wire shapes:
 *
 *   - **legacy**: session-based — `initialize` handshake, `Mcp-Session-Id`
 *     on every follow-up, no per-request `_meta` envelope. Predates
 *     SEP-2575.
 *   - **stateless** (SEP-2575): no initialize, no session id, every
 *     request body carries `_meta.io.modelcontextprotocol/*` and the
 *     `MCP-Protocol-Version` header pins the negotiated version per
 *     request.
 *
 * SEP-2575 (Accepted) removes the `initialize` handshake on
 * `DRAFT-2026-v1` and later, so a spec-conformant client at that version
 * MUST use the stateless wire. `isStateless(ctx)` answers whether the
 * spec version on the context requires it; the tasks/MRTR scenarios
 * derive their wire choice from this rather than carrying a parallel
 * `wire` knob — a parallel knob lets callers go out of sync with the
 * version they declared on the wire, producing legacy handshakes
 * against a version that has removed them.
 */

import { DRAFT_PROTOCOL_VERSION } from '../../../types';
import type { RunContext } from '../../../connection';

/**
 * Protocol versions for which SEP-2575 has removed the `initialize`
 * handshake. Widen when a future dated release picks SEP-2575 up.
 */
const POST_SEP_2575_VERSIONS: ReadonlySet<string> = new Set([
  DRAFT_PROTOCOL_VERSION
]);

export function isStateless(ctx: Pick<RunContext, 'specVersion'>): boolean {
  return POST_SEP_2575_VERSIONS.has(ctx.specVersion);
}
