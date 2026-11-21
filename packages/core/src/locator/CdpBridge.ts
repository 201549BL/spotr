import { Effect, Layer, Schema } from "effect"
import { InternalApiChanged } from "../model/errors.ts"
import { installAgent } from "./agent.ts"
import { Bridge } from "./Bridge.ts"
import { Page } from "../transport/Page.ts"

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

// The Bridge on the real Spotify: each call runs the page agent there.
export const CdpBridge = Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const page = yield* Page

    // Runs the agent with `use` appended, e.g. `.dispatch(...)`, and
    // returns what it resolves to.
    const runAgent = (operation: string, use: string) => page.evaluate(operation, `(${AGENT_SOURCE})()${use}`)

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
).pipe(Layer.provide(Page.layer))
