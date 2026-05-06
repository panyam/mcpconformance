/**
 * SEP-2549 List-TTL test runner.
 *
 * Iterates the list-ttl scenario against three SEP-2549-conformant
 * fixtures (positive / explicit-zero / unset TTL). Configuration:
 *
 *   1. Point at three already-running servers:
 *        LIST_TTL_POSITIVE_URL=http://localhost:18094/mcp \
 *        LIST_TTL_ZERO_URL=http://localhost:18095/mcp \
 *        LIST_TTL_UNSET_URL=http://localhost:18096/mcp \
 *          npm test -- list-ttl/list-ttl.test.ts
 *
 *   2. Auto-spawn three fixtures before tests (any language):
 *        LIST_TTL_POSITIVE_URL=... LIST_TTL_POSITIVE_CMD=... \
 *        LIST_TTL_ZERO_URL=...     LIST_TTL_ZERO_CMD=... \
 *        LIST_TTL_UNSET_URL=...    LIST_TTL_UNSET_CMD=... \
 *          npm test -- list-ttl/list-ttl.test.ts
 *
 * The scenario reads `LIST_TTL_POSITIVE_URL` via the standard
 * `run(serverUrl)` arg and the other two URLs from the environment.
 *
 * If `LIST_TTL_POSITIVE_URL` is unset the suite is skipped. Missing
 * `LIST_TTL_ZERO_URL` / `LIST_TTL_UNSET_URL` cause those checks to emit
 * INFO instead of FAILURE — verifying all three states is best-effort.
 *
 * The fixture servers can be implemented in any language; one example
 * reference impl spawns three Go binaries from
 * https://github.com/panyam/mcpkit/tree/main/examples/list-ttl.
 */

import { spawn, ChildProcess } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ListTtlScenario } from './list-ttl';
import { waitForServerReady } from '../_shared/test-runner';

const POSITIVE_URL = process.env.LIST_TTL_POSITIVE_URL;
const ZERO_URL = process.env.LIST_TTL_ZERO_URL;
const UNSET_URL = process.env.LIST_TTL_UNSET_URL;

const POSITIVE_CMD = process.env.LIST_TTL_POSITIVE_CMD;
const ZERO_CMD = process.env.LIST_TTL_ZERO_CMD;
const UNSET_CMD = process.env.LIST_TTL_UNSET_CMD;

const SERVER_STARTUP_TIMEOUT_MS = 15_000;

const HAVE_TARGET = Boolean(POSITIVE_URL);
const SHOULD_SPAWN_POSITIVE = Boolean(POSITIVE_URL && POSITIVE_CMD);
const SHOULD_SPAWN_ZERO = Boolean(ZERO_URL && ZERO_CMD);
const SHOULD_SPAWN_UNSET = Boolean(UNSET_URL && UNSET_CMD);

const describeIfTarget = HAVE_TARGET ? describe : describe.skip;

describeIfTarget('SEP-2549 List-TTL — server conformance', () => {
  const procs: ChildProcess[] = [];

  beforeAll(
    async () => {
      const spawns: Array<{ label: string; url: string; cmd: string }> = [];
      if (SHOULD_SPAWN_POSITIVE)
        spawns.push({
          label: 'positive',
          url: POSITIVE_URL!,
          cmd: POSITIVE_CMD!
        });
      if (SHOULD_SPAWN_ZERO)
        spawns.push({ label: 'zero', url: ZERO_URL!, cmd: ZERO_CMD! });
      if (SHOULD_SPAWN_UNSET)
        spawns.push({ label: 'unset', url: UNSET_URL!, cmd: UNSET_CMD! });

      for (const { label, url, cmd } of spawns) {
        const proc = spawn('sh', ['-c', cmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false
        });
        procs.push(proc);

        let stdoutBuf = '';
        let stderrBuf = '';
        proc.stdout?.on('data', (b) => {
          stdoutBuf += b.toString();
        });
        proc.stderr?.on('data', (b) => {
          stderrBuf += b.toString();
        });
        proc.on('exit', (code) => {
          if (code !== null && code !== 0) {
            console.error(
              `list-ttl ${label} fixture exited unexpectedly with code ${code}.\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
            );
          }
        });

        await waitForServerReady(url, SERVER_STARTUP_TIMEOUT_MS).catch(
          (err) => {
            for (const p of procs) {
              if (!p.killed) p.kill('SIGKILL');
            }
            throw new Error(
              `list-ttl ${label} fixture (${url}) did not become reachable within ${SERVER_STARTUP_TIMEOUT_MS}ms: ${err.message}\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
            );
          }
        );
      }
    },
    SERVER_STARTUP_TIMEOUT_MS * 3 + 5_000
  );

  afterAll(async () => {
    for (const proc of procs) {
      if (proc.killed) continue;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
          resolve();
        }, 3_000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    procs.length = 0;
  });

  it('list-ttl — all checks succeed across the three fixtures', async () => {
    const scenario = new ListTtlScenario();
    const checks = await scenario.run(POSITIVE_URL!);
    expect(checks.length).toBeGreaterThan(0);
    const failures = checks.filter(
      (c) => c.status === 'FAILURE' || c.status === 'WARNING'
    );
    if (failures.length > 0) {
      const detail = failures
        .map((c) => `  - ${c.id}: ${c.errorMessage ?? '(no message)'}`)
        .join('\n');
      throw new Error(
        `${failures.length}/${checks.length} checks failed:\n${detail}`
      );
    }
  });
});
