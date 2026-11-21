import { Effect, Layer, Predicate, SchemaAST } from "effect"
import { OpenRpc, type RpcMessage, RpcSerialization, RpcServer } from "effect/rpc"
import { Spotr } from "./core/operations.ts"

const takesNothing = new Set<string>(Array.from(Spotr.requests.values()).flatMap((rpc) =>
  SchemaAST.isVoid(rpc.payloadSchema.ast) ? [rpc._tag] : []
))

// JSON-RPC clients call an operation without arguments with no params,
// {} or [], but its payload only decodes from null.
const withoutParams = (message: RpcMessage.FromClientEncoded): RpcMessage.FromClientEncoded =>
  Predicate.isTagged(message, "Request") && takesNothing.has(message.tag) ? { ...message, payload: null } : message

// Without acks, a client that only reads lines still gets every watch
// update. With them, the server would wait for an @effect/rpc/Ack after
// each one.
const stdio = Layer.effect(
  RpcServer.Protocol,
  RpcServer.makeProtocolStdio.pipe(Effect.map((protocol) => ({
    ...protocol,
    supportsAck: false,
    run: (handle: (clientId: number, message: RpcMessage.FromClientEncoded) => Effect.Effect<void>) =>
      protocol.run((clientId, message) => handle(clientId, withoutParams(message)))
  })))
)

// JSON-RPC 2.0 on stdin and stdout, one message per line.
export const serve = RpcServer.layer(Spotr).pipe(
  Layer.provide(stdio),
  Layer.provide(RpcSerialization.layerNdJsonRpc())
)

// What spotr serve speaks, as an OpenRPC document for client generators.
export const openRpc = OpenRpc.fromRpcGroup(Spotr, { info: { title: "spotr", version: "0.1.0" } })
