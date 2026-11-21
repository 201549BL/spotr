import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { Bridge } from "../src/locator/Bridge.ts"
import { FakeBridge, sampleQueue } from "../src/locator/FakeBridge.ts"
import type { Device } from "../src/model/Device.ts"
import { Client } from "../src/api/Client.ts"
import { core } from "./core.ts"

const fake = FakeBridge(sampleQueue, 0)

const TestSpotify = Layer.merge(core(fake), fake)

const active = (devices: ReadonlyArray<Device>) => devices.flatMap((device) => device.active ? [device.name] : [])

const transfers = Bridge.use((bridge) => bridge.call("Test", "transfers")).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Finite)),
  Effect.orDie
)

describe("devices", () => {
  it.effect("lists devices and marks the active one", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const devices = yield* client.devices()

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
      const client = yield* Client

      assert.deepStrictEqual(active(yield* client.useDevice({ device: "kitchen" })), ["Kitchen"])
      assert.deepStrictEqual(active(yield* client.useDevice({ device: "local_device" })), ["This Mac"])
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("does nothing when the device is already active", () =>
    Effect.gen(function* () {
      const client = yield* Client

      assert.deepStrictEqual(active(yield* client.useDevice({ device: "This Mac" })), ["This Mac"])
      assert.strictEqual(yield* transfers, 0)
    }).pipe(Effect.provide(TestSpotify)))

  it.effect("refuses unknown and shared device names", () =>
    Effect.gen(function* () {
      const client = yield* Client
      const missing = yield* Effect.flip(client.useDevice({ device: "Garage" }))
      const twins = yield* Effect.flip(client.useDevice({ device: "twin speaker" }))

      assert.deepStrictEqual([missing.message, twins.message], [
        "Device \"Garage\" wasn't found",
        "A single device named \"twin speaker\" wasn't found"
      ])
      assert.strictEqual(yield* transfers, 0)
    }).pipe(Effect.provide(TestSpotify)))
})
