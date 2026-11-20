import { Runtime, Schema } from "effect"

export class ClientNotRunning extends Schema.TaggedError<
  ClientNotRunning,
  { readonly brand: unique symbol }
>()("ClientNotRunning", {
  port: Schema.Int
}) {
  readonly [Runtime.errorExitCode] = 3
  readonly [Runtime.errorReported] = false

  get message() {
    return `Spotify isn't reachable on port ${this.port}`
  }

  readonly hint = "Start Spotify with --remote-debugging-port=9222, or pass --port."

  get detail() {
    return `Nothing answered on http://127.0.0.1:${this.port}/json/list`
  }
}

export class BridgeTimeout extends Schema.TaggedError<
  BridgeTimeout,
  { readonly brand: unique symbol }
>()("BridgeTimeout", {
  operation: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 3
  readonly [Runtime.errorReported] = false

  get message() {
    return `Spotify didn't answer ${this.operation} in time`
  }

  readonly hint = "Spotify may be frozen or still starting. Try again in a moment."

  get detail() {
    return "No reply within 5 seconds"
  }
}

export type BridgeError = ClientNotRunning | BridgeTimeout

export class InternalApiChanged extends Schema.TaggedError<
  InternalApiChanged,
  { readonly brand: unique symbol }
>()("InternalApiChanged", {
  operation: Schema.String,
  issue: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 4
  readonly [Runtime.errorReported] = false

  get message() {
    return `Spotify returned something unexpected for ${this.operation}`
  }

  readonly hint = "Spotify has probably updated, and spotr needs a fix."

  get detail() {
    return this.issue
  }
}


export class NotFound extends Schema.TaggedError<
  NotFound,
  { readonly brand: unique symbol }
>()("NotFound", {
  what: Schema.String,
  hint: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 5
  readonly [Runtime.errorReported] = false

  get message() {
    return `${this.what} wasn't found`
  }

  get detail() {
    return "spotr looked it up in Spotify and got no match"
  }
}

export type SpotifyError = BridgeError | InternalApiChanged | NotFound
