import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { Bridge } from "../src/bridge/Bridge.ts"
import { FakeBridge, sampleQueue } from "../src/bridge/FakeBridge.ts"
import type { Device } from "../src/domain/Device.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const fake = FakeBridge(sampleQueue, 0)

const TestSpotify = Layer.merge(Spotify.layer.pipe(Layer.provide(fake)), fake)

const active = (devices: ReadonlyArray<Device>) => devices.flatMap((device) => device.active ? [device.name] : [])

const transfers = Bridge.use((bridge) => bridge.call("Test", "transfers")).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Finite)),
  Effect.orDie
)

describe("devices", () => {
  it.effect("lists devices and marks the active one", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const devices = yield* spotify.devices

      assert.deepStrictEqual(
        devices.map(({ name, type, active: isActive, local }) => ({ name, type, isActive, local })),
        [
          { name: "This Mac", type: "computer", isActive: true, local: true },
          { name: "Kitchen", type: "speaker", isActive: false, local: false },
          { name: "Twin Speaker", type: "speaker", isActive: false, local: false },
          { name: "Twin Speaker", type: "speaker", isActive: false, local: false }
        ]
      )
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("moves playback to a device found by name, ignoring case", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(active(yield* spotify.useDevice("kitchen")), ["Kitchen"])
      assert.deepStrictEqual(active(yield* spotify.useDevice("local_device")), ["This Mac"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("does nothing when the device is already active", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify

      assert.deepStrictEqual(active(yield* spotify.useDevice("This Mac")), ["This Mac"])
      assert.strictEqual(yield* transfers, 0)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown and shared device names", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const missing = yield* Effect.flip(spotify.useDevice("Garage"))
      const twins = yield* Effect.flip(spotify.useDevice("twin speaker"))

      assert.deepStrictEqual([missing.message, twins.message], [
        "Device \"Garage\" wasn't found",
        "A single device named \"twin speaker\" wasn't found"
      ])
      assert.strictEqual(yield* transfers, 0)
    }).pipe(Effect.provide(TestSpotify)))
})
