import { assert, describe, it } from "@effect/vitest"
import { PlayerStatus } from "../src/domain/PlayerStatus.ts"
import { Queue } from "../src/domain/Queue.ts"
import { SpotifyUri, Track } from "../src/domain/Track.ts"
import { queueText, repeatText, shuffleText, statusText } from "../src/render.ts"

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

describe("queueText", () => {
  it("lists the current track, the queue and what's next", () => {
    const other = new Track({ ...track, name: "Second Song", artists: ["Other Artist"] })

    assert.strictEqual(
      queueText(new Queue({ current: track, queued: [other], nextUp: [] })),
      "Now playing: First Song · Some Artist, Guest\nQueued:\n  1. Second Song · Other Artist"
    )
  })

  it("says when nothing is queued, and shortens a long list", () => {
    const text = queueText(new Queue({ current: null, queued: [], nextUp: Array.from({ length: 12 }, () => track) }))

    assert.strictEqual(
      text,
      [
        "Nothing playing",
        "Queued: nothing",
        "Next up:",
        ...Array.from({ length: 10 }, (_, index) => `  ${index + 1}. First Song · Some Artist, Guest`),
        "  … and 2 more"
      ].join("\n")
    )
  })
})
