import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { formatTime, parseSeek } from "../src/domain/Seek.ts"
import { SpotifyUri, toSpotifyUri } from "../src/domain/Track.ts"
import { parseVolumeChange } from "../src/domain/Volume.ts"

describe("parseSeek", () => {
  it("reads absolute and relative positions", () => {
    assert.deepStrictEqual(parseSeek("90"), Option.some({ relative: false, ms: 90_000 }))
    assert.deepStrictEqual(parseSeek("1:30"), Option.some({ relative: false, ms: 90_000 }))
    assert.deepStrictEqual(parseSeek("+10"), Option.some({ relative: true, ms: 10_000 }))
    assert.deepStrictEqual(parseSeek("-10"), Option.some({ relative: true, ms: -10_000 }))
    assert.deepStrictEqual(parseSeek("+1:05"), Option.some({ relative: true, ms: 65_000 }))
  })

  it("rejects anything else", () => {
    assert.deepStrictEqual(parseSeek("1:75"), Option.none())
    assert.deepStrictEqual(parseSeek("abc"), Option.none())
    assert.deepStrictEqual(parseSeek(""), Option.none())
  })
})

describe("formatTime", () => {
  it("shows minutes and two-digit seconds", () => {
    assert.strictEqual(formatTime(0), "0:00")
    assert.strictEqual(formatTime(65_400), "1:05")
    assert.strictEqual(formatTime(3_600_000), "60:00")
  })
})

describe("toSpotifyUri", () => {
  it("turns open.spotify.com links into URIs", () => {
    assert.strictEqual(
      toSpotifyUri("https://open.spotify.com/track/1111111111111111111111?si=abc"),
      "spotify:track:1111111111111111111111"
    )
    assert.strictEqual(
      toSpotifyUri("https://open.spotify.com/intl-de/album/0000000000000000000000"),
      "spotify:album:0000000000000000000000"
    )
  })

  it("turns liked into the Liked Songs URI", () => {
    assert.strictEqual(toSpotifyUri("liked"), "spotify:collection:tracks")
    assert.strictEqual(toSpotifyUri("https://open.spotify.com/collection/tracks"), "spotify:collection:tracks")
  })

  it("leaves URIs and other input alone", () => {
    assert.strictEqual(toSpotifyUri("spotify:playlist:abc"), "spotify:playlist:abc")
    assert.strictEqual(toSpotifyUri("hello"), "hello")
  })
})

describe("SpotifyUri", () => {
  const valid = Schema.is(SpotifyUri)

  it("accepts tracks, Liked Songs, user collections and local files", () => {
    assert.deepStrictEqual(
      [
        "spotify:track:1111111111111111111111",
        "spotify:collection:tracks",
        "spotify:user:someone:collection",
        "spotify:local:Some+Artist::Some+Song:215"
      ].map(valid),
      [true, true, true, true]
    )
  })

  it("rejects anything that isn't a spotify: URI", () => {
    assert.deepStrictEqual(
      ["notauri", "spotify:", "spotify:track", "spotify:track:", "spotify:track:has space", "https://example.com"].map(valid),
      [false, false, false, false, false, false]
    )
  })
})

describe("parseVolumeChange", () => {
  it("reads levels and changes", () => {
    assert.deepStrictEqual(parseVolumeChange("40"), Option.some({ relative: false, amount: 40 }))
    assert.deepStrictEqual(parseVolumeChange("0"), Option.some({ relative: false, amount: 0 }))
    assert.deepStrictEqual(parseVolumeChange("+10"), Option.some({ relative: true, amount: 10 }))
    assert.deepStrictEqual(parseVolumeChange("-5"), Option.some({ relative: true, amount: -5 }))
  })

  it("rejects levels above 100 and anything else", () => {
    assert.deepStrictEqual(["101", "loud", "", "+", "1.5"].map(parseVolumeChange), [
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none()
    ])
  })
})
