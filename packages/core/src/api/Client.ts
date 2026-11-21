import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"
import { type RpcClient, RpcTest } from "effect/rpc"
import { Socket } from "effect/socket"
import { CdpBridge } from "../locator/CdpBridge.ts"
import { FakeBridge, sampleQueue } from "../locator/FakeBridge.ts"
import { Internals } from "../locator/Internals.ts"
import type { Bridge } from "../locator/Bridge.ts"
import { DevToolsPort } from "../transport/DevToolsPort.ts"
import { Launcher } from "../transport/Launcher.ts"
import { handlers } from "./handlers.ts"
import { type Operation, Spotrc } from "./operations.ts"

// The handlers on a Bridge. Adapters reach them through Client.
const handlersOn = <E, R>(bridge: Layer.Layer<Bridge, E, R>) =>
  handlers.pipe(
    Layer.provide(Internals.layer),
    Layer.provide(bridge),
    Layer.provide(Launcher.layer)
  )

// The handlers on the real Spotify, reached through the DevTools port.
export const live = handlersOn(CdpBridge).pipe(
  Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
)

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

// Calls the operations in-process, through the same handlers the servers
// use. Every adapter talks to core through this.
export class Client extends Context.Service<Client, RpcClient.RpcClient<Operation>>()("spotrc/Client") {
  static readonly layer = Layer.effect(Client, RpcTest.makeClient(Spotrc))
}
