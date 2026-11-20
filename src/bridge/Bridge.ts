import { Context, type Effect } from "effect"
import type { BridgeError, InternalApiChanged } from "../domain/errors.ts"

// Calls one method on one of Spotify's internal APIs, e.g.
// call("PlayerAPI", "getState"). What comes back is whatever Spotify
// returns, so callers must decode it.
export class Bridge extends Context.Service<Bridge, {
  readonly call: (api: string, method: string) => Effect.Effect<unknown, BridgeError | InternalApiChanged>
}>()("spotr/Bridge") {}
