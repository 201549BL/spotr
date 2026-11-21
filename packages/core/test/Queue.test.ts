import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { FakeBridge, sampleExtra, sampleQueue } from "../src/locator/FakeBridge.ts"
import type { Queue } from "../src/model/Queue.ts"
import { SpotifyUri } from "../src/model/Track.ts"
import { Client } from "../src/api/Client.ts"
import { core } from "./core.ts"

const TestSpotify = core(FakeBridge(sampleQueue, 0))

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
      const client = yield* Client

      assert.deepStrictEqual(names(yield* client.queue()), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("adds tracks to the end of the queue", () =>
    Effect.gen(function* () {
      const client = yield* Client

      yield* client.addToQueue({ uri: extra })

      assert.deepStrictEqual(names(yield* client.addToQueue({ uri: secondSong })).queued, ["Extra Song", "Second Song"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("removes only the queued copy, not the album's own copy of the track", () =>
    Effect.gen(function* () {
      const client = yield* Client

      yield* client.addToQueue({ uri: secondSong })

      assert.deepStrictEqual(names(yield* client.removeFromQueue({ uri: secondSong })), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("says when the track to remove isn't queued", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const error = yield* Effect.flip(client.removeFromQueue({ uri: extra }))

      assert.strictEqual(error.message, "spotify:track:3333333333333333333333 in your queue wasn't found")
      assert.strictEqual(error._tag, "NotFound")
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("clear empties the user's queue and keeps the album", () =>
    Effect.gen(function* () {
      const client = yield* Client

      yield* client.addToQueue({ uri: extra })
      yield* client.addToQueue({ uri: secondSong })

      assert.deepStrictEqual(names(yield* client.clearQueue()), {
        current: "First Song",
        queued: [],
        nextUp: ["Second Song"]
      })
    }).pipe(Effect.provide(TestSpotify)))
})
