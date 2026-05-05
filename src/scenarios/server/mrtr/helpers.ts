/**
 * MRTR (SEP-2322 ephemeral) scenario helpers.
 *
 * Reuses the raw-rpc + session bootstrap from the tasks scenarios since
 * MRTR's wire shape (resultType discriminator, requestState, inputRequests)
 * is the SEP-2322 base that SEP-2663 builds on. The MRTR resultType value
 * is centralized here so it's a one-liner to flip when the spec converges
 * (SEP-2322 draft uses "input_required", SEP-2663 draft uses "incomplete";
 * see prezaei comment on PR 2663 for the open question).
 */

import type { ConformanceCheck, SpecReference } from '../../../types';

export const SEP_2322_REF: SpecReference = {
  id: 'SEP-2322',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2322'
};

// SPEC WATCH — MRTR resultType discriminator value
// SEP-2322 (MRTR) and SEP-2663 (Tasks Extension) currently disagree on
// the wire value: SEP-2322's draft uses "input_required", SEP-2663's
// draft uses "incomplete". Awaiting alignment between SEP authors
// (PR 2663 comment 4381885336 + PR 2322 comment 4381884825). When the
// spec converges, this single constant flips.
export const MRTR_INCOMPLETE_RESULT_TYPE = 'incomplete';

export function isIncompleteResult(result: any): boolean {
  if (!result) return false;
  if (result.resultType === MRTR_INCOMPLETE_RESULT_TYPE) return true;
  return 'inputRequests' in result || 'requestState' in result;
}

export function isCompleteResult(result: any): boolean {
  if (!result) return false;
  if (result.resultType === 'complete') return true;
  if (!('resultType' in result)) return true;
  return !isIncompleteResult(result);
}

/** Build an ElicitResult-shaped mock response payload. */
export function mockElicitResponse(
  content: Record<string, unknown>
): Record<string, unknown> {
  return { action: 'accept', content };
}

/** Build a CreateMessageResult-shaped mock response payload. */
export function mockSamplingResponse(text: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: { type: 'text', text },
    model: 'test-model',
    stopReason: 'endTurn'
  };
}

/** Build a ListRootsResult-shaped mock response payload. */
export function mockListRootsResponse(): Record<string, unknown> {
  return { roots: [{ uri: 'file:///test/root', name: 'Test Root' }] };
}

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failureCheck(
  id: string,
  name: string,
  description: string,
  error: unknown,
  specReferences: SpecReference[] = [SEP_2322_REF]
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
