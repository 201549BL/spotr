import { Effect, Schema } from "effect"
import { Socket } from "effect/socket"

// One Chrome DevTools Protocol frame, trimmed to what Runtime.evaluate
// replies with.
const Frame = Schema.fromJsonString(Schema.Struct({
  id: Schema.optional(Schema.Int),
  result: Schema.optional(Schema.Struct({
    result: Schema.Struct({ value: Schema.optional(Schema.Unknown) }),
    exceptionDetails: Schema.optional(Schema.Struct({
      text: Schema.String,
      exception: Schema.optional(Schema.Struct({ description: Schema.optional(Schema.String) }))
    }))
  }))
}))

const decodeFrame = Schema.decodeUnknownEffect(Frame)

const REQUEST_ID = 1

// Opens a WebSocket to a page, runs `expression` there, and returns its
// value. The socket stays open until the surrounding Scope closes.
export const evaluate = Effect.fn("Cdp.evaluate")(function* (url: string, expression: string) {
  const socket = yield* Socket.makeWebSocket(url, { openTimeout: "2 seconds" })
  const writer = yield* socket.writer
  const reader = yield* socket.reader

  yield* writer.write(JSON.stringify({
    id: REQUEST_ID,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true }
  }))

  // Chromium may send other frames first, so read until our reply.
  while (true) {
    const frames = yield* reader.pull

    for (const raw of frames) {
      const frame = yield* decodeFrame(raw).pipe(Effect.orDie)

      if (frame.id !== REQUEST_ID || !frame.result) continue
      const { result, exceptionDetails } = frame.result

      if (exceptionDetails) {
        const reason = exceptionDetails.exception?.description ?? exceptionDetails.text

        return yield* Effect.die(`Spotify's page threw: ${reason}`)
      }

      return result.value
    }
  }
})
