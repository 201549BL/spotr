import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge, sampleQueue } from "../src/bridge/FakeBridge.ts"
import type { PlayerStatus } from "../src/domain/PlayerStatus.ts"
import { Volume } from "../src/domain/Volume.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const spotifyWith = (staleReads: number) =>
  Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, staleReads)))

const nothingLoaded = Spotify.layer.pipe(Layer.provide(FakeBridge([], 0)))

const summary = ({ track, paused }: PlayerStatus) => ({ track: track?.name ?? null, paused })

// Runs a command that polls, moving fake time forward so it can finish.
const withTime = <A, E>(self: Effect.Effect<A, E>, time: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(self)

    yield* TestClock.adjust(time)

    return yield* Fiber.join(fiber)
  })

describe("Spotify", () => {
  it.effect("status returns the current track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const { track, paused } = yield* spotify.status

      assert.deepStrictEqual(
        { uri: track?.uri, name: track?.name, artists: track?.artists, paused },
        { uri: "spotify:track:6sGIMrtIzQjdzkxDfA4Gxu", name: "Teardrop", artists: ["Massive Attack"], paused: false }
      )
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("status reports no track when nothing is loaded", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* spotify.status), { track: null, paused: false })
    }).pipe(Effect.provide(nothingLoaded)))

  it.effect("next skips and returns the new track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* spotify.next), { track: "Windowlicker", paused: false })
      assert.deepStrictEqual(summary(yield* spotify.status), { track: "Windowlicker", paused: false })
    }).pipe(Effect.provide(spotifyWith(0))))

  it.effect("next waits out stale reads after a skip", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* withTime(spotify.next, "300 millis")), { track: "Windowlicker", paused: false })
    }).pipe(Effect.provide(spotifyWith(3))))

  it.effect("next gives up and returns the old track when it never changes", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* withTime(spotify.next, "2 seconds")), { track: "Teardrop", paused: false })
    }).pipe(Effect.provide(spotifyWith(100))))

  it.effect("pause and resume wait until Spotify reports the change", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(summary(yield* withTime(spotify.pause, "300 millis")), { track: "Teardrop", paused: true })
      assert.deepStrictEqual(summary(yield* withTime(spotify.resume, "300 millis")), { track: "Teardrop", paused: false })
    }).pipe(Effect.provide(spotifyWith(2))))

  it.effect("setVolume sends a level that volume reads back", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.strictEqual(yield* spotify.volume, 100)
      yield* spotify.setVolume(Volume.make(30))
      assert.strictEqual(yield* spotify.volume, 30)
    }).pipe(Effect.provide(spotifyWith(0))))
})
