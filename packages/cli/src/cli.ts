import { ChecksFailed, Client, describe, DevToolsPort, live, parseSeek, parseVolumeChange, SpotifyUri, toSpotifyUri } from "@spotrc/core"
import { Effect, Layer, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import {
  searchText,
  createdText,
  deletedText,
  devicesText,
  doctorText,
  launchText,
  presentEach,
  watchText,
  likeText,
  playlistAddText,
  playlistsText,
  present,
  queueText,
  repeatText,
  shuffleText,
  statusText,
  volumeText
} from "./render.ts"
import { Json, Port } from "./settings.ts"

const uriArgument = (description: string) =>
  Argument.String("uri").pipe(
    Argument.withDescription(description),
    Argument.map(toSpotifyUri),
    Argument.withSchema(SpotifyUri)
  )

// Optional track arguments become a payload without the uri key, which
// the handlers read as the playing track.
const trackOf = (uri: Option.Option<SpotifyUri>) => Option.match(uri, { onNone: () => ({}), onSome: (track) => ({ uri: track }) })

const status = Command.make("status", {}, () =>
  Client.use((client) => client.status()).pipe(present(statusText))
).pipe(Command.withDescription(describe("status")))

const play = Command.make(
  "play",
  {
    what: Argument.String("what").pipe(
      Argument.withDescription("A spotify: URI, an open.spotify.com link, \"liked\", or words to search for"),
      Argument.variadic()
    )
  },
  ({ what }) => Client.use((client) => client.play({ what: what.join(" ") })).pipe(present(statusText))
).pipe(Command.withDescription(describe("play")))

const search = Command.make(
  "search",
  {
    words: Argument.String("words").pipe(Argument.withDescription("What to search for"), Argument.variadic({ min: 1 })),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("How many results, from 1 to 30"),
      Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
      Flag.withDefault(10)
    )
  },
  ({ words, limit }) => Client.use((client) => client.search({ text: words.join(" "), limit })).pipe(present(searchText))
).pipe(Command.withDescription(describe("search")))

const pause = Command.make("pause", {}, () =>
  Client.use((client) => client.pause()).pipe(present(statusText))
).pipe(Command.withDescription(describe("pause")))

const resume = Command.make("resume", {}, () =>
  Client.use((client) => client.resume()).pipe(present(statusText))
).pipe(Command.withDescription(describe("resume")))

const next = Command.make("next", {}, () =>
  Client.use((client) => client.next()).pipe(present(statusText))
).pipe(Command.withDescription(describe("next")))

const previous = Command.make("previous", {}, () =>
  Client.use((client) => client.previous()).pipe(present(statusText))
).pipe(Command.withDescription(describe("previous")))

const seek = Command.make(
  "seek",
  {
    position: Argument.String("position").pipe(
      Argument.withDescription("1:30 or 90 to jump there, +10 or -10 to move by seconds"),
      Argument.filterMap(parseSeek, (input) => `Expected a time like 1:30, 90, +10 or -10, got "${input}"`)
    )
  },
  ({ position }) => Client.use((client) => client.seek(position)).pipe(present(statusText))
).pipe(Command.withDescription(describe("seek")))

const shuffle = Command.make(
  "shuffle",
  { mode: Argument.Literals("mode", ["on", "off"]).pipe(Argument.optional) },
  ({ mode }) =>
    Client.use((client) =>
      Option.match(mode, { onNone: () => client.status(), onSome: (on) => client.setShuffle({ on: on === "on" }) })
    ).pipe(present(shuffleText))
).pipe(Command.withDescription("Show shuffle, or turn it on or off"))

const repeat = Command.make(
  "repeat",
  { mode: Argument.Literals("mode", ["off", "all", "one"]).pipe(Argument.optional) },
  ({ mode }) =>
    Client.use((client) =>
      Option.match(mode, { onNone: () => client.status(), onSome: (repeat) => client.setRepeat({ mode: repeat }) })
    ).pipe(present(repeatText))
).pipe(Command.withDescription("Show repeat, or set it to off, all or one"))

const queueAdd = Command.make("add", { uri: uriArgument("The track to add") }, ({ uri }) =>
  Client.use((client) => client.addToQueue({ uri })).pipe(present(queueText))
).pipe(Command.withDescription(describe("addToQueue")))

const queueRemove = Command.make("remove", { uri: uriArgument("The queued track to remove") }, ({ uri }) =>
  Client.use((client) => client.removeFromQueue({ uri })).pipe(present(queueText))
).pipe(Command.withDescription(describe("removeFromQueue")))

const queueClear = Command.make("clear", {}, () =>
  Client.use((client) => client.clearQueue()).pipe(present(queueText))
).pipe(Command.withDescription(describe("clearQueue")))

const queue = Command.make("queue", {}, () =>
  Client.use((client) => client.queue()).pipe(present(queueText))
).pipe(
  Command.withSubcommands([queueAdd, queueRemove, queueClear]),
  Command.withDescription("Show what plays next, or change your queue")
)

const like = Command.make(
  "like",
  { uri: uriArgument("The track to like. Defaults to the playing track").pipe(Argument.optional) },
  ({ uri }) => Client.use((client) => client.like(trackOf(uri))).pipe(present(likeText))
).pipe(Command.withDescription("Add a track to Liked Songs"))

const unlike = Command.make(
  "unlike",
  { uri: uriArgument("The track to unlike. Defaults to the playing track").pipe(Argument.optional) },
  ({ uri }) => Client.use((client) => client.unlike(trackOf(uri))).pipe(present(likeText))
).pipe(Command.withDescription("Remove a track from Liked Songs"))

const playlistList = Command.make("ls", {}, () =>
  Client.use((client) => client.playlists()).pipe(present(playlistsText))
).pipe(Command.withDescription(describe("playlists")))

const playlistAdd = Command.make(
  "add",
  {
    playlist: Argument.String("playlist").pipe(Argument.withDescription("The playlist's name or URI")),
    uri: uriArgument("The track to add. Defaults to the playing track").pipe(Argument.optional)
  },
  ({ playlist, uri }) =>
    Client.use((client) => client.addToPlaylist({ playlist, ...trackOf(uri) })).pipe(
      present(playlistAddText)
    )
).pipe(Command.withDescription("Add a track to one of your playlists"))

const playlistCreate = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(
      Argument.withDescription("The new playlist's name"),
      Argument.map((name) => name.trim()),
      Argument.withSchema(Schema.String.check(Schema.isNonEmpty()))
    ),
    isPrivate: Flag.Boolean("private").pipe(
      Flag.withDescription("Keep it off your public profile"),
      Flag.withDefault(false)
    )
  },
  ({ name, isPrivate }) =>
    Client.use((client) => client.createPlaylist({ name, isPrivate })).pipe(present(createdText))
).pipe(Command.withDescription(describe("createPlaylist")))

const playlistDelete = Command.make(
  "delete",
  {
    playlist: Argument.String("playlist").pipe(Argument.withDescription("The playlist's name or URI")),
    yes: Flag.Boolean("yes").pipe(Flag.withDescription("Confirm the deletion"), Flag.withDefault(false))
  },
  ({ playlist, yes }) =>
    Client.use((client) => client.deletePlaylist({ playlist, yes })).pipe(present(deletedText))
).pipe(Command.withDescription("Delete one of your playlists. Needs --yes"))

const playlist = Command.make("playlist").pipe(
  Command.withSubcommands([playlistList, playlistAdd, playlistCreate, playlistDelete]),
  Command.withDescription("List, create, delete or add to your playlists")
)

const devicesUse = Command.make(
  "use",
  { device: Argument.String("device").pipe(Argument.withDescription("The device's name or id")) },
  ({ device }) => Client.use((client) => client.useDevice({ device })).pipe(present(devicesText))
).pipe(Command.withDescription(describe("useDevice")))

const devices = Command.make("devices", {}, () =>
  Client.use((client) => client.devices()).pipe(present(devicesText))
).pipe(
  Command.withSubcommands([devicesUse]),
  Command.withDescription("List Spotify Connect devices, or switch to one")
)

const watch = Command.make("watch", {}, () =>
  Client.use((client) => Effect.succeed(client.watch())).pipe(Effect.flatMap(presentEach(watchText)))
).pipe(Command.withDescription("Print a line whenever the track or play state changes. Ctrl+C stops"))

const launch = Command.make("launch", {}, () =>
  Client.use((client) => client.launch()).pipe(present(launchText))
).pipe(Command.withDescription(describe("launch")))

const doctor = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const checks = yield* Client.use((client) => client.doctor())
    const failed = checks.filter((check) => check.status === "fail").length

    yield* Effect.succeed(checks).pipe(present(doctorText))

    if (failed > 0) return yield* new ChecksFailed({ failed })
  })
).pipe(Command.withDescription(describe("doctor")))

const volume = Command.make(
  "volume",
  {
    change: Argument.String("level").pipe(
      Argument.withDescription("40 sets the level, +10 or -10 changes it"),
      Argument.filterMap(parseVolumeChange, (input) => `Expected 0 to 100, or a change like +10 or -10, got "${input}"`),
      Argument.optional
    )
  },
  ({ change }) =>
    Client.use((client) =>
      Option.match(change, { onNone: () => client.volume(), onSome: (level) => client.setVolume(level) })
    ).pipe(present(volumeText))
).pipe(Command.withDescription("Show the volume, or change it"))

const mute = Command.make("mute", {}, () =>
  Client.use((client) => client.mute()).pipe(present(volumeText))
).pipe(Command.withDescription(describe("mute")))

const unmute = Command.make("unmute", {}, () =>
  Client.use((client) => client.unmute()).pipe(present(volumeText))
).pipe(Command.withDescription(describe("unmute")))

const toggle = Command.make("toggle", {}, () =>
  Client.use((client) => client.toggle()).pipe(present(statusText))
).pipe(Command.withDescription(describe("toggle")))

// The core reads the DevTools port from a service; the CLI fills it in
// from --port (or SPOTRC_PORT).
const devToolsPort = Layer.effect(DevToolsPort, Port)

export const spotrc = Command.make("spotrc").pipe(
  Command.withSubcommands([
    status,
    search,
    play,
    pause,
    resume,
    toggle,
    next,
    previous,
    seek,
    shuffle,
    repeat,
    queue,
    like,
    unlike,
    playlist,
    devices,
    volume,
    mute,
    unmute,
    watch,
    launch,
    doctor
  ]),
  Command.provide(Client.layer.pipe(Layer.provideMerge(live), Layer.provideMerge(devToolsPort))),
  Command.withGlobalFlags([Json, Port]),
  Command.withDescription("Control the Spotify desktop app")
)
