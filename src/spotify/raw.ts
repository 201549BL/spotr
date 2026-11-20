import { Effect, Schema } from "effect"
import { Device } from "../domain/Device.ts"
import { InternalApiChanged, type SpotifyError } from "../domain/errors.ts"
import { Playlist } from "../domain/Playlist.ts"
import { PlayerStatus, type Repeat } from "../domain/PlayerStatus.ts"
import { SpotifyUri, Track } from "../domain/Track.ts"
import { Volume } from "../domain/Volume.ts"

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

// The parts of PlayerAPI.getState() spotr uses. Spotify's own UI treats
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
