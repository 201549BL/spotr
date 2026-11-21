import { Option, Schema } from "effect"

// Where to seek: an absolute position, or an offset from the current one.
export const SeekTarget = Schema.Struct({ relative: Schema.Boolean, ms: Schema.Int })

export type SeekTarget = typeof SeekTarget.Type

// Accepts "90" or "1:30" (absolute), and "+10", "-10" or "+1:00" (relative).
export const parseSeek = (input: string): Option.Option<SeekTarget> => {
  const match = input.match(/^([+-])?(?:(\d+):([0-5]\d)|(\d+))$/)

  if (!match) return Option.none()
  const [, sign, minutes, seconds, plain] = match
  const totalSeconds = plain === undefined ? Number(minutes) * 60 + Number(seconds) : Number(plain)
  const ms = totalSeconds * 1000

  return Option.some(sign ? { relative: true, ms: sign === "-" ? -ms : ms } : { relative: false, ms })
}

export const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000)

  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}
