import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Queue, Sink, Stdio, Stream } from "effect"
import { RpcClient, type RpcMessage, RpcSerialization } from "effect/rpc"
import { Spotr } from "../src/core/operations.ts"
import { serve } from "../src/server.ts"
import { fakeCore } from "./core.ts"

const encoder = new TextEncoder()

// Runs `spotr serve` on fake stdin and stdout, and connects a real
// RpcClient to it that speaks the same newline-delimited JSON-RPC. Every
// line the server writes is kept in `lines`.
const connect = Effect.gen(function* () {
  const stdin = yield* Queue.unbounded<Uint8Array>()
  const stdout = yield* Queue.unbounded<string | Uint8Array>()
  const lines: Array<string> = []
  const serialization = RpcSerialization.ndJsonRpc()

  // In its own fiber, because the server interrupts the fiber that started
  // it once its output ends, as the process does on end of input.
  yield* Layer.launch(serve.pipe(
    Layer.provide(fakeCore),
    Layer.provide(Stdio.layerTest({
      stdin: Stream.fromQueue(stdin),
      stdout: () => Sink.forEach((chunk) => Queue.offer(stdout, chunk))
    }))
  )).pipe(Effect.forkScoped)

  const protocol = yield* RpcClient.Protocol.make(Effect.fnUntraced(function* (writeResponse, clientIds) {
    const requests = serialization.makeUnsafe()
    const responses = serialization.makeUnsafe()

    yield* Stream.fromQueue(stdout).pipe(
      Stream.runForEach((chunk) => {
        lines.push(...String(chunk).split("\n").filter((line) => line !== ""))

        // SAFETY: the server only writes messages from server to client.
        return Effect.forEach(responses.decode(chunk) as ReadonlyArray<RpcMessage.FromServerEncoded>, (response) =>
          Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response)))
      }),
      Effect.forkScoped
    )

    return {
      send: (_clientId, request) => Queue.offer(stdin, encoder.encode(String(requests.encode(request)))),
      supportsAck: false,
      supportsTransferables: false,
      codecFor: serialization.codecFor
    }
  }))

  const client = yield* RpcClient.make(Spotr).pipe(Effect.provideService(RpcClient.Protocol, protocol))

  return { client, lines }
})

describe("spotr serve", () => {
  it.effect("answers an operation without a payload", () =>
    Effect.gen(function* () {
      const { client } = yield* connect
      const status = yield* client.status()

      assert.deepStrictEqual([status.track?.name, status.paused], ["First Song", false])
    }))

  it.effect("decodes a payload", () =>
    Effect.gen(function* () {
      const { client } = yield* connect
      const volume = yield* client.setVolume({ relative: false, amount: 40 })

      assert.deepStrictEqual({ volume: volume.volume, muted: volume.muted }, { volume: 40, muted: false })
    }))

  it.effect("sends errors with their tag, message, hint and detail", () =>
    Effect.gen(function* () {
      const { client, lines } = yield* connect
      const error = yield* client.useDevice({ device: "Nowhere" }).pipe(Effect.flip)

      assert.strictEqual(error._tag, "NotFound")
      // Request ids count up across clients, so the test pins it.
      assert.strictEqual(
        lines.at(-1)?.replace(/"id":\d+/, "\"id\":0"),
        "{\"jsonrpc\":\"2.0\",\"id\":0,\"error\":{\"_tag\":\"Cause\",\"code\":0," +
          "\"message\":\"Device \\\"Nowhere\\\" wasn't found\"," +
          "\"data\":[{\"_tag\":\"Fail\",\"error\":{\"_tag\":\"NotFound\",\"what\":\"Device \\\"Nowhere\\\"\"," +
          "\"hint\":\"Run spotr devices to see the devices Spotify can play on.\"," +
          "\"message\":\"Device \\\"Nowhere\\\" wasn't found\"," +
          "\"detail\":\"spotr looked it up in Spotify and got no match\"}}]}}"
      )
    }))

  it.effect("streams watch", () =>
    Effect.gen(function* () {
      const { client } = yield* connect
      const seen = yield* client.watch().pipe(Stream.take(1), Stream.runCollect)

      assert.deepStrictEqual(seen.map(({ track }) => track?.name), ["First Song"])
    }))
})
