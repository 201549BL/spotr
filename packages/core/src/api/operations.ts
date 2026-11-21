import { Context, Effect, Schema } from "effect"
import { OpenRpc, Rpc, RpcGroup } from "effect/rpc"
import { Check } from "../model/Check.ts"
import { Device } from "../model/Device.ts"
import { SpotifyError } from "../model/errors.ts"
import { PlayerStatus, Repeat } from "../model/PlayerStatus.ts"
import { CreatedPlaylist, DeletedPlaylist, LikeResult, Playlist, PlaylistAddResult } from "../model/Playlist.ts"
import { Queue } from "../model/Queue.ts"
import { SearchResult } from "../model/SearchResult.ts"
import { SeekTarget } from "../model/Seek.ts"
import { SpotifyUri } from "../model/Track.ts"
import { VolumeChange, VolumeStatus } from "../model/Volume.ts"
import { LaunchResult } from "../transport/Launcher.ts"

const op = <const Tag extends string, Success extends Schema.Top, Payload extends Schema.Top | Schema.Struct.Fields = typeof Schema.Void>(
  tag: Tag,
  description: string,
  options: { readonly payload?: Payload; readonly success: Success }
) => Rpc.make(tag, { ...options, error: SpotifyError }).annotate(OpenRpc.Description, description)

const track = { uri: Schema.optionalKey(SpotifyUri) }

const playlist = Schema.String.annotate({ description: "The playlist's name or URI" })

// Every operation spotrc offers. The CLI, the JSON-RPC server, the MCP
// server and the OpenRPC document are all built from this table.
export const Spotrc = RpcGroup.make(
  op("status", "Show what's playing", { success: PlayerStatus }),
  op("play", "Play something by URI, link or search, or resume", {
    payload: {
      what: Schema.String.annotate({
        description: "A spotify: URI, an open.spotify.com link, \"liked\", or words to search for. Empty resumes"
      })
    },
    success: PlayerStatus
  }),
  op("pause", "Pause playback", { success: PlayerStatus }),
  op("resume", "Resume playback", { success: PlayerStatus }),
  op("toggle", "Pause if playing, resume if paused", { success: PlayerStatus }),
  op("next", "Skip to the next track", { success: PlayerStatus }),
  op("previous", "Go back to the previous track, or restart this one", { success: PlayerStatus }),
  op("seek", "Jump to a position in the track", { payload: SeekTarget, success: PlayerStatus }),
  op("setShuffle", "Turn shuffle on or off", { payload: { on: Schema.Boolean }, success: PlayerStatus }),
  op("setRepeat", "Set repeat to off, all or one", { payload: { mode: Repeat }, success: PlayerStatus }),
  op("queue", "Show what plays next", { success: Queue }),
  op("addToQueue", "Add a track to the end of your queue", { payload: { uri: SpotifyUri }, success: Queue }),
  op("removeFromQueue", "Remove a track you queued", { payload: { uri: SpotifyUri }, success: Queue }),
  op("clearQueue", "Remove everything you queued", { success: Queue }),
  op("like", "Add a track to Liked Songs. Defaults to the playing track", { payload: track, success: LikeResult }),
  op("unlike", "Remove a track from Liked Songs. Defaults to the playing track", {
    payload: track,
    success: LikeResult
  }),
  op("playlists", "List your playlists", { success: Schema.Array(Playlist) }),
  op("addToPlaylist", "Add a track to one of your playlists. Defaults to the playing track", {
    payload: { playlist, ...track },
    success: PlaylistAddResult
  }),
  op("createPlaylist", "Create a playlist at the top of your library", {
    payload: { name: Schema.String.check(Schema.isNonEmpty()), isPrivate: Schema.Boolean },
    success: CreatedPlaylist
  }),
  op("deletePlaylist", "Delete one of your playlists. Fails with NeedsConfirmation unless yes is true", {
    payload: { playlist, yes: Schema.Boolean },
    success: DeletedPlaylist
  }),
  op("devices", "List Spotify Connect devices", { success: Schema.Array(Device) }),
  op("useDevice", "Move playback to another device", {
    payload: { device: Schema.String.annotate({ description: "The device's name or id" }) },
    success: Schema.Array(Device)
  }),
  op("volume", "Show the volume", { success: VolumeStatus }),
  op("setVolume", "Set the volume, or change it by an amount", { payload: VolumeChange, success: VolumeStatus }),
  op("mute", "Mute Spotify", { success: VolumeStatus }),
  op("unmute", "Unmute Spotify, back to the volume before muting", { success: VolumeStatus }),
  op("search", "Search Spotify, best match first", {
    payload: {
      text: Schema.String,
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(10))
      )
    },
    success: Schema.Array(SearchResult)
  }),
  Rpc.make("watch", { success: PlayerStatus, error: SpotifyError, stream: true }).annotate(
    OpenRpc.Description,
    "Emit the player status now, then whenever the track or play state changes"
  ),
  // Failed checks are part of the answer, not an error, so clients get
  // the whole list.
  Rpc.make("doctor", { success: Schema.Array(Check) })
    .annotate(OpenRpc.Description, "Check that spotrc can reach and drive Spotify")
    .annotate(OpenRpc.Errors, []),
  op("launch", "Start Spotify with its DevTools port open (macOS)", { success: LaunchResult })
).annotate(OpenRpc.Errors, [{
  code: 1,
  message: "code is the error's exit code (2 to 7). data is one of the SpotifyError components: its _tag, fields, message, hint and detail"
}])

export type Operation = RpcGroup.Rpcs<typeof Spotrc>

export const describe = (tag: Operation["_tag"]) =>
  Context.getOrUndefined(Spotrc.requests.get(tag)?.annotations ?? Context.empty(), OpenRpc.Description) ?? ""
