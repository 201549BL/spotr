# spotrc

Control the Spotify desktop app on macOS from your terminal.

```
$ spotrc status
▶ Song Name · Artist
  1:23 / 3:45 · shuffle off · repeat all · ♥ liked
```

spotrc drives the app you already have open, so it works without a Spotify developer account or Web API keys. It connects to Spotify over the Chrome DevTools Protocol and calls the same internal functions Spotify's own buttons use.

These internals aren't a public API. A Spotify update can rename or reshape them. When that happens, spotrc says so and exits with code 4, and `spotrc doctor` shows which part moved.

## Install

You need Node 24 or later, and the Spotify desktop app.

```bash
git clone https://github.com/201549BL/spotr.git
cd spotr
npm ci
npm link
```

`npm link` puts the `spotrc`, `spotrc-jsonrpc` and `spotrc-mcp` commands on your PATH. It points at your clone, so keep it where it is.

### Standalone binary

`npm run build:bin` builds `dist/spotrc`, `dist/spotrc-jsonrpc` and `dist/spotrc-mcp`, each a single file with the Bun runtime inside, so they run without Node. Each is about 86 MB and starts in about 50 ms. Copy them anywhere on your PATH. Other programs can run `spotrc <command> --json` and parse the output.

## Start Spotify with its DevTools port

Spotify only accepts spotrc's connection when it starts with a DevTools port open. Quit Spotify, then run:

```bash
spotrc launch
```

That starts Spotify with `--remote-debugging-port=9222`. If Spotify is already running without the port, `launch` tells you to quit it first. Run `spotrc doctor` to check the whole setup.

While the port is open, other programs on this computer can control Spotify too. Quit and reopen Spotify normally to close it.

## Commands

| Command | What it does |
| --- | --- |
| `spotrc status` | Show the track, position, shuffle, repeat and liked state |
| `spotrc search <words> [--limit n]` | Search Spotify. Lists tracks, artists, albums, playlists, podcasts and more, best match first |
| `spotrc play [what]` | Play a URI, an open.spotify.com link, or the best match for some words (`spotrc play around the world daft punk`). `spotrc play liked` plays Liked Songs. No argument resumes |
| `spotrc pause` / `spotrc resume` | Pause or resume |
| `spotrc toggle` | Pause if playing, resume if paused |
| `spotrc next` / `spotrc previous` | Skip forward or back. `previous` restarts the track when it's a few seconds in |
| `spotrc seek <pos>` | `1:30` or `90` jumps there, `+10` or `-10` moves by seconds |
| `spotrc shuffle [on\|off]` | Show or set shuffle |
| `spotrc repeat [off\|all\|one]` | Show or set repeat |
| `spotrc volume [level]` | Show the volume. `40` sets it, `+10` or `-10` changes it |
| `spotrc mute` / `spotrc unmute` | Mute, or go back to the volume from before muting |
| `spotrc queue` | Show the current track, your queue and what's next |
| `spotrc queue add <uri>` | Add a track to the end of your queue |
| `spotrc queue remove <uri>` | Remove a track you queued |
| `spotrc queue clear` | Remove everything you queued |
| `spotrc like [uri]` / `spotrc unlike [uri]` | Add or remove a track in Liked Songs. Defaults to the playing track |
| `spotrc playlist ls` | List your playlists |
| `spotrc playlist add <name\|uri> [uri]` | Add a track to a playlist. Defaults to the playing track |
| `spotrc playlist create <name> [--private]` | Create a playlist. `--private` keeps it off your public profile |
| `spotrc playlist delete <name\|uri> --yes` | Delete a playlist. Without `--yes` it refuses |
| `spotrc devices` | List Spotify Connect devices |
| `spotrc devices use <name\|id>` | Move playback to another device |
| `spotrc watch` | Print a line whenever the track or play state changes. Ctrl+C stops |
| `spotrc launch` | Start Spotify with its DevTools port open |
| `spotrc doctor` | Check that spotrc can reach and drive Spotify |

A deleted playlist can be recovered for a while at spotify.com/account/recover-playlists.

`play` with words only plays a hit that shares a word with what you typed, since Spotify's search returns something even for gibberish. Use `spotrc search` to see every hit.

Wherever a command takes a URI, you can also paste an `open.spotify.com` link. Liked Songs (`spotify:collection:tracks`) and local files (`spotify:local:…`) work too.

Every command accepts `--json` for machine-readable output, and `--port` (or `SPOTRC_PORT`) for a DevTools port other than 9222. `watch --json` prints one JSON object per line.

## Other programs: JSON-RPC and MCP

Every command is an operation in one table, and two more executables offer that table to other programs. They read `SPOTRC_PORT` for a DevTools port other than 9222.

`spotrc-jsonrpc` speaks JSON-RPC 2.0 on stdin and stdout, one message per line, so any language with a line reader can drive Spotify. Method names are the operation names (`status`, `play`, `seek`, `setVolume`, `search` and so on), and params are by name. An operation without arguments accepts no params, `{}` or `[]`.

```
$ printf '{"jsonrpc":"2.0","id":1,"method":"seek","params":{"relative":true,"ms":10000}}\n' | spotrc-jsonrpc
{"jsonrpc":"2.0","id":1,"result":{"track":{…},"paused":false,"positionMs":93000,…}}
```

Payloads are structured: `seek` takes `{ relative, ms }` and `setVolume` takes `{ relative, amount }`, not the CLI's `+10`. `play` takes `{ what }`, which is a URI, a link, `liked`, or words to search for, and resumes when empty.

A failed call returns a JSON-RPC error. `code` is the error's exit code from the table below, `message` is spotrc's message, and `data` carries the error's `_tag`, its fields, `message`, `hint` and `detail`, the same text the CLI prints:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"Spotify isn't reachable on port 9222","data":{"_tag":"ClientNotRunning","port":9222,"reason":"port","message":"Spotify isn't reachable on port 9222","hint":"Launch Spotify through spotrc, or start it with --remote-debugging-port=9222.","detail":"Nothing answered on http://127.0.0.1:9222/json/list"}}}
```

A request spotrc can't run gets JSON-RPC's own codes: `-32700` for a line that isn't JSON, `-32600` for JSON that isn't a request, `-32601` for an unknown method, and `-32602` for params that don't fit the operation, with the problem in `message`.

Requests run concurrently and may answer out of order, so match answers by `id`. A request without an `id` runs and gets no answer.

`watch` streams. Each update is a notification named after the operation, carrying the request's id:

```json
{"jsonrpc":"2.0","method":"watch","params":{"id":7,"value":{"track":{…},"paused":false,…}}}
```

To stop it, send `{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":7}}`, the cancel message LSP, StreamJsonRpc and vscode-jsonrpc use. The call then answers with code `-32800`. Cancelling works on any running request. When stdin closes, spotrc cancels every stream, answers the calls still running, and exits.

`spotrc-jsonrpc --schema` prints the OpenRPC document instead of serving, for generating clients. `doctor` succeeds with its list of checks; a failed check is in the list, not an error.

`spotrc-mcp` is an MCP server on stdio with one tool per operation, except `watch`. Errors come back as the tool's result, with `isError` set. To use it from Claude Code:

```bash
claude mcp add spotrc -- spotrc-mcp
```

## Exit codes

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

The code layout and conventions are in [AGENTS.md](AGENTS.md). `npm run check` runs the typecheck, lint and tests, and must pass before a commit. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), and a commit hook checks them.

## License

[MIT](LICENSE)
