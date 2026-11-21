import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ClientNotRunning, LaunchFailed, type SpotifyError, SpotifyWithoutDebugPort } from "../domain/errors.ts"
import { DevToolsPort } from "../DevToolsPort.ts"
import { Spotify } from "./Spotify.ts"

export class LaunchResult extends Schema.Class<LaunchResult, { readonly brand: unique symbol }>("LaunchResult")({
  started: Schema.Boolean,
  port: Schema.Int
}) {}

// Starts the Spotify app with its DevTools port open. macOS only: it uses
// `pgrep` and `open`.
export class Launcher extends Context.Service<Launcher, {
  readonly launch: Effect.Effect<LaunchResult, SpotifyError>
}>()("spotrc/Launcher") {
  static readonly layer = Layer.effect(
    Launcher,
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const port = yield* DevToolsPort

      const reachable = spotify.status.pipe(
        Effect.as(true),
        Effect.catchTag("ClientNotRunning", () => Effect.succeed(false))
      )

      const exitCode = (command: string, args: ReadonlyArray<string>) =>
        spawner.exitCode(ChildProcess.make(command, args)).pipe(
          Effect.mapError((error) => new LaunchFailed({ issue: `${command} failed: ${error.message}` }))
        )

      // No --remote-allow-origins flag: spotrc's WebSocket sends no Origin
      // header, and allowing every origin would let any web page drive
      // Spotify.
      const launch = Effect.gen(function* () {
        if (yield* reachable) return new LaunchResult({ started: false, port })

        if ((yield* exitCode("pgrep", ["-x", "Spotify"])) === 0) {
          return yield* new SpotifyWithoutDebugPort({ port })
        }

        const opened = yield* exitCode("open", ["-a", "Spotify", "--args", `--remote-debugging-port=${port}`])

        if (opened !== 0) return yield* new LaunchFailed({ issue: `open -a Spotify exited with ${opened}` })

        const ready = yield* reachable.pipe(
          Effect.repeat({ until: (up) => up, schedule: Schedule.spaced("500 millis"), times: 40 })
        )

        if (!ready) return yield* new ClientNotRunning({ port, reason: "port" })

        return new LaunchResult({ started: true, port })
      })

      return { launch }
    })
  )
}
