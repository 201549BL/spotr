import { assert, describe, it } from "@effect/vitest"
import { type Duration, Effect, Fiber, Layer, Predicate, Ref, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { Bridge } from "../src/bridge/Bridge.ts"
import { FakeBridge, sampleQueue } from "../src/bridge/FakeBridge.ts"
import { ClientNotRunning, InternalApiChanged } from "../src/domain/errors.ts"
import { Port } from "../src/settings.ts"
import { Launcher } from "../src/spotify/Launcher.ts"
import { Spotify } from "../src/spotify/Spotify.ts"

const withTime = <A, E>(self: Effect.Effect<A, E>, time: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(self)

    yield* TestClock.adjust(time)

    return yield* Fiber.join(fiber)
  })

describe("watch", () => {
  it.effect("emits the status, then one line per change of track or play state", () =>
    Effect.gen(function* () {
      const spotify = yield* Spotify
      const fiber = yield* Effect.forkChild(Stream.runCollect(spotify.watch.pipe(Stream.take(3))))

      yield* TestClock.adjust("1 second")
      yield* spotify.pause
      yield* TestClock.adjust("2 seconds")
      yield* spotify.next
      yield* TestClock.adjust("1 second")

      const seen = yield* Fiber.join(fiber)

      assert.deepStrictEqual(
        seen.map(({ track, paused }) => `${track?.name} ${paused ? "paused" : "playing"}`),
        ["First Song playing", "First Song paused", "Second Song paused"]
      )
    }).pipe(Effect.provide(Spotify.layer.pipe(Layer.provide(FakeBridge(sampleQueue, 0))))))
})

// A Bridge where `fail` decides how each inspected API answers.
const inspectingBridge = (fail: (api: string) => Effect.Effect<ReadonlyArray<string>, ClientNotRunning | InternalApiChanged>) =>
  Layer.succeed(Bridge, {
    call: () => Effect.die("doctor never calls methods"),
    inspect: (api) => fail(api)
  })

const doctorWith = (bridge: Layer.Layer<Bridge>) =>
  Spotify.use((spotify) => spotify.doctor).pipe(
    Effect.map((checks) => checks.map(({ name, status }) => `${status} ${name}`)),
    Effect.provide(Spotify.layer.pipe(Layer.provide(bridge)))
  )

describe("doctor", () => {
  it.effect("passes every check when Spotify has every method spotr uses", () =>
    Effect.gen(function* () {
      const checks = yield* doctorWith(FakeBridge(sampleQueue, 0))

      assert.deepStrictEqual(checks, [
        "pass Spotify answers on the DevTools port",
        "pass Spotify's window is open",
        "pass spotr's agent reaches Spotify's internals",
        "pass PlayerAPI has the 13 methods spotr uses",
        "pass PlaybackAPI has the 2 methods spotr uses",
        "pass LibraryAPI has the 3 methods spotr uses",
        "pass RootlistAPI has the method spotr uses",
        "pass PlaylistAPI has the method spotr uses",
        "pass ConnectDevicesAPI has the method spotr uses",
        "pass ConnectTransferAPI has the method spotr uses"
      ])
    }))

  it.effect("fails the first broken step and skips the rest", () =>
    Effect.gen(function* () {
      const noPort = yield* doctorWith(inspectingBridge(() => Effect.fail(new ClientNotRunning({ port: 9222, reason: "port" }))))
      const noPage = yield* doctorWith(inspectingBridge(() => Effect.fail(new ClientNotRunning({ port: 9222, reason: "page" }))))

      const notReady = yield* doctorWith(
        inspectingBridge(() => Effect.fail(new InternalApiChanged({ operation: "x", issue: "NotReady: no registry" })))
      )

      assert.deepStrictEqual(noPort.slice(0, 3), [
        "fail Spotify answers on the DevTools port",
        "skipped Spotify's window is open",
        "skipped spotr's agent reaches Spotify's internals"
      ])
      assert.deepStrictEqual(noPage.slice(0, 3), [
        "pass Spotify answers on the DevTools port",
        "fail Spotify's window is open",
        "skipped spotr's agent reaches Spotify's internals"
      ])
      assert.deepStrictEqual(notReady.slice(2, 4), [
        "fail spotr's agent reaches Spotify's internals",
        "skipped PlayerAPI has the 13 methods spotr uses"
      ])
    }))

  it.effect("names the API that lost a method or went missing", () =>
    Effect.gen(function* () {
      const checks = yield* Spotify.use((spotify) => spotify.doctor).pipe(
        Effect.provide(Spotify.layer.pipe(Layer.provide(inspectingBridge((api) => {
          if (api === "LibraryAPI") return Effect.succeed(["contains"])

          if (api === "PlaylistAPI") return Effect.fail(new InternalApiChanged({ operation: api, issue: "ApiMissing: No internal API named PlaylistAPI" }))

          return Effect.succeed([])
        }))))
      )

      assert.deepStrictEqual(
        checks.flatMap(({ name, status, detail }) => status === "fail" ? [`${name}: ${detail}`] : []),
        [
          "LibraryAPI has the 3 methods spotr uses: lacks contains",
          "PlaylistAPI has the method spotr uses: ApiMissing: No internal API named PlaylistAPI"
        ]
      )
    }))
})

// A spawner that records each command and answers with `codes`.
const recordingSpawner = (ran: Ref.Ref<ReadonlyArray<string>>, codes: (command: string) => number) =>
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
    ...ChildProcessSpawner.make(() => Effect.die("launch only uses exitCode")),
    exitCode: (command) =>
      Predicate.isTagged(command, "StandardCommand")
        ? Ref.update(ran, (all) => [...all, [command.command, ...command.args.map(String)].join(" ")]).pipe(
          Effect.as(ChildProcessSpawner.ExitCode(codes(command.command)))
        )
        : Effect.die("launch never pipes commands")
  })

// Spotify answers only once `open` has run.
const startsAfterOpen = (ran: Ref.Ref<ReadonlyArray<string>>) =>
  Layer.effect(
    Bridge,
    Effect.gen(function* () {
      const inner = yield* Bridge
      const opened = Ref.get(ran).pipe(Effect.map((all) => all.some((line) => line.startsWith("open "))))

      return {
        call: (api, method, ...args) =>
          opened.pipe(
            Effect.flatMap((up) => up ? inner.call(api, method, ...args) : Effect.fail(new ClientNotRunning({ port: 9222, reason: "port" })))
          ),
        inspect: inner.inspect
      }
    })
  ).pipe(Layer.provide(FakeBridge(sampleQueue, 0)))

const launchWith = (ran: Ref.Ref<ReadonlyArray<string>>, bridge: Layer.Layer<Bridge>, codes: (command: string) => number) =>
  Launcher.use((launcher) => launcher.launch).pipe(
    Effect.provide(
      Launcher.layer.pipe(
        Layer.provide(Spotify.layer.pipe(Layer.provide(bridge))),
        Layer.provide(recordingSpawner(ran, codes)),
        Layer.provide(Layer.succeed(Port, 9222))
      )
    )
  )

describe("launch", () => {
  it.effect("does nothing when Spotify already answers", () =>
    Effect.gen(function* () {
      const ran = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* launchWith(ran, FakeBridge(sampleQueue, 0), () => 0)

      assert.deepStrictEqual({ started: result.started, ran: yield* Ref.get(ran) }, { started: false, ran: [] })
    }))

  it.effect("starts Spotify with the DevTools port and waits until it answers", () =>
    Effect.gen(function* () {
      const ran = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* launchWith(ran, startsAfterOpen(ran), (command) => command === "pgrep" ? 1 : 0)

      assert.deepStrictEqual(
        { started: result.started, ran: yield* Ref.get(ran) },
        { started: true, ran: ["pgrep -x Spotify", "open -a Spotify --args --remote-debugging-port=9222"] }
      )
    }))

  it.effect("refuses when Spotify runs without the port, or won't open", () =>
    Effect.gen(function* () {
      const ran = yield* Ref.make<ReadonlyArray<string>>([])

      const notRunning = Layer.succeed(Bridge, {
        call: () => Effect.fail(new ClientNotRunning({ port: 9222, reason: "port" })),
        inspect: () => Effect.die("unused")
      })

      const running = yield* Effect.flip(launchWith(ran, notRunning, () => 0))
      const broken = yield* Effect.flip(launchWith(ran, notRunning, (command) => command === "pgrep" ? 1 : 1))
      const silent = yield* Effect.flip(withTime(launchWith(ran, notRunning, (command) => command === "pgrep" ? 1 : 0), "30 seconds"))

      assert.deepStrictEqual([running._tag, broken._tag, silent._tag], [
        "SpotifyWithoutDebugPort",
        "LaunchFailed",
        "ClientNotRunning"
      ])
    }))
})
