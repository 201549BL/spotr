import { Schema } from "effect"
import { SpotifyUri } from "./Track.ts"

// A playlist in the user's sidebar. `folder` is its folder path, such as
// "Work / Focus", or null at the top level. `canAdd` says whether the
// user may add tracks to it.
export class Playlist extends Schema.Class<Playlist, { readonly brand: unique symbol }>("Playlist")({
  uri: SpotifyUri,
  name: Schema.String,
  folder: Schema.NullOr(Schema.String),
  canAdd: Schema.Boolean,
  tracks: Schema.Int
}) {}

// The outcome of liking, unliking or adding a track to a playlist.
// `name` is the track's name when spotr knows it.
export class LikeResult extends Schema.Class<LikeResult, { readonly brand: unique symbol }>("LikeResult")({
  uri: SpotifyUri,
  name: Schema.NullOr(Schema.String),
  liked: Schema.Boolean
}) {}

export class PlaylistAddResult extends Schema.Class<PlaylistAddResult, { readonly brand: unique symbol }>("PlaylistAddResult")({
  playlist: Playlist,
  uri: SpotifyUri,
  name: Schema.NullOr(Schema.String)
}) {}
