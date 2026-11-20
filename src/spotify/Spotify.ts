import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { InternalApiChanged, type SpotifyError } from "../domain/errors.ts"
import { PlayerStatus } from "../domain/PlayerStatus.ts"
import { SpotifyUri, Track } from "../domain/Track.ts"
import { Volume } from "../domain/Volume.ts"

// The shape PlayerAPI.getState() returns inside Spotify. Spotify's own
// UI treats `item` as possibly missing, so we do too.
const RawState = Schema.Struct({
  item: Schema.optional(Schema.NullOr(Schema.Struct({
    uri: SpotifyUri,
    name: Schema.String,
    artists: Schema.Array(Schema.Struct({ name: Schema.String }))
  }))),
  isPaused: Schema.Boolean
})

const decodeState = Schema.decodeUnknownEffect(RawState)

const decodeLevel = Schema.decodeUnknownEffect(Schema.Finite)

const decodeVolume = Schema.decodeUnknownEffect(Volume)

// When Spotify's data doesn't match a schema, Spotify has most likely
// changed underneath us.
const blameUpdate = (operation: string) =>
  <A>(self: Effect.Effect<A, SpotifyError | Schema.SchemaError>): Effect.Effect<A, SpotifyError> =>
    self.pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(new InternalApiChanged({ operation, issue: error.message }))
      )
    )

const toStatus = ({ item, isPaused }: typeof RawState.Type) =>
  new PlayerStatus({
    track: item
      ? new Track({ uri: item.uri, name: item.name, artists: item.artists.map((artist) => artist.name) })
      : null,
    paused: isPaused
  })

export class Spotify extends Context.Service<Spotify, {
  readonly status: Effect.Effect<PlayerStatus, SpotifyError>
  readonly next: Effect.Effect<PlayerStatus, SpotifyError>
  readonly pause: Effect.Effect<PlayerStatus, SpotifyError>
  readonly resume: Effect.Effect<PlayerStatus, SpotifyError>
  readonly volume: Effect.Effect<Volume, SpotifyError>
  readonly setVolume: (level: Volume) => Effect.Effect<void, SpotifyError>
}>()("spotr/Spotify") {
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const status = bridge.call("PlayerAPI", "getState").pipe(
        Effect.flatMap(decodeState),
        Effect.map(toStatus),
        blameUpdate("PlayerAPI.getState")
      )

      // Spotify reports the old state for a moment after a command, so
      // poll until it shows the change. Give up after about two seconds
      // and return what it says then, e.g. repeat-one keeps the track.
      const settle = (done: (status: PlayerStatus) => boolean) =>
        status.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced("100 millis"), times: 20 }))

      const next = Effect.gen(function* () {
        const before = yield* status

        yield* bridge.call("PlayerAPI", "skipToNext")

        return yield* settle((now) => now.track?.uri !== before.track?.uri)
      })

      const pause = bridge.call("PlayerAPI", "pause").pipe(
        Effect.andThen(settle((now) => now.paused))
      )

      const resume = bridge.call("PlayerAPI", "resume").pipe(
        Effect.andThen(settle((now) => !now.paused))
      )

      const volume = bridge.call("PlaybackAPI", "getVolume").pipe(
        Effect.flatMap(decodeLevel),
        Effect.flatMap((level) => decodeVolume(Math.round(level * 100))),
        blameUpdate("PlaybackAPI.getVolume")
      )

      const setVolume = (level: Volume) =>
        bridge.call("PlaybackAPI", "setVolume", level / 100).pipe(Effect.asVoid)

      return { status, next, pause, resume, volume, setVolume }
    })
  )
}
