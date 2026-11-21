import { Config, Context, Layer } from "effect"

export const defaultPort = 9222

// The port Spotify's DevTools endpoint listens on. `layer` reads
// SPOTRC_PORT, so every executable agrees; the CLI's --port overrides it.
export class DevToolsPort extends Context.Service<DevToolsPort, number>()("spotrc/DevToolsPort") {
  static readonly layer = Layer.effect(DevToolsPort, Config.Int("SPOTRC_PORT").pipe(Config.withDefault(defaultPort)))
}
