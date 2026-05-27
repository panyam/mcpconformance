/**
 * Cross-suite SEP reference constants. Each check pushed by a scenario
 * carries a `specReferences` array of these; centralizing the values
 * here keeps URLs in one place when a SEP gets renumbered or its
 * canonical URL changes (e.g. when an upstream PR redirects to the
 * dated-release docs page).
 *
 * The tasks-specific SEP-2663 reference (and the MRTR `SEP_2322_REF`,
 * which mrtr/helpers.ts originally re-declared locally) live here
 * because both suites grade against the same canonical URLs.
 */

import type { SpecReference } from '../../../types';

export const SEP_2243_REF: SpecReference = {
  id: 'SEP-2243',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2243'
};

export const SEP_2322_REF: SpecReference = {
  id: 'SEP-2322',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2322'
};

export const SEP_2575_REF: SpecReference = {
  id: 'SEP-2575',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2575'
};

export const SEP_2663_REF: SpecReference = {
  id: 'SEP-2663',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2663'
};
