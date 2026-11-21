import { Context } from "effect"

// The port Spotify's DevTools endpoint listens on. Each interface fills
// it in, the CLI from its --port flag.
export class DevToolsPort extends Context.Service<DevToolsPort, number>()("spotr/DevToolsPort") {}
