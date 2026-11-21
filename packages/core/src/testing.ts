import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { handlersOn } from "./api/Client.ts"
import type { Bridge } from "./locator/Bridge.ts"
import { FakeBridge, sampleQueue } from "./locator/FakeBridge.ts"
import { DevToolsPort } from "./transport/DevToolsPort.ts"

export { FakeBridge, sampleQueue }

// The handlers on a FakeBridge, for testing an adapter without Spotify.
// Launching is the one thing the fake can't do.
export const fakeOn = <E, R>(bridge: Layer.Layer<Bridge, E, R>) =>
  handlersOn(bridge).pipe(
    Layer.provide(Layer.succeed(DevToolsPort, 9222)),
    Layer.provide(Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("the fake core never launches Spotify"))
    ))
  )

export const fake = fakeOn(FakeBridge(sampleQueue, 0))
