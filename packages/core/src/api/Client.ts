import { Context, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { type RpcClient, RpcTest } from "effect/rpc"
import { Socket } from "effect/socket"
import { CdpBridge } from "../locator/CdpBridge.ts"
import { Internals } from "../locator/Internals.ts"
import type { Bridge } from "../locator/Bridge.ts"
import { Launcher } from "../transport/Launcher.ts"
import { handlers } from "./handlers.ts"
import { type Operation, Spotrc } from "./operations.ts"

// The handlers on a Bridge. Adapters reach them through Client.
export const handlersOn = <E, R>(bridge: Layer.Layer<Bridge, E, R>) =>
  handlers.pipe(
    Layer.provide(Internals.layer),
    Layer.provide(bridge),
    Layer.provide(Launcher.layer)
  )

// The handlers on the real Spotify, reached through the DevTools port.
export const live = handlersOn(CdpBridge).pipe(
  Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
)

// Calls the operations in-process, through the same handlers the servers
// use. Every adapter talks to core through this.
export class Client extends Context.Service<Client, RpcClient.RpcClient<Operation>>()("spotrc/Client") {
  static readonly layer = Layer.effect(Client, RpcTest.makeClient(Spotrc))
}
