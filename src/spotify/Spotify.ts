import { Clock, Context, Effect, Layer, Schedule, Schema } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { InternalApiChanged, type SpotifyError } from "../domain/errors.ts"
import { PlayerStatus, type Repeat } from "../domain/PlayerStatus.ts"
import type { SeekTarget } from "../domain/Seek.ts"
import { type SpotifyUri, SpotifyUri as SpotifyUriSchema, Track } from "../domain/Track.ts"
import { Volume } from "../domain/Volume.ts"

const RawItem = Schema.Struct({
  uri: SpotifyUriSchema,
  name: Schema.String,
  artists: Schema.Array(Schema.Struct({ name: Schema.String })),
  duration: Schema.Struct({ milliseconds: Schema.Finite }),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String))
})

// The parts of PlayerAPI.getState() spotr uses. Spotify's own UI treats
// `item` as possibly missing, and the whole state is null before the
// player's first update.
const RawState = Schema.NullOr(Schema.Struct({
  item: Schema.optional(Schema.NullOr(RawItem)),
  context: Schema.optional(Schema.NullOr(Schema.Struct({ uri: Schema.String }))),
  isPaused: Schema.Boolean,
  shuffle: Schema.Boolean,
  repeat: Schema.Literals([0, 1, 2]),
  positionAsOfTimestamp: Schema.Finite,
  timestamp: Schema.Finite
}))

const decodeState = Schema.decodeUnknownEffect(RawState)

const decodeLevel = Schema.decodeUnknownEffect(Schema.Finite)

const decodeVolume = Schema.decodeUnknownEffect(Volume)

const repeatModes: ReadonlyArray<Repeat> = ["off", "all", "one"]

// When Spotify's data doesn't match a schema, Spotify has most likely
// changed underneath us.
const blameUpdate = (operation: string) =>
  <A>(self: Effect.Effect<A, SpotifyError | Schema.SchemaError>): Effect.Effect<A, SpotifyError> =>
    self.pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(new InternalApiChanged({ operation, issue: error.message }))
      )
    )

// Spotify reports the position at a moment in time; while playing, the
// real position has moved on since then.
const toStatus = (raw: typeof RawState.Type, now: number) => {
  const item = raw?.item ?? null
  const durationMs = Math.round(item?.duration.milliseconds ?? 0)
  const moved = raw && !raw.isPaused ? now - raw.timestamp : 0
  const position = Math.round((raw?.positionAsOfTimestamp ?? 0) + moved)

  return new PlayerStatus({
    track: item
      ? new Track({ uri: item.uri, name: item.name, artists: item.artists.map((artist) => artist.name), durationMs })
      : null,
    context: raw?.context?.uri ?? null,
    paused: raw?.isPaused ?? true,
    positionMs: Math.max(0, item ? Math.min(position, durationMs) : 0),
    shuffle: raw?.shuffle ?? false,
    repeat: repeatModes[raw?.repeat ?? 0] ?? "off",
    liked: item?.metadata?.["collection.in_collection"] === "true"
  })
}

export class Spotify extends Context.Service<Spotify, {
  readonly status: Effect.Effect<PlayerStatus, SpotifyError>
  readonly play: (uri: SpotifyUri) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly pause: Effect.Effect<PlayerStatus, SpotifyError>
  readonly resume: Effect.Effect<PlayerStatus, SpotifyError>
  readonly next: Effect.Effect<PlayerStatus, SpotifyError>
  readonly previous: Effect.Effect<PlayerStatus, SpotifyError>
  readonly seek: (target: SeekTarget) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly setShuffle: (on: boolean) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly setRepeat: (mode: Repeat) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly volume: Effect.Effect<Volume, SpotifyError>
  readonly setVolume: (level: Volume) => Effect.Effect<void, SpotifyError>
}>()("spotr/Spotify") {
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const status = Effect.gen(function* () {
        const raw = yield* bridge.call("PlayerAPI", "getState").pipe(Effect.flatMap(decodeState))

        return toStatus(raw, yield* Clock.currentTimeMillis)
      }).pipe(blameUpdate("PlayerAPI.getState"))

      // Spotify reports the old state for a moment after a command, so
      // poll until it shows the change. Give up after about two seconds
      // and return what it says then, e.g. repeat-one keeps the track.
      const settle = (done: (status: PlayerStatus) => boolean) =>
        status.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced("100 millis"), times: 20 }))

      const command = (method: string, ...args: ReadonlyArray<Schema.Json>) =>
        bridge.call("PlayerAPI", method, ...args)

      // Done once Spotify plays from `uri` and something visibly changed,
      // so replaying the album that's already on doesn't count as done
      // before Spotify has reacted.
      const play = (uri: SpotifyUri) =>
        Effect.gen(function* () {
          const before = yield* status

          yield* command("play", { uri }, {}, {})

          return yield* settle((now) => {
            const playingIt = !now.paused && (now.track?.uri === uri || now.context === uri)

            const changed = before.paused || now.track?.uri !== before.track?.uri ||
              now.context !== before.context || now.positionMs < before.positionMs

            return playingIt && changed
          })
        })

      const pause = command("pause").pipe(Effect.andThen(settle((now) => now.paused)))

      const resume = command("resume").pipe(Effect.andThen(settle((now) => !now.paused)))

      const next = Effect.gen(function* () {
        const before = yield* status

        yield* command("skipToNext")

        return yield* settle((now) => now.track?.uri !== before.track?.uri)
      })

      // Spotify restarts the current track instead when it is more than
      // a few seconds in, so a jump back in position also counts.
      const previous = Effect.gen(function* () {
        const before = yield* status

        yield* command("skipToPrevious")

        return yield* settle((now) =>
          now.track?.uri !== before.track?.uri || now.positionMs < before.positionMs - 1000
        )
      })

      const seek = (target: SeekTarget) =>
        Effect.gen(function* () {
          const before = yield* status
          const wanted = target.relative ? before.positionMs + target.ms : target.ms
          const ms = Math.max(0, Math.min(wanted, before.track?.durationMs ?? 0))

          yield* command("seekTo", ms)

          return yield* settle((now) => Math.abs(now.positionMs - ms) < 1500)
        })

      const setShuffle = (on: boolean) =>
        command("setShuffle", on).pipe(Effect.andThen(settle((now) => now.shuffle === on)))

      const setRepeat = (mode: Repeat) =>
        command("setRepeat", repeatModes.indexOf(mode)).pipe(
          Effect.andThen(settle((now) => now.repeat === mode))
        )

      const volume = bridge.call("PlaybackAPI", "getVolume").pipe(
        Effect.flatMap(decodeLevel),
        Effect.flatMap((level) => decodeVolume(Math.round(level * 100))),
        blameUpdate("PlaybackAPI.getVolume")
      )

      const setVolume = (level: Volume) =>
        bridge.call("PlaybackAPI", "setVolume", level / 100).pipe(Effect.asVoid)

      return { status, play, pause, resume, next, previous, seek, setShuffle, setRepeat, volume, setVolume }
    })
  )
}
