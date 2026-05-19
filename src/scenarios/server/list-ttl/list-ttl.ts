/**
 * SEP-2549 — TTL for List Results — mcpkit-stricter sentinel.
 *
 * SEP-2549 merged Final on the MCP specification on 2026-05-15. Canonical,
 * brand-neutral conformance coverage of the merged spec lives upstream in
 * `modelcontextprotocol/conformance` PR 275 (`src/scenarios/server/caching.ts`,
 * branch `ttl-tests`). This file is a thin sentinel against the mcpkit
 * example fixture — it verifies the merged wire shape end-to-end and adds
 * one mcpkit-stricter check the spec deliberately leaves open.
 *
 * Merged wire shape, on `tools/list`, `prompts/list`, `resources/list`,
 * `resources/templates/list`, and `resources/read`:
 *   - `ttlMs`      number, integer milliseconds, cache-freshness hint
 *   - `cacheScope` string, "public" | "private", absent defaults to "public"
 *
 * Per the merged spec an absent `ttlMs` and an explicit `ttlMs: 0` are
 * client-equivalent ("immediately stale"). The mcpkit-stricter check below
 * verifies the example fixture nonetheless keeps the two distinct on the
 * wire — a server that conflates them (e.g. a naive `int` + `omitempty`)
 * is still spec-conformant, so this check is sentinel-only, not a spec gate.
 *
 * Verifying the three ttlMs states needs three fixture servers, one per
 * state. The scenario receives the positive-ttlMs URL via the standard
 * `run(serverUrl)` argument and reads the other two from the environment:
 *   - LIST_TTL_ZERO_URL   — fixture with explicit `ttlMs: 0`
 *   - LIST_TTL_UNSET_URL  — fixture with no cache hints configured
 *
 * If either env var is missing the affected checks emit `INFO` rather than
 * failing — they are "couldn't verify" rather than "spec violation."
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

// Passthrough Zod schema — preserves `ttlMs` / `cacheScope` on responses
// (the SDK's typed result schemas would strip unknown fields).
const AnyResult = z.object({}).passthrough();

// The five SEP-2549 cacheable endpoints. resources/read joined the coverage
// list mid-cycle; the mcpkit example registers file:///fixture for it.
const ENDPOINTS: ReadonlyArray<{
  method: string;
  params: Record<string, unknown>;
  payloadKey: string;
}> = [
  { method: 'tools/list', params: {}, payloadKey: 'tools' },
  { method: 'prompts/list', params: {}, payloadKey: 'prompts' },
  { method: 'resources/list', params: {}, payloadKey: 'resources' },
  {
    method: 'resources/templates/list',
    params: {},
    payloadKey: 'resourceTemplates'
  },
  {
    method: 'resources/read',
    params: { uri: 'file:///fixture' },
    payloadKey: 'contents'
  }
];

export class ListTtlScenario implements ClientScenario {
  name = 'list-ttl';
  readonly source = { introducedIn: DRAFT_PROTOCOL_VERSION } as const;
  description = `mcpkit-stricter sentinel for SEP-2549 (TTL for List Results).

Canonical, brand-neutral coverage of the merged spec lives upstream in
\`modelcontextprotocol/conformance\` PR 275 (\`src/scenarios/server/caching.ts\`).
This sentinel verifies the merged wire shape end-to-end against the mcpkit
example fixture and adds one mcpkit-stricter check.

**Merged wire shape:**

Each of \`tools/list\`, \`prompts/list\`, \`resources/list\`,
\`resources/templates/list\`, and \`resources/read\` MAY carry:

- \`ttlMs\` — number, integer milliseconds, cache-freshness hint.
- \`cacheScope\` — string, \`"public"\` or \`"private"\`; absent defaults
  to \`"public"\`.

**ttlMs states (three fixtures):**

- **Positive** — \`ttlMs\` present, positive integer; fresh for N ms.
- **Explicit zero** — \`ttlMs\` present with value \`0\`; immediately stale.
- **Unset** — \`ttlMs\` absent; clients treat it the same as \`0\`.

Per the merged spec absent and \`0\` are client-equivalent. The
\`list-ttl-explicit-zero-distinct\` check verifies the mcpkit fixture keeps
them distinct on the wire anyway — a server that conflates them is still
conformant, so that check is sentinel-only.

**Three-fixture contract:** the scenario reads the positive-ttlMs URL via
\`run(serverUrl)\`; \`LIST_TTL_ZERO_URL\` and \`LIST_TTL_UNSET_URL\` come
from the environment. Missing env vars downgrade the affected checks to
\`INFO\`.`;

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
          'Initialize handshake against the positive-ttlMs fixture succeeds',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed to initialize: ${errMsg(error)}`,
        specReferences: [SEP_2549_REF]
      });
      return checks;
    }

    // Check 1: positive ttlMs surfaces on every cacheable endpoint as a
    // positive integer JSON number, uniform across endpoints. The payload
    // array coexists with the hint (regression guard against field swaps).
    {
      const id = 'list-ttl-ms-positive-on-all-endpoints';
      const name = 'ListTtlMsPositiveOnAllEndpoints';
      const description =
        'ttlMs surfaces on all five SEP-2549 endpoints as a uniform positive integer, alongside the payload';
      try {
        const errs: string[] = [];
        let observed: number | null = null;
        for (const ep of ENDPOINTS) {
          const result = (await positive.request(
            { method: ep.method, params: ep.params },
            AnyResult
          )) as any;
          if (typeof result.ttlMs !== 'number') {
            errs.push(
              `${ep.method}: ttlMs MUST be a number; got ${typeof result.ttlMs}`
            );
          } else if (!Number.isInteger(result.ttlMs)) {
            errs.push(`${ep.method}: ttlMs = ${result.ttlMs}, want integer`);
          } else if (result.ttlMs <= 0) {
            errs.push(
              `${ep.method}: ttlMs = ${result.ttlMs}, want positive on this fixture`
            );
          } else if (observed === null) {
            observed = result.ttlMs;
          } else if (observed !== result.ttlMs) {
            errs.push(
              `${ep.method}: ttlMs = ${result.ttlMs}, expected uniform (${observed})`
            );
          }
          if (!(ep.payloadKey in result)) {
            errs.push(
              `${ep.method}: payload key "${ep.payloadKey}" missing alongside ttlMs`
            );
          }
        }
        checks.push(
          resultCheck(id, name, description, errs, { observedTtlMs: observed })
        );
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2549_REF]));
      }
    }

    // Check 2 (mcpkit-stricter): explicit `ttlMs: 0` is present on the wire,
    // distinct from the absent case. The merged spec treats absent and 0 as
    // client-equivalent, so this is a sentinel-only check, not a spec gate.
    {
      const id = 'list-ttl-explicit-zero-distinct';
      const name = 'ListTtlExplicitZeroDistinct';
      const description =
        'mcpkit-stricter: explicit ttlMs:0 is present on the wire, distinct from absent (spec treats the two as client-equivalent)';
      if (!zeroUrl) {
        checks.push(infoCheck(id, name, description, 'LIST_TTL_ZERO_URL'));
      } else {
        try {
          const zero = await connect(zeroUrl);
          const errs: string[] = [];
          for (const ep of ENDPOINTS) {
            const result = (await zero.request(
              { method: ep.method, params: ep.params },
              AnyResult
            )) as any;
            if (!('ttlMs' in result)) {
              errs.push(
                `${ep.method}: ttlMs MUST be present when the fixture sets 0; raw=${JSON.stringify(result)}`
              );
            } else if (result.ttlMs !== 0) {
              errs.push(`${ep.method}: ttlMs = ${result.ttlMs}, want 0`);
            }
          }
          await zero.close();
          checks.push(resultCheck(id, name, description, errs));
        } catch (error) {
          checks.push(
            failureCheck(id, name, description, error, [SEP_2549_REF])
          );
        }
      }
    }

    // Check 3: ttlMs is absent when the server configures no cache hints.
    {
      const id = 'list-ttl-ms-absent-when-unset';
      const name = 'ListTtlMsAbsentWhenUnset';
      const description =
        'ttlMs is absent when the server has no cache hints configured';
      if (!unsetUrl) {
        checks.push(infoCheck(id, name, description, 'LIST_TTL_UNSET_URL'));
      } else {
        try {
          const unset = await connect(unsetUrl);
          const errs: string[] = [];
          for (const ep of ENDPOINTS) {
            const result = (await unset.request(
              { method: ep.method, params: ep.params },
              AnyResult
            )) as any;
            if ('ttlMs' in result) {
              errs.push(
                `${ep.method}: ttlMs MUST be absent on the unset fixture; raw=${JSON.stringify(result)}`
              );
            }
            if ('cacheScope' in result) {
              errs.push(
                `${ep.method}: cacheScope MUST be absent on the unset fixture; raw=${JSON.stringify(result)}`
              );
            }
          }
          await unset.close();
          checks.push(resultCheck(id, name, description, errs));
        } catch (error) {
          checks.push(
            failureCheck(id, name, description, error, [SEP_2549_REF])
          );
        }
      }
    }

    // Check 4: cacheScope surfaces as the expected enum string on every
    // endpoint. The positive fixture advertises "public".
    {
      const id = 'list-ttl-cache-scope';
      const name = 'ListTtlCacheScope';
      const description =
        'cacheScope surfaces on all five SEP-2549 endpoints as a "public"/"private" string';
      try {
        const errs: string[] = [];
        for (const ep of ENDPOINTS) {
          const result = (await positive.request(
            { method: ep.method, params: ep.params },
            AnyResult
          )) as any;
          if (!('cacheScope' in result)) {
            errs.push(
              `${ep.method}: cacheScope MUST be present on this fixture; raw=${JSON.stringify(result)}`
            );
          } else if (
            result.cacheScope !== 'public' &&
            result.cacheScope !== 'private'
          ) {
            errs.push(
              `${ep.method}: cacheScope = ${JSON.stringify(result.cacheScope)}, want "public" or "private"`
            );
          }
        }
        checks.push(resultCheck(id, name, description, errs));
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2549_REF]));
      }
    }

    // Check 5: the pre-merge `ttl` (integer seconds) field MUST NOT appear —
    // regression guard for the SEP-2549 ttl -> ttlMs rename.
    {
      const id = 'list-ttl-no-stale-seconds-field';
      const name = 'ListTtlNoStaleSecondsField';
      const description =
        'the pre-merge `ttl` (seconds) field is gone — renamed to ttlMs (milliseconds)';
      try {
        const errs: string[] = [];
        for (const ep of ENDPOINTS) {
          const result = (await positive.request(
            { method: ep.method, params: ep.params },
            AnyResult
          )) as any;
          if ('ttl' in result) {
            errs.push(
              `${ep.method}: stale \`ttl\` field present; SEP-2549 renamed it to ttlMs; raw=${JSON.stringify(result)}`
            );
          }
        }
        checks.push(resultCheck(id, name, description, errs));
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

function resultCheck(
  id: string,
  name: string,
  description: string,
  errs: string[],
  details?: Record<string, unknown>
): ConformanceCheck {
  return {
    id,
    name,
    description,
    status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
    timestamp: new Date().toISOString(),
    errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
    specReferences: [SEP_2549_REF],
    details
  };
}

function infoCheck(
  id: string,
  name: string,
  description: string,
  missingEnvVar: string
): ConformanceCheck {
  return {
    id,
    name,
    description,
    status: 'INFO',
    timestamp: new Date().toISOString(),
    errorMessage: `${missingEnvVar} env var not set; cannot verify this fixture`,
    specReferences: [SEP_2549_REF]
  };
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
