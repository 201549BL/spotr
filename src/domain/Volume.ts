import { Schema } from "effect"

// Volume as a whole percentage. Spotify itself uses 0 to 1.
export const Volume = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  Schema.brand("Volume")
)

export type Volume = typeof Volume.Type
