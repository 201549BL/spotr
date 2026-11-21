# spotr

Controls the Spotify desktop app over the Chrome DevTools Protocol by calling Spotify's internal JS APIs. Built on Effect 4. One core holds every operation; the CLI, a JSON-RPC server and an MCP server are adapters on it. An npm workspace with two packages:

- `packages/core` (`spotr-core`) connects to Spotify, holds all Spotify logic and the operations table.
- `packages/cli` (`spotr`) is the binary: the command line, `spotr serve` and `spotr mcp`.

Node 24 runs the TypeScript directly through type stripping, so development has no build step. Bun is used only to compile the standalone binary.

## Commands

Run from the repository root.

- `npm ci` installs dependencies, Bun included, and the commit hooks.
- `npm run check` runs typecheck, lint and tests. It must pass before committing, and the pre-commit hook runs it.
- `npm run typecheck` is `effect-tsgo tsc`, so Effect diagnostics fail it too.
- `npm run lint` is Oxlint with the vendored anti-slop rules.
- `npm test` is Vitest.
- `npm run build:bin` compiles `dist/spotr`, a standalone binary with the Bun runtime inside.
- `node packages/cli/src/main.ts --help` runs the CLI.

## Layout

`packages/core/src/`:

- `index.ts` is the package's public API. Anything the CLI or another consumer imports is exported here.
- `operations.ts` is the operations table: an `RpcGroup` with one `Rpc` per operation, carrying its payload, success and error schemas and its description.
- `handlers.ts` maps each operation to `Spotify` or `Launcher`. `live` wires the handlers to the real app, and `Client` calls them in-process.
- `domain/` holds the Schema models, tagged errors, and pure helpers such as seek parsing.
- `spotify/Spotify.ts` is the service the handlers use, one method per operation. Its `uses` table lists every internal method spotr calls, and `queries` every GraphQL query. `call` is typed against `uses`, and `doctor` checks both.
- `spotify/raw.ts` holds the shapes Spotify's internal APIs return, and turns them into domain types.
- `spotify/Launcher.ts` starts the Spotify app with the DevTools port open, through `effect/process`.
- `DevToolsPort.ts` is the service holding the port Spotify's DevTools listen on. Each interface fills it in.
- `bridge/` is the seam to Spotify. `Bridge.ts` is the interface, `CdpBridge.ts` and `Cdp.ts` reach the real app, and `FakeBridge.ts` stands in for it in tests.
- `page/agent.ts` runs inside Spotify's page and only dispatches calls to Spotify's internals. It is sent as source text, so its function body must be self-contained.

`packages/core/test/` holds Vitest tests. Most run `Spotify` on `FakeBridge`. `agent.test.ts` runs the agent from its source text against a fake page.

`packages/cli/src/`:

- `main.ts` is the entry point and the only place a runtime is created. The binary is compiled from it.
- `cli.ts` holds the command tree and the layer wiring. Commands parse arguments, call an operation through `Client`, and render the result.
- `render.ts` turns command results and errors into text or JSON.
- `settings.ts` defines the global `--json` and `--port` settings. `--port` fills in core's `DevToolsPort`.
- `server.ts` is `spotr serve`, the table as JSON-RPC 2.0 over stdio, and the OpenRPC document `spotr schema` prints. It is a small JSON-RPC loop of its own rather than Effect's `RpcServer`, whose wire format carries Effect's `Cause` and stream framing that clients in other languages would have to copy. Changing its wire format breaks every client, so the README's serve section is the contract.
- `mcp.ts` is `spotr mcp`. It derives one MCP tool per operation from the table.

`packages/cli/test/` holds the adapter tests. `core.ts` puts the handlers on `FakeBridge` for them.

`scripts/commit-msg.ts` is the commit-msg hook that checks for conventional commits. `tools/oxlint/anti-slop/` is vendored. See its `UPSTREAM.md` before changing it.

## Rules

- Verify every Effect API against the JSDoc in `node_modules/effect/src` before using it. The installed source is the v4 truth. v3 names from memory, such as `Context.Tag`, `@effect/cli` and `catchAll`, are wrong here.
- Spotify logic belongs in `packages/core`. Adapters only turn their input into operations and present the results, so any other interface can reuse core unchanged.
- Add an operation to the table in `operations.ts`, then its handler in `handlers.ts`, then its CLI command. `serve`, `mcp` and `schema` pick it up from the table.
- Operation payloads are domain values. Parsing CLI strings such as `1:30`, `+10` or links stays in the CLI command.
- An operation's description lives in the table. A CLI command that maps to exactly one operation uses `describe(tag)` for its help.
- Errors cross the protocol through the `SpotifyError` schema in `errors.ts`, which copies `message`, `hint` and `detail` into fields. Add a new error class to that union.
- `--json` output is the contract for programs that run the binary. Change its shape only on purpose, and mark the change as breaking.
- Every command returns data and pipes it through `present(toText)` (or `presentEach` for a stream) from `render.ts`, which prints the result or the error as text or JSON. Printing happens inside commands because the `--json` setting only exists in command context.
- Each error class carries its own exit code as `[Runtime.errorExitCode]`, with `[Runtime.errorReported] = false` so the runtime does not log it again. The codes are listed in `README.md`.
- `Flag.Boolean` needs `Flag.withDefault(false)`, or the flag becomes required.
- `page/` never imports Effect. Bump the agent's `version` whenever `agent.ts` changes, or Spotify keeps running the old copy.
- Keep core runnable on both Node and Bun. Use Effect's platform services, not Node-only globals, and run `npm run build:bin` after changing how core reaches the outside world.
- GraphQL queries are run by name. The agent reads each query's hash from Spotify's code, because the hash changes when Spotify changes the query. Never hardcode one.
- Handlers depend on `Spotify` (and `Launcher`), never on `Bridge` directly. Commands and adapters call operations, never `Spotify`.
- Decode everything Spotify returns with Schema in `raw.ts`, and turn decode failures into `InternalApiChanged` with `blameUpdate`.
- After a command, Spotify reports the old state for a moment. Wait for the change with `settle` or `pollUntil` in `Spotify.ts`, and wait for every part of the change, not just the first.
- `FakeBridge` mirrors the real shapes. When `Spotify` starts calling a new method, add a handler that behaves like Spotify's, including its quirks.
- Tests and fixtures use placeholder tracks, playlists and devices. Never commit data from a real Spotify account.
- Before a live check on a real Spotify, see whether it's playing. Record its state, including whether the playing track is liked, and restore it afterwards.
- Fix lint and Effect diagnostics in the code. Do not suppress them or lower their severity.
- Always write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, such as `feat(queue): add queue clear` or `fix(agent): skip placeholder playlists`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, `style` or `revert`. Scopes are optional and name the area, such as `playback`, `queue`, `library`, `playlist`, `devices`, `search`, `agent` or `cli`. Mark breaking changes with `!` after the type. The commit-msg hook rejects anything else.
