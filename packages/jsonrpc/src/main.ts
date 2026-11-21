#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { DevToolsPort, live } from "@spotrc/core"
import { Console, Effect, Layer } from "effect"
import { Command, Flag } from "effect/cli"
import { openRpc, serve } from "./server.ts"

const command = Command.make(
  "spotrc-jsonrpc",
  {
    schema: Flag.Boolean("schema").pipe(
      Flag.withDescription("Print the OpenRPC document instead of serving"),
      Flag.withDefault(false)
    )
  },
  ({ schema }) =>
    schema
      ? Console.log(JSON.stringify(openRpc, null, 2))
      : serve.pipe(Effect.provide(live.pipe(Layer.provideMerge(DevToolsPort.layer))))
).pipe(Command.withDescription("Serve every spotrc operation as JSON-RPC 2.0 on stdin and stdout, one message per line"))

Command.run(command, { version: "0.1.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
