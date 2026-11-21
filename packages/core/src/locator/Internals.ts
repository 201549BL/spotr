import { Clock, Context, Effect, Layer, type Schema } from "effect"
import { Check } from "../model/Check.ts"
import type { Device } from "../model/Device.ts"
import type { SpotifyError } from "../model/errors.ts"
import type { PlayerStatus, Repeat } from "../model/PlayerStatus.ts"
import type { Playlist } from "../model/Playlist.ts"
import { Queue } from "../model/Queue.ts"
import type { SearchResult } from "../model/SearchResult.ts"
import type { SpotifyUri } from "../model/Track.ts"
import { VolumeStatus } from "../model/Volume.ts"
import { Bridge } from "./Bridge.ts"
import {
  blameUpdate,
  decodeContains,
  decodeCreated,
  decodeDevices,
  decodeLevel,
  decodeMuted,
  decodePublished,
  decodeQueue,
  decodeRootlist,
  decodeSearch,
  decodeState,
  decodeVolume,
  repeatModes,
  toDevices,
  toPlaylists,
  toSearchResults,
  toStatus,
  toTrack
} from "./raw.ts"

// Every internal method spotrc calls. `call` accepts only these, and
// `checks` verifies that each one exists, so the two can't drift apart.
const uses = {
  PlayerAPI: [
    "getState",
    "getQueue",
    "play",
    "pause",
    "resume",
    "skipToNext",
    "skipToPrevious",
    "seekTo",
    "setShuffle",
    "setRepeat",
    "addToQueue",
    "removeFromQueue",
    "clearQueue"
  ],
  // "getMuteHelper.mute" means getMuteHelper(), then mute() on its result.
  PlaybackAPI: ["getVolume", "setVolume", "getMuteHelper.isMuted", "getMuteHelper.mute", "getMuteHelper.unmute"],
  LibraryAPI: ["add", "remove", "contains"],
  RootlistAPI: ["getContents", "contains", "createPlaylist", "remove", "setPublishedState", "getPublishedState"],
  PlaylistAPI: ["add"],
  ConnectDevicesAPI: ["getDevices"],
  ConnectTransferAPI: ["transferPlayback"]
} as const

type Api = keyof typeof uses

// Spotify's GraphQL queries spotrc runs. `checks` verifies each is defined.
const queries = ["searchModalResults"] as const

// How one API looked to `checks`.
type Inspection =
  | { readonly kind: "ok" | "no-port" | "no-page" | "unreachable" }
  | { readonly kind: "missing"; readonly detail: string }

type Effect<A> = Effect.Effect<A, SpotifyError>

// Spotify's internal APIs as typed calls. Everything that knows a method
// name, an argument shape or a return shape of Spotify's lives here.
// Commands return as soon as Spotify accepts them; waiting for Spotify to
// show the change is the caller's job.
export class Internals extends Context.Service<Internals, {
  readonly player: {
    readonly state: Effect<PlayerStatus>
    readonly queue: Effect<Queue>
    readonly play: (uri: SpotifyUri) => Effect<void>
    readonly pause: Effect<void>
    readonly resume: Effect<void>
    readonly skipToNext: Effect<void>
    readonly skipToPrevious: Effect<void>
    readonly seekTo: (ms: number) => Effect<void>
    readonly setShuffle: (on: boolean) => Effect<void>
    readonly setRepeat: (mode: Repeat) => Effect<void>
    readonly addToQueue: (uri: SpotifyUri) => Effect<void>
    // Removes every queued copy of `uri` and returns how many there were.
    readonly removeFromQueue: (uri: SpotifyUri) => Effect<number>
    readonly clearQueue: Effect<void>
  }
  readonly library: {
    readonly contains: (uri: SpotifyUri) => Effect<boolean>
    readonly add: (uri: SpotifyUri) => Effect<void>
    readonly remove: (uri: SpotifyUri) => Effect<void>
  }
  readonly rootlist: {
    readonly playlists: Effect<ReadonlyArray<Playlist>>
    readonly contains: (uri: SpotifyUri) => Effect<boolean>
    // The new playlist's URI, or null when Spotify refused.
    readonly create: (name: string) => Effect<SpotifyUri | null>
    readonly remove: (uri: SpotifyUri) => Effect<void>
    readonly isPublished: (uri: SpotifyUri) => Effect<boolean>
    readonly unpublish: (uri: SpotifyUri) => Effect<void>
  }
  readonly playlist: {
    readonly append: (playlist: SpotifyUri, track: SpotifyUri) => Effect<void>
  }
  readonly playback: {
    readonly volume: Effect<VolumeStatus>
    readonly setVolume: (percent: number) => Effect<void>
    readonly mute: Effect<void>
    readonly unmute: Effect<void>
  }
  readonly devices: {
    readonly list: Effect<ReadonlyArray<Device>>
    readonly transfer: (id: string) => Effect<void>
  }
  readonly search: (text: string, limit: number) => Effect<ReadonlyArray<SearchResult>>
  // Whether spotrc can reach Spotify and every internal it uses exists.
  // Failed checks are in the list, not errors.
  readonly checks: Effect.Effect<ReadonlyArray<Check>>
}>()("spotrc/Internals") {
  static readonly layer = Layer.effect(
    Internals,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const call = <A extends Api>(api: A, method: (typeof uses)[A][number], ...args: ReadonlyArray<Schema.Json>) =>
        bridge.call(api, method, ...args)

      const command = <A extends Api>(api: A, method: (typeof uses)[A][number], ...args: ReadonlyArray<Schema.Json>) =>
        call(api, method, ...args).pipe(Effect.asVoid)

      const state = Effect.gen(function* () {
        const raw = yield* call("PlayerAPI", "getState").pipe(Effect.flatMap(decodeState))

        return toStatus(raw, yield* Clock.currentTimeMillis)
      }).pipe(blameUpdate("PlayerAPI.getState"))

      const rawQueue = call("PlayerAPI", "getQueue").pipe(
        Effect.flatMap(decodeQueue),
        blameUpdate("PlayerAPI.getQueue")
      )

      const queue = rawQueue.pipe(
        Effect.map((raw) =>
          new Queue({
            current: raw.current ? toTrack(raw.current) : null,
            queued: raw.queued.map(toTrack),
            nextUp: raw.nextUp.map(toTrack)
          })
        )
      )

      // Spotify matches by uid when one is given, otherwise by uri. The
      // uri alone would also drop that track from the playing album, so
      // pass the uid of each queued copy.
      const removeFromQueue = (uri: SpotifyUri) =>
        Effect.gen(function* () {
          const { queued } = yield* rawQueue
          const copies = queued.flatMap((item) => item.uri === uri && item.uid ? [{ uri, uid: item.uid }] : [])

          if (copies.length > 0) yield* command("PlayerAPI", "removeFromQueue", copies)

          return copies.length
        })

      const contains = (uri: SpotifyUri) =>
        call("LibraryAPI", "contains", uri).pipe(
          Effect.flatMap(decodeContains),
          Effect.map(([liked]) => liked === true),
          blameUpdate("LibraryAPI.contains")
        )

      const playlists = call("RootlistAPI", "getContents").pipe(
        Effect.flatMap(decodeRootlist),
        Effect.map((root) => toPlaylists(root)),
        blameUpdate("RootlistAPI.getContents")
      )

      // RootlistAPI.contains takes an array, unlike LibraryAPI.contains.
      const inRootlist = (uri: SpotifyUri) =>
        call("RootlistAPI", "contains", [uri]).pipe(
          Effect.flatMap(decodeContains),
          Effect.map(([found]) => found === true),
          blameUpdate("RootlistAPI.contains")
        )

      // Spotify puts new playlists at the top of the sidebar.
      const create = (name: string) =>
        call("RootlistAPI", "createPlaylist", name, { before: "start" }, {}).pipe(
          Effect.flatMap(decodeCreated),
          blameUpdate("RootlistAPI.createPlaylist")
        )

      const isPublished = (uri: SpotifyUri) =>
        call("RootlistAPI", "getPublishedState", uri).pipe(
          Effect.flatMap(decodePublished),
          blameUpdate("RootlistAPI.getPublishedState")
        )

      // Spotify's level is 0 to 1; spotrc's is a whole percentage.
      const volume = Effect.gen(function* () {
        const level = yield* call("PlaybackAPI", "getVolume").pipe(Effect.flatMap(decodeLevel))
        const percent = yield* decodeVolume(Math.round(level * 100))
        const muted = yield* call("PlaybackAPI", "getMuteHelper.isMuted").pipe(Effect.flatMap(decodeMuted))

        return new VolumeStatus({ volume: percent, muted })
      }).pipe(blameUpdate("PlaybackAPI.getVolume"))

      // ConnectDevicesAPI and ConnectTransferAPI exist from startup.
      // ConnectAPI would do the same job, but creating it starts a
      // device search on the local network.
      const devices = call("ConnectDevicesAPI", "getDevices").pipe(
        Effect.flatMap(decodeDevices),
        Effect.map(toDevices),
        blameUpdate("ConnectDevicesAPI.getDevices")
      )

      // The query behind Spotify's quick-search box. It returns a mix of
      // tracks, artists, albums, playlists and more, best match first.
      const search = (text: string, limit: number) =>
        Effect.gen(function* () {
          const body = yield* bridge.graphql("searchModalResults", {
            searchTerm: text,
            limit,
            numberOfTopResults: limit,
            offset: 0,
            includeAuthors: false
          }).pipe(Effect.flatMap(decodeSearch))

          return yield* toSearchResults(body)
        }).pipe(blameUpdate("GraphQL searchModalResults"))

      const inspect = (api: Api) =>
        bridge.inspect(api, uses[api]).pipe(
          Effect.map((missing): Inspection =>
            missing.length === 0 ? { kind: "ok" } : { kind: "missing", detail: `lacks ${missing.join(", ")}` }
          ),
          Effect.catchTags({
            ClientNotRunning: (error) => Effect.succeed<Inspection>({ kind: error.reason === "port" ? "no-port" : "no-page" }),
            BridgeTimeout: () => Effect.succeed<Inspection>({ kind: "unreachable" }),
            InternalApiChanged: (error) =>
              Effect.succeed<Inspection>(
                error.issue.startsWith("NotReady") ? { kind: "unreachable" } : { kind: "missing", detail: error.issue }
              )
          })
        )

      // Each check runs only when the ones before it passed.
      const checks = Effect.gen(function* () {
        const apis = Object.keys(uses).filter((key): key is Api => key in uses)
        const inspections = yield* Effect.forEach(apis, (api) => inspect(api).pipe(Effect.map((result) => ({ api, result }))))
        const kinds = inspections.map(({ result }) => result.kind)
        const portOk = !kinds.includes("no-port")
        const pageOk = portOk && !kinds.includes("no-page")
        const agentOk = pageOk && !kinds.includes("unreachable")

        const step = (name: string, ok: boolean, ready: boolean, detail: string) =>
          new Check({ name, status: !ready ? "skipped" : ok ? "pass" : "fail", detail: ready && !ok ? detail : "" })

        const missingQueries = yield* bridge.inspectQueries(queries).pipe(
          Effect.catch((error) => Effect.succeed([`could not check: ${error.message}`]))
        )

        return [
          step("Spotify answers on the DevTools port", portOk, true, "Run spotrc launch, or start Spotify with --remote-debugging-port."),
          step("Spotify's window is open", pageOk, portOk, "Spotify may still be starting."),
          step("spotrc's agent reaches Spotify's internals", agentOk, pageOk, "Spotify didn't answer, or its internals have moved."),
          ...inspections.map(({ api, result }) =>
            step(`${api} has the ${uses[api].length === 1 ? "method" : `${uses[api].length} methods`} spotrc uses`, result.kind === "ok", agentOk, "detail" in result ? result.detail : "")
          ),
          step("Spotify's search query is defined", missingQueries.length === 0, agentOk, `missing ${missingQueries.join(", ")}`)
        ]
      })

      return {
        player: {
          state,
          queue,
          play: (uri) => command("PlayerAPI", "play", { uri }, {}, {}),
          pause: command("PlayerAPI", "pause"),
          resume: command("PlayerAPI", "resume"),
          skipToNext: command("PlayerAPI", "skipToNext"),
          skipToPrevious: command("PlayerAPI", "skipToPrevious"),
          seekTo: (ms) => command("PlayerAPI", "seekTo", ms),
          setShuffle: (on) => command("PlayerAPI", "setShuffle", on),
          setRepeat: (mode) => command("PlayerAPI", "setRepeat", repeatModes.indexOf(mode)),
          addToQueue: (uri) => command("PlayerAPI", "addToQueue", [{ uri }]),
          removeFromQueue,
          clearQueue: command("PlayerAPI", "clearQueue")
        },
        library: {
          contains,
          add: (uri) => command("LibraryAPI", "add", { uris: [uri] }),
          remove: (uri) => command("LibraryAPI", "remove", { uris: [uri] })
        },
        rootlist: {
          playlists,
          contains: inRootlist,
          create,
          remove: (uri) => command("RootlistAPI", "remove", [{ uri }]),
          isPublished,
          unpublish: (uri) => command("RootlistAPI", "setPublishedState", uri, false)
        },
        playlist: {
          append: (playlist, track) => command("PlaylistAPI", "add", playlist, [track], { after: "end" }, {})
        },
        playback: {
          volume,
          setVolume: (percent) => command("PlaybackAPI", "setVolume", percent / 100),
          mute: command("PlaybackAPI", "getMuteHelper.mute"),
          unmute: command("PlaybackAPI", "getMuteHelper.unmute")
        },
        devices: {
          list: devices,
          transfer: (id) => command("ConnectTransferAPI", "transferPlayback", id, { interactionId: "" })
        },
        search,
        checks
      }
    })
  )
}
