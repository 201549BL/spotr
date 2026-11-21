import { assert, describe, it } from "@effect/vitest"
import { type Cause, Effect, type Schema, Fiber, Layer, Queue, Sink, Stdio, Stream } from "effect"
import { serve } from "../src/server.ts"
import { fake } from "@spotrc/core/testing"

const encoder = new TextEncoder()

// Runs `spotrc serve` on fake stdin and stdout. `send` writes one request
// line, `end` closes stdin, `next` reads the next line the server wrote,
// and `done` waits for the server to stop.
const connect = Effect.gen(function* () {
  const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const stdout = yield* Queue.unbounded<string>()

  const server = yield* serve.pipe(
    Effect.provide(Layer.merge(fake, Stdio.layerTest({
      stdin: Stream.fromQueue(stdin),
      stdout: () => Sink.forEach((chunk) => Queue.offer(stdout, String(chunk).trimEnd()))
    }))),
    Effect.forkScoped
  )

  return {
    send: (message: { readonly id?: string | number; readonly method: string; readonly params?: Schema.Json }) => Queue.offer(stdin, encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)),
    sendRaw: (text: string) => Queue.offer(stdin, encoder.encode(`${text}\n`)),
    end: Queue.end(stdin),
    next: Queue.take(stdout),
    done: Fiber.join(server),
    rest: Queue.clear(stdout)
  }
})

describe("spotrc serve", () => {
  it.effect("answers an operation without params", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.send({ id: 1, method: "volume" })

      assert.strictEqual(yield* server.next, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"volume\":100,\"muted\":false}}")
    }))

  it.effect("decodes params by name", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.send({ id: "a", method: "setVolume", params: { relative: false, amount: 40 } })

      assert.strictEqual(yield* server.next, "{\"jsonrpc\":\"2.0\",\"id\":\"a\",\"result\":{\"volume\":40,\"muted\":false}}")
    }))

  it.effect("sends a spotrc error flat, with its exit code as the code", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.send({ id: 1, method: "useDevice", params: { device: "Nowhere" } })

      assert.strictEqual(
        yield* server.next,
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":5,\"message\":\"Device \\\"Nowhere\\\" wasn't found\"," +
          "\"data\":{\"_tag\":\"NotFound\",\"what\":\"Device \\\"Nowhere\\\"\"," +
          "\"hint\":\"List the devices to see the ones Spotify can play on.\"," +
          "\"message\":\"Device \\\"Nowhere\\\" wasn't found\"," +
          "\"detail\":\"spotrc looked it up in Spotify and got no match\"}}}"
      )
    }))

  it.effect("rejects what isn't a valid call with JSON-RPC's own codes", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.sendRaw("nope")
      yield* server.send({ id: 2, method: "bogus" })
      yield* server.send({ id: 3, method: "search", params: { limit: 3 } })

      assert.deepStrictEqual([yield* server.next, yield* server.next, yield* server.next], [
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Not JSON\"}}",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"code\":-32601,\"message\":\"spotrc has no operation named bogus\"}}",
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32602,\"message\":\"Missing key\\n  at [\\\"text\\\"]\"}}"
      ])
    }))

  it.effect("streams watch as notifications until it is cancelled", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.send({ id: 7, method: "watch" })

      const update = JSON.parse(yield* server.next)

      assert.deepStrictEqual([update.method, update.params.id, update.params.value.track.name], ["watch", 7, "First Song"])

      yield* server.send({ method: "$/cancelRequest", params: { id: 7 } })

      assert.strictEqual(yield* server.next, "{\"jsonrpc\":\"2.0\",\"id\":7,\"error\":{\"code\":-32800,\"message\":\"watch was cancelled\"}}")
    }))

  it.effect("stops at the end of input, after answering what it was sent", () =>
    Effect.gen(function* () {
      const server = yield* connect

      yield* server.send({ id: 1, method: "watch" })
      yield* server.send({ id: 2, method: "volume" })
      yield* server.end
      yield* server.done

      // Responses only: watch may also have sent an update first.
      const answers = (yield* server.rest).map((line) => JSON.parse(line)).filter((message) => "id" in message)

      assert.deepStrictEqual(answers.map((message) => [message.id, message.error?.code ?? "result"]).sort(), [
        [1, -32800],
        [2, "result"]
      ])
    }))
})
