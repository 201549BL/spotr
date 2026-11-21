import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { DevToolsPort, FakeBridge, handlers, Launcher, sampleQueue, Spotify } from "spotr-core"

// The operation handlers on FakeBridge, as every adapter test uses them.
export const fakeCore = handlers.pipe(
  Layer.provide(Launcher.layer),
  Layer.provide(Spotify.layer),
  Layer.provide(FakeBridge(sampleQueue, 0)),
  Layer.provide(Layer.succeed(DevToolsPort, 9222)),
  Layer.provide(Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("tests never launch Spotify"))
  ))
)
