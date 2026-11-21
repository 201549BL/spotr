#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { DevToolsPort, live } from "@spotrc/core"
import { Effect, Layer } from "effect"
import { mcp } from "./mcp.ts"

Layer.launch(mcp).pipe(
  Effect.provide(live.pipe(Layer.provideMerge(DevToolsPort.layer), Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain
)
