# spotrc

Controls the Spotify desktop app over the Chrome DevTools Protocol by calling Spotify's internal JS APIs. Built on Effect 4. One core holds every operation; the CLI, a JSON-RPC server and an MCP server are adapters on it. An npm workspace with four packages:

- `packages/core` (`@spotrc/core`) connects to Spotify, holds all Spotify logic and the operations table.
- `packages/cli` (`spotrc`) is the command line, the `spotrc` executable.
- `packages/jsonrpc` (`@spotrc/jsonrpc`) serves the operations as JSON-RPC 2.0 on stdio, the `spotrc-jsonrpc` executable.
- `packages/mcp` (`@spotrc/mcp`) serves the operations as MCP tools on stdio, the `spotrc-mcp` executable.

Each executable has its own `main.ts`, the only place it creates a runtime. Core's `DevToolsPort.layer` reads `SPOTRC_PORT`; the CLI's `--port` overrides it.

Node 24 runs the TypeScript directly through type stripping, so development has no build step. Bun is used only to compile the standalone binary.

## Commands

Run from the repository root.

- `npm ci` installs dependencies, Bun included, and the commit hooks.
- `npm run check` runs typecheck, lint and tests. It must pass before committing, and the pre-commit hook runs it.
- `npm run typecheck` is `effect-tsgo tsc`, so Effect diagnostics fail it too.
- `npm run lint` is Oxlint with the vendored anti-slop rules.
- `npm test` is Vitest.
- `npm run build:bin` compiles `dist/spotrc`, `dist/spotrc-jsonrpc` and `dist/spotrc-mcp`, standalone binaries with the Bun runtime inside.
- `node packages/cli/src/main.ts --help` runs the CLI.

## Layout

`packages/core/src/` is layered. Each layer imports only from the layers below it, and every layer may use `model/`.

- `index.ts` is the package's public API: `Client`, `live`, `fake`, the operations table and the model. Anything an adapter imports is exported here.
- `api/` is the domain API, what adapters call.
  - `operations.ts` is the operations table: an `RpcGroup` with one `Rpc` per operation, carrying its payload, success and error schemas and its description.
  - `handlers.ts` implements every operation on `Internals` and `Launcher`: waiting for Spotify to show a change, resolving names to playlists and devices, the playing-track defaults, and the domain errors.
  - `Client.ts` wires it up. `live` runs the handlers on the real app, `fake` and `fakeOn` on a `FakeBridge`, and `Client` calls them in-process.
- `locator/` is everything that knows Spotify's internals.
  - `Internals.ts` is Spotify's internal APIs as typed calls (`player.pause`, `library.add`, …). Its `uses` table lists every internal method spotrc calls, and `queries` every GraphQL query. `call` is typed against `uses`, and `checks` (what `doctor` returns) verifies both.
  - `raw.ts` holds the shapes Spotify's internal APIs return, and turns them into model types.
  - `Bridge.ts` is the seam below `Internals`. `CdpBridge.ts` runs the page agent through the transport, and `FakeBridge.ts` stands in for Spotify in tests.
  - `agent.ts` runs inside Spotify's page and only dispatches calls to Spotify's internals. It is sent as source text, so its function body must be self-contained.
- `transport/` reaches the app.
  - `Page.ts` finds Spotify's page through the DevTools port and evaluates code there. `Cdp.ts` is the WebSocket side of that.
  - `Launcher.ts` finds the Spotify process and opens it with the DevTools port, through `effect/process`.
  - `DevToolsPort.ts` is the service holding the port. Its `layer` reads `SPOTRC_PORT`, falling back to `defaultPort`.
- `model/` holds the Schema models, tagged errors, and pure helpers such as seek parsing.

`packages/core/test/` holds Vitest tests. Most call operations through `Client` on `FakeBridge`. `agent.test.ts` runs the agent from its source text against a fake page.

`packages/cli/src/`:

- `main.ts` is the entry point and the only place the CLI creates a runtime. The `spotrc` binary is compiled from it.
- `cli.ts` holds the command tree and the layer wiring. Commands parse arguments, call an operation through `Client`, and render the result.
- `render.ts` turns command results and errors into text or JSON.
- `settings.ts` defines the global `--json` and `--port` settings. `--port` fills in core's `DevToolsPort`.

`packages/jsonrpc/src/server.ts` is the table as JSON-RPC 2.0 over stdio, and the OpenRPC document `spotrc-jsonrpc --schema` prints. `main.ts` is the executable. It is a small JSON-RPC loop of its own rather than Effect's `RpcServer`, whose wire format carries Effect's `Cause` and stream framing that clients in other languages would have to copy. Changing its wire format breaks every client, so the README's serve section is the contract.

`packages/mcp/src/mcp.ts` derives one MCP tool per operation from the table. `main.ts` is the executable.

Each package's `test/` holds its tests. The adapter tests run on core's `fake`.

`scripts/commit-msg.ts` is the commit-msg hook that checks for conventional commits. `tools/oxlint/anti-slop/` is vendored. See its `UPSTREAM.md` before changing it.

## Rules

- Verify every Effect API against the JSDoc in `node_modules/effect/src` before using it. The installed source is the v4 truth. v3 names from memory, such as `Context.Tag`, `@effect/cli` and `catchAll`, are wrong here.
- Spotify logic belongs in `packages/core`. Adapters only turn their input into operations and present the results, so any other interface can reuse core unchanged.
- Add an operation to the table in `operations.ts`, any new internal call to `Internals`, then its handler in `handlers.ts`, then its CLI command. `spotrc-jsonrpc` and `spotrc-mcp` pick it up from the table.
- Operation payloads are domain values. Parsing CLI strings such as `1:30`, `+10` or links stays in the CLI command.
- An operation's description lives in the table. A CLI command that maps to exactly one operation uses `describe(tag)` for its help.
- Errors cross the protocol through the `SpotifyError` schema in `errors.ts`, which copies `message`, `hint` and `detail` into fields. Add a new error class to that union.
- `--json` output is the contract for programs that run the binary. Change its shape only on purpose, and mark the change as breaking.
- Every command returns data and pipes it through `present(toText)` (or `presentEach` for a stream) from `render.ts`, which prints the result or the error as text or JSON. Printing happens inside commands because the `--json` setting only exists in command context.
- Each error class carries its own exit code as `[Runtime.errorExitCode]`, with `[Runtime.errorReported] = false` so the runtime does not log it again. The codes are listed in `README.md`.
- `Flag.Boolean` needs `Flag.withDefault(false)`, or the flag becomes required.
- `locator/agent.ts` never imports Effect. Bump the agent's `version` whenever `agent.ts` changes, or Spotify keeps running the old copy.
- Keep core runnable on both Node and Bun. Use Effect's platform services, not Node-only globals, and run `npm run build:bin` after changing how core reaches the outside world.
- GraphQL queries are run by name. The agent reads each query's hash from Spotify's code, because the hash changes when Spotify changes the query. Never hardcode one.
- Handlers depend on `Internals` and `Launcher`, never on `Bridge` or `Page`. Every method name and argument shape of Spotify's lives in `Internals`. Adapters call operations through `Client`, never the layers below it.
- Decode everything Spotify returns with Schema in `raw.ts`, and turn decode failures into `InternalApiChanged` with `blameUpdate`.
- After a command, Spotify reports the old state for a moment. Wait for the change with `settle` or `pollUntil` in `handlers.ts`, and wait for every part of the change, not just the first.
- `FakeBridge` mirrors the real shapes. When `Internals` starts calling a new method, add a handler that behaves like Spotify's, including its quirks.
- Tests and fixtures use placeholder tracks, playlists and devices. Never commit data from a real Spotify account.
- Before a live check on a real Spotify, see whether it's playing. Record its state, including whether the playing track is liked, and restore it afterwards.
- Fix lint and Effect diagnostics in the code. Do not suppress them or lower their severity.
- Always write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, such as `feat(queue): add queue clear` or `fix(agent): skip placeholder playlists`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, `style` or `revert`. Scopes are optional and name the area, such as `playback`, `queue`, `library`, `playlist`, `devices`, `search`, `agent` or `cli`. Mark breaking changes with `!` after the type. The commit-msg hook rejects anything else.
