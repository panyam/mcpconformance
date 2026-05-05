/**
 * SEP-2663 Tasks Extension — wire-format / TTL conformance.
 *
 * Tests the renamed wire fields (ttlSeconds, pollIntervalMilliseconds),
 * the no-early-TTL-expiry rule, and confirms the v1 `related-task` _meta
 * key is absent on tasks/get's inlined result (taskId is at root level
 * already, so the metadata is redundant).
 *
 * Required server fixtures:
 *   - slow_compute — task-supporting, sleeps N seconds
 */

import {
  ClientScenario,
  ConformanceCheck,
  ScenarioSpecTag,
  DRAFT_PROTOCOL_VERSION
} from '../../../types';
import {
  TASKS_EXTENSION_ID,
  SEP_2663_REF,
  errMsg,
  failureCheck,
  skipCheck,
  initRawSession,
  rawRequest,
  waitForTerminal
} from './helpers';

export class TasksWireFieldsScenario implements ClientScenario {
  name = 'tasks-wire-fields';
  specVersions: ScenarioSpecTag[] = ['extension', DRAFT_PROTOCOL_VERSION];
  description = `Test SEP-2663 wire-field renames + TTL semantics.

**Server Implementation Requirements:**

**Wire-field renames (SEP-2663):**
- The TTL field is named \`ttlSeconds\` on the wire (the v1 \`ttl\`
  key is in milliseconds-by-convention; SEP-2663 puts the unit in the
  field name).
- The poll-interval field is named \`pollIntervalMilliseconds\` (v1
  used \`pollInterval\`).
- A \`CreateTaskResult\` MUST NOT carry the legacy \`ttl\` or
  \`pollInterval\` keys — clients keying off v1 names on a v2 server
  would silently miss the TTL guidance.

**TTL non-expiry (SEP-2663):**
- A task MUST remain accessible via \`tasks/get\` for the duration of
  its \`ttlSeconds\`; a server MUST NOT expire it earlier.

**Inlined-result \`_meta\` (SEP-2663):**
- The v1 \`io.modelcontextprotocol/related-task\` \`_meta\` key MUST NOT
  appear on tasks/get's inlined \`result\` — the \`taskId\` is already
  at the root level of the \`tasks/get\` response, so the metadata is
  redundant.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    let sessionId: string;
    try {
      ({ sessionId } = await initRawSession(serverUrl, {
        capabilities: {
          extensions: { [TASKS_EXTENSION_ID]: {} }
        }
      }));
    } catch (error) {
      checks.push({
        id: 'tasks-session-bootstrap',
        name: 'TasksSessionBootstrap',
        description:
          'Initialize handshake declaring io.modelcontextprotocol/tasks extension succeeds',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed to initialize: ${errMsg(error)}`,
        specReferences: [SEP_2663_REF]
      });
      return checks;
    }

    // Check 1: ttlSeconds + pollIntervalMilliseconds wire shape.
    let createdTaskId: string | undefined;
    {
      const id = 'tasks-wire-field-renames';
      const name = 'TasksWireFieldRenames';
      const description =
        'CreateTaskResult uses ttlSeconds + pollIntervalMilliseconds; legacy ttl / pollInterval keys absent';
      try {
        const result = await rawRequest(
          serverUrl,
          'tools/call',
          {
            name: 'slow_compute',
            arguments: { seconds: 1, label: 'wire-fields' }
          },
          { sessionId }
        );
        createdTaskId = result.taskId;
        const errs: string[] = [];
        // ttlSeconds — required, positive (or null = unlimited; treat
        // either as well-formed). Legacy `ttl` MUST be absent.
        if (!('ttlSeconds' in result)) {
          errs.push(
            'CreateTaskResult MUST carry ttlSeconds (renamed from v1 `ttl`)'
          );
        } else if (
          result.ttlSeconds !== null &&
          (typeof result.ttlSeconds !== 'number' || result.ttlSeconds <= 0)
        ) {
          errs.push(
            `ttlSeconds MUST be null or a positive number; got ${JSON.stringify(result.ttlSeconds)}`
          );
        }
        if ('ttl' in result) {
          errs.push(
            'CreateTaskResult MUST NOT carry the v1 `ttl` key (use ttlSeconds)'
          );
        }
        // pollIntervalMilliseconds — optional. When present it MUST be
        // a positive number and the legacy `pollInterval` key MUST NOT
        // appear.
        if (
          result.pollIntervalMilliseconds !== undefined &&
          (typeof result.pollIntervalMilliseconds !== 'number' ||
            result.pollIntervalMilliseconds <= 0)
        ) {
          errs.push(
            `pollIntervalMilliseconds MUST be a positive number when present; got ${JSON.stringify(result.pollIntervalMilliseconds)}`
          );
        }
        if ('pollInterval' in result) {
          errs.push(
            'CreateTaskResult MUST NOT carry the v1 `pollInterval` key (use pollIntervalMilliseconds)'
          );
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2663_REF],
          details: {
            ttlSeconds: result.ttlSeconds,
            pollIntervalMilliseconds: result.pollIntervalMilliseconds,
            hasLegacyTtl: 'ttl' in result,
            hasLegacyPollInterval: 'pollInterval' in result
          }
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2663_REF]));
      }
    }

    // Check 2: task accessible before TTL elapses.
    {
      const id = 'tasks-no-early-ttl-expiry';
      const name = 'TasksNoEarlyTtlExpiry';
      const description =
        'Task remains accessible via tasks/get for the duration of its ttlSeconds';
      if (!createdTaskId) {
        checks.push(skipCheck(id, name, description, 'no task created'));
      } else {
        try {
          await waitForTerminal(serverUrl, sessionId, createdTaskId);
          // Sanity probe well before TTL (the unit is seconds; servers
          // typically pick order-of-minutes defaults).
          await new Promise((r) => setTimeout(r, 500));
          const after = await rawRequest(
            serverUrl,
            'tasks/get',
            { taskId: createdTaskId },
            { sessionId }
          );
          const errs: string[] = [];
          if (after.taskId !== createdTaskId) {
            errs.push(
              `task MUST still be accessible before TTL; got taskId=${after.taskId}`
            );
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2663_REF]
          });
        } catch (error) {
          checks.push(
            failureCheck(id, name, description, error, [SEP_2663_REF])
          );
        }
      }
    }

    // Check 3: no related-task _meta on inlined result.
    {
      const id = 'tasks-no-related-task-meta-on-inlined-result';
      const name = 'TasksNoRelatedTaskMetaOnInlinedResult';
      const description =
        'tasks/get inlined result MUST NOT include the v1 io.modelcontextprotocol/related-task _meta key (taskId is at the root)';
      try {
        const created = await rawRequest(
          serverUrl,
          'tools/call',
          {
            name: 'slow_compute',
            arguments: { seconds: 1, label: 'wire-fields-meta' }
          },
          { sessionId }
        );
        const taskId = created.taskId;
        if (!taskId) {
          checks.push(skipCheck(id, name, description, 'no task created'));
        } else {
          const terminal = await waitForTerminal(serverUrl, sessionId, taskId);
          const errs: string[] = [];
          const meta = terminal.result?._meta;
          if (meta && meta['io.modelcontextprotocol/related-task']) {
            errs.push(
              'related-task _meta MUST NOT appear on tasks/get inlined result'
            );
          }
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2663_REF],
            details: {
              hasMeta: Boolean(meta),
              hasRelatedTask: Boolean(
                meta?.['io.modelcontextprotocol/related-task']
              )
            }
          });
        }
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2663_REF]));
      }
    }

    return checks;
  }
}
