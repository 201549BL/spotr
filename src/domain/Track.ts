import { Schema } from "effect"

export const SpotifyUri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^spotify:[a-z]+:[A-Za-z0-9]+$/)),
  Schema.brand("SpotifyUri")
)

export class Track extends Schema.Class<Track, { readonly brand: unique symbol }>("Track")({
  uri: SpotifyUri,
  name: Schema.String,
  artists: Schema.Array(Schema.String)
}) {}
