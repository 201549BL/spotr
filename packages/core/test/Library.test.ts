import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge, sampleExtra, sampleQueue } from "../src/bridge/FakeBridge.ts"
import type { Playlist } from "../src/domain/Playlist.ts"
import { SpotifyUri } from "../src/domain/Track.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const TestSpotify = Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, 0)))

const nothingLoaded = Spotify.layer.pipe(Layer.provide(FakeBridge([], 0)))

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
      const spotify = yield* Spotify
      const result = yield* spotify.like(undefined)

      assert.deepStrictEqual(
        { uri: result.uri, name: result.name, liked: result.liked },
        { uri: "spotify:track:1111111111111111111111", name: "First Song", liked: true }
      )
      assert.isTrue((yield* spotify.status).liked)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("unlike a given track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.isTrue((yield* spotify.like(extra)).liked)
      const result = yield* spotify.unlike(extra)

      assert.deepStrictEqual({ uri: result.uri, name: result.name, liked: result.liked }, { uri: extra, name: null, liked: false })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("needs a track when nothing is playing", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const error = yield* Effect.flip(spotify.like(undefined))

      assert.strictEqual(error.message, "A playing track wasn't found")
    }).pipe(Effect.provide(nothingLoaded)))
})

describe("playlists", () => {
  it.effect("lists every playlist with its folder, skipping ones Spotify couldn't load", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual((yield* spotify.playlists).map(summary), [
        { name: "Road Trip", folder: null, canAdd: true, tracks: 2 },
        { name: "Focus", folder: "Work", canAdd: true, tracks: 5 },
        { name: "Someone's Mix", folder: "Work", canAdd: false, tracks: 30 },
        { name: "Twins", folder: null, canAdd: true, tracks: 1 },
        { name: "Twins", folder: null, canAdd: true, tracks: 1 }
      ])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds the playing track to a playlist found by name, ignoring case", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const result = yield* spotify.addToPlaylist("road trip", undefined)

      assert.deepStrictEqual(
        { playlist: result.playlist.name, uri: result.uri, name: result.name },
        { playlist: "Road Trip", uri: "spotify:track:1111111111111111111111", name: "First Song" }
      )
      assert.strictEqual((yield* spotify.playlists)[0]?.tracks, 3)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds a given track to a playlist found by URI", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* spotify.addToPlaylist(roadTrip, extra)

      assert.strictEqual((yield* spotify.playlists)[0]?.tracks, 3)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown names, shared names and playlists the user can't add to", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const missing = yield* Effect.flip(spotify.addToPlaylist("Nope", extra))
      const twins = yield* Effect.flip(spotify.addToPlaylist("twins", extra))
      const readOnly = yield* Effect.flip(spotify.addToPlaylist("spotify:playlist:3333333333333333333333", extra))
      const byName = yield* Effect.flip(spotify.addToPlaylist("Someone's Mix", extra))

      assert.deepStrictEqual([missing.message, twins.message, readOnly.message, byName.message], [
        "Playlist \"Nope\" wasn't found",
        "A single playlist named \"twins\" wasn't found",
        "A playlist you can add to named \"Someone's Mix\" wasn't found",
        "Playlist \"Someone's Mix\" wasn't found"
      ])
      assert.deepStrictEqual((yield* spotify.playlists).map((playlist) => playlist.tracks), [2, 5, 30, 1, 1])
    }).pipe(Effect.provide(TestSpotify)))
})

describe("playlist create and delete", () => {
  it.effect("creates a public playlist at the top of the library", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const created = yield* spotify.createPlaylist("New Mix", false)

      assert.deepStrictEqual({ name: created.name, public: created.public }, { name: "New Mix", public: true })
      assert.deepStrictEqual((yield* spotify.playlists).map(summary)[0], { name: "New Mix", folder: null, canAdd: true, tracks: 0 })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("creates a private playlist when asked", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const created = yield* spotify.createPlaylist("Secret Mix", true)

      assert.deepStrictEqual({ name: created.name, public: created.public }, { name: "Secret Mix", public: false })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("reports when Spotify doesn't create the playlist", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const error = yield* Effect.flip(spotify.createPlaylist("refuse me", false))

      assert.deepStrictEqual({ tag: error._tag, message: error.message }, {
        tag: "SpotifyRefused",
        message: "Spotify didn't create the playlist \"refuse me\""
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("deletes a playlist found by name only with confirmation", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const unconfirmed = yield* Effect.flip(spotify.deletePlaylist("road trip", false))

      assert.strictEqual(unconfirmed.message, "spotrc won't delete \"Road Trip\" without --yes")
      assert.strictEqual((yield* spotify.playlists).length, 5)

      const deleted = yield* spotify.deletePlaylist("road trip", true)

      assert.deepStrictEqual({ uri: deleted.uri, name: deleted.name }, { uri: roadTrip, name: "Road Trip" })
      assert.deepStrictEqual((yield* spotify.playlists).map((playlist) => playlist.name), ["Focus", "Someone's Mix", "Twins", "Twins"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown and shared names, and notices a delete that didn't happen", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const missing = yield* Effect.flip(spotify.deletePlaylist("Nope", true))
      const twins = yield* Effect.flip(spotify.deletePlaylist("Twins", true))
      const stuck = yield* Effect.flip(withTime(spotify.deletePlaylist("Someone's Mix", true), "3 seconds"))

      assert.deepStrictEqual([missing.message, twins.message, stuck.message], [
        "Playlist \"Nope\" wasn't found",
        "A single playlist named \"Twins\" wasn't found",
        "Spotify didn't delete \"Someone's Mix\""
      ])
      assert.strictEqual((yield* spotify.playlists).length, 5)
    }).pipe(Effect.provide(TestSpotify)))
})
