import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Socket } from "effect/socket"
import { BridgeTimeout, ClientNotRunning } from "../model/errors.ts"
import * as Cdp from "./Cdp.ts"
import { DevToolsPort } from "./DevToolsPort.ts"

// What Chromium's DevTools endpoint lists at /json/list.
const Targets = Schema.Array(Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.String
}))

// Spotify's main page, reached through its DevTools port. Each evaluate
// finds the page again, so a restarted Spotify needs no reconnecting.
export class Page extends Context.Service<Page, {
  // Runs `expression` in the page and returns its value. `operation`
  // names the work in a timeout.
  readonly evaluate: (operation: string, expression: string) => Effect.Effect<unknown, ClientNotRunning | BridgeTimeout>
}>()("spotrc/Page") {
  static readonly layer = Layer.effect(
    Page,
    Effect.gen(function* () {
      const port = yield* DevToolsPort
      const http = yield* HttpClient.HttpClient
      const webSocket = yield* Socket.WebSocketConstructor

      const find = http.get(`http://127.0.0.1:${port}/json/list`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Targets)),
        Effect.mapError(() => new ClientNotRunning({ port, reason: "port" })),
        Effect.flatMap((targets) => {
          const page = targets.find((t) => t.type === "page" && t.url.includes("xpui"))

          return page ? Effect.succeed(page) : Effect.fail(new ClientNotRunning({ port, reason: "page" }))
        })
      )

      const evaluate = (operation: string, expression: string) =>
        Effect.gen(function* () {
          const page = yield* find

          return yield* Cdp.evaluate(page.webSocketDebuggerUrl, expression).pipe(
            Effect.catchTag("SocketError", () => Effect.fail(new ClientNotRunning({ port, reason: "port" })))
          )
        }).pipe(
          Effect.scoped,
          Effect.provideService(Socket.WebSocketConstructor, webSocket),
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.fail(new BridgeTimeout({ operation }))
          })
        )

      return { evaluate }
    })
  )
}
