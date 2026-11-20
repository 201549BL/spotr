import { Schema } from "effect"

export const SpotifyUri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^spotify:[a-z]+:[A-Za-z0-9]+$/)),
  Schema.brand("SpotifyUri")
)

export type SpotifyUri = typeof SpotifyUri.Type

// Turns an open.spotify.com link into a spotify: URI. Anything else is
// returned unchanged, so SpotifyUri can reject it.
export const toSpotifyUri = (input: string) => {
  const link = input.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?([a-z]+)\/([A-Za-z0-9]+)/)

  return link ? `spotify:${link[1]}:${link[2]}` : input
}

export class Track extends Schema.Class<Track, { readonly brand: unique symbol }>("Track")({
  uri: SpotifyUri,
  name: Schema.String,
  artists: Schema.Array(Schema.String),
  durationMs: Schema.Int
}) {}
