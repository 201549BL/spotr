import { Cause, Effect, FiberMap, Option, Runtime, Schema, SchemaAST, Stdio, Stream } from "effect"
import { OpenRpc, RpcSchema, RpcTest } from "effect/rpc"
import { SpotifyError } from "./core/domain/errors.ts"
import { type Operation, Spotr } from "./core/operations.ts"

// The JSON-RPC 2.0 codes spotr uses besides each error's exit code.
// -32800 is LSP's request-cancelled code, which StreamJsonRpc and
// vscode-jsonrpc also understand.
const codes = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  cancelled: -32800
} as const

const Id = Schema.Union([Schema.String, Schema.Finite])

type Id = typeof Id.Type

const Message = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(Id),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Json)
})

const Cancel = Schema.Struct({ id: Id })

type Payload = Operation["payloadSchema"]["Type"]

type Success = Operation["successSchema"]["Type"]

type Chunk = Extract<Operation["successSchema"], RpcSchema.Stream<Schema.Top, Schema.Top>>["success"]["Type"]

type Reply =
  | { readonly result: Schema.Json }
  | { readonly error: { readonly code: number; readonly message: string; readonly data?: Schema.Json } }

type Outgoing =
  | { readonly jsonrpc: "2.0"; readonly id: Id | null } & Reply
  | { readonly jsonrpc: "2.0"; readonly method: string; readonly params: { readonly id: Id | null; readonly value: Schema.Json } }

const fail = (code: number, message: string): Reply => ({ error: { code, message } })

const toJson = <S extends Schema.ConstraintEncoder<unknown>>(schema: S) => (value: S["Type"]) =>
  Schema.encodeUnknownEffect(schema)(value).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)))

// A spotr error goes out with its exit code as the code, its message as
// the message, and its tag, fields, message, hint and detail as data.
const failWith = (error: SpotifyError) =>
  toJson(SpotifyError)(error).pipe(
    Effect.map((data): Reply => ({ error: { code: error[Runtime.errorExitCode], message: error.message, data } })),
    Effect.orElseSucceed(() => fail(codes.internal, error.message))
  )

// JSON-RPC 2.0 on stdin and stdout, one message per line. Each request
// runs on its own fiber, so a watch never holds up other calls. A
// $/cancelRequest stops a request. The end of input stops every stream
// and waits for the other calls to answer.
export const serve = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const calls = yield* FiberMap.make<Id>()
  const streams = yield* FiberMap.make<Id>()

  // SAFETY: operations are looked up by name at runtime, so TypeScript
  // can't pair a payload with its operation. Each payload is decoded with
  // its own operation's schema before the call.
  const call = (yield* RpcTest.makeClient(Spotr, { flatten: true })) as (
    tag: string,
    payload: Payload
  ) => Effect.Effect<Success, SpotifyError> & Stream.Stream<Chunk, SpotifyError>

  const write = (body: Outgoing) => Stream.make(`${JSON.stringify(body)}\n`).pipe(Stream.run(stdio.stdout()), Effect.orDie)

  const answer = (id: Id | undefined, reply: Reply) =>
    id === undefined ? Effect.void : write({ jsonrpc: "2.0", id, ...reply })

  // A stream sends each value as a notification named after the
  // operation, carrying the request's id, then answers null when it ends.
  const run = (rpc: Operation, id: Id | undefined, payload: Payload): Effect.Effect<Reply, SpotifyError> => {
    if (RpcSchema.isStreamSchema(rpc.successSchema)) {
      const encode = toJson(rpc.successSchema.success)

      return call(rpc._tag, payload).pipe(
        Stream.runForEach((value) =>
          encode(value).pipe(
            Effect.orDie,
            Effect.flatMap((json) => write({ jsonrpc: "2.0", method: rpc._tag, params: { id: id ?? null, value: json } }))
          )),
        Effect.as({ result: null })
      )
    }

    return call(rpc._tag, payload).pipe(
      Effect.flatMap((value) => toJson(rpc.successSchema)(value).pipe(Effect.orDie)),
      Effect.map((result) => ({ result }))
    )
  }

  const request = (id: Id | undefined, method: string, params: Schema.Json | undefined) =>
    Effect.gen(function* () {
      const rpc = Spotr.requests.get(method)

      if (rpc === undefined) return yield* answer(id, fail(codes.methodNotFound, `spotr has no operation named ${method}`))

      const payload = SchemaAST.isVoid(rpc.payloadSchema.ast)
        ? Option.some<Payload>(undefined)
        : yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(params ?? {}).pipe(Effect.option)

      if (Option.isNone(payload)) {
        const issue = yield* Schema.decodeUnknownEffect(rpc.payloadSchema)(params ?? {}).pipe(Effect.flip)

        return yield* answer(id, fail(codes.invalidParams, issue.message))
      }

      const reply = yield* run(rpc, id, payload.value).pipe(
        Effect.catchIf(Schema.is(SpotifyError), failWith),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => Effect.succeed(fail(codes.internal, Cause.pretty(cause)))
        ),
        Effect.onInterrupt(() => answer(id, fail(codes.cancelled, `${method} was cancelled`)))
      )

      yield* answer(id, reply)
    })

  const receive = (text: string) =>
    Effect.gen(function* () {
      if (text.trim() === "") return

      const message = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(text).pipe(
        Effect.mapError(() => fail(codes.parse, "Not JSON")),
        Effect.flatMap((json) =>
          Schema.decodeUnknownEffect(Message)(json).pipe(
            Effect.mapError(() => fail(codes.invalidRequest, "Not a JSON-RPC 2.0 request"))
          )),
        Effect.tapError((reply) => write({ jsonrpc: "2.0", id: null, ...reply })),
        Effect.option
      )

      if (Option.isNone(message)) return

      const { id, method, params } = message.value

      if (method === "$/cancelRequest") {
        const cancel = yield* Schema.decodeUnknownEffect(Cancel)(params).pipe(Effect.option)

        if (Option.isNone(cancel)) return

        yield* FiberMap.remove(calls, cancel.value.id)
        yield* FiberMap.remove(streams, cancel.value.id)

        return
      }

      const work = request(id, method, params)

      if (id === undefined) return yield* Effect.forkScoped(work)

      const rpc = Spotr.requests.get(method)
      const isStream = rpc !== undefined && RpcSchema.isStreamSchema(rpc.successSchema)

      yield* FiberMap.run(isStream ? streams : calls, id, work)
    })

  yield* stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(receive), Effect.orDie)

  yield* FiberMap.clear(streams)
  yield* FiberMap.awaitEmpty(calls)
}).pipe(Effect.scoped)

// What spotr serve speaks, as an OpenRPC document for client generators.
export const openRpc = OpenRpc.fromRpcGroup(Spotr, { info: { title: "spotr", version: "0.1.0" } })
