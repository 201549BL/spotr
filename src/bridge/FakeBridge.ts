import { Clock, Effect, Layer, Ref, Schema } from "effect"
import { Bridge } from "./Bridge.ts"

type RawTrack = {
  readonly uri: string
  readonly name: string
  readonly artists: ReadonlyArray<{ readonly name: string }>
  readonly duration: { readonly milliseconds: number }
}

export const sampleContext = "spotify:album:0000000000000000000000"

export const sampleQueue: ReadonlyArray<RawTrack> = [
  {
    uri: "spotify:track:1111111111111111111111",
    name: "First Song",
    artists: [{ name: "Some Artist" }],
    duration: { milliseconds: 200_000 }
  },
  {
    uri: "spotify:track:2222222222222222222222",
    name: "Second Song",
    artists: [{ name: "Other Artist" }, { name: "Guest" }],
    duration: { milliseconds: 180_000 }
  }
]

type PlayerState = {
  readonly index: number
  readonly paused: boolean
  readonly positionMs: number
  readonly shuffle: boolean
  readonly repeat: number
}

const decodeArgs = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(schema)

// A Spotify stand-in for tests. It plays `queue` in the `sampleContext`
// album; an empty queue means nothing is loaded. After each command, the
// next `staleReads` calls to getState still report the old state, the
// way real Spotify lags behind.
export const FakeBridge = (queue: ReadonlyArray<RawTrack>, staleReads: number) => Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const initial: PlayerState = { index: 0, paused: false, positionMs: 0, shuffle: false, repeat: 0 }
    const state = yield* Ref.make(initial)
    const shown = yield* Ref.make(initial)
    const staleLeft = yield* Ref.make(0)
    const level = yield* Ref.make(1)

    const getState = Effect.gen(function* () {
      const stale = yield* Ref.getAndUpdate(staleLeft, (left) => Math.max(0, left - 1))

      if (stale === 0) yield* Ref.set(shown, yield* Ref.get(state))
      const current = yield* Ref.get(shown)
      const item = queue[current.index % queue.length]

      return {
        item: item ? { ...item, metadata: { "collection.in_collection": "false" } } : null,
        context: item ? { uri: sampleContext } : null,
        isPaused: current.paused,
        shuffle: current.shuffle,
        repeat: current.repeat,
        positionAsOfTimestamp: current.positionMs,
        timestamp: yield* Clock.currentTimeMillis
      }
    })

    const command = (change: (current: PlayerState) => PlayerState) =>
      Ref.update(state, change).pipe(Effect.andThen(Ref.set(staleLeft, staleReads)))

    const play = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Struct({ uri: Schema.String }), Schema.Unknown, Schema.Unknown]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([{ uri }]) => {
          const index = uri === sampleContext ? 0 : queue.findIndex((track) => track.uri === uri)

          return index < 0
            ? Effect.die(`FakeBridge can't play ${uri}`)
            : command((current) => ({ ...current, index, paused: false, positionMs: 0 }))
        })
      )

    const withNumber = (change: (value: number) => (current: PlayerState) => PlayerState) =>
      (args: ReadonlyArray<Schema.Json>) =>
        decodeArgs(Schema.Tuple([Schema.Finite]))(args).pipe(
          Effect.orDie,
          Effect.flatMap(([value]) => command(change(value)))
        )

    const setShuffle = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Boolean]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([shuffle]) => command((current) => ({ ...current, shuffle })))
      )

    const setVolume = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Finite]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([next]) => Ref.set(level, next))
      )

    const handlers = new Map<string, (args: ReadonlyArray<Schema.Json>) => Effect.Effect<unknown>>([
      ["PlayerAPI.getState", () => getState],
      ["PlayerAPI.play", play],
      ["PlayerAPI.pause", () => command((current) => ({ ...current, paused: true }))],
      ["PlayerAPI.resume", () => command((current) => ({ ...current, paused: false }))],
      ["PlayerAPI.skipToNext", () => command((current) => ({ ...current, index: current.index + 1, positionMs: 0 }))],
      [
        "PlayerAPI.skipToPrevious",
        () =>
          command((current) =>
            current.positionMs > 3000
              ? { ...current, positionMs: 0 }
              : { ...current, index: Math.max(0, current.index - 1), positionMs: 0 }
          )
      ],
      ["PlayerAPI.seekTo", withNumber((positionMs) => (current) => ({ ...current, positionMs }))],
      ["PlayerAPI.setShuffle", setShuffle],
      ["PlayerAPI.setRepeat", withNumber((repeat) => (current) => ({ ...current, repeat }))],
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
