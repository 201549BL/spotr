import { Clock, Effect, Layer, Ref, Schema } from "effect"
import { Bridge } from "./Bridge.ts"

type RawTrack = {
  readonly uri: string
  readonly name: string
  readonly artists: ReadonlyArray<{ readonly name: string }>
  readonly duration: { readonly milliseconds: number }
}

export const sampleContext = "spotify:album:0000000000000000000000"

export const sampleQueue: ReadonlyArray<RawTrack> = [
  {
    uri: "spotify:track:1111111111111111111111",
    name: "First Song",
    artists: [{ name: "Some Artist" }],
    duration: { milliseconds: 200_000 }
  },
  {
    uri: "spotify:track:2222222222222222222222",
    name: "Second Song",
    artists: [{ name: "Other Artist" }, { name: "Guest" }],
    duration: { milliseconds: 180_000 }
  }
]

// A track outside the sample album, for queueing.
export const sampleExtra: RawTrack = {
  uri: "spotify:track:3333333333333333333333",
  name: "Extra Song",
  artists: [{ name: "Someone Else" }],
  duration: { milliseconds: 150_000 }
}

type SamplePlaylist = {
  readonly type: "playlist"
  readonly uri: string
  readonly name: string
  readonly canAdd: boolean
  readonly totalLength: number
}

type SampleFolder = {
  readonly type: "folder"
  readonly uri: string
  readonly name: string
  readonly items: ReadonlyArray<SampleFolder | SamplePlaylist | { readonly type: "placeholder"; readonly uri: string }>
}

const samplePlaylist = (
  id: number,
  name: string,
  canAdd: boolean,
  totalLength: number,
  uri = `spotify:playlist:${String(id).repeat(22)}`
): SamplePlaylist => ({
  type: "playlist",
  uri,
  name,
  canAdd,
  totalLength
})

const stuckPlaylist = "spotify:playlist:3333333333333333333333"

// The playlist sidebar: a folder, a playlist the user can't add to, two
// playlists that share a name, and a playlist Spotify couldn't load.
export const sampleRootlist: SampleFolder = {
  type: "folder",
  uri: "",
  name: "",
  items: [
    samplePlaylist(1, "Road Trip", true, 2),
    {
      type: "folder",
      uri: "spotify:user:someone:folder:0",
      name: "Work",
      items: [samplePlaylist(2, "Focus", true, 5), samplePlaylist(3, "Someone's Mix", false, 30)]
    },
    samplePlaylist(4, "Twins", true, 1),
    samplePlaylist(5, "Twins", true, 1),
    { type: "placeholder", uri: "spotify:playlist:9999999999999999999999" }
  ]
}

// This computer and two speakers, two of which share a name.
export const sampleDevices = [
  { id: "local_device", name: "This Mac", type: "computer", isLocal: true },
  { id: "speaker-1", name: "Kitchen", type: "speaker", isLocal: false },
  { id: "speaker-2", name: "Twin Speaker", type: "speaker", isLocal: false },
  { id: "speaker-3", name: "Twin Speaker", type: "speaker", isLocal: false }
]

const profiles = (...names: ReadonlyArray<string>) => ({ items: names.map((name) => ({ profile: { name } })) })

// What the fake's search can find, in Spotify's searchModalResults shape,
// including a hit of a type spotr doesn't know.
const searchable = [
  { __typename: "Track", uri: sampleQueue[0]?.uri, name: "First Song", artists: profiles("Some Artist"), albumOfTrack: {} },
  { __typename: "Album", uri: sampleContext, name: "Sample Album", artists: profiles("Some Artist"), type: "ALBUM" },
  { __typename: "Artist", uri: "spotify:artist:4444444444444444444444", profile: { name: "Some Artist" } },
  {
    __typename: "Playlist",
    uri: "spotify:playlist:1111111111111111111111",
    name: "Road Trip Songs",
    description: "",
    ownerV2: { data: { __typename: "User", name: "Someone" } }
  },
  { __typename: "Genre", uri: "spotify:genre:5555555555555555555555", name: "Song Genre" },
  { __typename: "SomethingNew", uri: "spotify:new:6666666666666666666666", name: "Song From The Future" }
]

// Like Spotify, the fake always returns something, even for gibberish.
const filler = {
  __typename: "Playlist",
  uri: "spotify:playlist:7777777777777777777777",
  name: "Popular Right Now",
  description: "",
  ownerV2: { data: { __typename: "User", name: "Spotify" } }
}

const searchBody = (term: string, limit: number) => ({
  data: {
    searchV2: {
      topResultsV2: {
        itemsV2: [...searchable.filter((hit) => JSON.stringify(hit).toLowerCase().includes(term.toLowerCase())), filler]
          .slice(0, limit)
          .map((data) => ({ item: { __typename: `${data.__typename}ResponseWrapper`, data } }))
      }
    }
  },
  extensions: {}
})

type QueueEntry = { readonly uri: string; readonly uid: string }

type PlayerState = {
  readonly index: number
  readonly paused: boolean
  readonly positionMs: number
  readonly shuffle: boolean
  readonly repeat: number
  readonly queued: ReadonlyArray<QueueEntry>
  readonly removedFromContext: ReadonlyArray<string>
  readonly uids: number
  readonly liked: ReadonlyArray<string>
  readonly playlistAdds: ReadonlyArray<string>
  readonly created: ReadonlyArray<SamplePlaylist>
  readonly removed: ReadonlyArray<string>
  readonly unpublished: ReadonlyArray<string>
  readonly activeDevice: string
  readonly transfers: number
}

const ItemRef = Schema.Struct({ uri: Schema.String, uid: Schema.optional(Schema.String) })

const decodeArgs = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(schema)

// A Spotify stand-in for tests. It plays `queue` in the `sampleContext`
// album; an empty queue means nothing is loaded. After each command, the
// next `staleReads` calls to getState still report the old state, the
// way real Spotify lags behind.
export const FakeBridge = (queue: ReadonlyArray<RawTrack>, staleReads: number) => Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const initial: PlayerState = {
      index: 0,
      paused: false,
      positionMs: 0,
      shuffle: false,
      repeat: 0,
      queued: [],
      removedFromContext: [],
      uids: 0,
      liked: [],
      playlistAdds: [],
      created: [],
      removed: [],
      unpublished: [],
      activeDevice: "local_device",
      transfers: 0
    }

    const state = yield* Ref.make(initial)
    const shown = yield* Ref.make(initial)
    const staleLeft = yield* Ref.make(0)
    // Like Spotify's mute helper: any volume change records the last
    // non-zero level, and 0 counts as muted.
    const sound = yield* Ref.make({ level: 1, muted: false, behindMute: 1 })
    const muteLag = yield* Ref.make(false)

    const changeLevel = (level: number) =>
      Ref.update(sound, (current) => ({
        level,
        muted: level === 0,
        behindMute: level === 0 ? current.behindMute : level
      }))

    const getState = Effect.gen(function* () {
      const stale = yield* Ref.getAndUpdate(staleLeft, (left) => Math.max(0, left - 1))

      if (stale === 0) yield* Ref.set(shown, yield* Ref.get(state))
      const current = yield* Ref.get(shown)
      const item = queue[current.index % queue.length]

      return {
        item: item ? { ...item, metadata: { "collection.in_collection": String(current.liked.includes(item.uri)) } } : null,
        context: item ? { uri: sampleContext } : null,
        isPaused: current.paused,
        shuffle: current.shuffle,
        repeat: current.repeat,
        positionAsOfTimestamp: current.positionMs,
        timestamp: yield* Clock.currentTimeMillis
      }
    })

    const command = (change: (current: PlayerState) => PlayerState) =>
      Ref.update(state, change).pipe(Effect.andThen(Ref.set(staleLeft, staleReads)))

    const play = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Struct({ uri: Schema.String }), Schema.Unknown, Schema.Unknown]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([{ uri }]) => {
          // Liked Songs and the sample album both start from the top.
          const fromTop = uri === sampleContext || uri === "spotify:collection:tracks"
          const index = fromTop ? 0 : queue.findIndex((track) => track.uri === uri)

          return index < 0
            ? Effect.die(`FakeBridge can't play ${uri}`)
            : command((current) => ({ ...current, index, paused: false, positionMs: 0 }))
        })
      )

    const withNumber = (change: (value: number) => (current: PlayerState) => PlayerState) =>
      (args: ReadonlyArray<Schema.Json>) =>
        decodeArgs(Schema.Tuple([Schema.Finite]))(args).pipe(
          Effect.orDie,
          Effect.flatMap(([value]) => command(change(value)))
        )

    const setShuffle = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Boolean]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([shuffle]) => command((current) => ({ ...current, shuffle })))
      )

    const setVolume = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Finite]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([next]) => changeLevel(next))
      )

    const lookup = (uri: string) => [...queue, sampleExtra].find((track) => track.uri === uri)

    const getQueue = Ref.get(state).pipe(
      Effect.map((current) => ({
        current: queue[current.index % queue.length] ?? null,
        queued: current.queued.flatMap(({ uri, uid }) => {
          const track = lookup(uri)

          return track ? [{ ...track, uid, provider: "queue" }] : []
        }),
        nextUp: queue.slice(current.index + 1).flatMap((track, offset) =>
          current.removedFromContext.includes(track.uri)
            ? []
            : [{ ...track, uid: `context-${current.index + 1 + offset}`, provider: "context" }]
        )
      }))
    )

    const addToQueue = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Array(ItemRef)]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([items]) =>
          Ref.update(state, (current) => ({
            ...current,
            queued: [...current.queued, ...items.map(({ uri }, offset) => ({ uri, uid: `queue-${current.uids + offset}` }))],
            uids: current.uids + items.length
          }))
        )
      )

    // Like Spotify: an item with a uid matches only that entry, one
    // without matches every upcoming entry with the same uri, including
    // the album's own.
    const removeFromQueue = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Array(ItemRef)]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([items]) =>
          Ref.update(state, (current) => ({
            ...current,
            queued: current.queued.filter((entry) =>
              !items.some((item) => item.uid ? item.uid === entry.uid : item.uri === entry.uri)
            ),
            removedFromContext: [
              ...current.removedFromContext,
              ...items.flatMap((item) => item.uid ? [] : [item.uri])
            ]
          }))
        )
      )

    const setLiked = (liked: boolean) => (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Struct({ uris: Schema.Array(Schema.String) })]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([{ uris }]) =>
          command((current) => ({
            ...current,
            liked: liked
              ? [...current.liked, ...uris]
              : current.liked.filter((uri) => !uris.includes(uri))
          }))
        )
      )

    // LibraryAPI.contains takes URIs as separate arguments.
    const contains = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Array(Schema.String))(args).pipe(
        Effect.orDie,
        Effect.flatMap((uris) => Ref.get(state).pipe(Effect.map((current) => uris.map((uri) => current.liked.includes(uri)))))
      )

    // Each add grows that playlist's track count, so tests can see it.
    // Created playlists sit at the top, and removed ones are gone.
    const rootlist = Ref.get(state).pipe(
      Effect.map((current) => {
        const live = (folder: SampleFolder): SampleFolder => ({
          ...folder,
          items: folder.items.flatMap((item): ReadonlyArray<SampleFolder["items"][number]> => {
            if (item.type === "folder") return [live(item)]

            if (current.removed.includes(item.uri)) return []

            if (item.type === "placeholder") return [item]

            return [{ ...item, totalLength: item.totalLength + current.playlistAdds.filter((uri) => uri === item.uri).length }]
          })
        })

        return live({ ...sampleRootlist, items: [...current.created, ...sampleRootlist.items] })
      })
    )

    // Like Spotify, an unusable name yields null instead of an error.
    const createPlaylist = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.String, Schema.Struct({ before: Schema.Literal("start") }), Schema.Unknown]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([name]) =>
          Ref.modify(state, (current) => {
            if (name === "refuse me") return [null, current]

            const uri = `spotify:playlist:created${current.created.length}`.padEnd(39, "0")

            return [uri, { ...current, created: [samplePlaylist(0, name, true, 0, uri), ...current.created] }]
          })
        )
      )

    const setPublishedState = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.String, Schema.Boolean]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([uri, published]) =>
          Ref.update(state, (current) => ({
            ...current,
            unpublished: published ? current.unpublished.filter((other) => other !== uri) : [...current.unpublished, uri]
          }))
        )
      )

    const getPublishedState = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.String]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([uri]) => Ref.get(state).pipe(Effect.map((current) => !current.unpublished.includes(uri))))
      )

    const sidebarUris = rootlist.pipe(
      Effect.map((root) => {
        const uris = (folder: SampleFolder): ReadonlyArray<string> =>
          folder.items.flatMap((item) => item.type === "folder" ? uris(item) : [item.uri])

        return uris(root)
      })
    )

    // RootlistAPI.contains takes an array of URIs.
    const rootlistContains = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Array(Schema.String)]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([uris]) => sidebarUris.pipe(Effect.map((present) => uris.map((uri) => present.includes(uri)))))
      )

    // Like Spotify, remove reports nothing. This fake quietly keeps
    // "Someone's Mix", so tests can see a removal that didn't happen.
    const removeFromRootlist = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.Array(Schema.Struct({ uri: Schema.String }))]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([items]) =>
          Ref.update(state, (current) => ({
            ...current,
            removed: [...current.removed, ...items.flatMap(({ uri }) => uri === stuckPlaylist ? [] : [uri])]
          }))
        )
      )

    const addToPlaylist = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.String, Schema.Array(Schema.String), Schema.Struct({ after: Schema.Literal("end") }), Schema.Unknown]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([playlist, uris]) =>
          Ref.update(state, (current) => ({ ...current, playlistAdds: [...current.playlistAdds, ...uris.map(() => playlist)] }))
        )
      )

    const getDevices = Ref.get(state).pipe(
      Effect.map((current) => sampleDevices.map((device) => ({ ...device, isActive: device.id === current.activeDevice })))
    )

    // Real Spotify throws when the logging argument is missing.
    const transferPlayback = (args: ReadonlyArray<Schema.Json>) =>
      decodeArgs(Schema.Tuple([Schema.String, Schema.Struct({ interactionId: Schema.String })]))(args).pipe(
        Effect.orDie,
        Effect.flatMap(([activeDevice]) =>
          Ref.update(state, (current) => ({ ...current, activeDevice, transfers: current.transfers + 1 }))
        )
      )

    // How many transfers ran, for tests that check none did.
    const getTransfers = Ref.get(state).pipe(Effect.map((current) => current.transfers))

    const handlers = new Map<string, (args: ReadonlyArray<Schema.Json>) => Effect.Effect<unknown>>([
      ["PlayerAPI.getState", () => getState],
      ["PlayerAPI.play", play],
      ["PlayerAPI.pause", () => command((current) => ({ ...current, paused: true }))],
      ["PlayerAPI.resume", () => command((current) => ({ ...current, paused: false }))],
      ["PlayerAPI.skipToNext", () => command((current) => ({ ...current, index: current.index + 1, positionMs: 0 }))],
      [
        "PlayerAPI.skipToPrevious",
        () =>
          command((current) =>
            current.positionMs > 3000
              ? { ...current, positionMs: 0 }
              : { ...current, index: Math.max(0, current.index - 1), positionMs: 0 }
          )
      ],
      ["PlayerAPI.seekTo", withNumber((positionMs) => (current) => ({ ...current, positionMs }))],
      ["PlayerAPI.setShuffle", setShuffle],
      ["PlayerAPI.setRepeat", withNumber((repeat) => (current) => ({ ...current, repeat }))],
      ["PlayerAPI.getQueue", () => getQueue],
      ["PlayerAPI.addToQueue", addToQueue],
      ["PlayerAPI.removeFromQueue", removeFromQueue],
      ["PlayerAPI.clearQueue", () => Ref.update(state, (current) => ({ ...current, queued: [] }))],
      ["LibraryAPI.add", setLiked(true)],
      ["LibraryAPI.remove", setLiked(false)],
      ["LibraryAPI.contains", contains],
      ["RootlistAPI.getContents", () => rootlist],
      ["RootlistAPI.contains", rootlistContains],
      ["RootlistAPI.createPlaylist", createPlaylist],
      ["RootlistAPI.remove", removeFromRootlist],
      ["RootlistAPI.setPublishedState", setPublishedState],
      ["RootlistAPI.getPublishedState", getPublishedState],
      ["PlaylistAPI.add", addToPlaylist],
      ["ConnectDevicesAPI.getDevices", () => getDevices],
      ["ConnectTransferAPI.transferPlayback", transferPlayback],
      ["Test.transfers", () => getTransfers],
      [
        "PlaybackAPI.getVolume",
        () =>
          Effect.gen(function* () {
            const { level } = yield* Ref.get(sound)

            if (yield* Ref.getAndSet(muteLag, false)) yield* Ref.update(sound, (current) => ({ ...current, level: 0 }))

            return level
          })
      ],
      ["PlaybackAPI.setVolume", setVolume],
      ["PlaybackAPI.getMuteHelper.isMuted", () => Ref.get(sound).pipe(Effect.map((current) => current.muted))],
      // Like Spotify, mute flips the flag first; the volume reads as before
      // once more, then drops to 0.
      [
        "PlaybackAPI.getMuteHelper.mute",
        () =>
          Ref.update(sound, (current) => current.muted ? current : { ...current, muted: true, behindMute: current.level }).pipe(
            Effect.andThen(Ref.set(muteLag, true))
          )
      ],
      [
        "PlaybackAPI.getMuteHelper.unmute",
        () => Ref.update(sound, (current) => current.muted ? { ...current, level: current.behindMute, muted: false } : current)
      ]
    ])

    return {
      call: (api: string, method: string, ...args: ReadonlyArray<Schema.Json>) => {
        const handler = handlers.get(`${api}.${method}`)

        return handler ? handler(args) : Effect.die(`FakeBridge has no ${api}.${method}`)
      },
      inspect: (api: string, methods: ReadonlyArray<string>) =>
        Effect.succeed(methods.filter((method) => !handlers.has(`${api}.${method}`))),
      graphql: (name: string, variables: { readonly [key: string]: Schema.Json }) =>
        name === "searchModalResults"
          // Like Spotify, numberOfTopResults sets the count; limit doesn't.
          ? decodeArgs(Schema.Struct({ searchTerm: Schema.String, numberOfTopResults: Schema.Int }))(variables).pipe(
            Effect.orDie,
            Effect.map(({ searchTerm, numberOfTopResults }) => searchBody(searchTerm, numberOfTopResults))
          )
          : Effect.die(`FakeBridge has no query ${name}`),
      inspectQueries: (names: ReadonlyArray<string>) =>
        Effect.succeed(names.filter((name) => name !== "searchModalResults"))
    }
  })
)
