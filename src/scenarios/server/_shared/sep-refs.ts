/**
 * Cross-suite SEP reference constants. Each check pushed by a scenario
 * carries a `specReferences` array of these; centralizing the values
 * here keeps URLs in one place when a SEP gets renumbered or its
 * canonical URL changes.
 *
 * URLs point at the rendered SEP pages on modelcontextprotocol.io
 * rather than the merged PR URLs — the rendered pages absorb any
 * post-merge amendments the working group makes to the SEP text,
 * while the PR view freezes at the merge commit.
 */

import type { SpecReference } from '../../../types';

export const SEP_2243_REF: SpecReference = {
  id: 'SEP-2243',
  url: 'https://modelcontextprotocol.io/seps/2243-http-standardization'
};

export const SEP_2322_REF: SpecReference = {
  id: 'SEP-2322',
  url: 'https://modelcontextprotocol.io/seps/2322-MRTR'
};

export const SEP_2575_REF: SpecReference = {
  id: 'SEP-2575',
  url: 'https://modelcontextprotocol.io/seps/2575-stateless-mcp'
};

export const SEP_2663_REF: SpecReference = {
  id: 'SEP-2663',
  url: 'https://modelcontextprotocol.io/seps/2663-tasks-extension'
};
