import { Context, type Effect, type Schema } from "effect"
import type { BridgeError, InternalApiChanged } from "../domain/errors.ts"

// Calls one method on one of Spotify's internal APIs, e.g.
// call("PlaybackAPI", "setVolume", 0.5). Arguments must be JSON, because
// they travel to Spotify as text. What comes back is whatever Spotify
// returns, so callers must decode it.
export class Bridge extends Context.Service<Bridge, {
  readonly call: (
    api: string,
    method: string,
    ...args: ReadonlyArray<Schema.Json>
  ) => Effect.Effect<unknown, BridgeError | InternalApiChanged>
}>()("spotr/Bridge") {}
