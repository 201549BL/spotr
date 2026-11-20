import { Effect, Layer, Ref, Schema } from "effect"
import { Bridge } from "./Bridge.ts"

const queue = [
  {
    uri: "spotify:track:6sGIMrtIzQjdzkxDfA4Gxu",
    name: "Teardrop",
    artists: [{ name: "Massive Attack" }],
    durationMs: 330_773
  },
  {
    uri: "spotify:track:0bhE6M3TaGGE4LNX6tWRJh",
    name: "Windowlicker",
    artists: [{ name: "Aphex Twin" }],
    durationMs: 366_000
  }
]

// After a skip, the first `staleReads` calls to getState still report
// the previous track, the way real Spotify lags behind.
export const FakeBridge = (staleReads: number) => Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const position = yield* Ref.make(0)
    const staleLeft = yield* Ref.make(0)
    const paused = yield* Ref.make(false)

    const getState = Effect.gen(function* () {
      const index = yield* Ref.get(position)
      const stale = yield* Ref.getAndUpdate(staleLeft, (left) => Math.max(0, left - 1))
      const shown = stale > 0 ? index - 1 : index

      return { item: queue[shown % queue.length], isPaused: yield* Ref.get(paused) }
    })

    const skipToNext = Effect.gen(function* () {
      yield* Ref.update(position, (index) => index + 1)
      yield* Ref.set(staleLeft, staleReads)
    })

    const level = yield* Ref.make(1)

    const setVolume = (args: ReadonlyArray<Schema.Json>) =>
      Schema.decodeUnknownEffect(Schema.Tuple([Schema.Finite]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([next]) => Ref.set(level, next))
      )

    const handlers = new Map<string, (args: ReadonlyArray<Schema.Json>) => Effect.Effect<unknown>>([
      ["PlayerAPI.getState", () => getState],
      ["PlayerAPI.skipToNext", () => skipToNext],
      ["PlayerAPI.pause", () => Ref.set(paused, true)],
      ["PlayerAPI.resume", () => Ref.set(paused, false)],
      ["PlaybackAPI.getVolume", () => Ref.get(level)],
      ["PlaybackAPI.setVolume", setVolume]
    ])

    return {
      call: (api: string, method: string, ...args: ReadonlyArray<Schema.Json>) => {
        const handler = handlers.get(`${api}.${method}`)

        return handler ? handler(args) : Effect.die(`FakeBridge has no ${api}.${method}`)
      }
    }
  })
)
