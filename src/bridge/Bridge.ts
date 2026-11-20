import { Context, type Effect, type Schema } from "effect"
import type { BridgeError, InternalApiChanged } from "../domain/errors.ts"

// The seam to Spotify's internal APIs.
export class Bridge extends Context.Service<Bridge, {
  // Calls one method, e.g. call("PlaybackAPI", "setVolume", 0.5).
  // Arguments must be JSON, because they travel to Spotify as text.
  // What comes back is whatever Spotify returns, so callers must decode it.
  readonly call: (
    api: string,
    method: string,
    ...args: ReadonlyArray<Schema.Json>
  ) => Effect.Effect<unknown, BridgeError | InternalApiChanged>
  // Returns which of `methods` the API lacks, without calling any.
  readonly inspect: (
    api: string,
    methods: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<string>, BridgeError | InternalApiChanged>
}>()("spotr/Bridge") {}
