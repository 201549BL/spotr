import { Schema } from "effect"

// One line of spotrc doctor. `detail` says what to do about a failure.
export class Check extends Schema.Class<Check, { readonly brand: unique symbol }>("Check")({
  name: Schema.String,
  status: Schema.Literals(["pass", "fail", "skipped"]),
  detail: Schema.String
}) {}
