import { Option, Schema } from "effect"

// "spotify:" and a kind, then colon-separated parts ending in a non-empty
// one. Most are "spotify:track:<id>", but Liked Songs is
// "spotify:collection:tracks" and local files have several parts, some
// of them empty.
export const SpotifyUri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^spotify:[a-z]+(?::[^\s:]*)*:[^\s:]+$/)),
  Schema.brand("SpotifyUri")
)

export type SpotifyUri = typeof SpotifyUri.Type

export const likedSongs = "spotify:collection:tracks"

// Turns an open.spotify.com link, or the word "liked", into a spotify:
// URI. Anything else is returned unchanged, so SpotifyUri can reject it.
export const toSpotifyUri = (input: string) => {
  if (input === "liked") return likedSongs
  const link = input.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/)

  return link ? `spotify:${link[1]}:${link[2]}` : input
}

export class Track extends Schema.Class<Track, { readonly brand: unique symbol }>("Track")({
  uri: SpotifyUri,
  name: Schema.String,
  artists: Schema.Array(Schema.String),
  durationMs: Schema.Int
}) {}

// What play was asked to play: nothing (resume), a URI or link,
// or words to search for.
export type PlayTarget =
  | { readonly kind: "resume" }
  | { readonly kind: "uri"; readonly uri: SpotifyUri }
  | { readonly kind: "search"; readonly text: string }

const decodeUri = Schema.decodeUnknownOption(SpotifyUri)

export const toPlayTarget = (what: string): PlayTarget => {
  const text = what.trim()

  if (text === "") return { kind: "resume" }

  return Option.match(decodeUri(toSpotifyUri(text)), {
    onNone: (): PlayTarget => ({ kind: "search", text }),
    onSome: (uri): PlayTarget => ({ kind: "uri", uri })
  })
}
