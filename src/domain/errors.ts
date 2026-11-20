import { Runtime, Schema } from "effect"

export class ClientNotRunning extends Schema.TaggedError<
  ClientNotRunning,
  { readonly brand: unique symbol }
>()("ClientNotRunning", {
  port: Schema.Int,
  // "port": nothing answers on the DevTools port. "page": something
  // answers, but Spotify's main window isn't among its pages.
  reason: Schema.Literals(["port", "page"])
}) {
  readonly [Runtime.errorExitCode] = 3
  readonly [Runtime.errorReported] = false

  get message() {
    return this.reason === "port"
      ? `Spotify isn't reachable on port ${this.port}`
      : `Spotify's window wasn't found on port ${this.port}`
  }

  get hint() {
    return this.reason === "port"
      ? `Run spotr launch, or start Spotify with --remote-debugging-port=${this.port}.`
      : "Spotify may still be starting. Wait a moment and try again."
  }

  get detail() {
    return this.reason === "port"
      ? `Nothing answered on http://127.0.0.1:${this.port}/json/list`
      : `http://127.0.0.1:${this.port}/json/list has no page with "xpui" in its URL`
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

export class SpotifyWithoutDebugPort extends Schema.TaggedError<
  SpotifyWithoutDebugPort,
  { readonly brand: unique symbol }
>()("SpotifyWithoutDebugPort", {
  port: Schema.Int
}) {
  readonly [Runtime.errorExitCode] = 3
  readonly [Runtime.errorReported] = false

  get message() {
    return "Spotify is running, but without the DevTools port"
  }

  get hint() {
    return "Quit Spotify, then run spotr launch again."
  }

  get detail() {
    return `Spotify only opens port ${this.port} when it starts with --remote-debugging-port=${this.port}`
  }
}

export class LaunchFailed extends Schema.TaggedError<
  LaunchFailed,
  { readonly brand: unique symbol }
>()("LaunchFailed", {
  issue: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 3
  readonly [Runtime.errorReported] = false

  get message() {
    return "spotr couldn't start Spotify"
  }

  get hint() {
    return "Check that Spotify is installed in /Applications."
  }

  get detail() {
    return this.issue
  }
}

// doctor already printed which checks failed, so this only sets the exit
// code.
export class ChecksFailed extends Schema.TaggedError<
  ChecksFailed,
  { readonly brand: unique symbol }
>()("ChecksFailed", {
  failed: Schema.Int
}) {
  readonly [Runtime.errorExitCode] = 6
  readonly [Runtime.errorReported] = false
}

// Spotify accepted the request but didn't do it. Several of its methods
// report failure this way instead of throwing.
export class SpotifyRefused extends Schema.TaggedError<
  SpotifyRefused,
  { readonly brand: unique symbol }
>()("SpotifyRefused", {
  action: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 7
  readonly [Runtime.errorReported] = false

  get message() {
    return `Spotify didn't ${this.action}`
  }

  get hint() {
    return "Check that Spotify is online and signed in, then try again."
  }

  get detail() {
    return "Spotify reported no error, but the change didn't happen"
  }
}

// Deleting needs an explicit --yes, so a typo can't remove a playlist.
export class NeedsConfirmation extends Schema.TaggedError<
  NeedsConfirmation,
  { readonly brand: unique symbol }
>()("NeedsConfirmation", {
  action: Schema.String
}) {
  readonly [Runtime.errorExitCode] = 2
  readonly [Runtime.errorReported] = false

  get message() {
    return `spotr won't ${this.action} without --yes`
  }

  get hint() {
    return "Run the command again with --yes if you're sure."
  }

  get detail() {
    return "Deleted playlists can only be recovered at spotify.com/account/recover-playlists"
  }
}

export type SpotifyError =
  | BridgeError
  | InternalApiChanged
  | NotFound
  | SpotifyWithoutDebugPort
  | LaunchFailed
  | SpotifyRefused
  | NeedsConfirmation
