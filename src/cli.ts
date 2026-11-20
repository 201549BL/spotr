import { Effect, Layer, Option } from "effect"
import { Argument, Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { CdpBridge } from "./bridge/CdpBridge.ts"
import { Volume } from "./domain/Volume.ts"
import { present, statusText, volumeText } from "./render.ts"
import { Json, Port } from "./settings.ts"
import { Spotify } from "./spotify/Spotify.ts"

const status = Command.make("status", {}, () =>
  Spotify.use((spotify) => spotify.status).pipe(present(statusText))
).pipe(Command.withDescription("Show what's playing"))

const next = Command.make("next", {}, () =>
  Spotify.use((spotify) => spotify.next).pipe(present(statusText))
).pipe(Command.withDescription("Skip to the next track"))

const pause = Command.make("pause", {}, () =>
  Spotify.use((spotify) => spotify.pause).pipe(present(statusText))
).pipe(Command.withDescription("Pause playback"))

const resume = Command.make("resume", {}, () =>
  Spotify.use((spotify) => spotify.resume).pipe(present(statusText))
).pipe(Command.withDescription("Resume playback"))

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
  Command.withSubcommands([status, next, pause, resume, volume]),
  Command.provide(
    Spotify.layer.pipe(
      Layer.provide(CdpBridge),
      Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
    )
  ),
  Command.withGlobalFlags([Json, Port]),
  Command.withDescription("Control the Spotify desktop app")
)
