import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { type RpcClient, RpcTest } from "effect/rpc"
import { ChildProcessSpawner } from "effect/process"
import { Socket } from "effect/socket"
import { CdpBridge } from "../locator/CdpBridge.ts"
import { FakeBridge, sampleQueue } from "../locator/FakeBridge.ts"
import { DevToolsPort } from "../transport/DevToolsPort.ts"
import { toPlayTarget } from "../model/Track.ts"
import { type Operation, Spotrc } from "./operations.ts"
import { Launcher } from "../transport/Launcher.ts"
import { Spotify } from "./Spotify.ts"

export const handlers = Spotrc.toLayer(Effect.gen(function* () {
  const spotify = yield* Spotify
  const launcher = yield* Launcher

  return Spotrc.of({
    status: () => spotify.status,
    play: ({ what }) => {
      const target = toPlayTarget(what)

      switch (target.kind) {
        case "resume":
          return spotify.resume
        case "uri":
          return spotify.play(target.uri)
        case "search":
          return spotify.playSearch(target.text)
      }
    },
    pause: () => spotify.pause,
    resume: () => spotify.resume,
    toggle: () => spotify.toggle,
    next: () => spotify.next,
    previous: () => spotify.previous,
    seek: (target) => spotify.seek(target),
    setShuffle: ({ on }) => spotify.setShuffle(on),
    setRepeat: ({ mode }) => spotify.setRepeat(mode),
    queue: () => spotify.queue,
    addToQueue: ({ uri }) => spotify.addToQueue(uri),
    removeFromQueue: ({ uri }) => spotify.removeFromQueue(uri),
    clearQueue: () => spotify.clearQueue,
    like: ({ uri }) => spotify.like(uri),
    unlike: ({ uri }) => spotify.unlike(uri),
    playlists: () => spotify.playlists,
    addToPlaylist: ({ playlist, uri }) => spotify.addToPlaylist(playlist, uri),
    createPlaylist: ({ name, isPrivate }) => spotify.createPlaylist(name, isPrivate),
    deletePlaylist: ({ playlist, yes }) => spotify.deletePlaylist(playlist, yes),
    devices: () => spotify.devices,
    useDevice: ({ device }) => spotify.useDevice(device),
    volume: () => spotify.volume,
    setVolume: (change) => spotify.setVolume(change),
    mute: () => spotify.mute,
    unmute: () => spotify.unmute,
    search: ({ text, limit }) => spotify.search(text, limit),
    watch: () => spotify.watch,
    doctor: () => spotify.doctor,
    launch: () => launcher.launch
  })
}))

// The handlers on the real Spotify, reached through the DevTools port.
export const live = handlers.pipe(
  Layer.provide(Launcher.layer),
  Layer.provide(Spotify.layer),
  Layer.provide(CdpBridge),
  Layer.provide([FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal])
)

// The handlers on FakeBridge, for testing an adapter without Spotify.
export const fake = handlers.pipe(
  Layer.provide(Launcher.layer),
  Layer.provide(Spotify.layer),
  Layer.provide(FakeBridge(sampleQueue, 0)),
  Layer.provide(Layer.succeed(DevToolsPort, 9222)),
  Layer.provide(Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("the fake core never launches Spotify"))
  ))
)

// Calls the operations in-process, through the same handlers the servers
// use. The CLI and the MCP server talk to the core through this.
export class Client extends Context.Service<Client, RpcClient.RpcClient<Operation>>()("spotrc/Client") {
  static readonly layer = Layer.effect(Client, RpcTest.makeClient(Spotrc))
}
