/**
 * The groups extension (`io.modelcontextprotocol/groups`, progressive
 * disclosure): `groups/list`, `groups/get`, placement of scoped tools, and
 * nested groups.
 *
 * One scenario, many checks (AGENTS.md "fewer scenarios, more checks"). Each
 * check ID's verbatim spec quote lives in src/seps/groups.yaml.
 *
 * Discovery is dynamic and brand-neutral. The scenario walks whatever groups
 * the server lists, following each parent's `groups` with its own
 * `groups/get`, and hardcodes no group or tool name. A server that does not
 * declare the extension SKIPs everything. Checks that need something the
 * extension makes optional (nested groups, scoped tools) SKIP with a reason
 * when the server has none, the way an empty skills listing SKIPs the
 * skills entry checks.
 *
 * Scoped-tool placement is checked from two connections: one that declares
 * the extension, which must not see scoped tools in `tools/list`, and one
 * that does not, which by default should see them flattened to top level.
 */

import { isDeepStrictEqual } from 'util';
import type { ClientScenario, ConformanceCheck } from '../../../types';
import type { Connection, RunContext } from '../../../connection';
import {
  CONTENT_FIELDS,
  GROUPS_EXTENSION_ID,
  GROUPS_GET_METHOD,
  JSONRPC_RESOURCE_NOT_FOUND,
  MAX_GROUPS_FETCHED,
  type GetGroupResult,
  errorCodeOf,
  groupsCheck,
  isObject,
  joinErrs,
  listAllGroups,
  listAllToolNames,
  nameProblem,
  serverDeclaresGroups
} from './helpers';

const DECLARES_GROUPS = { extensions: { [GROUPS_EXTENSION_ID]: {} } };

/** A name no conformant server should have a group for. */
const UNKNOWN_GROUP = 'mcp-conformance-no-such-group-7c1e';

const ALL_CHECK_IDS = [
  'groups-list-result',
  'groups-group-fields',
  'groups-name-format',
  'groups-list-no-contents',
  'groups-get-not-empty',
  'groups-get-resolves-reachable',
  'groups-get-unknown-name',
  'groups-get-tool-definitions',
  'groups-scoped-tools-not-listed',
  'groups-flatten-for-plain-client',
  'groups-scoped-tool-callable',
  'groups-nested-not-top-level',
  'groups-nested-identical'
] as const;

/** Where a group was seen: in groups/list, or in a named parent's groups. */
interface Sighting {
  where: string;
  group: unknown;
}

export class GroupsScenario implements ClientScenario {
  name = 'groups';
  readonly source = { extensionId: GROUPS_EXTENSION_ID } as const;
  description = `Groups extension (progressive disclosure, WG draft): \`groups/list\`, \`groups/get\`, scoped tool placement and nested groups.

**Requirements covered** (each check carries a verbatim spec excerpt in src/seps/groups.yaml):

- \`groups-list-result\`: \`groups/list\` returns a \`groups\` array
- \`groups-group-fields\` / \`groups-name-format\`: every \`Group\` has a \`name\` and a \`description\`, and the name follows the identifier rule
- \`groups-list-no-contents\`: a listed \`Group\` carries no instructions or scoped primitives
- \`groups-get-not-empty\` / \`groups-get-resolves-reachable\` / \`groups-get-unknown-name\`: \`groups/get\` returns content for every reachable name and \`-32002\` for an unknown one
- \`groups-get-tool-definitions\`: scoped tools come as complete definitions with \`inputSchema\`
- \`groups-scoped-tools-not-listed\` / \`groups-flatten-for-plain-client\`: scoped tools stay out of \`tools/list\` for a client that declares the extension, and by default show up for one that does not
- \`groups-scoped-tool-callable\`: a scoped tool answers \`tools/call\` without its group being fetched first
- \`groups-nested-not-top-level\` / \`groups-nested-identical\`: a nested group is not also top-level, and is the same object under every parent

**Discovery is dynamic**: an undeclared extension SKIPs everything, and checks that need nested groups or scoped tools SKIP when the server has none.`;

  async run(ctx: RunContext): Promise<ConformanceCheck[]> {
    const conn = await ctx.connect({ capabilities: DECLARES_GROUPS });
    try {
      if (!(await serverDeclaresGroups(conn))) {
        const reason = `Server did not declare the ${GROUPS_EXTENSION_ID} extension; groups checks not applicable.`;
        return ALL_CHECK_IDS.map((id) =>
          groupsCheck(id, reason, 'SKIPPED', { errorMessage: reason })
        );
      }
      return await this.runDeclared(ctx, conn);
    } finally {
      await conn.close();
    }
  }

  private async runDeclared(
    ctx: RunContext,
    conn: Connection
  ): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    // groups/list
    let listed: unknown[];
    try {
      listed = await listAllGroups(conn);
      checks.push(
        groupsCheck(
          'groups-list-result',
          `groups/list returned ${listed.length} group(s)`,
          'SUCCESS'
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push(
        groupsCheck(
          'groups-list-result',
          'groups/list did not return a groups array',
          'FAILURE',
          { errorMessage: msg }
        )
      );
      const reason = `groups/list failed, so nothing else can be checked: ${msg}`;
      for (const id of ALL_CHECK_IDS.slice(1)) {
        checks.push(
          groupsCheck(id, reason, 'SKIPPED', { errorMessage: reason })
        );
      }
      return checks;
    }

    // Walk the graph: every listed group, then every child a fetched parent
    // names, each fetched once.
    const sightings = new Map<string, Sighting[]>();
    const results = new Map<string, GetGroupResult>();
    const getErrors: string[] = [];
    const topLevel = new Set<string>();
    const queue: string[] = [];
    const see = (group: unknown, where: string) => {
      if (!isObject(group) || typeof group.name !== 'string') return;
      const list = sightings.get(group.name) ?? [];
      list.push({ where, group });
      sightings.set(group.name, list);
      if (!results.has(group.name) && !queue.includes(group.name))
        queue.push(group.name);
    };
    for (const g of listed) {
      see(g, 'groups/list');
      if (isObject(g) && typeof g.name === 'string') topLevel.add(g.name);
    }
    let fetched = 0;
    while (queue.length && fetched < MAX_GROUPS_FETCHED) {
      const name = queue.shift()!;
      if (results.has(name)) continue;
      fetched++;
      try {
        const res = await conn.request<GetGroupResult>(GROUPS_GET_METHOD, {
          name
        });
        results.set(name, res);
        for (const child of Array.isArray(res.groups) ? res.groups : []) {
          see(child, `groups/get ${name}`);
        }
      } catch (err) {
        getErrors.push(
          `${name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    const nested = new Set(
      [...sightings.keys()].filter(
        (n) =>
          !topLevel.has(n) ||
          (sightings.get(n) ?? []).some((s) => s.where !== 'groups/list')
      )
    );

    // Group fields and names, wherever each group was seen.
    const fieldErrs: string[] = [];
    const nameErrs: string[] = [];
    const allSeen = [
      ...listed,
      ...[...results.values()].flatMap((r) =>
        Array.isArray(r.groups) ? r.groups : []
      )
    ];
    for (const g of allSeen) {
      if (!isObject(g)) {
        fieldErrs.push(`a group is not an object: ${JSON.stringify(g)}`);
        continue;
      }
      if (typeof g.name !== 'string')
        fieldErrs.push(
          `a group has no string name: ${JSON.stringify(g).slice(0, 120)}`
        );
      if (typeof g.description !== 'string')
        fieldErrs.push(`group ${String(g.name)} has no string description`);
      const bad = nameProblem(g.name);
      if (bad) nameErrs.push(bad);
    }
    checks.push(
      groupsCheck(
        'groups-group-fields',
        `Every Group has a string name and description (${allSeen.length} seen)`,
        fieldErrs.length ? 'FAILURE' : 'SUCCESS',
        fieldErrs.length ? { errorMessage: joinErrs(fieldErrs) } : {}
      )
    );
    checks.push(
      groupsCheck(
        'groups-name-format',
        'Every group name is 1 to 64 characters, lowercase alphanumeric and single hyphens',
        nameErrs.length ? 'FAILURE' : 'SUCCESS',
        nameErrs.length ? { errorMessage: joinErrs(nameErrs) } : {}
      )
    );

    // A listed Group is lightweight.
    const heavy: string[] = [];
    for (const g of listed) {
      if (!isObject(g)) continue;
      const extra = CONTENT_FIELDS.filter((f) => f in g);
      if (extra.length)
        heavy.push(`${String(g.name)} carries ${extra.join(', ')}`);
    }
    checks.push(
      groupsCheck(
        'groups-list-no-contents',
        'Listed groups carry no instructions or scoped primitives',
        heavy.length ? 'FAILURE' : 'SUCCESS',
        heavy.length ? { errorMessage: joinErrs(heavy) } : {}
      )
    );

    // groups/get content, and resolution of every reachable name.
    if (!sightings.size) {
      const reason =
        'groups/list returned no groups, so there is nothing to fetch.';
      for (const id of [
        'groups-get-not-empty',
        'groups-get-resolves-reachable'
      ] as const) {
        checks.push(
          groupsCheck(id, reason, 'SKIPPED', { errorMessage: reason })
        );
      }
    } else {
      const empty = [...results]
        .filter(([, r]) => !CONTENT_FIELDS.some((f) => r[f] !== undefined))
        .map(([n]) => n);
      checks.push(
        groupsCheck(
          'groups-get-not-empty',
          `Every groups/get result has instructions or contents (${results.size} fetched)`,
          empty.length ? 'FAILURE' : 'SUCCESS',
          empty.length
            ? {
                errorMessage: `groups/get returned none of ${CONTENT_FIELDS.join(', ')} for: ${joinErrs(empty)}`
              }
            : {}
        )
      );
      checks.push(
        groupsCheck(
          'groups-get-resolves-reachable',
          `groups/get answers every reachable group name (${sightings.size} reachable, ${nested.size} nested)`,
          getErrors.length ? 'FAILURE' : 'SUCCESS',
          getErrors.length ? { errorMessage: joinErrs(getErrors) } : {}
        )
      );
    }

    // Unknown name.
    const unknown = await errorCodeOf(
      conn.request(GROUPS_GET_METHOD, { name: UNKNOWN_GROUP })
    );
    const unknownOk = unknown.code === JSONRPC_RESOURCE_NOT_FOUND;
    checks.push(
      groupsCheck(
        'groups-get-unknown-name',
        `groups/get on an unknown name returns ${JSONRPC_RESOURCE_NOT_FOUND}`,
        unknownOk ? 'SUCCESS' : 'FAILURE',
        unknownOk
          ? {}
          : {
              errorMessage:
                unknown.code === undefined && !unknown.message
                  ? `groups/get ${UNKNOWN_GROUP} succeeded`
                  : `groups/get ${UNKNOWN_GROUP} returned code ${unknown.code ?? 'none'} (${unknown.message ?? ''}), want ${JSONRPC_RESOURCE_NOT_FOUND}`
            }
      )
    );

    // Scoped tools.
    const scoped = new Map<string, Record<string, unknown>>();
    const toolErrs: string[] = [];
    for (const [gname, r] of results) {
      for (const t of Array.isArray(r.tools) ? r.tools : []) {
        if (!isObject(t) || typeof t.name !== 'string') {
          toolErrs.push(`${gname}: a tool has no string name`);
          continue;
        }
        if (!isObject(t.inputSchema))
          toolErrs.push(`${gname}: tool ${t.name} has no inputSchema object`);
        scoped.set(t.name, t);
      }
    }
    if (!scoped.size && !toolErrs.length) {
      const reason =
        'No fetched group scopes any tools, so the scoped-tool checks have nothing to check.';
      for (const id of [
        'groups-get-tool-definitions',
        'groups-scoped-tools-not-listed',
        'groups-flatten-for-plain-client',
        'groups-scoped-tool-callable'
      ] as const) {
        checks.push(
          groupsCheck(id, reason, 'SKIPPED', { errorMessage: reason })
        );
      }
    } else {
      checks.push(
        groupsCheck(
          'groups-get-tool-definitions',
          `Scoped tools are complete definitions with inputSchema (${scoped.size} seen)`,
          toolErrs.length ? 'FAILURE' : 'SUCCESS',
          toolErrs.length ? { errorMessage: joinErrs(toolErrs) } : {}
        )
      );
      await this.checkPlacement(ctx, conn, scoped, checks);
    }

    // Nested groups.
    const nestedOnly = [...sightings].filter(([, s]) =>
      s.some((x) => x.where !== 'groups/list')
    );
    if (!nestedOnly.length) {
      const reason =
        'No fetched group lists child groups; nesting is optional.';
      for (const id of [
        'groups-nested-not-top-level',
        'groups-nested-identical'
      ] as const) {
        checks.push(
          groupsCheck(id, reason, 'SKIPPED', { errorMessage: reason })
        );
      }
    } else {
      const both = nestedOnly.filter(([n]) => topLevel.has(n)).map(([n]) => n);
      checks.push(
        groupsCheck(
          'groups-nested-not-top-level',
          `A nested group is not also listed at top level (${nestedOnly.length} nested)`,
          both.length ? 'FAILURE' : 'SUCCESS',
          both.length
            ? {
                errorMessage: `in groups/list and nested under a parent: ${joinErrs(both)}`
              }
            : {}
        )
      );
      const multi = [...sightings].filter(([, s]) => s.length > 1);
      if (!multi.length) {
        const reason =
          'No group appears in more than one place, so there is nothing to compare.';
        checks.push(
          groupsCheck('groups-nested-identical', reason, 'SKIPPED', {
            errorMessage: reason
          })
        );
      } else {
        const differ = multi
          .filter(([, s]) =>
            s.some((x) => !isDeepStrictEqual(x.group, s[0].group))
          )
          .map(([n, s]) => `${n} (${s.map((x) => x.where).join(' vs ')})`);
        checks.push(
          groupsCheck(
            'groups-nested-identical',
            `A group seen under several parents is the same object everywhere (${multi.length} such)`,
            differ.length ? 'FAILURE' : 'SUCCESS',
            differ.length ? { errorMessage: joinErrs(differ) } : {}
          )
        );
      }
    }

    return checks;
  }

  private async checkPlacement(
    ctx: RunContext,
    conn: Connection,
    scoped: Map<string, Record<string, unknown>>,
    checks: ConformanceCheck[]
  ): Promise<void> {
    const names = [...scoped.keys()];

    const declaredView = await listAllToolNames(conn);
    const leaked = names.filter((n) => declaredView.has(n));
    checks.push(
      groupsCheck(
        'groups-scoped-tools-not-listed',
        `Scoped tools stay out of tools/list for a client that declares the extension (${names.length} scoped)`,
        leaked.length ? 'FAILURE' : 'SUCCESS',
        leaked.length
          ? {
              errorMessage: `scoped and also in tools/list: ${joinErrs(leaked)}`
            }
          : {}
      )
    );

    const plain = await ctx.connect();
    try {
      const plainView = await listAllToolNames(plain);
      const hidden = names.filter((n) => !plainView.has(n));
      checks.push(
        groupsCheck(
          'groups-flatten-for-plain-client',
          `By default a client without the extension sees scoped tools in tools/list`,
          hidden.length ? 'WARNING' : 'SUCCESS',
          hidden.length
            ? {
                errorMessage: `not flattened for a client without the extension: ${joinErrs(hidden)}`
              }
            : {}
        )
      );
    } finally {
      await plain.close();
    }

    // A fresh connection that has fetched no group calls one scoped tool.
    const [toolName, tool] = [...scoped][0];
    const fresh = await ctx.connect({ capabilities: DECLARES_GROUPS });
    try {
      const res = await errorCodeOf(
        fresh.request('tools/call', {
          name: toolName,
          arguments: minimalArguments(tool.inputSchema)
        })
      );
      const ok = res.code === undefined && !res.message;
      checks.push(
        groupsCheck(
          'groups-scoped-tool-callable',
          `Scoped tool ${toolName} answers tools/call before its group is fetched`,
          ok ? 'SUCCESS' : 'FAILURE',
          ok
            ? {}
            : {
                errorMessage: `tools/call ${toolName} failed with code ${res.code ?? 'none'}: ${res.message ?? ''}`
              }
        )
      );
    } finally {
      await fresh.close();
    }
  }
}

/**
 * Arguments that satisfy a schema's required primitive properties, so the
 * call reaches the tool. The check grades whether the tool is invokable, not
 * what it returns, so a tool-level isError result still passes.
 */
function minimalArguments(schema: unknown): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!isObject(schema) || !isObject(schema.properties)) return args;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key !== 'string') continue;
    const prop = (schema.properties as Record<string, unknown>)[key];
    const type = isObject(prop) ? prop.type : undefined;
    if (isObject(prop) && Array.isArray(prop.enum) && prop.enum.length)
      args[key] = prop.enum[0];
    else if (type === 'integer' || type === 'number') args[key] = 1;
    else if (type === 'boolean') args[key] = true;
    else if (type === 'array') args[key] = [];
    else if (type === 'object') args[key] = {};
    else args[key] = 'conformance';
  }
  return args;
}
