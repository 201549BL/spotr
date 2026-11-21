import { Schema } from "effect"

// A Spotify Connect device. `id` is "local_device" for this computer.
export class Device extends Schema.Class<Device, { readonly brand: unique symbol }>("Device")({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  active: Schema.Boolean,
  local: Schema.Boolean
}) {}
