import { Clock, Context, Effect, Layer, Schedule, type Schema, Stream } from "effect"
import { Bridge } from "../bridge/Bridge.ts"
import { Check } from "../domain/Check.ts"
import type { Device } from "../domain/Device.ts"
import { NotFound, type SpotifyError } from "../domain/errors.ts"
import type { PlayerStatus, Repeat } from "../domain/PlayerStatus.ts"
import { LikeResult, type Playlist, PlaylistAddResult } from "../domain/Playlist.ts"
import { Queue } from "../domain/Queue.ts"
import type { SeekTarget } from "../domain/Seek.ts"
import type { SpotifyUri } from "../domain/Track.ts"
import type { Volume } from "../domain/Volume.ts"
import {
  blameUpdate,
  decodeContains,
  decodeDevices,
  decodeLevel,
  decodeQueue,
  decodeRootlist,
  decodeState,
  decodeVolume,
  repeatModes,
  toDevices,
  toPlaylists,
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
  PlaybackAPI: ["getVolume", "setVolume"],
  LibraryAPI: ["add", "remove", "contains"],
  RootlistAPI: ["getContents"],
  PlaylistAPI: ["add"],
  ConnectDevicesAPI: ["getDevices"],
  ConnectTransferAPI: ["transferPlayback"]
} as const

type Api = keyof typeof uses

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
  readonly devices: Effect.Effect<ReadonlyArray<Device>, SpotifyError>
  readonly useDevice: (device: string) => Effect.Effect<ReadonlyArray<Device>, SpotifyError>
  readonly volume: Effect.Effect<Volume, SpotifyError>
  readonly setVolume: (level: Volume) => Effect.Effect<void, SpotifyError>
  // Emits the status now, then again whenever the track or play state
  // changes. It checks once a second.
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
            const playingIt = !now.paused && (now.track?.uri === uri || now.context === uri)

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

      const volume = call("PlaybackAPI", "getVolume").pipe(
        Effect.flatMap(decodeLevel),
        Effect.flatMap((level) => decodeVolume(Math.round(level * 100))),
        blameUpdate("PlaybackAPI.getVolume")
      )

      const setVolume = (level: Volume) =>
        call("PlaybackAPI", "setVolume", level / 100).pipe(Effect.asVoid)

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

        return [
          step("Spotify answers on the DevTools port", portOk, true, "Run spotr launch, or start Spotify with --remote-debugging-port."),
          step("Spotify's window is open", pageOk, portOk, "Spotify may still be starting."),
          step("spotr's agent reaches Spotify's internals", agentOk, pageOk, "Spotify didn't answer, or its internals have moved."),
          ...inspections.map(({ api, result }) =>
            step(`${api} has the ${uses[api].length === 1 ? "method" : `${uses[api].length} methods`} spotr uses`, result.kind === "ok", agentOk, "detail" in result ? result.detail : "")
          )
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
        devices,
        useDevice,
        volume,
        setVolume,
        watch,
        doctor
      }
    })
  )
}
