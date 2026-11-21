import { Context, Effect, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { LaunchFailed } from "../model/errors.ts"
import { DevToolsPort } from "./DevToolsPort.ts"

// Starts and finds the Spotify app process. macOS only: it uses `pgrep`
// and `open`.
export class Launcher extends Context.Service<Launcher, {
  readonly running: Effect.Effect<boolean, LaunchFailed>
  // Opens Spotify with its DevTools port open. Returns once `open` does,
  // before Spotify answers.
  readonly open: Effect.Effect<void, LaunchFailed>
}>()("spotrc/Launcher") {
  static readonly layer = Layer.effect(
    Launcher,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const port = yield* DevToolsPort

      const exitCode = (command: string, args: ReadonlyArray<string>) =>
        spawner.exitCode(ChildProcess.make(command, args)).pipe(
          Effect.mapError((error) => new LaunchFailed({ issue: `${command} failed: ${error.message}` }))
        )

      const running = exitCode("pgrep", ["-x", "Spotify"]).pipe(Effect.map((code) => code === 0))

      // No --remote-allow-origins flag: spotrc's WebSocket sends no Origin
      // header, and allowing every origin would let any web page drive
      // Spotify.
      const open = Effect.gen(function* () {
        const code = yield* exitCode("open", ["-a", "Spotify", "--args", `--remote-debugging-port=${port}`])

        if (code !== 0) return yield* new LaunchFailed({ issue: `open -a Spotify exited with ${code}` })
      })

      return { running, open }
    })
  )
}
