import { Schema } from "effect"

export class LaunchResult extends Schema.Class<LaunchResult, { readonly brand: unique symbol }>("LaunchResult")({
  started: Schema.Boolean,
  port: Schema.Int
}) {}
