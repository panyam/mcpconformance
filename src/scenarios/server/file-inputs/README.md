# SEP-2356 File Inputs — Server Conformance

Tests an MCP server that implements declarative file inputs per SEP-2356:

- Tool input properties of `{type: "string", format: "uri"}` carrying the `x-mcp-file` JSON Schema extension keyword (capability-gated).
- Files travel as RFC 2397 base64 data URIs with optional percent-encoded `name=` parameter.
- Server-side validation: oversized → `-32602 file_too_large`, wrong MIME → `-32602 file_type_not_accepted`.
- Single-file and array-of-files inputs both work.

Tagged `['extension', DRAFT_PROTOCOL_VERSION]`. Registered in `pendingClientScenariosList` so default `all-scenarios.test.ts` runs against the upstream `everything-server` skip this suite (the everything-server does not yet implement SEP-2356).

## ClientScenario class

### `file-inputs` (`file-inputs.ts`)

Single class with 7 internal `ConformanceCheck` records covering the full SEP-2356 surface (per AGENTS.md "fewer scenarios, more checks").

| Check                                          | What it tests                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file-inputs-x-mcp-file-with-cap`              | When client declares `fileInputs`, tools/list advertises `x-mcp-file` on every file-input property (single + array shapes)                                                                   |
| `file-inputs-x-mcp-file-stripped-without-cap`  | Without `fileInputs` cap, `x-mcp-file` is stripped from tool schemas BUT the underlying string/uri property remains visible (legacy clients can still call)                                  |
| `file-inputs-valid-upload-roundtrip`           | Valid data URI is decoded by the server; bytes / mediaType / filename recovered in the tool result                                                                                           |
| `file-inputs-oversized-rejected`               | Payload exceeding `maxSize` → `-32602` with `data: { reason: "file_too_large", actualSize, maxSize }`                                                                                        |
| `file-inputs-wrong-mime-rejected`              | Payload mediaType not matching `accept` → `-32602` with `data: { reason: "file_type_not_accepted", mediaType, accept }`                                                                      |
| `file-inputs-array-multi-file`                 | Array-of-files property accepts multiple data URIs; server decodes each                                                                                                                      |
| `file-inputs-filename-special-chars-roundtrip` | Filenames with parens / spaces / quotes round-trip via Go-`url.PathEscape`-compatible percent-encoding (catches encoders that use only `encodeURIComponent` and leave `! ' ( ) *` unescaped) |

## Required server fixtures

The fixture server MUST register these tools:

| Tool                | Behavior                                            |
| ------------------- | --------------------------------------------------- |
| `upload_image`      | Single-file picker; accept `image/*`, maxSize 5 MiB |
| `analyze_documents` | Array-of-files picker; accept `application/pdf`     |
| `process_any_file`  | Single-file picker; no constraints                  |

Any-language fixture works. One example reference implementation lives at https://github.com/panyam/mcpkit/tree/main/examples/file-inputs.

## Running

### Against an already-running server

```bash
FILE_INPUTS_SERVER_URL=http://localhost:8080/mcp \
  npx vitest run src/scenarios/server/file-inputs/
```

### Auto-spawn a fixture in `beforeAll`

```bash
FILE_INPUTS_SERVER_URL=http://localhost:18097/mcp \
FILE_INPUTS_SERVER_CMD="/path/to/file-inputs-server --port 18097" \
  npx vitest run src/scenarios/server/file-inputs/
```

If `FILE_INPUTS_SERVER_URL` is unset the suite is `describe.skip`'d.
