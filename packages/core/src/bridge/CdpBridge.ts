import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Socket } from "effect/socket"
import { BridgeTimeout, ClientNotRunning, InternalApiChanged } from "../domain/errors.ts"
import { installAgent } from "../page/agent.ts"
import { DevToolsPort } from "../DevToolsPort.ts"
import { Bridge } from "./Bridge.ts"
import * as Cdp from "./Cdp.ts"

// What Chromium's DevTools endpoint lists at /json/list.
const Targets = Schema.Array(Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.String
}))

const Failure = Schema.Struct({
  ok: Schema.Literal(false),
  kind: Schema.Literals(["NotReady", "ApiMissing", "MethodMissing", "QueryMissing", "Rejected"]),
  message: Schema.String
})

// What the page agent's dispatch() and inspect() resolve to.
const decodeDispatch = Schema.decodeUnknownEffect(Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Failure
]))

const decodeInspect = Schema.decodeUnknownEffect(Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Array(Schema.String) }),
  Failure
]))

const AGENT_SOURCE = installAgent.toString()

export const CdpBridge = Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const port = yield* DevToolsPort
    const http = yield* HttpClient.HttpClient
    const webSocket = yield* Socket.WebSocketConstructor

    const findPage = http.get(`http://127.0.0.1:${port}/json/list`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Targets)),
      Effect.mapError(() => new ClientNotRunning({ port, reason: "port" })),
      Effect.flatMap((targets) => {
        const page = targets.find((t) => t.type === "page" && t.url.includes("xpui"))

        return page ? Effect.succeed(page) : Effect.fail(new ClientNotRunning({ port, reason: "page" }))
      })
    )

    // Runs the agent with `use` appended, e.g. `.dispatch(...)`, and
    // returns what it resolves to.
    const runAgent = (operation: string, use: string) =>
      Effect.gen(function* () {
        const page = yield* findPage

        return yield* Cdp.evaluate(page.webSocketDebuggerUrl, `(${AGENT_SOURCE})()${use}`).pipe(
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

    const params = (...values: ReadonlyArray<Schema.Json>) => values.map((value) => JSON.stringify(value)).join(", ")

    const call = (api: string, method: string, ...args: ReadonlyArray<Schema.Json>) =>
      Effect.gen(function* () {
        const operation = `${api}.${method}`
        const raw = yield* runAgent(operation, `.dispatch(${params(api, method, args)})`)
        const result = yield* decodeDispatch(raw).pipe(Effect.orDie)

        if (result.ok) return result.value

        return yield* new InternalApiChanged({ operation, issue: `${result.kind}: ${result.message}` })
      })

    const inspect = (api: string, methods: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const raw = yield* runAgent(api, `.inspect(${params(api, methods)})`)
        const result = yield* decodeInspect(raw).pipe(Effect.orDie)

        if (result.ok) return result.value

        return yield* new InternalApiChanged({ operation: api, issue: `${result.kind}: ${result.message}` })
      })

    const graphql = (name: string, variables: { readonly [key: string]: Schema.Json }) =>
      Effect.gen(function* () {
        const operation = `GraphQL ${name}`
        const raw = yield* runAgent(operation, `.graphql(${params(name, variables)})`)
        const result = yield* decodeDispatch(raw).pipe(Effect.orDie)

        if (result.ok) return result.value

        return yield* new InternalApiChanged({ operation, issue: `${result.kind}: ${result.message}` })
      })

    const inspectQueries = (names: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const raw = yield* runAgent("GraphQL queries", `.inspectQueries(${params(names)})`)
        const result = yield* decodeInspect(raw).pipe(Effect.orDie)

        if (result.ok) return result.value

        return yield* new InternalApiChanged({ operation: "GraphQL queries", issue: `${result.kind}: ${result.message}` })
      })

    return { call, inspect, graphql, inspectQueries }
  })
)
