import { Layer } from "effect"
import { Client } from "../src/api/Client.ts"
import { fakeOn } from "../src/testing.ts"
import type { Bridge } from "../src/locator/Bridge.ts"

// A Client calling the operations on `bridge`.
export const core = <E, R>(bridge: Layer.Layer<Bridge, E, R>) => Client.layer.pipe(Layer.provide(fakeOn(bridge)))
