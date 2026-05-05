/**
 * Shared helpers for SEP-2663 Tasks server-conformance scenarios.
 *
 * The MCP TS SDK's typed schemas (CallToolResultSchema, etc.) strip the
 * SEP-2663 / SEP-2322 wire fields — `resultType`, `taskId`, `inputRequests`,
 * `requestState`, inlined `result`/`error` on tasks/get's DetailedTask. So
 * scenarios that exercise those fields use raw fetch instead. This file
 * centralizes the bootstrap + RPC + polling primitives.
 *
 * If/when the SDK gains schemas for the SEP-2663 wire shapes, the call
 * sites in scenarios switch back to `client.request(..., AnyResult)`
 * and this file shrinks (or disappears).
 */

import type { ConformanceCheck, SpecReference } from '../../../types';

export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';

export const SEP_2663_REF: SpecReference = {
  id: 'SEP-2663',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2663'
};
export const SEP_2322_REF: SpecReference = {
  id: 'SEP-2322',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2322'
};
export const SEP_2243_REF: SpecReference = {
  id: 'SEP-2243',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2243'
};
export const SEP_2575_REF: SpecReference = {
  id: 'SEP-2575',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2575'
};

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build a FAILURE check from a thrown error, preserving id/name/description. */
export function failureCheck(
  id: string,
  name: string,
  description: string,
  error: unknown,
  specReferences: SpecReference[]
): ConformanceCheck {
  return {
    id,
    name,
    description,
    status: 'FAILURE',
    timestamp: new Date().toISOString(),
    errorMessage: errMsg(error),
    specReferences
  };
}

/** Build a SKIPPED check (preserves id stability so Ctrl+F still finds it). */
export function skipCheck(
  id: string,
  name: string,
  description: string,
  reason: string,
  specReferences: SpecReference[] = [SEP_2663_REF]
): ConformanceCheck {
  return {
    id,
    name,
    description,
    status: 'SKIPPED',
    timestamp: new Date().toISOString(),
    errorMessage: `Skipped: ${reason}`,
    specReferences
  };
}

export interface InitOpts {
  /** Negotiated wire protocolVersion. Defaults to LATEST_SPEC_VERSION. */
  protocolVersion?: string;
  /** Client capabilities (extensions, elicitation, sampling, …). */
  capabilities?: Record<string, unknown>;
  /** Optional clientInfo override. */
  clientInfo?: { name: string; version: string };
}

export interface InitResult {
  /** Mcp-Session-Id minted by the server during initialize. */
  sessionId: string;
  /** capabilities object the server advertised in its initialize response. */
  serverCapabilities: Record<string, any>;
  /** Negotiated protocolVersion echoed back by the server. */
  serverProtocolVersion?: string;
  /** Server info (name, version, …). */
  serverInfo?: Record<string, any>;
}

/**
 * Run a fresh initialize handshake and return session id + the server's
 * advertised capabilities. Bypasses the SDK so callers can declare
 * extension capabilities the SDK's typed wrappers don't yet know about,
 * and so the SDK's Zod schemas don't strip extension fields off the
 * server response.
 */
export async function initRawSession(
  serverUrl: string,
  opts: InitOpts = {}
): Promise<InitResult> {
  const protocolVersion = opts.protocolVersion ?? '2025-11-25';
  const capabilities = opts.capabilities ?? {};
  const clientInfo = opts.clientInfo ?? {
    name: 'mcp-conformance',
    version: '1.0'
  };

  const initResp = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init-raw',
      method: 'initialize',
      params: { protocolVersion, clientInfo, capabilities }
    })
  });
  const sid = initResp.headers.get('mcp-session-id') || '';
  if (!sid) throw new Error('initialize response missing Mcp-Session-Id');

  const initBody = await initResp.json();
  if (initBody.error) {
    throw new Error(
      `initialize returned JSON-RPC error: ${JSON.stringify(initBody.error)}`
    );
  }
  const result = initBody.result ?? {};

  await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Mcp-Session-Id': sid
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
  });
  return {
    sessionId: sid,
    serverCapabilities: result.capabilities ?? {},
    serverProtocolVersion: result.protocolVersion,
    serverInfo: result.serverInfo
  };
}

export interface RawRequestOpts {
  sessionId: string;
  /** Optional _meta object merged into the JSON-RPC params. */
  meta?: Record<string, unknown>;
  /** Optional HTTP request headers merged after the harness defaults. */
  headers?: Record<string, string>;
}

export interface RawRequestResult {
  /** The JSON-RPC `result` body, when the response carried one. */
  result: any;
  /** The raw fetch Response so callers can inspect transport-level headers. */
  response: Response;
}

let nextId = 1;

/**
 * Send a raw JSON-RPC request via fetch, parsing SSE `data:` lines or
 * plain JSON depending on Content-Type. Throws an Error decorated with
 * `code` / `data` when the response carries a JSON-RPC error.
 */
export async function rawRequest(
  serverUrl: string,
  method: string,
  params: any,
  opts: RawRequestOpts
): Promise<any> {
  const { result } = await rawRequestFull(serverUrl, method, params, opts);
  return result;
}

/**
 * Like rawRequest, but also returns the raw fetch Response so callers
 * can inspect transport-level headers (e.g., SEP-2243 routing headers).
 */
export async function rawRequestFull(
  serverUrl: string,
  method: string,
  params: any,
  opts: RawRequestOpts
): Promise<RawRequestResult> {
  const id = nextId++;
  const requestParams = opts.meta ? { ...params, _meta: opts.meta } : params;
  const resp = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      'Mcp-Session-Id': opts.sessionId,
      ...(opts.headers ?? {})
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: requestParams
    })
  });
  const ct = resp.headers.get('content-type') || '';
  let body: any;
  if (ct.includes('text/event-stream')) {
    const text = await resp.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trimStart();
        if (payload.startsWith('{')) {
          const parsed = JSON.parse(payload);
          if (parsed.id === id) {
            body = parsed;
            break;
          }
        }
      }
    }
  } else {
    body = await resp.json();
  }
  if (!body) throw new Error(`No JSON-RPC response for ${method}`);
  if (body.error) {
    const err: any = new Error(body.error.message);
    err.code = body.error.code;
    err.data = body.error.data;
    throw err;
  }
  return { result: body.result, response: resp };
}

/** Poll tasks/get until the task reaches a terminal state. */
export async function waitForTerminal(
  serverUrl: string,
  sessionId: string,
  taskId: string,
  timeoutMs = 10_000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await rawRequest(
      serverUrl,
      'tasks/get',
      { taskId },
      { sessionId }
    );
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Task ${taskId} did not reach terminal state within ${timeoutMs}ms`
  );
}

/** Poll tasks/get until a specific status (or any terminal state). */
export async function waitForStatus(
  serverUrl: string,
  sessionId: string,
  taskId: string,
  status: string,
  timeoutMs = 10_000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await rawRequest(
      serverUrl,
      'tasks/get',
      { taskId },
      { sessionId }
    );
    if (
      task.status === status ||
      ['completed', 'failed', 'cancelled'].includes(task.status)
    ) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Task ${taskId} did not reach status ${status} within ${timeoutMs}ms`
  );
}
