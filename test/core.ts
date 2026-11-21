import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { FakeBridge, sampleQueue } from "../src/core/bridge/FakeBridge.ts"
import { handlers } from "../src/core/handlers.ts"
import { Launcher } from "../src/core/spotify/Launcher.ts"
import { Spotify } from "../src/core/spotify/Spotify.ts"
import { Port } from "../src/settings.ts"

// The operation handlers on FakeBridge, as every adapter test uses them.
export const fakeCore = handlers.pipe(
  Layer.provide(Launcher.layer),
  Layer.provide(Spotify.layer),
  Layer.provide(FakeBridge(sampleQueue, 0)),
  Layer.provide(Layer.succeed(Port, 9222)),
  Layer.provide(Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("tests never launch Spotify"))
  ))
)
