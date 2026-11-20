import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Socket } from "effect/socket"
import { Bridge } from "../src/bridge/Bridge.ts"
import { CdpBridge } from "../src/bridge/CdpBridge.ts"
import { Port } from "../src/settings.ts"

// A DevTools endpoint whose /json/list answers with `body`.
const devToolsAnswering = (body: string) =>
  CdpBridge.pipe(
    Layer.provide(Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body))))
    )),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(Layer.succeed(Port, 9222))
  )

const failure = (body: string) =>
  Bridge.use((bridge) => bridge.call("PlayerAPI", "getState")).pipe(
    Effect.flip,
    Effect.map((error) => ({ tag: error._tag, message: error.message })),
    Effect.provide(devToolsAnswering(body))
  )

describe("CdpBridge", () => {
  it.effect("says the port is closed when the DevTools endpoint doesn't answer properly", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* failure("not json"), {
        tag: "ClientNotRunning",
        message: "Spotify isn't reachable on port 9222"
      })
    }))

  it.effect("says the window is missing when no page is Spotify's", () =>
    Effect.gen(function* () {
      const targets = [{ type: "page", url: "https://example.com/", webSocketDebuggerUrl: "ws://127.0.0.1:9222/x" }]

      assert.deepStrictEqual(yield* failure(JSON.stringify(targets)), {
        tag: "ClientNotRunning",
        message: "Spotify's window wasn't found on port 9222"
      })
    }))
})
