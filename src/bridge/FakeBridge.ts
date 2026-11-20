import { Effect, Layer, Ref, Schema } from "effect"
import { Bridge } from "./Bridge.ts"

type RawTrack = {
  readonly uri: string
  readonly name: string
  readonly artists: ReadonlyArray<{ readonly name: string }>
  readonly durationMs: number
}

export const sampleQueue: ReadonlyArray<RawTrack> = [
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

// Plays `queue` in a loop; an empty queue means nothing is loaded. After
// a command, the first `staleReads` calls to getState still report the
// old state, the way real Spotify lags behind.
export const FakeBridge = (queue: ReadonlyArray<RawTrack>, staleReads: number) => Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const position = yield* Ref.make(0)
    const staleLeft = yield* Ref.make(0)
    const paused = yield* Ref.make(false)
    const shownPosition = yield* Ref.make(0)

    const shownPaused = yield* Ref.make(false)

    const getState = Effect.gen(function* () {
      const stale = yield* Ref.getAndUpdate(staleLeft, (left) => Math.max(0, left - 1))

      if (stale === 0) {
        yield* Ref.set(shownPosition, yield* Ref.get(position))
        yield* Ref.set(shownPaused, yield* Ref.get(paused))
      }

      const index = yield* Ref.get(shownPosition)

      return { item: queue[index % queue.length] ?? null, isPaused: yield* Ref.get(shownPaused) }
    })

    const command = (change: Effect.Effect<void>) =>
      change.pipe(Effect.andThen(Ref.set(staleLeft, staleReads)))

    const skipToNext = command(Ref.update(position, (index) => index + 1))

    const level = yield* Ref.make(1)

    const setVolume = (args: ReadonlyArray<Schema.Json>) =>
      Schema.decodeUnknownEffect(Schema.Tuple([Schema.Finite]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([next]) => Ref.set(level, next))
      )

    const handlers = new Map<string, (args: ReadonlyArray<Schema.Json>) => Effect.Effect<unknown>>([
      ["PlayerAPI.getState", () => getState],
      ["PlayerAPI.skipToNext", () => skipToNext],
      ["PlayerAPI.pause", () => command(Ref.set(paused, true))],
      ["PlayerAPI.resume", () => command(Ref.set(paused, false))],
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
