import { Schema } from "effect"
import { SpotifyUri } from "./Track.ts"

export const SearchKind = Schema.Literals([
  "track",
  "artist",
  "album",
  "playlist",
  "podcast",
  "episode",
  "audiobook",
  "user",
  "genre"
])

export type SearchKind = typeof SearchKind.Type

// One search hit. `by` is who made it: the artists of a track or album,
// a playlist's owner, or a podcast's publisher.
export class SearchResult extends Schema.Class<SearchResult, { readonly brand: unique symbol }>("SearchResult")({
  kind: SearchKind,
  uri: SpotifyUri,
  name: Schema.String,
  by: Schema.NullOr(Schema.String)
}) {}

// Users and genres have pages, but nothing to play.
export const playable = ({ kind }: SearchResult) => kind !== "user" && kind !== "genre"

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2)

// Spotify's search always returns something, even for gibberish. A hit
// counts as relevant when one of the searched words starts a word in its
// name or maker, ignoring case and accents.
export const relevant = (text: string) => (result: SearchResult) => {
  const found = words(`${result.name} ${result.by ?? ""}`)

  return words(text).some((word) => found.some((candidate) => candidate.startsWith(word)))
}
