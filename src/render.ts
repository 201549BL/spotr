import { Console, Effect, Stream } from "effect"
import type { Check } from "./domain/Check.ts"
import type { Device } from "./domain/Device.ts"
import type { SpotifyError } from "./domain/errors.ts"
import type { PlayerStatus } from "./domain/PlayerStatus.ts"
import type { LikeResult, Playlist, PlaylistAddResult } from "./domain/Playlist.ts"
import type { Queue } from "./domain/Queue.ts"
import type { Track } from "./domain/Track.ts"
import { formatTime } from "./domain/Seek.ts"
import type { Volume } from "./domain/Volume.ts"
import { Json } from "./settings.ts"

// Commands return data. This is the one place that decides how it
// looks: JSON with --json, otherwise the command's text format.
export const present = <A>(toText: (value: A) => string) =>
  <R>(self: Effect.Effect<A, SpotifyError, R>) =>
    Effect.gen(function* () {
      const json = yield* Json

      const value = yield* self.pipe(
        Effect.tapError((error) => Console.error(json ? errorJson(error) : errorText(error)))
      )

      yield* Console.log(json ? JSON.stringify(value) : toText(value))
    })

// Like present, for a stream: prints each value as it arrives, one JSON
// object per line with --json.
export const presentEach = <A>(toText: (value: A) => string) =>
  <R>(self: Stream.Stream<A, SpotifyError, R>) =>
    Effect.gen(function* () {
      const json = yield* Json

      yield* self.pipe(
        Stream.runForEach((value) => Console.log(json ? JSON.stringify(value) : toText(value))),
        Effect.tapError((error) => Console.error(json ? errorJson(error) : errorText(error)))
      )
    })

const errorText = (error: SpotifyError) =>
  `error:  ${error.message}\nhint:   ${error.hint}\ndetail: ${error.detail}`

const errorJson = (error: SpotifyError) =>
  JSON.stringify({ error: { _tag: error._tag, message: error.message, hint: error.hint, detail: error.detail } })

export const statusText = (status: PlayerStatus) => {
  const { track, paused } = status

  if (!track) return "Nothing playing"

  const details = [
    `${formatTime(status.positionMs)} / ${formatTime(track.durationMs)}`,
    `shuffle ${status.shuffle ? "on" : "off"}`,
    `repeat ${status.repeat}`,
    ...(status.liked ? ["♥ liked"] : [])
  ]

  return `${paused ? "⏸" : "▶"} ${trackLine(track)}\n  ${details.join(" · ")}`
}

const trackLine = (track: Track) => `${track.name} · ${track.artists.join(", ")}`

const numbered = (tracks: ReadonlyArray<Track>, limit: number) => {
  const lines = tracks.slice(0, limit).map((track, index) => `  ${index + 1}. ${trackLine(track)}`)
  const rest = tracks.length - limit

  return rest > 0 ? [...lines, `  … and ${rest} more`] : lines
}

export const queueText = ({ current, queued, nextUp }: Queue) =>
  [
    current ? `Now playing: ${trackLine(current)}` : "Nothing playing",
    queued.length > 0 ? "Queued:" : "Queued: nothing",
    ...numbered(queued, 20),
    ...(nextUp.length > 0 ? ["Next up:", ...numbered(nextUp, 10)] : [])
  ].join("\n")

export const likeText = ({ uri, name, liked }: LikeResult) =>
  liked ? `♥ Liked ${name ?? uri}` : `Removed ${name ?? uri} from Liked Songs`

export const playlistsText = (playlists: ReadonlyArray<Playlist>) =>
  playlists.length === 0
    ? "No playlists"
    : playlists
      .map((playlist) => {
        const name = playlist.folder ? `${playlist.folder} / ${playlist.name}` : playlist.name
        const tracks = `${playlist.tracks} track${playlist.tracks === 1 ? "" : "s"}`

        return `${name} · ${tracks}${playlist.canAdd ? "" : " · read-only"}`
      })
      .join("\n")

export const playlistAddText = ({ playlist, uri, name }: PlaylistAddResult) =>
  `Added ${name ?? uri} to ${playlist.name}`

export const devicesText = (devices: ReadonlyArray<Device>) =>
  devices
    .map((device) => `${device.active ? "▶" : " "} ${device.name} · ${device.type}${device.local ? " · this computer" : ""}`)
    .join("\n")

// One line per change, for spotr watch.
export const watchText = ({ track, paused }: PlayerStatus) =>
  track ? `${paused ? "⏸" : "▶"} ${trackLine(track)}` : "Nothing playing"

const checkMarks = { pass: "✓", fail: "✗", skipped: "-" }

export const doctorText = (checks: ReadonlyArray<Check>) =>
  checks
    .map(({ name, status, detail }) => {
      const suffix = status === "skipped" ? " (skipped)" : detail ? `\n    ${detail}` : ""

      return `${checkMarks[status]} ${name}${suffix}`
    })
    .join("\n")

export const launchText = ({ started, port }: { readonly started: boolean; readonly port: number }) =>
  started ? `Started Spotify with DevTools on port ${port}` : `Spotify is already reachable on port ${port}`

export const shuffleText = ({ shuffle }: PlayerStatus) => `Shuffle ${shuffle ? "on" : "off"}`

export const repeatText = ({ repeat }: PlayerStatus) => `Repeat ${repeat}`

export const volumeText = ({ volume }: { readonly volume: Volume }) => `Volume ${volume}%`
