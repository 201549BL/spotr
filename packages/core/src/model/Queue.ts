import { Schema } from "effect"
import { Track } from "./Track.ts"

// What plays next. `queued` is what the user added; `nextUp` is the rest
// of the album, playlist or artist that's playing.
export class Queue extends Schema.Class<Queue, { readonly brand: unique symbol }>("Queue")({
  current: Schema.NullOr(Track),
  queued: Schema.Array(Track),
  nextUp: Schema.Array(Track)
}) {}
