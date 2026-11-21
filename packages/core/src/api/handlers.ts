import { Effect, Schedule, Stream } from "effect"
import { Internals } from "../locator/Internals.ts"
import { ClientNotRunning, NeedsConfirmation, NotFound, type SpotifyError, SpotifyRefused, SpotifyWithoutDebugPort } from "../model/errors.ts"
import { LaunchResult } from "../model/LaunchResult.ts"
import type { PlayerStatus } from "../model/PlayerStatus.ts"
import { CreatedPlaylist, DeletedPlaylist, LikeResult, PlaylistAddResult } from "../model/Playlist.ts"
import { playable, relevant } from "../model/SearchResult.ts"
import { likedSongs, type SpotifyUri, toPlayTarget } from "../model/Track.ts"
import { DevToolsPort } from "../transport/DevToolsPort.ts"
import { Launcher } from "../transport/Launcher.ts"
import { Spotrc } from "./operations.ts"

const sameMoment = (a: PlayerStatus, b: PlayerStatus) => a.track?.uri === b.track?.uri && a.paused === b.paused

// Spotify reports the old state for a moment after a command, so poll
// until it shows the change. Give up after about two seconds and return
// what it says then, e.g. repeat-one keeps the track.
const pollUntil = <A>(read: Effect.Effect<A, SpotifyError>, done: (value: A) => boolean) =>
  read.pipe(Effect.repeat({ until: done, schedule: Schedule.spaced("100 millis"), times: 20 }))

// The domain API: every operation in the table, on Spotify's internals.
export const handlers = Spotrc.toLayer(Effect.gen(function* () {
  const { player, library, rootlist, playlist, playback, devices, search, checks } = yield* Internals
  const launcher = yield* Launcher
  const port = yield* DevToolsPort

  const status = player.state

  const settle = (done: (status: PlayerStatus) => boolean) => pollUntil(status, done)

  // Done once Spotify plays from `uri` and something visibly changed,
  // so replaying the album that's already on doesn't count as done
  // before Spotify has reacted.
  const play = (uri: SpotifyUri) =>
    Effect.gen(function* () {
      const before = yield* status

      yield* player.play(uri)

      return yield* settle((now) => {
        // Spotify plays Liked Songs from a playlist with its own URI.
        const fromUri = now.track?.uri === uri || now.context === uri || uri === likedSongs

        const playingIt = !now.paused && fromUri

        const changed = before.paused || now.track?.uri !== before.track?.uri ||
          now.context !== before.context || now.positionMs < before.positionMs

        return playingIt && changed
      })
    })

  const playSearch = (text: string) =>
    Effect.gen(function* () {
      const [best] = (yield* search(text, 10)).filter((hit) => playable(hit) && relevant(text)(hit))

      if (!best) return yield* new NotFound({ what: `Anything playable for "${text}"`, hint: "Try other words, or search to see what matches." })

      return yield* play(best.uri)
    })

  const pause = player.pause.pipe(Effect.andThen(settle((now) => now.paused)))

  const resume = player.resume.pipe(Effect.andThen(settle((now) => !now.paused)))

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

  const setLiked = (liked: boolean) => (uri: SpotifyUri | undefined) =>
    Effect.gen(function* () {
      const track = yield* target(uri)

      yield* (liked ? library.add : library.remove)(track.uri)

      const now = yield* pollUntil(library.contains(track.uri), (value) => value === liked)

      return new LikeResult({ ...track, liked: now })
    })

  // `name` is a URI, or a name matched without regard to case among all
  // playlists, or only those the user can add to.
  const findPlaylist = (name: string, canAddOnly: boolean) =>
    Effect.gen(function* () {
      const all = yield* rootlist.playlists
      const wanted = name.toLowerCase()

      const matches = all.filter((candidate) =>
        candidate.uri === name || ((!canAddOnly || candidate.canAdd) && candidate.name.toLowerCase() === wanted)
      )

      if (matches.length === 1 && matches[0]) return matches[0]

      return yield* new NotFound({
        what: matches.length > 1 ? `A single playlist named "${name}"` : `Playlist "${name}"`,
        hint: matches.length > 1
          ? "Several playlists share that name. Pass its URI, which the playlist list shows."
          : "List your playlists to see their names."
      })
    })

  const volume = playback.volume

  // Responsive once Spotify answers through its page, not just once the
  // process exists.
  const reachable = status.pipe(
    Effect.as(true),
    Effect.catchTag("ClientNotRunning", () => Effect.succeed(false))
  )

  return Spotrc.of({
    status: () => status,
    play: ({ what }) => {
      const playTarget = toPlayTarget(what)

      switch (playTarget.kind) {
        case "resume":
          return resume
        case "uri":
          return play(playTarget.uri)
        case "search":
          return playSearch(playTarget.text)
      }
    },
    pause: () => pause,
    resume: () => resume,
    toggle: () => Effect.flatMap(status, (now) => now.paused ? resume : pause),
    next: () =>
      Effect.gen(function* () {
        const before = yield* status

        yield* player.skipToNext

        return yield* settle((now) => now.track?.uri !== before.track?.uri)
      }),
    // Spotify restarts the current track instead when it is more than a
    // few seconds in, so a jump back in position also counts.
    previous: () =>
      Effect.gen(function* () {
        const before = yield* status

        yield* player.skipToPrevious

        return yield* settle((now) => now.track?.uri !== before.track?.uri || now.positionMs < before.positionMs - 1000)
      }),
    seek: (seekTarget) =>
      Effect.gen(function* () {
        const before = yield* status
        const wanted = seekTarget.relative ? before.positionMs + seekTarget.ms : seekTarget.ms
        const ms = Math.max(0, Math.min(wanted, before.track?.durationMs ?? 0))

        yield* player.seekTo(ms)

        return yield* settle((now) => Math.abs(now.positionMs - ms) < 1500)
      }),
    setShuffle: ({ on }) => player.setShuffle(on).pipe(Effect.andThen(settle((now) => now.shuffle === on))),
    setRepeat: ({ mode }) => player.setRepeat(mode).pipe(Effect.andThen(settle((now) => now.repeat === mode))),
    queue: () => player.queue,
    addToQueue: ({ uri }) =>
      Effect.gen(function* () {
        const before = yield* player.queue

        yield* player.addToQueue(uri)

        return yield* pollUntil(player.queue, (now) => now.queued.length > before.queued.length)
      }),
    removeFromQueue: ({ uri }) =>
      Effect.gen(function* () {
        if ((yield* player.removeFromQueue(uri)) === 0) {
          return yield* new NotFound({ what: `${uri} in your queue`, hint: "Show the queue to see what's queued." })
        }

        return yield* pollUntil(player.queue, (now) => now.queued.every((track) => track.uri !== uri))
      }),
    clearQueue: () => player.clearQueue.pipe(Effect.andThen(pollUntil(player.queue, (now) => now.queued.length === 0))),
    like: ({ uri }) => setLiked(true)(uri),
    unlike: ({ uri }) => setLiked(false)(uri),
    playlists: () => rootlist.playlists,
    addToPlaylist: ({ playlist: name, uri }) =>
      Effect.gen(function* () {
        const found = yield* findPlaylist(name, true)
        const track = yield* target(uri)

        if (!found.canAdd) {
          return yield* new NotFound({
            what: `A playlist you can add to named "${found.name}"`,
            hint: "You can only add to your own and collaborative playlists."
          })
        }

        yield* playlist.append(found.uri, track.uri)

        return new PlaylistAddResult({ playlist: found, ...track })
      }),
    // "Private" means not published on the user's profile.
    createPlaylist: ({ name, isPrivate }) =>
      Effect.gen(function* () {
        const uri = yield* rootlist.create(name)

        if (!uri) return yield* new SpotifyRefused({ action: `create the playlist "${name}"` })

        if (isPrivate) yield* rootlist.unpublish(uri)

        const published = yield* pollUntil(rootlist.isPublished(uri), (value) => !isPrivate || !value)

        if (isPrivate && published) return yield* new SpotifyRefused({ action: `make "${name}" private` })

        return new CreatedPlaylist({ uri, name, public: published })
      }),
    // Spotify's remove reports no errors, so check the playlist left the
    // sidebar.
    deletePlaylist: ({ playlist: name, yes }) =>
      Effect.gen(function* () {
        const found = yield* findPlaylist(name, false)

        if (!yes) return yield* new NeedsConfirmation({ action: `delete "${found.name}"` })

        yield* rootlist.remove(found.uri)

        if (yield* pollUntil(rootlist.contains(found.uri), (present) => !present)) {
          return yield* new SpotifyRefused({ action: `delete "${found.name}"` })
        }

        return new DeletedPlaylist({ uri: found.uri, name: found.name })
      }),
    devices: () => devices.list,
    // `device` is an id, or a name matched without regard to case. Using
    // the device that's already active does nothing.
    useDevice: ({ device }) =>
      Effect.gen(function* () {
        const all = yield* devices.list
        const matches = all.filter((candidate) => candidate.id === device || candidate.name.toLowerCase() === device.toLowerCase())
        const [found] = matches

        if (!found || matches.length > 1) {
          return yield* new NotFound({
            what: matches.length > 1 ? `A single device named "${device}"` : `Device "${device}"`,
            hint: "List the devices to see the ones Spotify can play on."
          })
        }

        if (found.active) return all

        yield* devices.transfer(found.id)

        return yield* pollUntil(devices.list, (now) => now.some((candidate) => candidate.id === found.id && candidate.active))
      }),
    volume: () => volume,
    // A change is applied to the current level and kept within 0 to 100.
    setVolume: (change) =>
      Effect.gen(function* () {
        const before = yield* volume
        const wanted = change.relative ? before.volume + change.amount : change.amount
        const level = Math.max(0, Math.min(100, wanted))

        yield* playback.setVolume(level)

        return yield* pollUntil(volume, (now) => now.volume === level)
      }),
    // Spotify's mute helper flips its flag first and moves the volume
    // after, so wait for both: unmuting too early restores the wrong level.
    mute: () => playback.mute.pipe(Effect.andThen(pollUntil(volume, (now) => now.muted && now.volume === 0))),
    unmute: () => playback.unmute.pipe(Effect.andThen(pollUntil(volume, (now) => !now.muted && now.volume > 0))),
    search: ({ text, limit }) => search(text, limit),
    watch: () => Stream.fromEffectSchedule(status, Schedule.spaced("1 second")).pipe(Stream.changesWith(sameMoment)),
    doctor: () => checks,
    launch: () =>
      Effect.gen(function* () {
        if (yield* reachable) return new LaunchResult({ started: false, port })

        if (yield* launcher.running) return yield* new SpotifyWithoutDebugPort({ port })

        yield* launcher.open

        const ready = yield* reachable.pipe(
          Effect.repeat({ until: (up) => up, schedule: Schedule.spaced("500 millis"), times: 40 })
        )

        if (!ready) return yield* new ClientNotRunning({ port, reason: "port" })

        return new LaunchResult({ started: true, port })
      })
  })
}))
