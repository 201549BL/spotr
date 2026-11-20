# spotr

TypeScript CLI that controls the Spotify desktop app over Chrome DevTools Protocol by calling Spotify's internal JS APIs. Built on Effect 4. Node 24 runs `src/main.ts` directly through type stripping, so there is no build step.

## Commands

Run from `cli/`.

- `npm ci` installs dependencies and the repo's pre-commit hook.
- `npm run check` runs typecheck, lint and tests. It must pass before committing. The pre-commit hook runs it when staged files touch `cli/`.
- `npm run typecheck` is `effect-tsgo tsc`, so Effect diagnostics fail it too.
- `npm run lint` is Oxlint with the vendored anti-slop rules.
- `npm test` is Vitest.
- `node src/main.ts --help` runs the CLI.

## Layout

- `src/main.ts` is the entry point and the only place a runtime is created.
- `src/cli.ts` holds the command tree and the layer wiring.
- `src/render.ts` turns command results and errors into text or JSON.
- `src/settings.ts` defines the global `--json` and `--port` settings.
- `src/domain/` holds the Schema models, tagged errors, and pure helpers such as seek parsing.
- `src/spotify/Spotify.ts` is the service commands use. Its `uses` table lists every internal method spotr calls. `call` is typed against it, and `doctor` checks it.
- `src/spotify/raw.ts` holds the shapes Spotify's internal APIs return, and turns them into domain types.
- `src/spotify/Launcher.ts` starts the Spotify app with the DevTools port open, through `effect/process`.
- `src/bridge/` is the seam to Spotify. `Bridge.ts` is the interface, `CdpBridge.ts` and `Cdp.ts` reach the real app, and `FakeBridge.ts` stands in for it in tests.
- `src/page/agent.ts` runs inside Spotify's page. It is sent as source text, so its function body must be self-contained.
- `test/` holds Vitest tests. Most run `Spotify` on `FakeBridge`. `agent.test.ts` runs the agent from its source text against a fake page.
- `tools/oxlint/anti-slop/` is vendored. See its `UPSTREAM.md` before changing it.

## Rules

- Verify every Effect API against the JSDoc in `node_modules/effect/src` before using it. The installed source is the v4 truth. v3 names from memory, such as `Context.Tag`, `@effect/cli` and `catchAll`, are wrong here.
- Every command returns data and pipes it through `present(toText)` (or `presentEach` for a stream) from `src/render.ts`, which prints the result or the error as text or JSON. Printing happens inside commands because the `--json` setting only exists in command context.
- Each error class carries its own exit code as `[Runtime.errorExitCode]`, with `[Runtime.errorReported] = false` so the runtime does not log it again. The codes are listed in `README.md`.
- `Flag.Boolean` needs `Flag.withDefault(false)`, or the flag becomes required.
- `src/page/` never imports Effect. Bump the agent's `version` whenever `agent.ts` changes, or Spotify keeps running the old copy.
- Commands depend on `Spotify` (and `Launcher`), never on `Bridge` directly.
- Decode everything Spotify returns with Schema in `raw.ts`, and turn decode failures into `InternalApiChanged` with `blameUpdate`.
- After a command, Spotify reports the old state for a moment. Wait for the change with `settle` or `pollUntil` in `Spotify.ts`.
- `FakeBridge` mirrors the real shapes. When `Spotify` starts calling a new method, add a handler that behaves like Spotify's, including its quirks.
- Tests and fixtures use placeholder tracks, playlists and devices. Never commit data from a real Spotify account.
- Fix lint and Effect diagnostics in the code. Do not suppress them or lower their severity.
