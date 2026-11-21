import { Effect, Option, Schema } from "effect"
import { Device } from "../model/Device.ts"
import { InternalApiChanged, type SpotifyError } from "../model/errors.ts"
import { Playlist } from "../model/Playlist.ts"
import { SearchResult } from "../model/SearchResult.ts"
import { PlayerStatus, type Repeat } from "../model/PlayerStatus.ts"
import { SpotifyUri, Track } from "../model/Track.ts"
import { Volume } from "../model/Volume.ts"

// The shapes Spotify's internal APIs return, and how they become domain
// types. Everything here is decoded, never trusted.

// A track or episode as Spotify's player describes it. Episodes may have
// no artists.
const RawItem = Schema.Struct({
  uri: SpotifyUri,
  uid: Schema.optional(Schema.String),
  name: Schema.String,
  artists: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  duration: Schema.Struct({ milliseconds: Schema.Finite }),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String))
})

export const toTrack = (item: typeof RawItem.Type) =>
  new Track({
    uri: item.uri,
    name: item.name,
    artists: (item.artists ?? []).map((artist) => artist.name),
    durationMs: Math.round(item.duration.milliseconds)
  })

// PlayerAPI.getQueue(): `queued` holds the user's additions, `nextUp`
// the rest of the context.
const RawQueue = Schema.Struct({
  current: Schema.optional(Schema.NullOr(RawItem)),
  queued: Schema.Array(RawItem),
  nextUp: Schema.Array(RawItem)
})

export const decodeQueue = Schema.decodeUnknownEffect(RawQueue)

// The parts of PlayerAPI.getState() spotrc uses. Spotify's own UI treats
// `item` as possibly missing, and the whole state is null before the
// player's first update.
const RawState = Schema.NullOr(Schema.Struct({
  item: Schema.optional(Schema.NullOr(RawItem)),
  context: Schema.optional(Schema.NullOr(Schema.Struct({ uri: Schema.String }))),
  isPaused: Schema.Boolean,
  shuffle: Schema.Boolean,
  repeat: Schema.Literals([0, 1, 2]),
  positionAsOfTimestamp: Schema.Finite,
  timestamp: Schema.Finite
}))

export const decodeState = Schema.decodeUnknownEffect(RawState)

export const decodeLevel = Schema.decodeUnknownEffect(Schema.Finite)

export const decodeVolume = Schema.decodeUnknownEffect(Volume)

export const repeatModes: ReadonlyArray<Repeat> = ["off", "all", "one"]

// When Spotify's data doesn't match a schema, Spotify has most likely
// changed underneath us.
export const blameUpdate = (operation: string) =>
  <A>(self: Effect.Effect<A, SpotifyError | Schema.SchemaError>): Effect.Effect<A, SpotifyError> =>
    self.pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(new InternalApiChanged({ operation, issue: error.message }))
      )
    )

// Spotify reports the position at a moment in time; while playing, the
// real position has moved on since then.
export const toStatus = (raw: typeof RawState.Type, now: number) => {
  const item = raw?.item ?? null
  const track = item ? toTrack(item) : null
  const moved = raw && !raw.isPaused ? now - raw.timestamp : 0
  const position = Math.round((raw?.positionAsOfTimestamp ?? 0) + moved)

  return new PlayerStatus({
    track,
    context: raw?.context?.uri ?? null,
    paused: raw?.isPaused ?? true,
    positionMs: Math.max(0, Math.min(position, track?.durationMs ?? 0)),
    shuffle: raw?.shuffle ?? false,
    repeat: repeatModes[raw?.repeat ?? 0] ?? "off",
    liked: item?.metadata?.["collection.in_collection"] === "true"
  })
}


const RawPlaylist = Schema.Struct({
  type: Schema.Literal("playlist"),
  uri: SpotifyUri,
  name: Schema.String,
  canAdd: Schema.optional(Schema.NullOr(Schema.Boolean)),
  totalLength: Schema.optional(Schema.NullOr(Schema.Finite))
})

const RawPlaceholder = Schema.Struct({ type: Schema.Literal("placeholder") })

interface RawFolder {
  readonly type: "folder"
  readonly name: string
  readonly items: ReadonlyArray<RawFolder | typeof RawPlaylist.Type | typeof RawPlaceholder.Type>
}

// The same tree before decoding, while playlist URIs are plain strings.
interface RawFolderInput {
  readonly type: "folder"
  readonly name: string
  readonly items: ReadonlyArray<RawFolderInput | typeof RawPlaylist.Encoded | typeof RawPlaceholder.Encoded>
}

// RootlistAPI.getContents(): the playlist sidebar as a folder tree.
const RawFolder = Schema.Struct({
  type: Schema.Literal("folder"),
  name: Schema.String,
  items: Schema.Array(Schema.Union([Schema.suspend((): Schema.Codec<RawFolder, RawFolderInput> => RawFolder), RawPlaylist, RawPlaceholder]))
})

export const decodeRootlist = Schema.decodeUnknownEffect(RawFolder)

// Flattens the folder tree, remembering each playlist's folder path.
export const toPlaylists = (folder: RawFolder, path: ReadonlyArray<string> = []): ReadonlyArray<Playlist> =>
  folder.items.flatMap((item) => {
    if (item.type === "folder") return toPlaylists(item, [...path, item.name])

    if (item.type === "placeholder") return []

    return [
      new Playlist({
        uri: item.uri,
        name: item.name,
        folder: path.length > 0 ? path.join(" / ") : null,
        canAdd: item.canAdd ?? false,
        tracks: Math.round(item.totalLength ?? 0)
      })
    ]
  })

export const decodeContains = Schema.decodeUnknownEffect(Schema.Array(Schema.Boolean))

// RootlistAPI.createPlaylist resolves to the new URI, or null when it
// failed.
export const decodeCreated = Schema.decodeUnknownEffect(Schema.NullOr(SpotifyUri))

export const decodeMuted = Schema.decodeUnknownEffect(Schema.Boolean)

export const decodePublished = Schema.decodeUnknownEffect(Schema.Boolean)

// ConnectDevicesAPI.getDevices(): Spotify Connect devices, this computer
// included.
const RawDevices = Schema.Array(Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  isActive: Schema.Boolean,
  isLocal: Schema.Boolean
}))

export const decodeDevices = Schema.decodeUnknownEffect(RawDevices)

export const toDevices = (raw: typeof RawDevices.Type) =>
  raw.map(({ id, name, type, isActive, isLocal }) => new Device({ id, name, type, active: isActive, local: isLocal }))

const Named = Schema.Struct({ name: Schema.String })

const Profiles = Schema.Struct({ items: Schema.Array(Schema.Struct({ profile: Named })) })

const OwnedBy = Schema.Struct({ data: Named })

// The search hits spotrc knows, by Spotify's __typename. Spotify's own
// search box skips types it doesn't know, and spotrc does the same.
const RawHit = Schema.Union([
  Schema.Struct({ __typename: Schema.Literal("Track"), uri: SpotifyUri, name: Schema.String, artists: Profiles }),
  Schema.Struct({ __typename: Schema.Literal("Album"), uri: SpotifyUri, name: Schema.String, artists: Profiles }),
  Schema.Struct({ __typename: Schema.Literal("Artist"), uri: SpotifyUri, profile: Named }),
  Schema.Struct({ __typename: Schema.Literal("Playlist"), uri: SpotifyUri, name: Schema.String, ownerV2: OwnedBy }),
  Schema.Struct({ __typename: Schema.Literal("Podcast"), uri: SpotifyUri, name: Schema.String, publisher: Named }),
  Schema.Struct({ __typename: Schema.Literal("Audiobook"), uri: SpotifyUri, name: Schema.String, publisher: Named }),
  Schema.Struct({ __typename: Schema.Literal("Episode"), uri: SpotifyUri, name: Schema.String, podcastV2: OwnedBy }),
  Schema.Struct({ __typename: Schema.Literal("User"), uri: SpotifyUri, name: Schema.String }),
  Schema.Struct({ __typename: Schema.Literal("Genre"), uri: SpotifyUri, name: Schema.String })
])

const knownHits = new Set(["Track", "Album", "Artist", "Playlist", "Podcast", "Audiobook", "Episode", "User", "Genre"])

// The searchModalResults response. Each hit's data stays raw here,
// because a Struct would drop every key it doesn't list.
const RawSearch = Schema.Struct({
  data: Schema.Struct({
    searchV2: Schema.Struct({
      topResultsV2: Schema.Struct({
        itemsV2: Schema.Array(Schema.Struct({ item: Schema.Struct({ data: Schema.optional(Schema.Unknown) }) }))
      })
    })
  })
})

export const decodeSearch = Schema.decodeUnknownEffect(RawSearch)

const decodeTypename = Schema.decodeUnknownOption(Schema.Struct({ __typename: Schema.String }))

const decodeHit = Schema.decodeUnknownEffect(RawHit)

// Hits of a type spotrc knows are decoded fully, so a reshaped Track is
// an error rather than a silently missing result. Other types are
// skipped, as Spotify's own search box does.
export const toSearchResults = (search: typeof RawSearch.Type) =>
  Effect.forEach(
    search.data.searchV2.topResultsV2.itemsV2.filter(({ item }) =>
      Option.exists(decodeTypename(item.data), ({ __typename }) => knownHits.has(__typename))
    ),
    ({ item }) => decodeHit(item.data).pipe(Effect.map(toSearchResult))
  )

const names = (artists: typeof Profiles.Type) => artists.items.map((artist) => artist.profile.name).join(", ")

const toSearchResult = (hit: typeof RawHit.Type) => {
  switch (hit.__typename) {
        case "Track":
          return new SearchResult({ kind: "track", uri: hit.uri, name: hit.name, by: names(hit.artists) })
        case "Album":
          return new SearchResult({ kind: "album", uri: hit.uri, name: hit.name, by: names(hit.artists) })
        case "Artist":
          return new SearchResult({ kind: "artist", uri: hit.uri, name: hit.profile.name, by: null })
        case "Playlist":
          return new SearchResult({ kind: "playlist", uri: hit.uri, name: hit.name, by: hit.ownerV2.data.name })
        case "Podcast":
          return new SearchResult({ kind: "podcast", uri: hit.uri, name: hit.name, by: hit.publisher.name })
        case "Audiobook":
          return new SearchResult({ kind: "audiobook", uri: hit.uri, name: hit.name, by: hit.publisher.name })
        case "Episode":
          return new SearchResult({ kind: "episode", uri: hit.uri, name: hit.name, by: hit.podcastV2.data.name })
        case "User":
          return new SearchResult({ kind: "user", uri: hit.uri, name: hit.name, by: null })
        case "Genre":
          return new SearchResult({ kind: "genre", uri: hit.uri, name: hit.name, by: null })
  }
}
