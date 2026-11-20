import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Socket } from "effect/socket"
import { BridgeTimeout, ClientNotRunning, InternalApiChanged } from "../domain/errors.ts"
import { installAgent } from "../page/agent.ts"
import { Port } from "../settings.ts"
import { Bridge } from "./Bridge.ts"
import * as Cdp from "./Cdp.ts"

// What Chromium's DevTools endpoint lists at /json/list.
const Targets = Schema.Array(Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.String
}))

// What the page agent's dispatch() resolves to.
const DispatchResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({
    ok: Schema.Literal(false),
    kind: Schema.Literals(["NotReady", "ApiMissing", "MethodMissing", "Rejected"]),
    message: Schema.String
  })
])

const decodeDispatch = Schema.decodeUnknownEffect(DispatchResult)

const AGENT_SOURCE = installAgent.toString()

export const CdpBridge = Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const port = yield* Port
    const http = yield* HttpClient.HttpClient
    const webSocket = yield* Socket.WebSocketConstructor
    const notRunning = new ClientNotRunning({ port })

    const findPage = http.get(`http://127.0.0.1:${port}/json/list`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Targets)),
      Effect.mapError(() => notRunning),
      Effect.flatMap((targets) => {
        const page = targets.find((t) => t.type === "page" && t.url.includes("xpui"))

        return page ? Effect.succeed(page) : Effect.fail(notRunning)
      })
    )

    const call = (api: string, method: string) =>
      Effect.gen(function* () {
        const page = yield* findPage
        const expression = `(${AGENT_SOURCE})().dispatch(${JSON.stringify(api)}, ${JSON.stringify(method)})`

        const raw = yield* Cdp.evaluate(page.webSocketDebuggerUrl, expression).pipe(
          Effect.catchTag("SocketError", () => Effect.fail(notRunning))
        )

        const result = yield* decodeDispatch(raw).pipe(Effect.orDie)

        if (result.ok) return result.value

        return yield* new InternalApiChanged({
          operation: `${api}.${method}`,
          issue: `${result.kind}: ${result.message}`
        })
      }).pipe(
        Effect.scoped,
        Effect.provideService(Socket.WebSocketConstructor, webSocket),
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.fail(new BridgeTimeout({ operation: `${api}.${method}` }))
        })
      )

    return { call }
  })
)
