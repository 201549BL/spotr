# spotr

Controls the Spotify desktop app over the Chrome DevTools Protocol by calling Spotify's internal JS APIs. Built on Effect 4. An npm workspace with two packages:

- `packages/core` (`spotr-core`) connects to Spotify and holds all Spotify logic.
- `packages/cli` (`spotr`) is the command line on top of it.

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
- `domain/` holds the Schema models, tagged errors, and pure helpers such as seek parsing.
- `spotify/Spotify.ts` is the service commands use, one method per operation. Its `uses` table lists every internal method spotr calls, and `queries` every GraphQL query. `call` is typed against `uses`, and `doctor` checks both.
- `spotify/raw.ts` holds the shapes Spotify's internal APIs return, and turns them into domain types.
- `spotify/Launcher.ts` starts the Spotify app with the DevTools port open, through `effect/process`.
- `DevToolsPort.ts` finds the port Spotify's DevTools listen on.
- `bridge/` is the seam to Spotify. `Bridge.ts` is the interface, `CdpBridge.ts` and `Cdp.ts` reach the real app, and `FakeBridge.ts` stands in for it in tests.
- `page/agent.ts` runs inside Spotify's page and only dispatches calls to Spotify's internals. It is sent as source text, so its function body must be self-contained.

`packages/core/test/` holds Vitest tests. Most run `Spotify` on `FakeBridge`. `agent.test.ts` runs the agent from its source text against a fake page.

`packages/cli/src/`:

- `main.ts` is the entry point and the only place a runtime is created. The binary is compiled from it.
- `cli.ts` holds the command tree and the layer wiring.
- `render.ts` turns command results and errors into text or JSON.
- `settings.ts` defines the global `--json` and `--port` settings.

`scripts/commit-msg.ts` is the commit-msg hook that checks for conventional commits. `tools/oxlint/anti-slop/` is vendored. See its `UPSTREAM.md` before changing it.

## Rules

- Verify every Effect API against the JSDoc in `node_modules/effect/src` before using it. The installed source is the v4 truth. v3 names from memory, such as `Context.Tag`, `@effect/cli` and `catchAll`, are wrong here.
- Spotify logic belongs in `packages/core`. The CLI only turns commands into `Spotify` calls and prints the results, so any other interface can reuse core unchanged.
- `--json` output is the contract for programs that run the binary. Change its shape only on purpose, and mark the change as breaking.
- Every command returns data and pipes it through `present(toText)` (or `presentEach` for a stream) from `render.ts`, which prints the result or the error as text or JSON. Printing happens inside commands because the `--json` setting only exists in command context.
- Each error class carries its own exit code as `[Runtime.errorExitCode]`, with `[Runtime.errorReported] = false` so the runtime does not log it again. The codes are listed in `README.md`.
- `Flag.Boolean` needs `Flag.withDefault(false)`, or the flag becomes required.
- `page/` never imports Effect. Bump the agent's `version` whenever `agent.ts` changes, or Spotify keeps running the old copy.
- Keep core runnable on both Node and Bun. Use Effect's platform services, not Node-only globals, and run `npm run build:bin` after changing how core reaches the outside world.
- GraphQL queries are run by name. The agent reads each query's hash from Spotify's code, because the hash changes when Spotify changes the query. Never hardcode one.
- Commands depend on `Spotify` (and `Launcher`), never on `Bridge` directly.
- Decode everything Spotify returns with Schema in `raw.ts`, and turn decode failures into `InternalApiChanged` with `blameUpdate`.
- After a command, Spotify reports the old state for a moment. Wait for the change with `settle` or `pollUntil` in `Spotify.ts`, and wait for every part of the change, not just the first.
- `FakeBridge` mirrors the real shapes. When `Spotify` starts calling a new method, add a handler that behaves like Spotify's, including its quirks.
- Tests and fixtures use placeholder tracks, playlists and devices. Never commit data from a real Spotify account.
- Before a live check on a real Spotify, see whether it's playing. Record its state, including whether the playing track is liked, and restore it afterwards.
- Fix lint and Effect diagnostics in the code. Do not suppress them or lower their severity.
- Always write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, such as `feat(queue): add queue clear` or `fix(agent): skip placeholder playlists`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, `style` or `revert`. Scopes are optional and name the area, such as `playback`, `queue`, `library`, `playlist`, `devices`, `search`, `agent` or `cli`. Mark breaking changes with `!` after the type. The commit-msg hook rejects anything else.
