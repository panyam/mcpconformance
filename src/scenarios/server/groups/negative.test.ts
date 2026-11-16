import { describe, test, expect } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { testContext } from '../../../connection/testing';
import { DRAFT_PROTOCOL_VERSION } from '../../../types';
import { withRequiredDraftResultFields } from '../../../mock-server';
import { takeWireViolations } from '../../../validation/wire-schema';
import { GroupsScenario } from './groups';
import { GROUPS_EXTENSION_ID } from './helpers';

/**
 * Positive and negative controls for the groups scenario. The fixture is a
 * small server that gets every rule right: a group with a scoped tool, a
 * child group nested under two parents, flattening for clients without the
 * extension. Each negative test breaks one rule and asserts that the check
 * grading that rule fails, so no check passes only because it cannot fail.
 */

interface Fixture {
  declare: boolean;
  list: object[];
  get: Record<string, object | { error: number }>;
  unknownCode: number;
  scopedTools: object[];
  topLevelTools: object[];
  /** Tools a client with the extension sees; default: topLevelTools. */
  listForGroupsClient?: object[];
  /** Tools a client without the extension sees; default: top-level plus scoped. */
  listForPlainClient?: object[];
  callFails: boolean;
}

const child = {
  name: 'refunds',
  description: 'Refund flows. Use when a customer asks for money back.'
};
const scopedTool = {
  name: 'issue_refund',
  description: 'Issues a refund.',
  inputSchema: {
    type: 'object',
    properties: { invoice: { type: 'string' } },
    required: ['invoice']
  }
};
const topTool = {
  name: 'ping',
  description: 'Replies pong.',
  inputSchema: { type: 'object' }
};

function goodFixture(): Fixture {
  return {
    declare: true,
    list: [
      { name: 'billing', description: 'Billing work: invoices and refunds.' },
      { name: 'support', description: 'Customer support workflows.' }
    ],
    get: {
      billing: {
        instructions: 'Refunds live in the refunds group.',
        tools: [scopedTool],
        groups: [child]
      },
      support: {
        instructions: 'Start from the refunds group for money questions.',
        groups: [child]
      },
      refunds: { instructions: 'Call issue_refund with the invoice ID.' }
    },
    unknownCode: -32002,
    scopedTools: [scopedTool],
    topLevelTools: [topTool],
    callFails: false
  };
}

function declaresGroups(body: Record<string, unknown>): boolean {
  const meta = (body.params as Record<string, unknown> | undefined)?._meta as
    | Record<string, unknown>
    | undefined;
  const caps = meta?.['io.modelcontextprotocol/clientCapabilities'] as
    | Record<string, unknown>
    | undefined;
  const ext = caps?.extensions as Record<string, unknown> | undefined;
  return !!ext && GROUPS_EXTENSION_ID in ext;
}

async function readJsonBody(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
}

function startServer(f: Fixture): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const body = await readJsonBody(req);
    const method = body.method as string;
    const id = body.id;
    const params = (body.params as Record<string, unknown>) ?? {};
    const send = (result: object) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: withRequiredDraftResultFields(method, result)
        })
      );
    };
    const fail = (code: number, message: string) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
    };

    switch (method) {
      case 'server/discover':
        send({
          supportedVersions: [DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: f.declare ? { [GROUPS_EXTENSION_ID]: {} } : {}
          },
          serverInfo: { name: 'groups-negative', version: '1.0.0' }
        });
        return;
      case 'groups/list':
        send({ groups: f.list, ttlMs: 0, cacheScope: 'private' });
        return;
      case 'groups/get': {
        const got = f.get[params.name as string];
        if (!got)
          return fail(f.unknownCode, `unknown group ${String(params.name)}`);
        if ('error' in got)
          return fail(got.error, `cannot fetch ${String(params.name)}`);
        send({ ...got, ttlMs: 0, cacheScope: 'private' });
        return;
      }
      case 'tools/list': {
        const tools = declaresGroups(body)
          ? (f.listForGroupsClient ?? f.topLevelTools)
          : (f.listForPlainClient ?? [...f.topLevelTools, ...f.scopedTools]);
        send({ tools });
        return;
      }
      case 'tools/call':
        if (f.callFails)
          return fail(-32602, `unknown tool ${String(params.name)}`);
        send({ content: [{ type: 'text', text: 'ok' }] });
        return;
    }
    fail(-32601, `Method not found: ${method}`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://localhost:${addr.port}/mcp`, server });
    });
  });
}

async function checksFor(f: Fixture) {
  const { url, server } = await startServer(f);
  try {
    const checks = await new GroupsScenario().run(
      testContext(url, DRAFT_PROTOCOL_VERSION)
    );
    // Malformed fixtures may break the base schema too; the assertions below
    // are about the scenario's own checks.
    takeWireViolations();
    return new Map(checks.map((c) => [c.id, c]));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const statusOf = async (f: Fixture, id: string) =>
  (await checksFor(f)).get(id)?.status;

describe('groups scenario', () => {
  test('a server that gets every rule right passes every check', async () => {
    const checks = await checksFor(goodFixture());
    const notPassing = [...checks.values()]
      .filter((c) => c.status !== 'SUCCESS')
      .map((c) => `${c.id}: ${c.status} ${c.errorMessage ?? ''}`);
    expect(notPassing).toEqual([]);
    expect(checks.size).toBeGreaterThanOrEqual(13);
  });

  test('a server without the extension SKIPs every check', async () => {
    const checks = await checksFor({ ...goodFixture(), declare: false });
    expect(
      [...checks.values()]
        .filter((c) => c.id.startsWith('groups-'))
        .every((c) => c.status === 'SKIPPED')
    ).toBe(true);
  });

  test.each([
    ['uppercase', 'Billing'],
    ['an underscore', 'bill_ing'],
    ['a doubled hyphen', 'bill--ing'],
    ['a leading hyphen', '-billing'],
    ['65 characters', 'a'.repeat(65)]
  ])('a group name with %s fails groups-name-format', async (_label, name) => {
    const f = goodFixture();
    f.list = [{ name, description: 'x' }, ...f.list.slice(1)];
    f.get[name] = { instructions: 'x' };
    expect(await statusOf(f, 'groups-name-format')).toBe('FAILURE');
  });

  test('a group without a description fails groups-group-fields', async () => {
    const f = goodFixture();
    f.list = [{ name: 'billing' }, ...f.list.slice(1)];
    expect(await statusOf(f, 'groups-group-fields')).toBe('FAILURE');
  });

  test('a listed group that carries its tools fails groups-list-no-contents', async () => {
    const f = goodFixture();
    f.list = [{ ...f.list[0], tools: [scopedTool] }, ...f.list.slice(1)];
    expect(await statusOf(f, 'groups-list-no-contents')).toBe('FAILURE');
  });

  test('an empty groups/get result fails groups-get-not-empty', async () => {
    const f = goodFixture();
    f.get.support = {};
    expect(await statusOf(f, 'groups-get-not-empty')).toBe('FAILURE');
  });

  test('an unknown name answered with -32602 fails groups-get-unknown-name', async () => {
    expect(
      await statusOf(
        { ...goodFixture(), unknownCode: -32602 },
        'groups-get-unknown-name'
      )
    ).toBe('FAILURE');
  });

  test('a nested group groups/get cannot resolve fails groups-get-resolves-reachable', async () => {
    const f = goodFixture();
    f.get.refunds = { error: -32002 };
    expect(await statusOf(f, 'groups-get-resolves-reachable')).toBe('FAILURE');
  });

  test('a scoped tool without inputSchema fails groups-get-tool-definitions', async () => {
    const f = goodFixture();
    const bare = { name: 'issue_refund', description: 'Issues a refund.' };
    f.get.billing = { ...f.get.billing, tools: [bare] };
    expect(await statusOf(f, 'groups-get-tool-definitions')).toBe('FAILURE');
  });

  test('a scoped tool in tools/list for a groups client fails groups-scoped-tools-not-listed', async () => {
    const f = goodFixture();
    f.listForGroupsClient = [topTool, scopedTool];
    expect(await statusOf(f, 'groups-scoped-tools-not-listed')).toBe('FAILURE');
  });

  test('hiding a scoped tool from a plain client is a WARNING on groups-flatten-for-plain-client', async () => {
    const f = goodFixture();
    f.listForPlainClient = [topTool];
    expect(await statusOf(f, 'groups-flatten-for-plain-client')).toBe(
      'WARNING'
    );
  });

  test('a scoped tool that tools/call rejects fails groups-scoped-tool-callable', async () => {
    expect(
      await statusOf(
        { ...goodFixture(), callFails: true },
        'groups-scoped-tool-callable'
      )
    ).toBe('FAILURE');
  });

  test('a nested group that is also top-level fails groups-nested-not-top-level', async () => {
    const f = goodFixture();
    f.list = [...f.list, child];
    expect(await statusOf(f, 'groups-nested-not-top-level')).toBe('FAILURE');
  });

  test('a child that differs between parents fails groups-nested-identical', async () => {
    const f = goodFixture();
    f.get.support = {
      ...f.get.support,
      groups: [{ ...child, description: 'Something else.' }]
    };
    expect(await statusOf(f, 'groups-nested-identical')).toBe('FAILURE');
  });

  test('a cycle of nested groups does not hang the scenario', async () => {
    const f = goodFixture();
    f.get.refunds = {
      instructions: 'x',
      groups: [
        { name: 'billing', description: 'Billing work: invoices and refunds.' }
      ]
    };
    const checks = await checksFor(f);
    expect(checks.get('groups-get-resolves-reachable')?.status).toBe('SUCCESS');
  }, 15_000);
});
