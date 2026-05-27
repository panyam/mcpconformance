/**
 * Tasks-specific helpers for SEP-2663 server-conformance scenarios.
 *
 * Only the bits that are genuinely tasks-shaped live here:
 *
 *   - `TASKS_EXTENSION_ID`: the extension identifier scenarios assert
 *     when checking server capabilities.
 *   - `waitForTerminal` / `waitForStatus`: tasks/get polling loops used
 *     by lifecycle, dispatch, and notification scenarios.
 *
 * Everything else that used to live here (the raw fetch session, the
 * SEP-2243 routing headers, the SEP refs, and the test scaffolding
 * helpers) has moved to `../_shared/` so other server suites can pull
 * them in without going through `tasks/`. Scenarios still import from
 * this file for `waitForTerminal` / `waitForStatus` and re-import the
 * shared primitives from their new locations.
 */

import type { RawSession } from '../_shared/raw-session';

export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';

/** Poll tasks/get until the task reaches a terminal state. */
export async function waitForTerminal(
  session: RawSession,
  taskId: string,
  timeoutMs = 10_000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = (await session.request('tasks/get', { taskId })) as any;
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
  session: RawSession,
  taskId: string,
  status: string,
  timeoutMs = 10_000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = (await session.request('tasks/get', { taskId })) as any;
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
