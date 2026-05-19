/**
 * SEP-2549 — TTL for List Results — server-conformance scenarios.
 *
 * Tests an MCP server that emits the optional `ttl` (in seconds)
 * cache-freshness hint on every paginated list response (tools/list,
 * prompts/list, resources/list, resources/templates/list).
 *
 * Three-state contract per the spec:
 *   - absent  (`ttl` field omitted)         no server guidance
 *   - 0       (`"ttl": 0` explicit)         do not cache, always re-fetch
 *   - >0      (`"ttl": N`)                  fresh for N seconds
 *
 * The scenario exercises all three states, which requires three
 * separate fixture servers (one per state) — the wire shape of "absent"
 * cannot be expressed by a single multi-state server. The scenario
 * receives the positive-TTL URL via the standard `run(serverUrl)`
 * interface and reads the other two from the environment:
 *   - LIST_TTL_ZERO_URL   — server with explicit zero TTL
 *   - LIST_TTL_UNSET_URL  — server with no TTL configured
 *
 * If either env var is missing the affected checks emit `INFO` rather
 * than failing — they're "couldn't verify" rather than "spec violation."
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import {
  ClientScenario,
  ConformanceCheck,
  SpecReference,
  DRAFT_PROTOCOL_VERSION
} from '../../../types';

const SEP_2549_REF: SpecReference = {
  id: 'SEP-2549',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2549'
};

// Passthrough Zod schema — preserves `ttl` on list responses (the SDK's
// typed list-result schemas would strip unknown fields).
const AnyResult = z.object({}).passthrough();

const LIST_METHODS = [
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list'
] as const;

const LIST_PAYLOAD_KEYS: Record<(typeof LIST_METHODS)[number], string> = {
  'tools/list': 'tools',
  'prompts/list': 'prompts',
  'resources/list': 'resources',
  'resources/templates/list': 'resourceTemplates'
};

export class ListTtlScenario implements ClientScenario {
  name = 'list-ttl';
  readonly source = { introducedIn: DRAFT_PROTOCOL_VERSION } as const;
  description = `Test SEP-2549 TTL hints on paginated list responses across all three TTL states.

**Server Implementation Requirements:**

Every paginated list response (\`tools/list\`, \`prompts/list\`,
\`resources/list\`, \`resources/templates/list\`) MAY carry an optional
\`ttl\` field (number, seconds) hinting at cache freshness. The wire
contract distinguishes three states:

- **Absent** — server provides no guidance. Clients fall back to
  list_changed notifications or their own heuristics. The \`ttl\` key
  MUST NOT appear on the wire.
- **Explicit 0** — "do not cache, always re-fetch." The \`ttl\` key
  MUST be present with value \`0\`. This case catches servers that
  conflate "absent" and "0" (e.g., a naive \`int\` field with
  \`omitempty\` that drops &0).
- **Positive N** — fresh for N seconds. The \`ttl\` key MUST be
  present with value \`N\`.

**Type guarantees:**
- When present, \`ttl\` MUST be a JSON number (integer seconds).
- The same TTL state MUST surface uniformly on all four list endpoints
  (servers can't differentiate per-method without explicit mechanism).
- TTL coexists with the existing list payload arrays
  (\`tools\`/\`prompts\`/\`resources\`/\`resourceTemplates\`); it
  doesn't replace them or interfere with cursor-based pagination.

**Three-fixture contract (this scenario):**

Verifying all three states requires three independent fixture servers,
one per state. The scenario reads the positive-TTL URL via the standard
\`run(serverUrl)\` argument; the other two come from environment
variables:

- \`LIST_TTL_ZERO_URL\` — fixture with explicit-zero TTL
- \`LIST_TTL_UNSET_URL\` — fixture with no TTL configured

When either is missing, the affected checks emit \`INFO\` (couldn't
verify) rather than \`FAILURE\`.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    const zeroUrl = process.env.LIST_TTL_ZERO_URL;
    const unsetUrl = process.env.LIST_TTL_UNSET_URL;

    let positive: Client;
    try {
      positive = await connect(serverUrl);
    } catch (error) {
      checks.push({
        id: 'list-ttl-session-bootstrap',
        name: 'ListTtlSessionBootstrap',
        description:
          'Initialize handshake against positive-TTL fixture succeeds',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed to initialize: ${errMsg(error)}`,
        specReferences: [SEP_2549_REF]
      });
      return checks;
    }

    // Check 1: positive TTL surfaces on all four list endpoints with the
    // expected positive value AND is a JSON number.
    {
      const id = 'list-ttl-positive-on-all-endpoints';
      const name = 'ListTtlPositiveOnAllEndpoints';
      const description =
        'Positive TTL surfaces on all four list endpoints; value is a positive integer';
      try {
        const errs: string[] = [];
        let observedTtl: number | null = null;
        for (const method of LIST_METHODS) {
          const result = (await positive.request(
            { method, params: {} },
            AnyResult
          )) as any;
          if (typeof result.ttl !== 'number') {
            errs.push(
              `${method}: ttl MUST be a number; got ${typeof result.ttl}`
            );
            continue;
          }
          if (!Number.isInteger(result.ttl)) {
            errs.push(`${method}: ttl = ${result.ttl}, want integer`);
          }
          if (result.ttl <= 0) {
            errs.push(
              `${method}: ttl = ${result.ttl}, want positive (this fixture should advertise a positive TTL)`
            );
          }
          if (observedTtl === null) {
            observedTtl = result.ttl;
          } else if (observedTtl !== result.ttl) {
            errs.push(
              `${method}: ttl = ${result.ttl}, expected uniform across endpoints (${observedTtl})`
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
          specReferences: [SEP_2549_REF],
          details: { observedTtl }
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2549_REF]));
      }
    }

    // Check 2: explicit zero TTL is preserved (not omitted).
    {
      const id = 'list-ttl-explicit-zero-preserved';
      const name = 'ListTtlExplicitZeroPreserved';
      const description =
        'Explicit zero TTL ("do not cache") is present on the wire on every list endpoint — distinguishable from the absent case';
      if (!zeroUrl) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'LIST_TTL_ZERO_URL env var not set; cannot verify explicit-zero behavior',
          specReferences: [SEP_2549_REF]
        });
      } else {
        try {
          const zero = await connect(zeroUrl);
          const errs: string[] = [];
          for (const method of LIST_METHODS) {
            const result = (await zero.request(
              { method, params: {} },
              AnyResult
            )) as any;
            if (!('ttl' in result)) {
              errs.push(
                `${method}: ttl field MUST be present when server explicitly sets 0; raw=${JSON.stringify(result)}`
              );
            } else if (result.ttl !== 0) {
              errs.push(`${method}: ttl = ${result.ttl}, want 0`);
            }
          }
          await zero.close();
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2549_REF]
          });
        } catch (error) {
          checks.push(
            failureCheck(id, name, description, error, [SEP_2549_REF])
          );
        }
      }
    }

    // Check 3: ttl field is absent when server has no TTL configured.
    {
      const id = 'list-ttl-absent-when-unset';
      const name = 'ListTtlAbsentWhenUnset';
      const description =
        'ttl field MUST be absent (not present-with-zero) when server has no TTL configured — clients fall back to list_changed';
      if (!unsetUrl) {
        checks.push({
          id,
          name,
          description,
          status: 'INFO',
          timestamp: new Date().toISOString(),
          errorMessage:
            'LIST_TTL_UNSET_URL env var not set; cannot verify the absent path',
          specReferences: [SEP_2549_REF]
        });
      } else {
        try {
          const unset = await connect(unsetUrl);
          const errs: string[] = [];
          for (const method of LIST_METHODS) {
            const result = (await unset.request(
              { method, params: {} },
              AnyResult
            )) as any;
            if ('ttl' in result) {
              errs.push(
                `${method}: ttl MUST be absent when server has no TTL; raw=${JSON.stringify(result)}`
              );
            }
          }
          await unset.close();
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2549_REF]
          });
        } catch (error) {
          checks.push(
            failureCheck(id, name, description, error, [SEP_2549_REF])
          );
        }
      }
    }

    // Check 4: ttl coexists with the list payload arrays.
    {
      const id = 'list-ttl-coexists-with-payload';
      const name = 'ListTtlCoexistsWithPayload';
      const description =
        "TTL doesn't disturb cursor pagination or the existing payload arrays — regression guard against future field swaps";
      try {
        const errs: string[] = [];
        for (const method of LIST_METHODS) {
          const result = (await positive.request(
            { method, params: {} },
            AnyResult
          )) as any;
          const expectedKey = LIST_PAYLOAD_KEYS[method];
          if (!Array.isArray(result[expectedKey])) {
            errs.push(
              `${method}: ${expectedKey} array must be present alongside ttl; raw=${JSON.stringify(result)}`
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
          specReferences: [SEP_2549_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2549_REF]));
      }
    }

    // Check 5: ttl wire type is JSON number (catches *string-encoded TTLs).
    {
      const id = 'list-ttl-wire-type-is-number';
      const name = 'ListTtlWireTypeIsNumber';
      const description =
        'TTL MUST be a JSON number when present, never a string or boolean';
      try {
        const result = (await positive.request(
          { method: 'tools/list', params: {} },
          AnyResult
        )) as any;
        const errs: string[] = [];
        if (typeof result.ttl !== 'number') {
          errs.push(
            `ttl wire type = ${typeof result.ttl} (${JSON.stringify(result.ttl)}), want "number"`
          );
        } else if (!Number.isInteger(result.ttl)) {
          errs.push(`ttl = ${result.ttl}, want integer`);
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2549_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2549_REF]));
      }
    }

    await positive.close();
    return checks;
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function connect(serverUrl: string): Promise<Client> {
  const client = new Client(
    { name: 'list-ttl-conformance', version: '1.0' },
    { capabilities: {} }
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl)));
  return client;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureCheck(
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
