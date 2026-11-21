import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge, sampleContext, sampleQueue } from "../src/bridge/FakeBridge.ts"
import type { PlayerStatus } from "../src/domain/PlayerStatus.ts"
import { SpotifyUri } from "../src/domain/Track.ts"
import type { VolumeStatus } from "../src/domain/Volume.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const spotifyWith = (staleReads: number) =>
  Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, staleReads)))

const nothingLoaded = Spotify.layer.pipe(Layer.provide(FakeBridge([], 0)))

const secondSong = SpotifyUri.make("spotify:track:2222222222222222222222")

const summary = ({ track, paused, positionMs }: PlayerStatus) => ({ track: track?.name ?? null, paused, positionMs })

// Runs a command that polls, moving fake time forward so it can finish.
const withTime = <A, E>(self: Effect.Effect<A, E>, time: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(self)

    yield* TestClock.adjust(time)

    return yield* Fiber.join(fiber)
  })

describe("Spotify", () => {
  it.effect("status describes the current track and player modes", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const status = yield* spotify.status

      assert.deepStrictEqual(
        {
          uri: status.track?.uri,
          name: status.track?.name,
          artists: status.track?.artists,
          durationMs: status.track?.durationMs,
          context: status.context,
          paused: status.paused,
          positionMs: status.positionMs,
          shuffle: status.shuffle,
          repeat: status.repeat,
          liked: status.liked
        },
        {
          uri: "spotify:track:1111111111111111111111",
          name: "First Song",
          artists: ["Some Artist"],
          durationMs: 200_000,
          context: sampleContext,
          paused: false,
          positionMs: 0,
          shuffle: false,
          repeat: "off",
          liked: false
        }
      )
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("status reports no track when nothing is loaded", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* spotify.status), { track: null, paused: false, positionMs: 0 })
    }).pipe(Effect.provide(nothingLoaded)))

  it.effect("next skips and returns the new track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual((yield* spotify.next).track?.name, "Second Song")
      assert.strictEqual((yield* spotify.status).track?.name, "Second Song")
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("next waits out stale reads after a skip", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual((yield* withTime(spotify.next, "300 millis")).track?.name, "Second Song")
    }).pipe(Effect.provide(spotifyWith(3))))

  it.effect("next gives up and returns the old track when it never changes", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual((yield* withTime(spotify.next, "2 seconds")).track?.name, "First Song")
    }).pipe(Effect.provide(spotifyWith(100))))

  it.effect("pause and resume wait until Spotify reports the change", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.isTrue((yield* withTime(spotify.pause, "300 millis")).paused)
      assert.isFalse((yield* withTime(spotify.resume, "300 millis")).paused)
    }).pipe(Effect.provide(spotifyWith(2))))

  it.effect("play starts a track, or a whole album from its first track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* withTime(spotify.pause, "300 millis")
      assert.deepStrictEqual(summary(yield* withTime(spotify.play(secondSong), "300 millis")), {
        track: "Second Song",
        paused: false,
        positionMs: 0
      })
      assert.deepStrictEqual(
        summary(yield* withTime(spotify.play(SpotifyUri.make(sampleContext)), "300 millis")),
        { track: "First Song", paused: false, positionMs: 0 }
      )
    }).pipe(Effect.provide(spotifyWith(2))))

  it.effect("previous goes back a track near the start, and restarts the track later on", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* spotify.play(secondSong)
      yield* spotify.seek({ relative: false, ms: 60_000 })
      assert.deepStrictEqual(summary(yield* spotify.previous), { track: "Second Song", paused: false, positionMs: 0 })
      assert.deepStrictEqual(summary(yield* spotify.previous), { track: "First Song", paused: false, positionMs: 0 })
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("seek jumps to a position, moves relative to it, and stays inside the track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual((yield* spotify.seek({ relative: false, ms: 90_000 })).positionMs, 90_000)
      assert.strictEqual((yield* spotify.seek({ relative: true, ms: -10_000 })).positionMs, 80_000)
      assert.strictEqual((yield* spotify.seek({ relative: true, ms: 999_000 })).positionMs, 200_000)
      assert.strictEqual((yield* spotify.seek({ relative: true, ms: -999_000 })).positionMs, 0)
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("shuffle and repeat change and read back", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.isTrue((yield* withTime(spotify.setShuffle(true), "300 millis")).shuffle)
      assert.strictEqual((yield* withTime(spotify.setRepeat("one"), "300 millis")).repeat, "one")
      assert.strictEqual((yield* withTime(spotify.setRepeat("all"), "300 millis")).repeat, "all")
      assert.isFalse((yield* withTime(spotify.setShuffle(false), "300 millis")).shuffle)
    }).pipe(Effect.provide(spotifyWith(2))))

  it.effect("sets the volume, changes it by steps, and keeps it within 0 to 100", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const level = (status: VolumeStatus) => `${status.volume}${status.muted ? " muted" : ""}`

      assert.strictEqual(level(yield* spotify.volume), "100")
      assert.strictEqual(level(yield* spotify.setVolume({ relative: false, amount: 30 })), "30")
      assert.strictEqual(level(yield* spotify.setVolume({ relative: true, amount: 15 })), "45")
      assert.strictEqual(level(yield* spotify.setVolume({ relative: true, amount: -60 })), "0 muted")
      assert.strictEqual(level(yield* spotify.setVolume({ relative: true, amount: 250 })), "100")
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("mute remembers the volume, and unmute brings it back", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const level = (status: VolumeStatus) => `${status.volume}${status.muted ? " muted" : ""}`

      yield* spotify.setVolume({ relative: false, amount: 40 })

      assert.strictEqual(level(yield* spotify.mute), "0 muted")
      assert.strictEqual(level(yield* spotify.mute), "0 muted")
      assert.strictEqual(level(yield* spotify.unmute), "40")
      assert.strictEqual(level(yield* spotify.unmute), "40")
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("toggle pauses when playing and resumes when paused", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.isTrue((yield* withTime(spotify.toggle, "300 millis")).paused)
      assert.isFalse((yield* withTime(spotify.toggle, "300 millis")).paused)
    }).pipe(Effect.provide(spotifyWith(2))))

  it.effect("play liked starts Liked Songs, which Spotify plays from a playlist of its own", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* withTime(spotify.pause, "300 millis")

      assert.deepStrictEqual(summary(yield* withTime(spotify.play(SpotifyUri.make("spotify:collection:tracks")), "300 millis")), {
        track: "First Song",
        paused: false,
        positionMs: 0
      })
    }).pipe(Effect.provide(spotifyWith(2))))
})
