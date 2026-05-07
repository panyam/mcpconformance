/**
 * Auth conformance test runner — Phase 1 (OAuth discovery).
 *
 * Iterates the auth server-conformance scenarios against an
 * MCP server that exposes the OAuth 2.0 discovery surface required
 * by MCP authorization spec (2025-11-25). Configuration is brand-
 * neutral and language-agnostic:
 *
 *   1. Point at an already-running server:
 *        AUTH_SERVER_URL=http://localhost:8080/mcp \
 *          npm test -- auth/auth.test.ts
 *
 *   2. Auto-spawn a fixture before tests (any language):
 *        AUTH_SERVER_URL=http://localhost:18098/mcp \
 *        AUTH_SERVER_CMD="/path/to/server --serve --addr=:18098" \
 *          npm test -- auth/auth.test.ts
 *
 * If AUTH_SERVER_URL is unset, the suite is skipped — keeping CI runs
 * against the upstream everything-server green until that fixture
 * grows the discovery surface.
 *
 * The fixture server can be implemented in any language as long as it
 * exposes the well-known endpoints required by the MCP authorization
 * spec. One example reference implementation lives at
 * https://github.com/panyam/mcpkit/tree/main/examples/auth.
 */

import { spawn, ChildProcess } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  AuthJwtClaimsScenario,
  AuthJwtValidationScenario,
  AuthOAuthDiscoveryScenario,
  AuthScopeStepUpScenario
} from './auth';
import { waitForServerReady } from '../_shared/test-runner';

const SERVER_URL = process.env.AUTH_SERVER_URL;
const SERVER_CMD = process.env.AUTH_SERVER_CMD;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const SHOULD_SPAWN = Boolean(SERVER_URL && SERVER_CMD);
const HAVE_TARGET = Boolean(SERVER_URL);

const AUTH_SCENARIOS = [
  new AuthOAuthDiscoveryScenario(),
  new AuthJwtValidationScenario(),
  new AuthJwtClaimsScenario(),
  new AuthScopeStepUpScenario()
];

const describeIfTarget = HAVE_TARGET ? describe : describe.skip;

describeIfTarget('MCP Auth — server-side discovery conformance', () => {
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
          `auth fixture exited unexpectedly with code ${code}.\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
        );
      }
    });

    await waitForServerReady(SERVER_URL!, SERVER_STARTUP_TIMEOUT_MS).catch(
      (err) => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
        throw new Error(
          `auth fixture did not become reachable within ${SERVER_STARTUP_TIMEOUT_MS}ms: ${err.message}\nSTDOUT: ${stdoutBuf}\nSTDERR: ${stderrBuf}`
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

  for (const scenario of AUTH_SCENARIOS) {
    it(`${scenario.name} — all checks succeed against fixture`, async () => {
      const checks = await scenario.run(SERVER_URL!);
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
  }
});
