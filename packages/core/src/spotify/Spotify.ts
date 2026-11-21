import { Clock, Context, Effect, Layer, Schedule, type Schema, Stream } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { Check } from "../domain/Check.ts"
import { playable, relevant, type SearchResult } from "../domain/SearchResult.ts"
import type { Device } from "../domain/Device.ts"
import { NeedsConfirmation, NotFound, type SpotifyError, SpotifyRefused } from "../domain/errors.ts"
import type { PlayerStatus, Repeat } from "../domain/PlayerStatus.ts"
import {
  CreatedPlaylist,
  DeletedPlaylist,
  LikeResult,
  type Playlist,
  PlaylistAddResult
} from "../domain/Playlist.ts"
import { Queue } from "../domain/Queue.ts"
import type { SeekTarget } from "../domain/Seek.ts"
import { likedSongs, type SpotifyUri } from "../domain/Track.ts"
import { type VolumeChange, VolumeStatus } from "../domain/Volume.ts"
import {
  blameUpdate,
  decodeContains,
  decodeCreated,
  decodePublished,
  decodeDevices,
  decodeLevel,
  decodeMuted,
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

// Every internal method spotr calls. `call` accepts only these, and
// doctor checks that each one exists, so the two can't drift apart.
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

// Spotify's GraphQL queries spotr runs. doctor checks each is defined.
const queries = ["searchModalResults"] as const

// How one API looked to doctor.
type Inspection =
  | { readonly kind: "ok" | "no-port" | "no-page" | "unreachable" }
  | { readonly kind: "missing"; readonly detail: string }

const sameMoment = (a: PlayerStatus, b: PlayerStatus) => a.track?.uri === b.track?.uri && a.paused === b.paused

export class Spotify extends Context.Service<Spotify, {
  readonly status: Effect.Effect<PlayerStatus, SpotifyError>
  readonly play: (uri: SpotifyUri) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly pause: Effect.Effect<PlayerStatus, SpotifyError>
  readonly resume: Effect.Effect<PlayerStatus, SpotifyError>
  readonly next: Effect.Effect<PlayerStatus, SpotifyError>
  readonly previous: Effect.Effect<PlayerStatus, SpotifyError>
  readonly seek: (target: SeekTarget) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly setShuffle: (on: boolean) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly setRepeat: (mode: Repeat) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly queue: Effect.Effect<Queue, SpotifyError>
  readonly addToQueue: (uri: SpotifyUri) => Effect.Effect<Queue, SpotifyError>
  readonly removeFromQueue: (uri: SpotifyUri) => Effect.Effect<Queue, SpotifyError>
  readonly clearQueue: Effect.Effect<Queue, SpotifyError>
  readonly like: (uri: SpotifyUri | undefined) => Effect.Effect<LikeResult, SpotifyError>
  readonly unlike: (uri: SpotifyUri | undefined) => Effect.Effect<LikeResult, SpotifyError>
  readonly playlists: Effect.Effect<ReadonlyArray<Playlist>, SpotifyError>
  readonly addToPlaylist: (
    playlist: string,
    uri: SpotifyUri | undefined
  ) => Effect.Effect<PlaylistAddResult, SpotifyError>
  readonly createPlaylist: (name: string, isPrivate: boolean) => Effect.Effect<CreatedPlaylist, SpotifyError>
  readonly deletePlaylist: (playlist: string, confirmed: boolean) => Effect.Effect<DeletedPlaylist, SpotifyError>
  readonly devices: Effect.Effect<ReadonlyArray<Device>, SpotifyError>
  readonly useDevice: (device: string) => Effect.Effect<ReadonlyArray<Device>, SpotifyError>
  readonly toggle: Effect.Effect<PlayerStatus, SpotifyError>
  readonly volume: Effect.Effect<VolumeStatus, SpotifyError>
  readonly setVolume: (change: VolumeChange) => Effect.Effect<VolumeStatus, SpotifyError>
  readonly mute: Effect.Effect<VolumeStatus, SpotifyError>
  readonly unmute: Effect.Effect<VolumeStatus, SpotifyError>
  // Emits the status now, then again whenever the track or play state
  // changes. It checks once a second.
  readonly search: (text: string, limit: number) => Effect.Effect<ReadonlyArray<SearchResult>, SpotifyError>
  // Plays the first playable search hit for `text`.
  readonly playSearch: (text: string) => Effect.Effect<PlayerStatus, SpotifyError>
  readonly watch: Stream.Stream<PlayerStatus, SpotifyError>
  readonly doctor: Effect.Effect<ReadonlyArray<Check>>
}>()("spotr/Spotify") {
  static readonly layer = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      const bridge = yield* Bridge

      const call = <A extends Api>(api: A, method: (typeof uses)[A][number], ...args: ReadonlyArray<Schema.Json>) =>
        bridge.call(api, method, ...args)

      const status = Effect.gen(function* () {
        const raw = yield* call("PlayerAPI", "getState").pipe(Effect.flatMap(decodeState))

        return toStatus(raw, yield* Clock.currentTimeMillis)
      }).pipe(blameUpdate("PlayerAPI.getState"))

      // Spotify reports the old state for a moment after a command, so
      // poll until it shows the change. Give up after about two seconds
      // and return what it says then, e.g. repeat-one keeps the track.
      const pollUntil = <A>(read: Effect.Effect<A, SpotifyError>, done: (value: A) => boolean) =>
        read.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced("100 millis"), times: 20 }))

      const settle = (done: (status: PlayerStatus) => boolean) => pollUntil(status, done)

      const command = (method: (typeof uses)["PlayerAPI"][number], ...args: ReadonlyArray<Schema.Json>) =>
        call("PlayerAPI", method, ...args)

      // Done once Spotify plays from `uri` and something visibly changed,
      // so replaying the album that's already on doesn't count as done
      // before Spotify has reacted.
      const play = (uri: SpotifyUri) =>
        Effect.gen(function* () {
          const before = yield* status

          yield* command("play", { uri }, {}, {})

          return yield* settle((now) => {
            // Spotify plays Liked Songs from a playlist with its own URI.
            const fromUri = now.track?.uri === uri || now.context === uri || uri === likedSongs

            const playingIt = !now.paused && fromUri

            const changed = before.paused || now.track?.uri !== before.track?.uri ||
              now.context !== before.context || now.positionMs < before.positionMs

            return playingIt && changed
          })
        })

      const pause = command("pause").pipe(Effect.andThen(settle((now) => now.paused)))

      const resume = command("resume").pipe(Effect.andThen(settle((now) => !now.paused)))

      const next = Effect.gen(function* () {
        const before = yield* status

        yield* command("skipToNext")

        return yield* settle((now) => now.track?.uri !== before.track?.uri)
      })

      // Spotify restarts the current track instead when it is more than
      // a few seconds in, so a jump back in position also counts.
      const previous = Effect.gen(function* () {
        const before = yield* status

        yield* command("skipToPrevious")

        return yield* settle((now) =>
          now.track?.uri !== before.track?.uri || now.positionMs < before.positionMs - 1000
        )
      })

      const seek = (target: SeekTarget) =>
        Effect.gen(function* () {
          const before = yield* status
          const wanted = target.relative ? before.positionMs + target.ms : target.ms
          const ms = Math.max(0, Math.min(wanted, before.track?.durationMs ?? 0))

          yield* command("seekTo", ms)

          return yield* settle((now) => Math.abs(now.positionMs - ms) < 1500)
        })

      const setShuffle = (on: boolean) =>
        command("setShuffle", on).pipe(Effect.andThen(settle((now) => now.shuffle === on)))

      const setRepeat = (mode: Repeat) =>
        command("setRepeat", repeatModes.indexOf(mode)).pipe(
          Effect.andThen(settle((now) => now.repeat === mode))
        )

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

      const addToQueue = (uri: SpotifyUri) =>
        Effect.gen(function* () {
          const before = yield* queue

          yield* command("addToQueue", [{ uri }])

          return yield* pollUntil(queue, (now) => now.queued.length > before.queued.length)
        })

      // Spotify matches by uid when one is given, otherwise by uri. The
      // uri alone would also drop that track from the playing album, so
      // pass the uid of each queued copy.
      const removeFromQueue = (uri: SpotifyUri) =>
        Effect.gen(function* () {
          const { queued } = yield* rawQueue
          const copies = queued.flatMap((item) => item.uri === uri && item.uid ? [{ uri, uid: item.uid }] : [])

          if (copies.length === 0) {
            return yield* new NotFound({ what: `${uri} in your queue`, hint: "Run spotr queue to see what's queued." })
          }

          yield* command("removeFromQueue", copies)

          return yield* pollUntil(queue, (now) => now.queued.every((track) => track.uri !== uri))
        })

      const clearQueue = command("clearQueue").pipe(
        Effect.andThen(pollUntil(queue, (now) => now.queued.length === 0))
      )

      // The given track, or the playing one when none is given.
      const target = (uri: SpotifyUri | undefined) =>
        Effect.gen(function* () {
          if (uri) return { uri, name: null }
          const { track } = yield* status

          if (!track) {
            return yield* new NotFound({ what: "A playing track", hint: "Play something, or pass a track URI." })
          }

          return { uri: track.uri, name: track.name }
        })

      const isLiked = (uri: SpotifyUri) =>
        call("LibraryAPI", "contains", uri).pipe(
          Effect.flatMap(decodeContains),
          Effect.map(([liked]) => liked === true),
          blameUpdate("LibraryAPI.contains")
        )

      const setLiked = (liked: boolean) => (uri: SpotifyUri | undefined) =>
        Effect.gen(function* () {
          const track = yield* target(uri)

          yield* call("LibraryAPI", liked ? "add" : "remove", { uris: [track.uri] })

          const now = yield* pollUntil(isLiked(track.uri), (value) => value === liked)

          return new LikeResult({ ...track, liked: now })
        })

      const playlists = call("RootlistAPI", "getContents").pipe(
        Effect.flatMap(decodeRootlist),
        Effect.map((root) => toPlaylists(root)),
        blameUpdate("RootlistAPI.getContents")
      )

      // `playlist` is a URI, or a name matched without regard to case
      // among the playlists the user can add to.
      const findPlaylist = (playlist: string) =>
        Effect.gen(function* () {
          const all = yield* playlists
          const wanted = playlist.toLowerCase()

          const matches = all.filter((candidate) =>
            candidate.uri === playlist || (candidate.canAdd && candidate.name.toLowerCase() === wanted)
          )

          if (matches.length === 1 && matches[0]) return matches[0]

          return yield* new NotFound({
            what: matches.length > 1 ? `A single playlist named "${playlist}"` : `Playlist "${playlist}"`,
            hint: matches.length > 1
              ? "Several playlists share that name. Pass its URI from spotr playlist ls."
              : "Run spotr playlist ls to see your playlists."
          })
        })

      const addToPlaylist = (playlist: string, uri: SpotifyUri | undefined) =>
        Effect.gen(function* () {
          const found = yield* findPlaylist(playlist)
          const track = yield* target(uri)

          if (!found.canAdd) {
            return yield* new NotFound({
              what: `A playlist you can add to named "${found.name}"`,
              hint: "You can only add to your own and collaborative playlists."
            })
          }

          yield* call("PlaylistAPI", "add", found.uri, [track.uri], { after: "end" }, {})

          return new PlaylistAddResult({ playlist: found, ...track })
        })

      const isPublished = (uri: SpotifyUri) =>
        call("RootlistAPI", "getPublishedState", uri).pipe(
          Effect.flatMap(decodePublished),
          blameUpdate("RootlistAPI.getPublishedState")
        )

      // RootlistAPI.contains takes an array, unlike LibraryAPI.contains.
      const inSidebar = (uri: SpotifyUri) =>
        call("RootlistAPI", "contains", [uri]).pipe(
          Effect.flatMap(decodeContains),
          Effect.map(([found]) => found === true),
          blameUpdate("RootlistAPI.contains")
        )

      // Spotify puts new playlists at the top of the sidebar. "Private"
      // means not published on the user's profile.
      const createPlaylist = (name: string, isPrivate: boolean) =>
        Effect.gen(function* () {
          const uri = yield* call("RootlistAPI", "createPlaylist", name, { before: "start" }, {}).pipe(
            Effect.flatMap(decodeCreated),
            blameUpdate("RootlistAPI.createPlaylist")
          )

          if (!uri) return yield* new SpotifyRefused({ action: `create the playlist "${name}"` })

          if (isPrivate) yield* call("RootlistAPI", "setPublishedState", uri, false)

          const published = yield* pollUntil(isPublished(uri), (value) => !isPrivate || !value)

          if (isPrivate && published) return yield* new SpotifyRefused({ action: `make "${name}" private` })

          return new CreatedPlaylist({ uri, name, public: published })
        })

      // `playlist` is a URI, or a name matched without regard to case.
      // Spotify's remove reports no errors, so check the playlist left
      // the sidebar.
      const deletePlaylist = (playlist: string, confirmed: boolean) =>
        Effect.gen(function* () {
          const all = yield* playlists
          const matches = all.filter((candidate) => candidate.uri === playlist || candidate.name.toLowerCase() === playlist.toLowerCase())
          const [found] = matches

          if (!found || matches.length > 1) {
            return yield* new NotFound({
              what: matches.length > 1 ? `A single playlist named "${playlist}"` : `Playlist "${playlist}"`,
              hint: matches.length > 1
                ? "Several playlists share that name. Pass its URI from spotr playlist ls."
                : "Run spotr playlist ls to see your playlists."
            })
          }

          if (!confirmed) return yield* new NeedsConfirmation({ action: `delete "${found.name}"` })

          yield* call("RootlistAPI", "remove", [{ uri: found.uri }])

          if (yield* pollUntil(inSidebar(found.uri), (present) => !present)) {
            return yield* new SpotifyRefused({ action: `delete "${found.name}"` })
          }

          return new DeletedPlaylist({ uri: found.uri, name: found.name })
        })

      // ConnectDevicesAPI and ConnectTransferAPI exist from startup.
      // ConnectAPI would do the same job, but creating it starts a
      // device search on the local network.
      const devices = call("ConnectDevicesAPI", "getDevices").pipe(
        Effect.flatMap(decodeDevices),
        Effect.map(toDevices),
        blameUpdate("ConnectDevicesAPI.getDevices")
      )

      // `device` is an id, or a name matched without regard to case.
      // Using the device that's already active does nothing.
      const useDevice = (device: string) =>
        Effect.gen(function* () {
          const all = yield* devices
          const matches = all.filter((candidate) => candidate.id === device || candidate.name.toLowerCase() === device.toLowerCase())
          const [found] = matches

          if (!found || matches.length > 1) {
            return yield* new NotFound({
              what: matches.length > 1 ? `A single device named "${device}"` : `Device "${device}"`,
              hint: "Run spotr devices to see the devices Spotify can play on."
            })
          }

          if (found.active) return all

          yield* call("ConnectTransferAPI", "transferPlayback", found.id, { interactionId: "" })

          return yield* pollUntil(devices, (now) => now.some((candidate) => candidate.id === found.id && candidate.active))
        })

      const toggle = Effect.flatMap(status, (now) => now.paused ? resume : pause)

      const volume = Effect.gen(function* () {
        const level = yield* call("PlaybackAPI", "getVolume").pipe(Effect.flatMap(decodeLevel))
        const volume = yield* decodeVolume(Math.round(level * 100))
        const muted = yield* call("PlaybackAPI", "getMuteHelper.isMuted").pipe(Effect.flatMap(decodeMuted))

        return new VolumeStatus({ volume, muted })
      }).pipe(blameUpdate("PlaybackAPI.getVolume"))

      // A change is applied to the current level and kept within 0 to 100.
      // Spotify's mute helper follows the volume: 0 mutes, anything else
      // unmutes.
      const setVolume = (change: VolumeChange) =>
        Effect.gen(function* () {
          const before = yield* volume
          const wanted = change.relative ? before.volume + change.amount : change.amount
          const level = Math.max(0, Math.min(100, wanted))

          yield* call("PlaybackAPI", "setVolume", level / 100)

          return yield* pollUntil(volume, (now) => now.volume === level)
        })

      // Spotify's mute helper flips its flag first and moves the volume
      // after, so wait for both: unmuting too early restores the wrong level.
      const mute = call("PlaybackAPI", "getMuteHelper.mute").pipe(
        Effect.andThen(pollUntil(volume, (now) => now.muted && now.volume === 0))
      )

      const unmute = call("PlaybackAPI", "getMuteHelper.unmute").pipe(
        Effect.andThen(pollUntil(volume, (now) => !now.muted && now.volume > 0))
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

      const playSearch = (text: string) =>
        Effect.gen(function* () {
          const [best] = (yield* search(text, 10)).filter((hit) => playable(hit) && relevant(text)(hit))

          if (!best) return yield* new NotFound({ what: `Anything playable for "${text}"`, hint: "Try other words, or spotr search to see what matches." })

          return yield* play(best.uri)
        })

      const watch = Stream.fromEffectSchedule(status, Schedule.spaced("1 second")).pipe(Stream.changesWith(sameMoment))

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
      const doctor = Effect.gen(function* () {
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
          step("Spotify answers on the DevTools port", portOk, true, "Run spotr launch, or start Spotify with --remote-debugging-port."),
          step("Spotify's window is open", pageOk, portOk, "Spotify may still be starting."),
          step("spotr's agent reaches Spotify's internals", agentOk, pageOk, "Spotify didn't answer, or its internals have moved."),
          ...inspections.map(({ api, result }) =>
            step(`${api} has the ${uses[api].length === 1 ? "method" : `${uses[api].length} methods`} spotr uses`, result.kind === "ok", agentOk, "detail" in result ? result.detail : "")
          ),
          step("Spotify's search query is defined", missingQueries.length === 0, agentOk, `missing ${missingQueries.join(", ")}`)
        ]
      })

      return {
        status,
        play,
        pause,
        resume,
        next,
        previous,
        seek,
        setShuffle,
        setRepeat,
        queue,
        addToQueue,
        removeFromQueue,
        clearQueue,
        like: setLiked(true),
        unlike: setLiked(false),
        playlists,
        addToPlaylist,
        createPlaylist,
        deletePlaylist,
        devices,
        useDevice,
        toggle,
        volume,
        setVolume,
        mute,
        unmute,
        search,
        playSearch,
        watch,
        doctor
      }
    })
  )
}
