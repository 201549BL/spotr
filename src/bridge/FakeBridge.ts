import { Effect, Layer, Ref } from "effect"
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

    const stateAt = (index: number) => ({ item: queue[index % queue.length], isPaused: false })

    const getState = Effect.gen(function* () {
      const index = yield* Ref.get(position)
      const stale = yield* Ref.getAndUpdate(staleLeft, (left) => Math.max(0, left - 1))

      return stale > 0 ? stateAt(index - 1) : stateAt(index)
    })

    const skipToNext = Effect.gen(function* () {
      yield* Ref.update(position, (index) => index + 1)
      yield* Ref.set(staleLeft, staleReads)
    })

    const handlers = new Map<string, Effect.Effect<unknown>>([
      ["PlayerAPI.getState", getState],
      ["PlayerAPI.skipToNext", skipToNext]
    ])

    return {
      call: (api: string, method: string) =>
        handlers.get(`${api}.${method}`) ?? Effect.die(`FakeBridge has no ${api}.${method}`)
    }
  })
)
