#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { spotrc } from "./cli.ts"

const program = Command.run(spotrc, { version: "0.1.0" })

program.pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
