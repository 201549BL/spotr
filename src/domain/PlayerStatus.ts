import { Schema } from "effect"
import { Track } from "./Track.ts"

// What the player is doing. `track` is null when nothing is loaded.
export class PlayerStatus extends Schema.Class<PlayerStatus, { readonly brand: unique symbol }>("PlayerStatus")({
  track: Schema.NullOr(Track),
  paused: Schema.Boolean
}) {}
