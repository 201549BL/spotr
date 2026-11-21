import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { McpTest } from "effect/ai"
import { protocols, registrations } from "../src/mcp.ts"
import { fake } from "@spotrc/core"

const connect = McpTest.makeClient(registrations.pipe(Layer.provide(fake)), { protocols })

describe("spotrc mcp", () => {
  it.effect("lists a tool for every operation except the watch stream", () =>
    Effect.gen(function* () {
      const client = yield* connect
      const { tools } = yield* client.listTools()

      assert.deepStrictEqual(tools.map((tool) => tool.name), [
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
        "doctor",
        "launch"
      ])
    }))

  it.effect("describes each tool and its parameters from the table", () =>
    Effect.gen(function* () {
      const client = yield* connect
      const { tools } = yield* client.listTools()
      const status = tools.find((tool) => tool.name === "status")
      const search = tools.find((tool) => tool.name === "search")

      assert.deepStrictEqual(
        [status?.description, status?.inputSchema],
        ["Show what's playing", { type: "object", additionalProperties: false }]
      )
      assert.deepStrictEqual([search?.description, search?.inputSchema], [
        "Search Spotify, best match first",
        {
          type: "object",
          properties: {
            text: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 30 }
          },
          required: ["text"],
          additionalProperties: true
        }
      ])
    }))

  it.effect("calls a tool, with defaults for missing parameters", () =>
    Effect.gen(function* () {
      const client = yield* connect
      const result = yield* client.callTool({ name: "search", arguments: { text: "first" } })

      // MCP's structured content must be an object, so a list comes back as text.
      assert.deepStrictEqual([result.isError, result.content], [false, [{
        type: "text",
        text: "[{\"kind\":\"track\",\"uri\":\"spotify:track:1111111111111111111111\",\"name\":\"First Song\",\"by\":\"Some Artist\"}," +
          "{\"kind\":\"playlist\",\"uri\":\"spotify:playlist:7777777777777777777777\",\"name\":\"Popular Right Now\",\"by\":\"Spotify\"}]"
      }]])
    }))

  it.effect("returns errors as the tool's result", () =>
    Effect.gen(function* () {
      const client = yield* connect
      const result = yield* client.callTool({ name: "useDevice", arguments: { device: "Nowhere" } })

      assert.deepStrictEqual([result.isError, result.content], [
        true,
        [{
          type: "text",
          text: "{\"_tag\":\"NotFound\",\"what\":\"Device \\\"Nowhere\\\"\"," +
            "\"hint\":\"Run spotrc devices to see the devices Spotify can play on.\"," +
            "\"message\":\"Device \\\"Nowhere\\\" wasn't found\"," +
            "\"detail\":\"spotrc looked it up in Spotify and got no match\"}"
        }]
      ])
    }))
})
