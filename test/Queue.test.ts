import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FakeBridge, sampleExtra, sampleQueue } from "../src/core/bridge/FakeBridge.ts"
import type { Queue } from "../src/core/domain/Queue.ts"
import { SpotifyUri } from "../src/core/domain/Track.ts"
import { Spotify } from "../src/core/spotify/Spotify.ts"

const TestSpotify = Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, 0)))

const extra = SpotifyUri.make(sampleExtra.uri)

const secondSong = SpotifyUri.make("spotify:track:2222222222222222222222")

const names = ({ current, queued, nextUp }: Queue) => ({
  current: current?.name ?? null,
  queued: queued.map((track) => track.name),
  nextUp: nextUp.map((track) => track.name)
})

describe("queue", () => {
  it.effect("lists the current track, the user's queue and the rest of the album", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(names(yield* spotify.queue), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds tracks to the end of the queue", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* spotify.addToQueue(extra)

      assert.deepStrictEqual(names(yield* spotify.addToQueue(secondSong)).queued, ["Extra Song", "Second Song"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("removes only the queued copy, not the album's own copy of the track", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* spotify.addToQueue(secondSong)

      assert.deepStrictEqual(names(yield* spotify.removeFromQueue(secondSong)), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("says when the track to remove isn't queued", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const error = yield* Effect.flip(spotify.removeFromQueue(extra))

      assert.strictEqual(error.message, "spotify:track:3333333333333333333333 in your queue wasn't found")
      assert.strictEqual(error._tag, "NotFound")
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("clear empties the user's queue and keeps the album", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* spotify.addToQueue(extra)
      yield* spotify.addToQueue(secondSong)

      assert.deepStrictEqual(names(yield* spotify.clearQueue), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))
})
