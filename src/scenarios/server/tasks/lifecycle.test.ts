/**
 * SEP-2663 Tasks extension test runner.
 *
 * Iterates the tasks server scenarios against a SEP-2663-conformant
 * server. Two ways to point at one — pick whichever fits:
 *
 *   1. Existing server already running:
 *        MCPKIT_TASKS_SERVER_URL=http://localhost:8080/mcp npm test -- lifecycle.test.ts
 *
 *   2. Auto-spawn a fixture binary in beforeAll (the binary must accept
 *      `--serve --addr :PORT` and bind Streamable HTTP at /mcp):
 *        MCPKIT_TASKS_BINARY=/path/to/tasks-server npm test -- lifecycle.test.ts
 *
 *   Optional: MCPKIT_TASKS_PORT overrides the auto-spawn port (default 18092).
 *
 * If neither is set, the suite is skipped — letting CI runs against the
 * everything-server stay green until the upstream fixture grows SEP-2663
 * support.
 *
 * The mcpkit reference fixture lives at
 * https://github.com/panyam/mcpkit/tree/main/examples/tasks-v2 (mcpkit
 * keeps its v1 surface alongside v2 internally; the fork only cares
 * about the SEP-2663 surface, hence the unsuffixed naming here).
 */

import { spawn, ChildProcess } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TasksLifecycleScenario } from './lifecycle';

const FIXTURE_BINARY = process.env.MCPKIT_TASKS_BINARY;
const EXTERNAL_URL = process.env.MCPKIT_TASKS_SERVER_URL;
const TEST_PORT = parseInt(process.env.MCPKIT_TASKS_PORT ?? '18092', 10);
const SERVER_URL = EXTERNAL_URL ?? `http://localhost:${TEST_PORT}/mcp`;
const SERVER_STARTUP_TIMEOUT_MS = 10_000;
// Spawn only when no external URL is provided AND a fixture binary is.
const SHOULD_SPAWN = !EXTERNAL_URL && Boolean(FIXTURE_BINARY);
const HAVE_TARGET = Boolean(EXTERNAL_URL) || SHOULD_SPAWN;

const TASKS_SCENARIOS = [new TasksLifecycleScenario()];

const describeIfTarget = HAVE_TARGET ? describe : describe.skip;

describeIfTarget('SEP-2663 Tasks — server conformance', () => {
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    if (!SHOULD_SPAWN) return;

    serverProcess = spawn(FIXTURE_BINARY!, ['--serve', '--addr', `:${TEST_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    serverProcess.stdout?.on('data', (b) => {
      stdoutBuf += b.toString();
    });
    serverProcess.stderr?.on('data', (b) => {
      stderrBuf += b.toString();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
        reject(
          new Error(
            `tasks fixture failed to start within ${SERVER_STARTUP_TIMEOUT_MS}ms.\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
          )
        );
      }, SERVER_STARTUP_TIMEOUT_MS);

      // mcpkit's tasks demo logs the listen address to stderr via the
      // log package; treat any "Connect:" or "listening" line as ready.
      const checkReady = (chunk: string) => {
        if (
          chunk.includes('Connect:') ||
          chunk.includes('listening') ||
          chunk.includes('Listening on')
        ) {
          clearTimeout(timer);
          resolve();
        }
      };
      serverProcess!.stdout?.on('data', (b) => checkReady(b.toString()));
      serverProcess!.stderr?.on('data', (b) => checkReady(b.toString()));

      serverProcess!.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn tasks fixture: ${err.message}`));
      });
      serverProcess!.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(
            new Error(
              `tasks fixture exited prematurely with code ${code}.\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
            )
          );
        }
      });
    });
  }, SERVER_STARTUP_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    if (!SHOULD_SPAWN) return;
    if (!serverProcess || serverProcess.killed) return;
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
        resolve();
      }, 3_000);
      serverProcess!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    serverProcess = null;
  });

  for (const scenario of TASKS_SCENARIOS) {
    it(`${scenario.name} — all checks succeed against fixture`, async () => {
      const checks = await scenario.run(SERVER_URL);
      expect(checks.length).toBeGreaterThan(0);
      const failures = checks.filter(
        (c) => c.status === 'FAILURE' || c.status === 'WARNING'
      );
      if (failures.length > 0) {
        // Surface the failing slugs and messages so vitest output points
        // at the exact spec-coverage gaps.
        const detail = failures
          .map((c) => `  - ${c.id}: ${c.errorMessage ?? '(no message)'}`)
          .join('\n');
        throw new Error(
          `${failures.length}/${checks.length} checks failed:\n${detail}`
        );
      }
    });
  }
});
