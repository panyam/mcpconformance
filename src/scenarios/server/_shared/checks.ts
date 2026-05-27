/**
 * Test-scaffolding helpers shared across server-conformance scenarios.
 *
 * Pure: no I/O, no async, no scenario-specific state. Every server
 * suite (tasks, mrtr, ...) emits checks in the same JSON shape and
 * derives them through the same FAILURE / SKIPPED helpers; pulling
 * them out of any one suite's helpers.ts makes them reusable.
 *
 * `AnyResult` is the Zod passthrough schema callers used to pair with
 * the official MCP TS SDK's `client.request(req, AnyResult)`. The raw
 * session helpers in `_shared/raw-session.ts` don't depend on Zod, but
 * scenarios that drive the SDK directly (or want to validate a
 * particular result shape later) keep using it.
 */

import { z } from 'zod';

import type { ConformanceCheck, SpecReference } from '../../../types';

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build a FAILURE check from a thrown error, preserving id/name/description. */
export function failureCheck(
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

/** Build a SKIPPED check (preserves id stability so Ctrl+F still finds it). */
export function skipCheck(
  id: string,
  name: string,
  description: string,
  reason: string,
  specReferences: SpecReference[]
): ConformanceCheck {
  return {
    id,
    name,
    description,
    status: 'SKIPPED',
    timestamp: new Date().toISOString(),
    errorMessage: `Skipped: ${reason}`,
    specReferences
  };
}

/**
 * Zod passthrough schema. Pair with `client.request(req, AnyResult)` to
 * preserve fields the SDK's typed result schemas would strip. Every
 * SEP-2663 / SEP-2322 wire field falls into this bucket today.
 */
export const AnyResult = z.object({}).passthrough();
