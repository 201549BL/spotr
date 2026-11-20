import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { InternalApiChanged, type SpotifyError } from "../domain/errors.ts"
import { SpotifyUri, Track } from "../domain/Track.ts"

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

const toTrack = (raw: typeof RawState.Type) =>
  new Track({
    uri: raw.item.uri,
    name: raw.item.name,
    artists: raw.item.artists.map((artist) => artist.name)
  })

export class Spotify extends Context.Service<Spotify, {
  readonly nowPlaying: Effect.Effect<Track, SpotifyError>
  readonly next: Effect.Effect<Track, SpotifyError>
}>()("spotr/Spotify") {
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const nowPlaying = bridge.call("PlayerAPI", "getState").pipe(
        Effect.flatMap(decodeState),
        Effect.map(toTrack),
        Effect.catchTag("SchemaError", (error) =>
          Effect.fail(new InternalApiChanged({ operation: "PlayerAPI.getState", issue: error.message }))
        )
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

      return { nowPlaying, next }
    })
  )
}
