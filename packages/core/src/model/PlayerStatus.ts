import { Schema } from "effect"
import { Track } from "./Track.ts"

export const Repeat = Schema.Literals(["off", "all", "one"])

export type Repeat = typeof Repeat.Type

// What the player is doing. `track` is null when nothing is loaded, and
// `context` is the album, playlist or artist it plays from, if any.
export class PlayerStatus extends Schema.Class<PlayerStatus, { readonly brand: unique symbol }>("PlayerStatus")({
  track: Schema.NullOr(Track),
  context: Schema.NullOr(Schema.String),
  paused: Schema.Boolean,
  positionMs: Schema.Int,
  shuffle: Schema.Boolean,
  repeat: Repeat,
  liked: Schema.Boolean
}) {}
