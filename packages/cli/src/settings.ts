import { Config } from "effect"
import { Flag, GlobalFlag } from "effect/cli"

export const Json = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDescription("Print machine-readable JSON"),
    Flag.withDefault(false)
  )
})

export const Port = GlobalFlag.Setting("port")({
  flag: Flag.Int("port").pipe(
    Flag.withDescription("Spotify's DevTools port"),
    Flag.withFallbackConfig(Config.Int("SPOTR_PORT")),
    Flag.withDefault(9222)
  )
})
