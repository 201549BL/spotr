import { Console, Effect } from "effect"
import type { SpotifyError } from "./domain/errors.ts"
import type { PlayerStatus } from "./domain/PlayerStatus.ts"
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

  return `${paused ? "⏸" : "▶"} ${track.name} · ${track.artists.join(", ")}\n  ${details.join(" · ")}`
}

export const shuffleText = ({ shuffle }: PlayerStatus) => `Shuffle ${shuffle ? "on" : "off"}`

export const repeatText = ({ repeat }: PlayerStatus) => `Repeat ${repeat}`

export const volumeText = ({ volume }: { readonly volume: Volume }) => `Volume ${volume}%`
