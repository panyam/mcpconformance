/**
 * Shared constants and helpers for the groups extension scenarios
 * (`io.modelcontextprotocol/groups`, progressive disclosure).
 *
 * The extension has no SEP number yet. Its text is the progressive-disclosure
 * WG's draft, PR 19 at 15b2a5cf, so the check IDs use a `groups-` prefix and
 * the verbatim quotes live in src/seps/groups.yaml. Rename both to
 * `sep-<number>-*` once the SEP is numbered.
 */

import type {
  CheckStatus,
  ConformanceCheck,
  SpecReference
} from '../../../types';
import { JsonRpcError, type Connection } from '../../../connection';

export const GROUPS_EXTENSION_ID = 'io.modelcontextprotocol/groups';
export const GROUPS_LIST_METHOD = 'groups/list';
export const GROUPS_GET_METHOD = 'groups/get';

/** `-32002` (Resource not found), which `groups/get` owes for an unknown name. */
export const JSONRPC_RESOURCE_NOT_FOUND = -32002;

/** 1 to 64 characters, lowercase alphanumeric and hyphens, no leading, trailing or doubled hyphens. */
export const GROUP_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const GROUP_NAME_MAX = 64;

/**
 * The traversal never fetches more groups than this. The harness is a client
 * too, so it must not recurse indefinitely on a cyclic or very large graph.
 */
export const MAX_GROUPS_FETCHED = 256;
export const MAX_LIST_PAGES = 32;

export const GROUPS_REF: SpecReference = {
  id: 'Groups extension (draft)',
  url: 'https://github.com/modelcontextprotocol/progressive-disclosure-wg/blob/15b2a5cf/seps/0000-progressive-disclosure-groups.md'
};

/** A `Group` as `groups/list` and a parent's `groups` carry it. */
export interface Group {
  name: string;
  title?: string;
  description: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A `groups/get` result (only the fields the scenarios inspect). */
export interface GetGroupResult {
  instructions?: string;
  tools?: Array<{
    name?: unknown;
    inputSchema?: unknown;
    [k: string]: unknown;
  }>;
  prompts?: unknown[];
  resources?: unknown[];
  groups?: Group[];
  [key: string]: unknown;
}

/** Fields only `groups/get` returns. A `Group` in a list never carries them. */
export const CONTENT_FIELDS = [
  'instructions',
  'tools',
  'prompts',
  'resources',
  'groups'
] as const;

export function groupsCheck(
  id: string,
  description: string,
  status: CheckStatus,
  extras: Partial<ConformanceCheck> = {}
): ConformanceCheck {
  return {
    id,
    name: id,
    description,
    status,
    timestamp: new Date().toISOString(),
    specReferences: [GROUPS_REF],
    ...extras
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether the server lists the extension in its discovered capabilities. */
export async function serverDeclaresGroups(conn: Connection): Promise<boolean> {
  const discovered = await conn.discover();
  const caps = (discovered.capabilities as Record<string, unknown>) ?? {};
  const extensions = caps.extensions as Record<string, unknown> | undefined;
  return !!extensions && GROUPS_EXTENSION_ID in extensions;
}

/** Every group from `groups/list`, following `nextCursor` up to MAX_LIST_PAGES. */
export async function listAllGroups(conn: Connection): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await conn.request<Record<string, unknown>>(
      GROUPS_LIST_METHOD,
      cursor ? { cursor } : {}
    );
    if (!Array.isArray(res.groups)) {
      throw new Error(
        `groups/list result has no groups array (got ${JSON.stringify(res).slice(0, 200)})`
      );
    }
    out.push(...res.groups);
    cursor =
      typeof res.nextCursor === 'string' && res.nextCursor
        ? res.nextCursor
        : undefined;
    if (!cursor) break;
  }
  return out;
}

/** Every tool name from `tools/list`, following `nextCursor` up to MAX_LIST_PAGES. */
export async function listAllToolNames(conn: Connection): Promise<Set<string>> {
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await conn.request<Record<string, unknown>>(
      'tools/list',
      cursor ? { cursor } : {}
    );
    for (const t of Array.isArray(res.tools) ? res.tools : []) {
      if (isObject(t) && typeof t.name === 'string') names.add(t.name);
    }
    cursor =
      typeof res.nextCursor === 'string' && res.nextCursor
        ? res.nextCursor
        : undefined;
    if (!cursor) break;
  }
  return names;
}

/** The JSON-RPC error code a request failed with, or undefined if it succeeded. */
export async function errorCodeOf(
  call: Promise<unknown>
): Promise<{ code?: number; message?: string }> {
  try {
    await call;
    return {};
  } catch (err) {
    if (err instanceof JsonRpcError)
      return { code: err.code, message: err.message };
    return { message: err instanceof Error ? err.message : String(err) };
  }
}

export function nameProblem(name: unknown): string | undefined {
  if (typeof name !== 'string')
    return `name is ${name === undefined ? 'missing' : typeof name}`;
  if (name.length < 1 || name.length > GROUP_NAME_MAX) {
    return `"${name}" is ${name.length} characters, not 1 to ${GROUP_NAME_MAX}`;
  }
  if (!GROUP_NAME_PATTERN.test(name)) {
    return `"${name}" is not lowercase alphanumeric and single hyphens`;
  }
  return undefined;
}

export function joinErrs(errs: string[], limit = 5): string {
  const shown = errs.slice(0, limit).join('; ');
  return errs.length > limit
    ? `${shown} (+${errs.length - limit} more)`
    : shown;
}
