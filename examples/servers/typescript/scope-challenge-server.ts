#!/usr/bin/env node

/**
 * Minimal scope-challenge SUT for the scope-challenge scenario's red/green
 * unit tests. Hand-rolls the SEP-2350 / RFC 6750 §3.1 wire shape (HTTP 403
 * with `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."`)
 * without depending on any MCP SDK, so it can be used both before and after
 * PR 1624 lands.
 *
 * Configuration via env:
 *   PORT                 - listen port (default 3013)
 *   SUFFICIENT_TOKEN     - bearer value that satisfies the gate (default 'sufficient')
 *   INSUFFICIENT_TOKEN   - bearer value that triggers the 403 (default 'insufficient')
 *   ACCEPTED_TOKEN       - optional bearer value treated as the OR-hierarchy parent
 *                          (default '' = no accepted-hierarchy semantics)
 *   REQUIRED_SCOPE       - scope advertised in WWW-Authenticate (default 'admin-write')
 *   SCOPE_GATED_TOOL     - tool name that requires the scope (default 'admin_call')
 *   RESOURCE_METADATA    - PRM URL advertised in WWW-Authenticate (default unset, omits the param)
 *
 * Intentionally not for production. The token comparison is exact-string,
 * the JWT is never decoded, and no JSON-RPC envelope is fully validated.
 * Sufficient to drive the scenario's check builders red/green.
 */

import express from 'express';

const PORT = parseInt(process.env.PORT || '3013', 10);
const SUFFICIENT_TOKEN = process.env.SUFFICIENT_TOKEN || 'sufficient';
const INSUFFICIENT_TOKEN = process.env.INSUFFICIENT_TOKEN || 'insufficient';
const ACCEPTED_TOKEN = process.env.ACCEPTED_TOKEN || '';
const REQUIRED_SCOPE = process.env.REQUIRED_SCOPE || 'admin-write';
const SCOPE_GATED_TOOL = process.env.SCOPE_GATED_TOOL || 'admin_call';
const RESOURCE_METADATA = process.env.RESOURCE_METADATA || '';

function quoteAuthParam(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildChallenge(): string {
  const parts = [
    `Bearer error="insufficient_scope"`,
    `scope="${quoteAuthParam(REQUIRED_SCOPE)}"`,
    `error_description="${quoteAuthParam(`Additional scopes required: ${REQUIRED_SCOPE}`)}"`
  ];
  if (RESOURCE_METADATA) {
    parts.splice(2, 0, `resource_metadata="${quoteAuthParam(RESOURCE_METADATA)}"`);
  }
  return parts.join(', ');
}

const app = express();
app.use(express.json());

app.post('/mcp', (req, res) => {
  const body = req.body ?? {};
  const method = body.method;
  const id = body.id ?? null;
  const auth = req.header('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null;

  if (method === 'server/discover' || method === 'initialize') {
    res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2026-07-28',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'scope-challenge-server',
          version: '1.0.0'
        }
      }
    });
    return;
  }

  if (method !== 'tools/call') {
    res.status(404).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
    return;
  }

  const toolName = body?.params?.name;
  if (toolName !== SCOPE_GATED_TOOL) {
    res.json({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `echo: ${toolName}` }] }
    });
    return;
  }

  const isSufficient = bearer === SUFFICIENT_TOKEN;
  const isAccepted = ACCEPTED_TOKEN && bearer === ACCEPTED_TOKEN;
  if (isSufficient || isAccepted) {
    res.json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          { type: 'text', text: `${SCOPE_GATED_TOOL}: ok` }
        ]
      }
    });
    return;
  }

  if (!bearer) {
    res.status(401)
      .set('WWW-Authenticate', `Bearer error="invalid_token"`)
      .json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Missing bearer token' }
      });
    return;
  }

  res
    .status(403)
    .set('WWW-Authenticate', buildChallenge())
    .json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: `Insufficient scope for tool: ${toolName}` }
    });
});

app.listen(PORT, () => {
  console.log(`scope-challenge-server listening on http://localhost:${PORT}/mcp`);
  console.log(`  required scope: ${REQUIRED_SCOPE}`);
  console.log(`  scope-gated tool: ${SCOPE_GATED_TOOL}`);
  console.log(`  sufficient token: ${SUFFICIENT_TOKEN}`);
  console.log(`  insufficient token: ${INSUFFICIENT_TOKEN}`);
  if (ACCEPTED_TOKEN) console.log(`  accepted token: ${ACCEPTED_TOKEN}`);
  if (RESOURCE_METADATA) console.log(`  resource_metadata: ${RESOURCE_METADATA}`);
});
