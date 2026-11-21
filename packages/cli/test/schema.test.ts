import { assert, describe, it } from "@effect/vitest"
import { openRpc } from "../src/server.ts"

describe("spotr schema", () => {
  it("documents every operation", () => {
    assert.deepStrictEqual(openRpc.methods.map((method) => method.name), [
      "status",
      "play",
      "pause",
      "resume",
      "toggle",
      "next",
      "previous",
      "seek",
      "setShuffle",
      "setRepeat",
      "queue",
      "addToQueue",
      "removeFromQueue",
      "clearQueue",
      "like",
      "unlike",
      "playlists",
      "addToPlaylist",
      "createPlaylist",
      "deletePlaylist",
      "devices",
      "useDevice",
      "volume",
      "setVolume",
      "mute",
      "unmute",
      "search",
      "watch",
      "doctor",
      "launch"
    ])
  })

  it("takes the description and params from the table", () => {
    const seek = openRpc.methods.find((method) => method.name === "seek")

    assert.deepStrictEqual(
      [seek?.description, seek?.params.map(({ name, required }) => ({ name, required }))],
      ["Jump to a position in the track", [{ name: "relative", required: true }, { name: "ms", required: true }]]
    )
  })
})
