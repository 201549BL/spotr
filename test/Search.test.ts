import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FakeBridge, sampleQueue } from "../src/bridge/FakeBridge.ts"
import { relevant, SearchResult } from "../src/domain/SearchResult.ts"
import { SpotifyUri, toPlayTarget } from "../src/domain/Track.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const TestSpotify = Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, 0)))

const withTime = <A, E>(self: Effect.Effect<A, E>, time: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(self)

    yield* TestClock.adjust(time)

    return yield* Fiber.join(fiber)
  })

const line = ({ kind, name, by }: SearchResult) => `${kind} ${name}${by ? ` by ${by}` : ""}`

describe("search", () => {
  it.effect("returns hits best first, and skips types spotr doesn't know", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual((yield* spotify.search("song", 10)).map(line), [
        "track First Song by Some Artist",
        "playlist Road Trip Songs by Someone",
        "genre Song Genre",
        "playlist Popular Right Now by Spotify"
      ])
      assert.deepStrictEqual((yield* spotify.search("some artist", 2)).map(line), [
        "track First Song by Some Artist",
        "album Sample Album by Some Artist"
      ])
      assert.deepStrictEqual((yield* spotify.search("nothing like this", 10)).map(line), ["playlist Popular Right Now by Spotify"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("play by search plays the first hit that can be played", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      yield* withTime(spotify.pause, "300 millis")
      const status = yield* withTime(spotify.playSearch("sample album"), "300 millis")

      assert.deepStrictEqual({ track: status.track?.name, paused: status.paused }, { track: "First Song", paused: false })
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("play by search refuses when nothing playable matches", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const nothing = yield* Effect.flip(spotify.playSearch("nothing like this"))
      const genreOnly = yield* Effect.flip(spotify.playSearch("song genre"))

      assert.deepStrictEqual([nothing.message, genreOnly.message], [
        "Anything playable for \"nothing like this\" wasn't found",
        "Anything playable for \"song genre\" wasn't found"
      ])
    }).pipe(Effect.provide(TestSpotify)))
})

describe("relevant", () => {
  const hit = (name: string, by: string | null) =>
    new SearchResult({ kind: "track", uri: SpotifyUri.make("spotify:track:1111111111111111111111"), name, by })

  it("needs a searched word to start a word in the name or maker", () => {
    assert.isTrue(relevant("around the world")(hit("Around the World", "Daft Punk")))
    assert.isTrue(relevant("windowlick")(hit("Windowlicker", "Aphex Twin")))
    assert.isTrue(relevant("aphex")(hit("Windowlicker", "Aphex Twin")))
    assert.isTrue(relevant("beyonce")(hit("Halo", "Beyoncé")))
    assert.isTrue(relevant("motley crue")(hit("Kickstart My Heart", "Mötley Crüe")))
    assert.isFalse(relevant("qqqqzzzz")(hit("Soda Pop", "Saja Boys")))
    assert.isFalse(relevant("a")(hit("A Song", null)))
  })
})

describe("toPlayTarget", () => {
  it("resumes with no words, plays URIs and links, and searches anything else", () => {
    assert.deepStrictEqual(toPlayTarget([]), { kind: "resume" })
    assert.deepStrictEqual(toPlayTarget(["  "]), { kind: "resume" })
    assert.deepStrictEqual(toPlayTarget(["liked"]), { kind: "uri", uri: SpotifyUri.make("spotify:collection:tracks") })
    assert.deepStrictEqual(toPlayTarget(["spotify:track:1111111111111111111111"]), {
      kind: "uri",
      uri: SpotifyUri.make("spotify:track:1111111111111111111111")
    })
    assert.deepStrictEqual(toPlayTarget(["https://open.spotify.com/album/0000000000000000000000?si=x"]), {
      kind: "uri",
      uri: SpotifyUri.make("spotify:album:0000000000000000000000")
    })
    assert.deepStrictEqual(toPlayTarget(["around", "the", "world"]), { kind: "search", text: "around the world" })
    assert.deepStrictEqual(toPlayTarget(["liked", "songs"]), { kind: "search", text: "liked songs" })
  })
})
