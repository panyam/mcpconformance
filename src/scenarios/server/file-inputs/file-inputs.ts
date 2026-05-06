/**
 * SEP-2356 — File Inputs — server-conformance scenarios.
 *
 * Verifies the wire-format contract for declarative file inputs:
 *
 *   - Tool input properties of `{type: "string", format: "uri"}` carrying
 *     the `x-mcp-file` JSON Schema extension keyword are advertised to
 *     clients that declare the `fileInputs` capability.
 *   - Servers MUST NOT include `x-mcp-file` in tool schemas (or
 *     elicitation `requestedSchema`) for clients without the capability.
 *     STRIP the keyword, KEEP the property visible as a plain
 *     `string`/`uri` so the tool stays callable on clients that haven't
 *     adopted SEP-2356.
 *   - Files travel as RFC 2397 base64 data URIs with an optional
 *     percent-encoded `name=` parameter:
 *         data:<mediatype>;name=<pct-encoded>;base64,<payload>
 *   - Servers reject oversized payloads with JSON-RPC `-32602` and
 *     structured `data: {reason: "file_too_large", actualSize, maxSize}`.
 *   - Servers reject MIME mismatches with `-32602` and
 *     `data: {reason: "file_type_not_accepted", mediaType, accept}`.
 *   - Both single-file and array-of-files inputs work; filenames with
 *     special characters round-trip through percent-encoding.
 *
 * Required server fixtures (must be registered as tools):
 *   upload_image       (accept: image/*, maxSize 5 MiB)  — single-file
 *   analyze_documents  (accept: application/pdf)          — array
 *   process_any_file   (no constraints)                   — unrestricted
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  ClientScenario,
  ConformanceCheck,
  ScenarioSpecTag,
  SpecReference,
  DRAFT_PROTOCOL_VERSION
} from '../../../types';

const SEP_2356_REF: SpecReference = {
  id: 'SEP-2356',
  url: 'https://github.com/modelcontextprotocol/specification/pull/2356'
};

// Passthrough Zod schema — preserves `x-mcp-file` keyword on inputSchema
// and other draft fields the SDK's typed result schemas would strip.
const AnyResult = z.object({}).passthrough();

export class FileInputsScenario implements ClientScenario {
  name = 'file-inputs';
  specVersions: ScenarioSpecTag[] = ['extension', DRAFT_PROTOCOL_VERSION];
  description = `Test SEP-2356 file inputs end-to-end on the server.

**Server Implementation Requirements:**

**Capability-gated schema visibility:**
- When the client declares the \`fileInputs\` capability during
  \`initialize\`, the server MUST advertise the \`x-mcp-file\` JSON Schema
  extension keyword on every file-input property in tools/list output —
  including array-items shapes for multi-file inputs.
- When the client does NOT declare \`fileInputs\`, the server MUST strip
  the \`x-mcp-file\` keyword but MUST KEEP the property visible as plain
  \`string\` / \`uri\` so the tool stays callable on clients that haven't
  adopted SEP-2356. (Interpretation: strip the keyword, not the
  property.)

**Wire format — RFC 2397 base64 data URI:**
- Files travel as \`data:<mediatype>[;name=<pct-encoded>];base64,<payload>\`.
- Filenames are percent-encoded matching Go's \`url.PathEscape\` —
  characters \`! ' ( ) *\` are encoded (which JavaScript's
  \`encodeURIComponent\` leaves alone).
- A round-trip through the server MUST recover bytes, mediaType, and
  filename verbatim.

**Server-side validation errors:**
- Oversized payload (size > descriptor's \`maxSize\`): JSON-RPC
  \`-32602\` with structured
  \`data: { reason: "file_too_large", actualSize: number, maxSize: number }\`.
- MIME mismatch (mediaType not matching descriptor's \`accept\` list):
  JSON-RPC \`-32602\` with
  \`data: { reason: "file_type_not_accepted", mediaType: string, accept: string[] }\`.

**Multi-file arrays:**
- A property of \`{type: "array", items: {type: "string", format: "uri",
  "x-mcp-file": ...}}\` MUST accept an array of data URIs and decode each.`;

  async run(serverUrl: string): Promise<ConformanceCheck[]> {
    const checks: ConformanceCheck[] = [];

    // Two parallel sessions: one declares fileInputs, one doesn't.
    let withCap: Client | undefined;
    let withoutCap: Client | undefined;
    try {
      withCap = await connect(serverUrl, { fileInputs: {} });
      withoutCap = await connect(serverUrl, {});
    } catch (error) {
      checks.push({
        id: 'file-inputs-session-bootstrap',
        name: 'FileInputsSessionBootstrap',
        description:
          'Initialize handshakes (with + without fileInputs cap) succeed',
        status: 'FAILURE',
        timestamp: new Date().toISOString(),
        errorMessage: `Failed to initialize: ${errMsg(error)}`,
        specReferences: [SEP_2356_REF]
      });
      return checks;
    }

    // Check 1: client with fileInputs cap sees x-mcp-file.
    {
      const id = 'file-inputs-x-mcp-file-with-cap';
      const name = 'FileInputsXMcpFileWithCap';
      const description =
        'When the client declares fileInputs, tools/list advertises x-mcp-file on every file-input property (single + array)';
      try {
        const list = (await withCap!.request(
          { method: 'tools/list', params: {} },
          AnyResult
        )) as any;
        const errs: string[] = [];
        const expected: Record<string, string> = {
          upload_image: 'image',
          analyze_documents: 'documents[]',
          process_any_file: 'file'
        };
        for (const [tool, expectedPath] of Object.entries(expected)) {
          const found = findFileInputPaths(getTool(list, tool).inputSchema);
          if (
            found.length !== 1 ||
            (found[0] !== expectedPath && !found[0].includes(expectedPath))
          ) {
            errs.push(
              `${tool}: expected x-mcp-file at "${expectedPath}"; got ${JSON.stringify(found)}`
            );
          }
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2356_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 2: client without cap does NOT see x-mcp-file (but tools stay).
    {
      const id = 'file-inputs-x-mcp-file-stripped-without-cap';
      const name = 'FileInputsXMcpFileStrippedWithoutCap';
      const description =
        'Without fileInputs cap, x-mcp-file is stripped from tools/list — but the underlying string/uri property MUST remain visible (legacy clients can still call the tool)';
      try {
        const list = (await withoutCap!.request(
          { method: 'tools/list', params: {} },
          AnyResult
        )) as any;
        const errs: string[] = [];
        for (const tool of [
          'upload_image',
          'analyze_documents',
          'process_any_file'
        ]) {
          const t = getTool(list, tool);
          const paths = findFileInputPaths(t.inputSchema);
          if (paths.length !== 0) {
            errs.push(
              `${tool}: x-mcp-file MUST be stripped without fileInputs cap; found at ${JSON.stringify(paths)}`
            );
          }
          // Property still visible.
          const props = t.inputSchema?.properties || {};
          const required = t.inputSchema?.required || [];
          for (const propName of required) {
            if (!props[propName]) {
              errs.push(
                `${tool}: required property "${propName}" was hidden along with x-mcp-file (interpretation: strip keyword only, keep property)`
              );
            }
          }
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2356_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 3: valid file upload round-trips bytes + mediaType + filename.
    {
      const id = 'file-inputs-valid-upload-roundtrip';
      const name = 'FileInputsValidUploadRoundtrip';
      const description =
        'A valid data URI (within maxSize, matching accept) is decoded by the server and bytes / media type / filename are recovered in the tool result';
      try {
        const png = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
          0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
          0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
        ]);
        const uri = makeDataURI('image/png', 'pixel.png', png);
        const result = (await withCap!.request(
          {
            method: 'tools/call',
            params: {
              name: 'upload_image',
              arguments: { image: uri, caption: 'conformance fixture' }
            }
          },
          AnyResult
        )) as any;
        const text = extractText(result);
        const errs: string[] = [];
        if (result.isError) {
          errs.push(`tool returned isError; result=${JSON.stringify(result)}`);
        }
        if (!/pixel\.png/.test(text)) {
          errs.push('response must echo decoded filename "pixel.png"');
        }
        if (!/image\/png/.test(text)) {
          errs.push('response must echo decoded media type "image/png"');
        }
        if (!/\b67\b/.test(text)) {
          errs.push('response must echo decoded byte count (67 bytes)');
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2356_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 4: oversized file → -32602 + reason file_too_large.
    {
      const id = 'file-inputs-oversized-rejected';
      const name = 'FileInputsOversizedRejected';
      const description =
        'Payload exceeding the descriptor\'s maxSize MUST be rejected with -32602 + structured data { reason: "file_too_large", actualSize, maxSize }';
      try {
        const maxSize = 5 * 1024 * 1024; // upload_image declares 5 MiB
        const oversized = Buffer.alloc(maxSize + 1024);
        const uri = makeDataURI('image/png', 'too-big.png', oversized);
        try {
          await withCap!.request(
            {
              method: 'tools/call',
              params: {
                name: 'upload_image',
                arguments: { image: uri }
              }
            },
            AnyResult
          );
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              'oversized upload returned a result instead of -32602',
            specReferences: [SEP_2356_REF]
          });
        } catch (e) {
          const errs = validateValidationError(e, {
            reason: 'file_too_large',
            checks: (data) => {
              const out: string[] = [];
              if (typeof data?.actualSize !== 'number') {
                out.push('error.data.actualSize MUST be a number');
              } else if (data.actualSize <= maxSize) {
                out.push(
                  `actualSize ${data.actualSize} should exceed maxSize ${maxSize}`
                );
              }
              if (data?.maxSize !== maxSize) {
                out.push(
                  `error.data.maxSize = ${data?.maxSize}, want ${maxSize}`
                );
              }
              return out;
            }
          });
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2356_REF]
          });
        }
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 5: wrong MIME → -32602 + reason file_type_not_accepted.
    {
      const id = 'file-inputs-wrong-mime-rejected';
      const name = 'FileInputsWrongMimeRejected';
      const description =
        'Payload whose mediaType doesn\'t match the descriptor\'s accept list MUST be rejected with -32602 + structured data { reason: "file_type_not_accepted", mediaType, accept }';
      try {
        const uri = makeDataURI(
          'text/plain',
          'not-an-image.txt',
          'hello world'
        );
        try {
          await withCap!.request(
            {
              method: 'tools/call',
              params: {
                name: 'upload_image',
                arguments: { image: uri }
              }
            },
            AnyResult
          );
          checks.push({
            id,
            name,
            description,
            status: 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage:
              'wrong-MIME upload returned a result instead of -32602',
            specReferences: [SEP_2356_REF]
          });
        } catch (e) {
          const errs = validateValidationError(e, {
            reason: 'file_type_not_accepted',
            checks: (data) => {
              const out: string[] = [];
              if (data?.mediaType !== 'text/plain') {
                out.push(
                  `error.data.mediaType = ${JSON.stringify(data?.mediaType)}, want "text/plain"`
                );
              }
              if (!Array.isArray(data?.accept)) {
                out.push(
                  'error.data.accept MUST be an array of accept patterns'
                );
              } else if (!data.accept.includes('image/*')) {
                out.push(
                  `error.data.accept = ${JSON.stringify(data.accept)} should include "image/*"`
                );
              }
              return out;
            }
          });
          checks.push({
            id,
            name,
            description,
            status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
            timestamp: new Date().toISOString(),
            errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
            specReferences: [SEP_2356_REF]
          });
        }
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 6: multi-file array input handles multiple data URIs.
    {
      const id = 'file-inputs-array-multi-file';
      const name = 'FileInputsArrayMultiFile';
      const description =
        'Array-of-files property accepts multiple data URIs and the server decodes each (FileInputArrayProperty: items.x-mcp-file shape)';
      try {
        const pdf = (label: string) =>
          Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'utf8');
        const docs = [
          makeDataURI('application/pdf', 'contract.pdf', pdf('contract')),
          makeDataURI('application/pdf', 'appendix.pdf', pdf('appendix'))
        ];
        const result = (await withCap!.request(
          {
            method: 'tools/call',
            params: {
              name: 'analyze_documents',
              arguments: { documents: docs }
            }
          },
          AnyResult
        )) as any;
        const text = extractText(result);
        const errs: string[] = [];
        if (result.isError) {
          errs.push(`tool returned isError; result=${JSON.stringify(result)}`);
        }
        if (!/contract\.pdf/.test(text)) {
          errs.push('response must echo first document filename');
        }
        if (!/appendix\.pdf/.test(text)) {
          errs.push('response must echo second document filename');
        }
        if (!/application\/pdf/.test(text)) {
          errs.push('response must echo PDF media type');
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2356_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    // Check 7: filename special chars round-trip through percent-encoding.
    {
      const id = 'file-inputs-filename-special-chars-roundtrip';
      const name = 'FileInputsFilenameSpecialCharsRoundtrip';
      const description =
        'Filename with characters outside the unreserved set (parens, spaces, quotes) round-trips end-to-end. Server-side decoder MUST reverse the percent-encoding faithfully (catches encoders that use only encodeURIComponent and leave parens unescaped)';
      try {
        const filename = "my photo (1) ' .png";
        const uri = makeDataURI(
          'image/png',
          filename,
          Buffer.from([0x89, 0x50, 0x4e, 0x47])
        );
        const errs: string[] = [];
        // Sanity-check our local encoder before sending.
        if (!/;name=my%20photo%20%281%29%20%27%20\.png;/.test(uri)) {
          errs.push(`local encoder output not in expected shape: ${uri}`);
        }
        const result = (await withCap!.request(
          {
            method: 'tools/call',
            params: { name: 'process_any_file', arguments: { file: uri } }
          },
          AnyResult
        )) as any;
        if (result.isError) {
          errs.push(`tool returned isError; result=${JSON.stringify(result)}`);
        }
        const text = extractText(result);
        if (!text.includes(filename)) {
          errs.push(
            `response must contain decoded filename ${JSON.stringify(filename)}; got: ${JSON.stringify(text)}`
          );
        }
        checks.push({
          id,
          name,
          description,
          status: errs.length === 0 ? 'SUCCESS' : 'FAILURE',
          timestamp: new Date().toISOString(),
          errorMessage: errs.length > 0 ? errs.join('; ') : undefined,
          specReferences: [SEP_2356_REF]
        });
      } catch (error) {
        checks.push(failureCheck(id, name, description, error, [SEP_2356_REF]));
      }
    }

    await withCap!.close();
    await withoutCap!.close();

    return checks;
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function connect(
  serverUrl: string,
  capabilities: Record<string, unknown>
): Promise<Client> {
  const client = new Client(
    { name: 'file-inputs-conformance', version: '1.0' },
    { capabilities }
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl)));
  return client;
}

/** Match Go's url.PathEscape — encodes `! ' ( ) *` which encodeURIComponent leaves alone. */
function pctEncodePathLike(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** Build a base64 data URI matching `core.EncodeDataURI` byte-for-byte. */
function makeDataURI(
  mediaType: string,
  filename: string,
  bytes: Buffer | string
): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  const namePart = filename ? `;name=${pctEncodePathLike(filename)}` : '';
  return `data:${mediaType}${namePart};base64,${buf.toString('base64')}`;
}

/** Walk an inputSchema and return the property paths that carry x-mcp-file. */
function findFileInputPaths(inputSchema: any): string[] {
  const found: string[] = [];
  function walk(node: any, path: string): void {
    if (node == null || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'x-mcp-file')) {
      found.push(path);
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const [k, v] of Object.entries(node.properties)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
    if (node.items) {
      walk(node.items, `${path}[]`);
    }
  }
  walk(inputSchema, '');
  return found;
}

function getTool(toolsList: any, name: string): any {
  const tool = (toolsList.tools || []).find((t: any) => t.name === name);
  if (!tool)
    throw new Error(
      `tool ${name} not found in tools/list result; available: ${(toolsList.tools || []).map((t: any) => t.name).join(', ')}`
    );
  return tool;
}

function extractText(callResult: any): string {
  const content = (callResult?.content || []) as Array<{
    type?: string;
    text?: string;
  }>;
  return content.map((c) => (c.type === 'text' ? c.text || '' : '')).join('\n');
}

interface ValidationCheckSpec {
  reason: string;
  checks: (data: any) => string[];
}

function validateValidationError(
  e: unknown,
  spec: ValidationCheckSpec
): string[] {
  const errs: string[] = [];
  if (!(e instanceof McpError) && !(e as any)?.code) {
    errs.push(`expected JSON-RPC error; got ${JSON.stringify(e)}`);
    return errs;
  }
  const code = (e as any).code;
  const data = (e as any).data;
  if (code !== -32602) {
    errs.push(`error.code = ${code}, want -32602`);
  }
  if (data?.reason !== spec.reason) {
    errs.push(
      `error.data.reason = ${JSON.stringify(data?.reason)}, want "${spec.reason}"`
    );
  }
  errs.push(...spec.checks(data));
  return errs;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureCheck(
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
