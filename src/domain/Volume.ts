import { Option, Schema } from "effect"

// Volume as a whole percentage. Spotify itself uses 0 to 1.
export const Volume = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  Schema.brand("Volume")
)

export type Volume = typeof Volume.Type

// `muted` is Spotify's mute button. While muted, the volume reads 0.
export class VolumeStatus extends Schema.Class<VolumeStatus, { readonly brand: unique symbol }>("VolumeStatus")({
  volume: Volume,
  muted: Schema.Boolean
}) {}

// A new volume: an absolute level, or a change to the current one.
export type VolumeChange = { readonly relative: boolean; readonly amount: number }

// Accepts "40" (a level from 0 to 100), and "+10" or "-10" (a change).
export const parseVolumeChange = (input: string): Option.Option<VolumeChange> => {
  const match = input.match(/^([+-])?(\d{1,3})$/)

  if (!match) return Option.none()
  const [, sign, digits] = match
  const amount = Number(digits)

  if (sign) return Option.some({ relative: true, amount: sign === "-" ? -amount : amount })

  return amount <= 100 ? Option.some({ relative: false, amount }) : Option.none()
}
