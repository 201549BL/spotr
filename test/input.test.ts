import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { formatTime, parseSeek } from "../src/domain/Seek.ts"
import { toSpotifyUri } from "../src/domain/Track.ts"

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

  it("leaves URIs and other input alone", () => {
    assert.strictEqual(toSpotifyUri("spotify:playlist:abc"), "spotify:playlist:abc")
    assert.strictEqual(toSpotifyUri("hello"), "hello")
  })
})
