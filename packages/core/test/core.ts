import { Layer } from "effect"
import { Client, fakeOn } from "../src/api/Client.ts"
import type { Bridge } from "../src/locator/Bridge.ts"

// A Client calling the operations on `bridge`.
export const core = <E, R>(bridge: Layer.Layer<Bridge, E, R>) => Client.layer.pipe(Layer.provide(fakeOn(bridge)))
