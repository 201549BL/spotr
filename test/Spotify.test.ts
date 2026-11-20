import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge } from "../src/bridge/FakeBridge.ts"
import { Volume } from "../src/domain/Volume.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const spotifyWith = (staleReads: number) => Spotify.layer.pipe(Layer.provide(FakeBridge(staleReads)))

describe("Spotify", () => {
  it.effect("nowPlaying returns the current track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const track = yield* spotify.nowPlaying

      assert.deepStrictEqual(
        { uri: track.uri, name: track.name, artists: track.artists },
        { uri: "spotify:track:6sGIMrtIzQjdzkxDfA4Gxu", name: "Teardrop", artists: ["Massive Attack"] }
      )
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("next skips and returns the new track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const skipped = yield* spotify.next
      const current = yield* spotify.nowPlaying

      assert.strictEqual(skipped.name, "Windowlicker")
      assert.strictEqual(current.name, "Windowlicker")
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("next waits out stale reads after a skip", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const fiber = yield* Effect.forkChild(spotify.next)

      yield* TestClock.adjust("300 millis")
      const skipped = yield* Fiber.join(fiber)

      assert.strictEqual(skipped.name, "Windowlicker")
    }).pipe(Effect.provide(spotifyWith(3))))

  it.effect("setVolume sends a level that volume reads back", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual(yield* spotify.volume, 100)
      yield* spotify.setVolume(Volume.make(30))
      assert.strictEqual(yield* spotify.volume, 30)
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("next gives up and returns the old track when it never changes", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const fiber = yield* Effect.forkChild(spotify.next)

      yield* TestClock.adjust("2 seconds")
      const skipped = yield* Fiber.join(fiber)

      assert.strictEqual(skipped.name, "Teardrop")
    }).pipe(Effect.provide(spotifyWith(100))))
})
