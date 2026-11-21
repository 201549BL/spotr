import { Effect, Layer, SchemaAST } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { type Rpc, type RpcGroup, RpcSchema, RpcTest } from "effect/rpc"
import { describe, type Operation, Spotrc } from "@spotrc/core"

type Stream = {
  [Tag in Operation["_tag"]]: [Rpc.IsStream<Operation, Tag>] extends [never] ? never : Tag
}[Operation["_tag"]]

const isStream = (rpc: Operation): rpc is Rpc.ExtractTag<Operation, Stream> => RpcSchema.isStreamSchema(rpc.successSchema)

const streams = Array.from(Spotrc.requests.values()).flatMap((rpc) => isStream(rpc) ? [rpc._tag] : [])

// MCP tools answer once, so stream operations such as watch have no tool.
const Unary = Spotrc.omit(...streams)

const unary = Array.from(Unary.requests.values())

// One tool per operation in the table. Errors come back as the tool's
// result, so agents see their tag, message, hint and detail.
export const tools = Toolkit.make<ReadonlyArray<Tool.Any>>(...unary.map((rpc) =>
  Tool.make(rpc._tag, {
    description: describe(rpc._tag),
    parameters: SchemaAST.isVoid(rpc.payloadSchema.ast) ? Tool.EmptyParams : rpc.payloadSchema,
    success: rpc.successSchema,
    failure: rpc.errorSchema,
    failureMode: "return"
  })
))

type Handler = Toolkit.HandlersFrom<typeof tools.tools>[string]

type UnaryOperation = RpcGroup.Rpcs<typeof Unary>

const handlers = tools.toLayer(Effect.gen(function* () {
  const call = yield* RpcTest.makeClient(Unary, { flatten: true })

  // SAFETY: the toolkit is built by iterating the table, so TypeScript
  // sees params as unknown. Each tool has already decoded them with its
  // own operation's payload schema.
  const handler = (tag: UnaryOperation["_tag"]): Handler => (params) => call(tag, params as never)

  return Object.fromEntries(unary.map((rpc) => [rpc._tag, handler(rpc._tag)]))
}))

// The erased tool types widen the requirements to any, so they are named
// here: the MCP server, and the handlers of every operation with a tool.
export const registrations: Layer.Layer<never, never, McpServer.McpServer | Rpc.ToHandler<UnaryOperation>> =
  McpServer.toolkit(tools).pipe(Layer.provide(handlers))

export const protocols = [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26] as const

export const mcp = McpServer.layerStdio({ name: "spotrc", version: "0.1.0", protocols, registrations })
