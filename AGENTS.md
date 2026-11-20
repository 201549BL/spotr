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

spotr is being rebuilt one concept at a time so its owner can learn Effect. Add a folder only when the current step needs it, and don't jump ahead. The finished design (spotify/, domain/, bridge/, page/, test/) is committed on branch `worktree-agent-a1982c5e57f983af7` for reference.

- `src/main.ts` is the entry point and the only place a runtime is created.
- `src/cli.ts` holds the command tree and the layer wiring.
- `src/render.ts` turns command results and errors into text or JSON.
- `src/settings.ts` defines the global `--json` and `--port` settings.
- `src/domain/` holds the Schema models and tagged errors.
- `src/spotify/Spotify.ts` is the service commands use. It decodes Spotify's raw data into domain types.
- `src/bridge/` is the seam to Spotify. `Bridge.ts` is the interface, `CdpBridge.ts` and `Cdp.ts` reach the real app, and `FakeBridge.ts` stands in for it in tests.
- `src/page/agent.ts` runs inside Spotify's page. It is sent as source text, so its function body must be self-contained.
- `test/` holds Vitest tests, which run `Spotify` on `FakeBridge`.
- `tools/oxlint/anti-slop/` is vendored. See its `UPSTREAM.md` before changing it.

The rules below describe the finished design. Rules for pieces that don't exist yet apply once they're added.

## Rules

- Verify every Effect API against the JSDoc in `node_modules/effect/src` before using it. The installed source is the v4 truth. v3 names from memory, such as `Context.Tag`, `@effect/cli` and `catchAll`, are wrong here.
- Every command returns data and pipes it through `present(toText)` from `src/render.ts`, which prints the result or the error as text or JSON. Printing happens inside commands because the `--json` setting only exists in command context.
- Each error class carries its own exit code as `[Runtime.errorExitCode]`, with `[Runtime.errorReported] = false` so the runtime does not log it again.
- `Flag.Boolean` needs `Flag.withDefault(false)`, or the flag becomes required.
- `src/page/` never imports Effect. `src/page/registry.ts` is the only file that knows Spotify internals.
- Commands depend on `Spotify`, never on `Bridge` directly.
- Fix lint and Effect diagnostics in the code. Do not suppress them or lower their severity.
