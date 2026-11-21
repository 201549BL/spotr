import { Check, CreatedPlaylist, DeletedPlaylist, Device, LikeResult, PlayerStatus, Playlist, PlaylistAddResult, Queue, SearchResult, SpotifyUri, Track, Volume, VolumeStatus } from "spotr-core"
import { assert, describe, it } from "@effect/vitest"
import { searchText, volumeText, createdText, deletedText, devicesText, doctorText, launchText, likeText, watchText, playlistAddText, playlistsText, queueText, repeatText, shuffleText, statusText } from "../src/render.ts"

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

describe("library text", () => {
  it("describes likes and playlist additions", () => {
    const uri = SpotifyUri.make("spotify:track:1111111111111111111111")
    const focus = new Playlist({ uri: SpotifyUri.make("spotify:playlist:2222222222222222222222"), name: "Focus", folder: "Work", canAdd: true, tracks: 1 })

    assert.strictEqual(likeText(new LikeResult({ uri, name: "First Song", liked: true })), "♥ Liked First Song")
    assert.strictEqual(likeText(new LikeResult({ uri, name: null, liked: false })), `Removed ${uri} from Liked Songs`)
    assert.strictEqual(playlistAddText(new PlaylistAddResult({ playlist: focus, uri, name: null })), `Added ${uri} to Focus`)
    assert.strictEqual(
      playlistsText([focus, new Playlist({ ...focus, folder: null, name: "Mix", canAdd: false, tracks: 30 })]),
      "Work / Focus · 1 track\nMix · 30 tracks · read-only"
    )
    assert.strictEqual(playlistsText([]), "No playlists")
    assert.strictEqual(createdText(new CreatedPlaylist({ uri, name: "Mix", public: false })), "Created \"Mix\" (private)")
    assert.strictEqual(createdText(new CreatedPlaylist({ uri, name: "Mix", public: true })), "Created \"Mix\" (public)")
    assert.strictEqual(deletedText(new DeletedPlaylist({ uri, name: "Mix" })), "Deleted \"Mix\"")
  })
})

describe("devicesText", () => {
  it("marks the active device and this computer", () => {
    assert.strictEqual(
      devicesText([
        new Device({ id: "local_device", name: "This Mac", type: "computer", active: false, local: true }),
        new Device({ id: "speaker-1", name: "Kitchen", type: "speaker", active: true, local: false })
      ]),
      "  This Mac · computer · this computer\n▶ Kitchen · speaker"
    )
  })
})

describe("volumeText", () => {
  it("shows the level, or that Spotify is muted", () => {
    assert.strictEqual(volumeText(new VolumeStatus({ volume: Volume.make(40), muted: false })), "Volume 40%")
    assert.strictEqual(volumeText(new VolumeStatus({ volume: Volume.make(0), muted: true })), "Muted")
  })
})

describe("extras text", () => {
  it("shows doctor checks, launch results and watch lines", () => {
    assert.strictEqual(
      doctorText([
        new Check({ name: "Port answers", status: "pass", detail: "" }),
        new Check({ name: "Window open", status: "fail", detail: "Wait a moment." }),
        new Check({ name: "Agent works", status: "skipped", detail: "" })
      ]),
      "✓ Port answers\n✗ Window open\n    Wait a moment.\n- Agent works (skipped)"
    )
    assert.strictEqual(launchText({ started: true, port: 9222 }), "Started Spotify with DevTools on port 9222")
    assert.strictEqual(launchText({ started: false, port: 9333 }), "Spotify is already reachable on port 9333")
    assert.strictEqual(watchText(playing), "▶ First Song · Some Artist, Guest")
  })
})

describe("searchText", () => {
  it("numbers the hits with their kind, maker and URI", () => {
    assert.strictEqual(
      searchText([
        new SearchResult({ kind: "track", uri: SpotifyUri.make("spotify:track:1111111111111111111111"), name: "First Song", by: "Some Artist" }),
        new SearchResult({ kind: "artist", uri: SpotifyUri.make("spotify:artist:4444444444444444444444"), name: "Some Artist", by: null })
      ]),
      " 1. track     First Song · Some Artist\n    spotify:track:1111111111111111111111\n 2. artist    Some Artist\n    spotify:artist:4444444444444444444444"
    )
    assert.strictEqual(searchText([]), "No results")
  })
})
