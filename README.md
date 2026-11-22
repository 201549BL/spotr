# spotrc

spotrc, short for **Spotify remote control**, controls the Spotify desktop app on macOS from your terminal.

```
$ spotrc status
▶ Song Name · Artist
  1:23 / 3:45 · shuffle off · repeat all · ♥ liked
```

It drives the app you already have open, so you don't need a Spotify developer account or Web API keys. spotrc connects to Spotify over the Chrome DevTools Protocol and calls the same internal functions Spotify's own buttons use.

The same operations are also available to other programs, as a JSON-RPC server and an MCP server.

> [!NOTE]
> Spotify's internals aren't a public API, and an update can rename or reshape them. When that happens, spotrc says so and exits with code 4, and `spotrc doctor` shows which part moved.

## Install

You need Node 24 or later and the Spotify desktop app.

```bash
git clone https://github.com/201549BL/spotrc.git
cd spotrc
npm ci
npm link
```

`npm link` puts `spotrc`, `spotrc-jsonrpc` and `spotrc-mcp` on your PATH. The links point at your clone, so keep it where it is.

### Standalone binaries

```bash
npm run build:bin
```

This builds `dist/spotrc`, `dist/spotrc-jsonrpc` and `dist/spotrc-mcp`. Each is a single file with the Bun runtime inside, so it runs without Node. They're about 86 MB each and start in about 50 ms. Copy them anywhere on your PATH.

## Setup

Spotify only accepts spotrc's connection when it was started with a DevTools port open. Quit Spotify, then run:

```bash
spotrc launch
```

This starts Spotify with `--remote-debugging-port=9222`. If Spotify is already running without the port, `launch` tells you to quit it first. `spotrc doctor` checks the whole setup.

While the port is open, any program on this computer can control Spotify. To close it, quit Spotify and open it normally.

## Commands

### Playback

| Command | What it does |
| --- | --- |
| `spotrc status` | Show the track, position, shuffle, repeat and liked state |
| `spotrc play [what]` | Play a URI, an `open.spotify.com` link, `liked` for Liked Songs, or the best match for some words. No argument resumes |
| `spotrc pause` / `resume` | Pause or resume |
| `spotrc toggle` | Pause if playing, resume if paused |
| `spotrc next` / `previous` | Skip forward or back. `previous` restarts the track when it's a few seconds in |
| `spotrc seek <pos>` | `1:30` or `90` jumps there, `+10` or `-10` moves by seconds |
| `spotrc shuffle [on\|off]` | Show or set shuffle |
| `spotrc repeat [off\|all\|one]` | Show or set repeat |
| `spotrc volume [level]` | Show the volume. `40` sets it, `+10` or `-10` changes it |
| `spotrc mute` / `unmute` | Mute, or go back to the volume from before muting |
| `spotrc watch` | Print a line whenever the track or play state changes. Ctrl+C stops |

### Search and queue

| Command | What it does |
| --- | --- |
| `spotrc search <words> [--limit n]` | Search tracks, artists, albums, playlists, podcasts and more, best match first |
| `spotrc queue` | Show the current track, your queue and what's next |
| `spotrc queue add <uri>` | Add a track to the end of your queue |
| `spotrc queue remove <uri>` | Remove a track you queued |
| `spotrc queue clear` | Remove everything you queued |

### Library and playlists

| Command | What it does |
| --- | --- |
| `spotrc like [uri]` / `unlike [uri]` | Add or remove a track in Liked Songs. Defaults to the playing track |
| `spotrc playlist ls` | List your playlists |
| `spotrc playlist add <name\|uri> [uri]` | Add a track to a playlist. Defaults to the playing track |
| `spotrc playlist create <name> [--private]` | Create a playlist. `--private` keeps it off your public profile |
| `spotrc playlist delete <name\|uri> --yes` | Delete a playlist. Refuses without `--yes` |

A deleted playlist can be recovered for a while at spotify.com/account/recover-playlists.

### Devices and setup

| Command | What it does |
| --- | --- |
| `spotrc devices` | List Spotify Connect devices |
| `spotrc devices use <name\|id>` | Move playback to another device |
| `spotrc launch` | Start Spotify with its DevTools port open |
| `spotrc doctor` | Check that spotrc can reach and drive Spotify |

### Good to know

- Wherever a command takes a URI, you can paste an `open.spotify.com` link instead. Liked Songs (`spotify:collection:tracks`) and local files (`spotify:local:…`) work too.
- `spotrc play around the world daft punk` plays the best search hit, but only one that shares a word with what you typed, since Spotify's search returns something even for gibberish. `spotrc search` shows every hit.
- Every command accepts `--json` for machine-readable output. `watch --json` prints one JSON object per line.
- `--port`, or the `SPOTRC_PORT` environment variable, picks a DevTools port other than 9222.

## Use from other programs

Every command is an operation in one table. Besides the CLI, two executables offer that table to other programs. Both read `SPOTRC_PORT` for a port other than 9222. For simple scripts, running `spotrc <command> --json` and parsing the output also works.

### JSON-RPC

`spotrc-jsonrpc` speaks JSON-RPC 2.0 on stdin and stdout, one message per line, so any language with a line reader can drive Spotify. `spotrc-jsonrpc --schema` prints the OpenRPC document instead of serving, for generating clients.

Method names are the operation names (`status`, `play`, `seek`, `setVolume`, `search` and so on), and params are by name. An operation without arguments accepts no params, `{}` or `[]`.

```
$ printf '{"jsonrpc":"2.0","id":1,"method":"seek","params":{"relative":true,"ms":10000}}\n' | spotrc-jsonrpc
{"jsonrpc":"2.0","id":1,"result":{"track":{…},"paused":false,"positionMs":93000,…}}
```

Payloads are structured values, not CLI strings: `seek` takes `{ relative, ms }` and `setVolume` takes `{ relative, amount }` rather than `+10`. `play` takes `{ what }`, which is a URI, a link, `liked`, or words to search for, and resumes when empty.

Requests run concurrently and may answer out of order, so match answers by `id`. A request without an `id` runs and gets no answer.

**Errors.** A failed call returns a JSON-RPC error. `code` is the error's [exit code](#exit-codes), `message` is spotrc's message, and `data` carries the error's `_tag`, its fields, and the same `message`, `hint` and `detail` the CLI prints:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"Spotify isn't reachable on port 9222","data":{"_tag":"ClientNotRunning","port":9222,"reason":"port","message":"Spotify isn't reachable on port 9222","hint":"Launch Spotify through spotrc, or start it with --remote-debugging-port=9222.","detail":"Nothing answered on http://127.0.0.1:9222/json/list"}}}
```

A request spotrc can't run gets JSON-RPC's own codes, with the problem in `message`:

| Code | Meaning |
| --- | --- |
| `-32700` | The line isn't JSON |
| `-32600` | The JSON isn't a request |
| `-32601` | Unknown method |
| `-32602` | The params don't fit the operation |
| `-32800` | The request was cancelled |

`doctor` succeeds with its list of checks. A failed check is in the list, not an error.

**Streaming.** `watch` streams. Each update is a notification named after the operation, carrying the request's id:

```json
{"jsonrpc":"2.0","method":"watch","params":{"id":7,"value":{"track":{…},"paused":false,…}}}
```

To stop it, send `{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":7}}`, the cancel message LSP, StreamJsonRpc and vscode-jsonrpc use. The call then answers with code `-32800`. Cancelling works on any running request. When stdin closes, spotrc cancels every stream, answers the calls still running, and exits.

### MCP

`spotrc-mcp` is an MCP server on stdio with one tool per operation, except `watch`. Errors come back as the tool's result, with `isError` set. To use it from Claude Code:

```bash
claude mcp add spotrc -- spotrc-mcp
```

## Exit codes

The CLI exits with these codes, and JSON-RPC errors use them as their `code`.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Bad arguments |
| 2 | A command needs `--yes` to go ahead |
| 3 | Spotify isn't reachable, or didn't answer in time |
| 4 | Spotify returned something unexpected. It has probably updated |
| 5 | A track, playlist or device wasn't found |
| 6 | `doctor` found a problem |
| 7 | Spotify accepted the request but didn't carry it out |
| 130 | Stopped with Ctrl+C |

## Development

[AGENTS.md](AGENTS.md) describes the code layout and conventions. `npm run check` runs the typecheck, lint and tests, and must pass before a commit. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), and a commit hook checks them.

## License

[MIT](LICENSE)
