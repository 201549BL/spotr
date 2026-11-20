import { Console, Effect, Layer } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { CdpBridge } from "./bridge/CdpBridge.ts"
import type { SpotifyError } from "./domain/errors.ts"
import type { Track } from "./domain/Track.ts"
import { Json, Port } from "./settings.ts"
import { Spotify } from "./spotify/Spotify.ts"

const printTrack = (track: Track) =>
  Effect.gen(function* () {
    const json = yield* Json

    if (json) {
      yield* Console.log(JSON.stringify(track))
    } else {
      yield* Console.log(`▶ ${track.name} · ${track.artists.join(", ")}`)
    }
  })

const printError = (error: SpotifyError) =>
  Effect.gen(function* () {
    const json = yield* Json

    if (json) {
      yield* Console.error(JSON.stringify({
        error: { _tag: error._tag, message: error.message, hint: error.hint, detail: error.detail }
      }))
    } else {
      yield* Console.error(`error:  ${error.message}\nhint:   ${error.hint}\ndetail: ${error.detail}`)
    }
  })

const reported = <A, R>(self: Effect.Effect<A, SpotifyError, R>) =>
  self.pipe(Effect.tapError(printError))

const next = Command.make("next", {}, () =>
  Effect.gen(function* () {
    const spotify = yield* Spotify
    const track = yield* spotify.next

    yield* printTrack(track)
  }).pipe(reported)
).pipe(Command.withDescription("Skip to the next track"))

const status = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const spotify = yield* Spotify
    const track = yield* spotify.nowPlaying

    yield* printTrack(track)
  }).pipe(reported)
).pipe(Command.withDescription("Show what's playing"))

export const spotr = Command.make("spotr").pipe(
  Command.withSubcommands([next, status]),
  Command.provide(
    Spotify.layer.pipe(
      Layer.provide(CdpBridge),
      Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
    )
  ),
  Command.withGlobalFlags([Json, Port]),
  Command.withDescription("Control the Spotify desktop app")
);
