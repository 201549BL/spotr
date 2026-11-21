import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge, sampleExtra, sampleQueue } from "../src/locator/FakeBridge.ts"
import type { Playlist } from "../src/model/Playlist.ts"
import { SpotifyUri } from "../src/model/Track.ts"
import { Client } from "../src/api/Client.ts"
import { core } from "./core.ts"

const TestSpotify = core(FakeBridge(sampleQueue, 0))

const nothingLoaded = core(FakeBridge([], 0))

const extra = SpotifyUri.make(sampleExtra.uri)

const roadTrip = "spotify:playlist:1111111111111111111111"

// Runs something that polls, moving fake time forward so it can finish.
const withTime = <A, E>(self: Effect.Effect<A, E>, time: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(self)

    yield* TestClock.adjust(time)

    return yield* Fiber.join(fiber)
  })

const summary = ({ name, folder, canAdd, tracks }: Playlist) => ({ name, folder, canAdd, tracks })

describe("like and unlike", () => {
  it.effect("like the playing track, and status shows it", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const result = yield* client.like({})

      assert.deepStrictEqual(
        { uri: result.uri, name: result.name, liked: result.liked },
        { uri: "spotify:track:1111111111111111111111", name: "First Song", liked: true }
      )
      assert.isTrue((yield* client.status()).liked)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("unlike a given track", () =>
    Effect.gen(function* () {
      const client = yield* Client

      assert.isTrue((yield* client.like({ uri: extra })).liked)
      const result = yield* client.unlike({ uri: extra })

      assert.deepStrictEqual({ uri: result.uri, name: result.name, liked: result.liked }, { uri: extra, name: null, liked: false })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("needs a track when nothing is playing", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const error = yield* Effect.flip(client.like({}))

      assert.strictEqual(error.message, "A playing track wasn't found")
    }).pipe(Effect.provide(nothingLoaded)))
})

describe("playlists", () => {
  it.effect("lists every playlist with its folder, skipping ones Spotify couldn't load", () =>
    Effect.gen(function* () {
      const client = yield* Client

      assert.deepStrictEqual((yield* client.playlists()).map(summary), [
        { name: "Road Trip", folder: null, canAdd: true, tracks: 2 },
        { name: "Focus", folder: "Work", canAdd: true, tracks: 5 },
        { name: "Someone's Mix", folder: "Work", canAdd: false, tracks: 30 },
        { name: "Twins", folder: null, canAdd: true, tracks: 1 },
        { name: "Twins", folder: null, canAdd: true, tracks: 1 }
      ])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds the playing track to a playlist found by name, ignoring case", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const result = yield* client.addToPlaylist({ playlist: "road trip" })

      assert.deepStrictEqual(
        { playlist: result.playlist.name, uri: result.uri, name: result.name },
        { playlist: "Road Trip", uri: "spotify:track:1111111111111111111111", name: "First Song" }
      )
      assert.strictEqual((yield* client.playlists())[0]?.tracks, 3)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds a given track to a playlist found by URI", () =>
    Effect.gen(function* () {
      const client = yield* Client

      yield* client.addToPlaylist({ playlist: roadTrip, uri: extra })

      assert.strictEqual((yield* client.playlists())[0]?.tracks, 3)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown names, shared names and playlists the user can't add to", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const missing = yield* Effect.flip(client.addToPlaylist({ playlist: "Nope", uri: extra }))
      const twins = yield* Effect.flip(client.addToPlaylist({ playlist: "twins", uri: extra }))
      const readOnly = yield* Effect.flip(client.addToPlaylist({ playlist: "spotify:playlist:3333333333333333333333", uri: extra }))
      const byName = yield* Effect.flip(client.addToPlaylist({ playlist: "Someone's Mix", uri: extra }))

      assert.deepStrictEqual([missing.message, twins.message, readOnly.message, byName.message], [
        "Playlist \"Nope\" wasn't found",
        "A single playlist named \"twins\" wasn't found",
        "A playlist you can add to named \"Someone's Mix\" wasn't found",
        "Playlist \"Someone's Mix\" wasn't found"
      ])
      assert.deepStrictEqual((yield* client.playlists()).map((playlist) => playlist.tracks), [2, 5, 30, 1, 1])
    }).pipe(Effect.provide(TestSpotify)))
})

describe("playlist create and delete", () => {
  it.effect("creates a public playlist at the top of the library", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const created = yield* client.createPlaylist({ name: "New Mix", isPrivate: false })

      assert.deepStrictEqual({ name: created.name, public: created.public }, { name: "New Mix", public: true })
      assert.deepStrictEqual((yield* client.playlists()).map(summary)[0], { name: "New Mix", folder: null, canAdd: true, tracks: 0 })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("creates a private playlist when asked", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const created = yield* client.createPlaylist({ name: "Secret Mix", isPrivate: true })

      assert.deepStrictEqual({ name: created.name, public: created.public }, { name: "Secret Mix", public: false })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("reports when Spotify doesn't create the playlist", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const error = yield* Effect.flip(client.createPlaylist({ name: "refuse me", isPrivate: false }))

      assert.deepStrictEqual({ tag: error._tag, message: error.message }, {
        tag: "SpotifyRefused",
        message: "Spotify didn't create the playlist \"refuse me\""
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("deletes a playlist found by name only with confirmation", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const unconfirmed = yield* Effect.flip(client.deletePlaylist({ playlist: "road trip", yes: false }))

      assert.strictEqual(unconfirmed.message, "spotrc won't delete \"Road Trip\" without confirmation")
      assert.strictEqual((yield* client.playlists()).length, 5)

      const deleted = yield* client.deletePlaylist({ playlist: "road trip", yes: true })

      assert.deepStrictEqual({ uri: deleted.uri, name: deleted.name }, { uri: roadTrip, name: "Road Trip" })
      assert.deepStrictEqual((yield* client.playlists()).map((playlist) => playlist.name), ["Focus", "Someone's Mix", "Twins", "Twins"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown and shared names, and notices a delete that didn't happen", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const missing = yield* Effect.flip(client.deletePlaylist({ playlist: "Nope", yes: true }))
      const twins = yield* Effect.flip(client.deletePlaylist({ playlist: "Twins", yes: true }))
      const stuck = yield* Effect.flip(withTime(client.deletePlaylist({ playlist: "Someone's Mix", yes: true }), "3 seconds"))

      assert.deepStrictEqual([missing.message, twins.message, stuck.message], [
        "Playlist \"Nope\" wasn't found",
        "A single playlist named \"Twins\" wasn't found",
        "Spotify didn't delete \"Someone's Mix\""
      ])
      assert.strictEqual((yield* client.playlists()).length, 5)
    }).pipe(Effect.provide(TestSpotify)))
})
