import { assert, describe, it } from "@effect/vitest"
import { PlayerStatus } from "../src/domain/PlayerStatus.ts"
import { SpotifyUri, Track } from "../src/domain/Track.ts"
import { repeatText, shuffleText, statusText } from "../src/render.ts"

const track = new Track({
  uri: SpotifyUri.make("spotify:track:1111111111111111111111"),
  name: "First Song",
  artists: ["Some Artist", "Guest"],
  durationMs: 200_000
})

const playing = new PlayerStatus({
  track,
  context: null,
  paused: false,
  positionMs: 83_000,
  shuffle: true,
  repeat: "all",
  liked: true
})

describe("statusText", () => {
  it("shows the track, then position and modes", () => {
    assert.strictEqual(
      statusText(playing),
      "▶ First Song · Some Artist, Guest\n  1:23 / 3:20 · shuffle on · repeat all · ♥ liked"
    )
  })

  it("marks a paused, unliked track", () => {
    assert.strictEqual(
      statusText(new PlayerStatus({ ...playing, paused: true, liked: false, shuffle: false, repeat: "off" })),
      "⏸ First Song · Some Artist, Guest\n  1:23 / 3:20 · shuffle off · repeat off"
    )
  })

  it("says when nothing is playing", () => {
    assert.strictEqual(statusText(new PlayerStatus({ ...playing, track: null })), "Nothing playing")
  })
})

describe("mode text", () => {
  it("shows shuffle and repeat", () => {
    assert.strictEqual(shuffleText(playing), "Shuffle on")
    assert.strictEqual(repeatText(playing), "Repeat all")
  })
})
