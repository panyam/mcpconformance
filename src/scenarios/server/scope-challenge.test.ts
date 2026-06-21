import { describe, it, expect } from 'vitest';
import {
  parseBearerChallenge,
  scopeSet,
  scopesEqual
} from './scope-challenge.js';

describe('parseBearerChallenge', () => {
  it('parses a typical insufficient_scope challenge', () => {
    const parsed = parseBearerChallenge(
      'Bearer error="insufficient_scope", scope="admin-write", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"'
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('Bearer');
    expect(parsed!.params['error']).toBe('insufficient_scope');
    expect(parsed!.params['scope']).toBe('admin-write');
    expect(parsed!.params['resource_metadata']).toBe(
      'https://api.example.com/.well-known/oauth-protected-resource'
    );
  });

  it('parses multiple space-separated scopes', () => {
    const parsed = parseBearerChallenge(
      'Bearer error="insufficient_scope", scope="tools-read admin-write"'
    );
    expect(parsed!.params['scope']).toBe('tools-read admin-write');
  });

  it('unescapes quoted-string backslash escapes per RFC 7235', () => {
    const parsed = parseBearerChallenge(
      'Bearer error_description="contains a \\"quote\\" inside"'
    );
    expect(parsed!.params['error_description']).toBe(
      'contains a "quote" inside'
    );
  });

  it('handles lowercase bearer scheme', () => {
    const parsed = parseBearerChallenge('bearer error="insufficient_scope"');
    expect(parsed).not.toBeNull();
    expect(parsed!.params['error']).toBe('insufficient_scope');
  });

  it('returns null for non-Bearer schemes', () => {
    expect(parseBearerChallenge('Basic realm="foo"')).toBeNull();
    expect(parseBearerChallenge('Digest realm="foo"')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseBearerChallenge('')).toBeNull();
    expect(parseBearerChallenge('   ')).toBeNull();
  });

  it('accepts token-shaped (unquoted) param values', () => {
    const parsed = parseBearerChallenge('Bearer error=insufficient_scope');
    expect(parsed!.params['error']).toBe('insufficient_scope');
  });

  it('lowercases param keys', () => {
    const parsed = parseBearerChallenge('Bearer Error="x", SCOPE="y"');
    expect(parsed!.params['error']).toBe('x');
    expect(parsed!.params['scope']).toBe('y');
  });
});

describe('scopeSet', () => {
  it('splits on whitespace', () => {
    expect(scopeSet('a b c')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns empty for null / undefined / empty', () => {
    expect(scopeSet(null)).toEqual(new Set());
    expect(scopeSet(undefined)).toEqual(new Set());
    expect(scopeSet('')).toEqual(new Set());
  });

  it('drops empty tokens from extra whitespace', () => {
    expect(scopeSet('  a   b  ')).toEqual(new Set(['a', 'b']));
  });

  it('deduplicates repeats', () => {
    expect(scopeSet('a b a')).toEqual(new Set(['a', 'b']));
  });
});

describe('scopesEqual', () => {
  it('treats space-separated lists as sets (order-independent)', () => {
    expect(scopesEqual('a b c', 'c b a')).toBe(true);
  });

  it('distinguishes proper subset / superset', () => {
    expect(scopesEqual('a b', 'a b c')).toBe(false);
    expect(scopesEqual('a b c', 'a b')).toBe(false);
  });

  it('treats null and empty as equal', () => {
    expect(scopesEqual(null, '')).toBe(true);
    expect(scopesEqual('', undefined)).toBe(true);
  });

  it('distinguishes empty from non-empty', () => {
    expect(scopesEqual('', 'a')).toBe(false);
    expect(scopesEqual('a', null)).toBe(false);
  });
});
