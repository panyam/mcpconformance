/**
 * SEP-2322 MRTR test runner.
 *
 * Iterates the MRTR scenario classes against a SEP-2322-conformant
 * server. Configuration is brand-neutral and language-agnostic:
 *
 *   1. Point at an already-running server:
 *        MRTR_SERVER_URL=http://localhost:8080/mcp npm test -- mrtr/all-scenarios.test.ts
 *
 *   2. Auto-spawn a fixture before tests (any language):
 *        MRTR_SERVER_URL=http://localhost:18093/mcp \
 *        MRTR_SERVER_CMD="/path/to/server --port 18093" \
 *          npm test -- mrtr/all-scenarios.test.ts
 *
 * If MRTR_SERVER_URL is unset the suite is skipped — keeping CI runs
 * against the everything-server green.
 *
 * The fixture server can be implemented in any language as long as it
 * exposes a SEP-2322 conformant Streamable HTTP MCP endpoint. Anyone is
 * free to bring their own; one example reference implementation lives
 * at https://github.com/panyam/mcpkit/tree/main/examples/mrtr.
 */

import { spawn, ChildProcess } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MrtrEphemeralFlowScenario } from './ephemeral-flow';
import { waitForServerReady } from '../_shared/test-runner';

const SERVER_URL = process.env.MRTR_SERVER_URL;
const SERVER_CMD = process.env.MRTR_SERVER_CMD;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const SHOULD_SPAWN = Boolean(SERVER_URL && SERVER_CMD);
const HAVE_TARGET = Boolean(SERVER_URL);

const MRTR_SCENARIOS = [new MrtrEphemeralFlowScenario()];

// SEP-2322 ephemeral MRTR (InputRequiredResult on tools/call) is
// wire-independent in spec, so the harness runs every scenario
// against both the legacy session wire AND the SEP-2575 stateless
// wire by default. Pin with MCP_WIRE_MODES=legacy or
// MCP_WIRE_MODES=stateless when an SDK has only one wire
// implemented. Shares the env var and the setDefaultWireStateless
// hook with the tasks suite — wire mode is a cross-cutting
// conformance concern, one knob drives both.
type WireMode = 'legacy' | 'stateless';

const VALID_MODES: ReadonlySet<WireMode> = new Set(['legacy', 'stateless']);

const DEFAULT_WIRE_MODES: WireMode[] = ['legacy', 'stateless'];

function parseWireModes(): WireMode[] {
  const raw = process.env.MCP_WIRE_MODES;
  if (!raw) return DEFAULT_WIRE_MODES;
  const modes = raw
    .split(',')
    .map((s) => s.trim().toLowerCase() as WireMode)
    .filter((m) => VALID_MODES.has(m));
  return modes.length > 0 ? modes : DEFAULT_WIRE_MODES;
}

const WIRE_MODES: WireMode[] = parseWireModes();

// describe.each / it.each table shape: tuple of (label, statelessFlag) so
// vitest reports the wire as a clean parameter row.
const WIRE_TABLE: ReadonlyArray<readonly [WireMode, boolean]> = WIRE_MODES.map(
  (m) => [m, m === 'stateless'] as const
);

const describeIfTarget = HAVE_TARGET ? describe : describe.skip;

describeIfTarget('SEP-2322 MRTR — server conformance', () => {
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    if (!SHOULD_SPAWN) return;

    serverProcess = spawn('sh', ['-c', SERVER_CMD!], {
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

    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(
          `mrtr fixture exited unexpectedly with code ${code}.\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
        );
      }
    });

    await waitForServerReady(SERVER_URL!, SERVER_STARTUP_TIMEOUT_MS).catch(
      (err) => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
        throw new Error(
          `mrtr fixture did not become reachable within ${SERVER_STARTUP_TIMEOUT_MS}ms: ${err.message}\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
        );
      }
    );
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

  describe.each(WIRE_TABLE)('%s wire', (_wireLabel, stateless) => {
    it.each(MRTR_SCENARIOS)(
      '$name — all checks succeed against fixture',
      async (scenario) => {
        const checks = await scenario.run(SERVER_URL!, { stateless });
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
      }
    );
  });
});
