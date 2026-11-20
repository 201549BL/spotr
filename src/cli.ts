import { Effect, Layer, Option } from "effect"
import { Argument, Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { CdpBridge } from "./bridge/CdpBridge.ts"
import { parseSeek } from "./domain/Seek.ts"
import { SpotifyUri, toSpotifyUri } from "./domain/Track.ts"
import { Volume } from "./domain/Volume.ts"
import { present, queueText, repeatText, shuffleText, statusText, volumeText } from "./render.ts"
import { Json, Port } from "./settings.ts"
import { Spotify } from "./spotify/Spotify.ts"

const uriArgument = (description: string) =>
  Argument.String("uri").pipe(
    Argument.withDescription(description),
    Argument.map(toSpotifyUri),
    Argument.withSchema(SpotifyUri)
  )

const status = Command.make("status", {}, () =>
  Spotify.use((spotify) => spotify.status).pipe(present(statusText))
).pipe(Command.withDescription("Show what's playing"))

const play = Command.make(
  "play",
  { uri: uriArgument("A spotify: URI or open.spotify.com link to play").pipe(Argument.optional) },
  ({ uri }) =>
    Spotify.use((spotify) =>
      Option.match(uri, { onNone: () => spotify.resume, onSome: spotify.play })
    ).pipe(present(statusText))
).pipe(Command.withDescription("Play a track, album, playlist or artist, or resume"))

const pause = Command.make("pause", {}, () =>
  Spotify.use((spotify) => spotify.pause).pipe(present(statusText))
).pipe(Command.withDescription("Pause playback"))

const resume = Command.make("resume", {}, () =>
  Spotify.use((spotify) => spotify.resume).pipe(present(statusText))
).pipe(Command.withDescription("Resume playback"))

const next = Command.make("next", {}, () =>
  Spotify.use((spotify) => spotify.next).pipe(present(statusText))
).pipe(Command.withDescription("Skip to the next track"))

const previous = Command.make("previous", {}, () =>
  Spotify.use((spotify) => spotify.previous).pipe(present(statusText))
).pipe(Command.withDescription("Go back to the previous track, or restart this one"))

const seek = Command.make(
  "seek",
  {
    position: Argument.String("position").pipe(
      Argument.withDescription("1:30 or 90 to jump there, +10 or -10 to move by seconds"),
      Argument.filterMap(parseSeek, (input) => `Expected a time like 1:30, 90, +10 or -10, got "${input}"`)
    )
  },
  ({ position }) => Spotify.use((spotify) => spotify.seek(position)).pipe(present(statusText))
).pipe(Command.withDescription("Jump to a position in the track"))

const shuffle = Command.make(
  "shuffle",
  { mode: Argument.Literals("mode", ["on", "off"]).pipe(Argument.optional) },
  ({ mode }) =>
    Spotify.use((spotify) =>
      Option.match(mode, { onNone: () => spotify.status, onSome: (on) => spotify.setShuffle(on === "on") })
    ).pipe(present(shuffleText))
).pipe(Command.withDescription("Show shuffle, or turn it on or off"))

const repeat = Command.make(
  "repeat",
  { mode: Argument.Literals("mode", ["off", "all", "one"]).pipe(Argument.optional) },
  ({ mode }) =>
    Spotify.use((spotify) =>
      Option.match(mode, { onNone: () => spotify.status, onSome: spotify.setRepeat })
    ).pipe(present(repeatText))
).pipe(Command.withDescription("Show repeat, or set it to off, all or one"))

const queueAdd = Command.make("add", { uri: uriArgument("The track to add") }, ({ uri }) =>
  Spotify.use((spotify) => spotify.addToQueue(uri)).pipe(present(queueText))
).pipe(Command.withDescription("Add a track to the end of your queue"))

const queueRemove = Command.make("remove", { uri: uriArgument("The queued track to remove") }, ({ uri }) =>
  Spotify.use((spotify) => spotify.removeFromQueue(uri)).pipe(present(queueText))
).pipe(Command.withDescription("Remove a track you queued"))

const queueClear = Command.make("clear", {}, () =>
  Spotify.use((spotify) => spotify.clearQueue).pipe(present(queueText))
).pipe(Command.withDescription("Remove everything you queued"))

const queue = Command.make("queue", {}, () =>
  Spotify.use((spotify) => spotify.queue).pipe(present(queueText))
).pipe(
  Command.withSubcommands([queueAdd, queueRemove, queueClear]),
  Command.withDescription("Show what plays next, or change your queue")
)

const volume = Command.make(
  "volume",
  {
    level: Argument.Int("level").pipe(
      Argument.withDescription("New volume, from 0 to 100"),
      Argument.withSchema(Volume),
      Argument.optional
    )
  },
  ({ level }) =>
    Spotify.use((spotify) =>
      Option.match(level, {
        onNone: () => spotify.volume,
        onSome: (wanted) => spotify.setVolume(wanted).pipe(Effect.as(wanted))
      })
    ).pipe(
      Effect.map((current) => ({ volume: current })),
      present(volumeText)
    )
).pipe(Command.withDescription("Show the volume, or set it"))

export const spotr = Command.make("spotr").pipe(
  Command.withSubcommands([status, play, pause, resume, next, previous, seek, shuffle, repeat, queue, volume]),
  Command.provide(
    Spotify.layer.pipe(
      Layer.provide(CdpBridge),
      Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
    )
  ),
  Command.withGlobalFlags([Json, Port]),
  Command.withDescription("Control the Spotify desktop app")
)
