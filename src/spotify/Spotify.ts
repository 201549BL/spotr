import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { InternalApiChanged, type SpotifyError } from "../domain/errors.ts"
import { SpotifyUri, Track } from "../domain/Track.ts"
import { Volume } from "../domain/Volume.ts"

// The shape PlayerAPI.getState() returns inside Spotify.
const RawState = Schema.Struct({
  item: Schema.Struct({
    uri: SpotifyUri,
    name: Schema.String,
    artists: Schema.Array(Schema.Struct({ name: Schema.String }))
  }),
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

const toTrack =(raw: typeof RawState.Type) =>
  new Track({
    uri: raw.item.uri,
    name: raw.item.name,
    artists: raw.item.artists.map((artist) => artist.name)
  })

export class Spotify extends Context.Service<Spotify, {
  readonly nowPlaying: Effect.Effect<Track, SpotifyError>
  readonly next: Effect.Effect<Track, SpotifyError>
  readonly pause: Effect.Effect<void, SpotifyError>
  readonly resume: Effect.Effect<void, SpotifyError>
  readonly volume: Effect.Effect<Volume, SpotifyError>
  readonly setVolume: (level: Volume) => Effect.Effect<void, SpotifyError>
}>()("spotr/Spotify") {
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const nowPlaying = bridge.call("PlayerAPI", "getState").pipe(
        Effect.flatMap(decodeState),
        Effect.map(toTrack),
        blameUpdate("PlayerAPI.getState")
      )

      // Spotify reports the old track for a moment after skipping, so
      // poll until it changes. Give up after about two seconds, because
      // repeat-one or the end of the queue keeps the same track.
      const next = Effect.gen(function* () {
        const before = yield* nowPlaying

        yield* bridge.call("PlayerAPI", "skipToNext")

        return yield* nowPlaying.pipe(
          Effect.repeat({
            until: (track) => track.uri !== before.uri,
            schedule: Schedule.spaced("100 millis"),
            times: 20
          })
        )
      })

      const pause = bridge.call("PlayerAPI", "pause").pipe(Effect.asVoid)

      const resume = bridge.call("PlayerAPI", "resume").pipe(Effect.asVoid)

      const volume = bridge.call("PlaybackAPI", "getVolume").pipe(
        Effect.flatMap(decodeLevel),
        Effect.flatMap((level) => decodeVolume(Math.round(level * 100))),
        blameUpdate("PlaybackAPI.getVolume")
      )

      const setVolume = (level: Volume) =>
        bridge.call("PlaybackAPI", "setVolume", level / 100).pipe(Effect.asVoid)

      return { nowPlaying, next, pause, resume, volume, setVolume }
    })
  )
}
