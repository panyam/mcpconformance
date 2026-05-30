# SEP-2322 MRTR — Server Conformance

Tests any MCP server that implements the SEP-2322 ephemeral
Multi Round-Trip Request flow on `tools/call` — the
`InputRequiredResult` → retry-with-`inputResponses` → `ToolResult`
contract that lets a tool gather elicitation / sampling / roots input
without creating a task envelope. The variant was renamed from
`IncompleteResult` / `"incomplete"` in SEP-2322 commit `de6d76fb`
(merged 2026-05-06).

## Specs covered

| SEP      | What it adds                                                                                                     | Where it shows up                                |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| SEP-2322 | Ephemeral MRTR — `resultType` discriminator, `inputRequests` / `inputResponses` keyed maps, `requestState` token | every check                                      |
| SEP-2663 | MRTR → Tasks composition (final round returns `CreateTaskResult`)                                                | `sep-2663-mrtr-synchronous-before-task-creation` |

## ClientScenario classes

### `mrtr-ephemeral-flow` (`ephemeral-flow.ts`)

A single scenario covering the full ephemeral MRTR contract — per the
AGENTS.md "fewer scenarios, more checks" rule. A server that
implemented elicitation round-trips but not sampling round-trips would
be incoherent, so they bundle.

| Check                                            | What it tests                                                                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mrtr-basic-elicitation-round-trip`              | Round 1 returns `InputRequiredResult` with `elicitation/create`; round 2 completes with the answer reflected                                                                        |
| `mrtr-sampling-round-trip`                       | Same flow with `sampling/createMessage`                                                                                                                                             |
| `mrtr-roots-list-round-trip`                     | Same flow with `roots/list`                                                                                                                                                         |
| `mrtr-request-state-round-trip`                  | When server emits `requestState`, it's a non-empty string and the server validates the echo                                                                                         |
| `mrtr-multiple-input-requests-one-round`         | A single `InputRequiredResult` MAY carry inputRequests for `elicitation/create` + `sampling/createMessage` + `roots/list` together                                                  |
| `mrtr-multi-round-flow`                          | A handler MAY take 2+ rounds; each round mints a fresh `requestState`; final result reflects answers from every round                                                               |
| `mrtr-wrong-input-key-rerequests`                | When client sends a wrong `inputResponses` key, server SHOULD re-request via `InputRequiredResult` rather than erroring                                                             |
| `sep-2663-mrtr-synchronous-before-task-creation` | MRTR → Tasks composition: handler exchanges `InputRequiredResult` rounds first, then returns `CreateTaskResult` on a subsequent round (SEP-2663 §"Task Creation", commit `451f5e1`) |

## Required server fixtures

The fixture server MUST register these tools:

| Tool                                     | Behavior                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `test_tool_with_elicitation`             | One `elicitation/create` round, completes with answer reflected                             |
| `test_incomplete_result_sampling`        | One `sampling/createMessage` round                                                          |
| `test_incomplete_result_list_roots`      | One `roots/list` round                                                                      |
| `test_incomplete_result_request_state`   | Exercises `requestState` validation; final result includes `state-ok` to confirm validation |
| `test_incomplete_result_multiple_inputs` | Emits 3+ inputRequests of different methods in one round                                    |
| `test_incomplete_result_multi_round`     | Drives 2+ MRTR rounds, final result references every answer                                 |
| `test_incomplete_result_elicitation`     | Emits inputRequest for `user_name`; server re-requests on wrong-key responses               |

The fixture can be implemented in any language; one example reference
implementation lives at
[`panyam/mcpkit/examples/mrtr`](https://github.com/panyam/mcpkit/tree/main/examples/mrtr).

## Running

```bash
# Against an already-running server
MRTR_SERVER_URL=http://localhost:8080/mcp \
  npx vitest run src/scenarios/server/mrtr/all-scenarios.test.ts

# Auto-spawn a fixture in beforeAll
MRTR_SERVER_URL=http://localhost:18093/mcp \
MRTR_SERVER_CMD="/path/to/mrtr-server --port 18093" \
  npx vitest run src/scenarios/server/mrtr/all-scenarios.test.ts
```

## Design notes

### Why the MRTR scenarios share helpers with `tasks/`

`MRTR_INPUT_REQUIRED_RESULT_TYPE`, the result-type predicates
(`isInputRequiredResult`, `isCompleteResult`), and the elicitation/sampling/
roots mocks live in `mrtr/helpers.ts`. The shared `AnyResult` Zod
passthrough schema and `waitForTerminal`/`waitForStatus` polling helpers
are imported from the sibling `../tasks/helpers` because both scenario
sets share the same wire-shape problem (SDK Zod schemas strip extension
fields). Pair `client.request(req, AnyResult)` with the SDK's
`StreamableHTTPClientTransport` and you preserve every SEP-2322 / SEP-2663
field. When the upstream SDK gains schemas for those shapes, the
passthrough disappears in favor of the typed schemas directly.
