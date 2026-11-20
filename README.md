# spotr

Control the Spotify desktop app on macOS from your terminal.

```
$ spotr status
▶ Song Name · Artist
  1:23 / 3:45 · shuffle off · repeat all · ♥ liked
```

spotr drives the app you already have open, so it works without a Spotify developer account or Web API keys. It connects to Spotify over the Chrome DevTools Protocol and calls the same internal functions Spotify's own buttons use.

These internals aren't a public API. A Spotify update can rename or reshape them. When that happens, spotr says so and exits with code 4, and `spotr doctor` shows which part moved.

## Install

You need Node 24 or later, and the Spotify desktop app.

```bash
cd cli
npm ci
npm link
```

`npm link` puts a `spotr` command on your PATH. It points at this folder, so keep the checkout where it is.

## Start Spotify with its DevTools port

Spotify only accepts spotr's connection when it starts with a DevTools port open. Quit Spotify, then run:

```bash
spotr launch
```

That starts Spotify with `--remote-debugging-port=9222`. If Spotify is already running without the port, `launch` tells you to quit it first. Run `spotr doctor` to check the whole setup.

While the port is open, other programs on this computer can control Spotify too. Quit and reopen Spotify normally to close it.

## Commands

| Command | What it does |
| --- | --- |
| `spotr status` | Show the track, position, shuffle, repeat and liked state |
| `spotr play [uri]` | Play a track, album, playlist or artist. No argument resumes |
| `spotr pause` / `spotr resume` | Pause or resume |
| `spotr next` / `spotr previous` | Skip forward or back. `previous` restarts the track when it's a few seconds in |
| `spotr seek <pos>` | `1:30` or `90` jumps there, `+10` or `-10` moves by seconds |
| `spotr shuffle [on\|off]` | Show or set shuffle |
| `spotr repeat [off\|all\|one]` | Show or set repeat |
| `spotr volume [0-100]` | Show or set the volume |
| `spotr queue` | Show the current track, your queue and what's next |
| `spotr queue add <uri>` | Add a track to the end of your queue |
| `spotr queue remove <uri>` | Remove a track you queued |
| `spotr queue clear` | Remove everything you queued |
| `spotr like [uri]` / `spotr unlike [uri]` | Add or remove a track in Liked Songs. Defaults to the playing track |
| `spotr playlist ls` | List your playlists |
| `spotr playlist add <name\|uri> [uri]` | Add a track to a playlist. Defaults to the playing track |
| `spotr playlist create <name> [--private]` | Create a playlist. `--private` keeps it off your public profile |
| `spotr playlist delete <name\|uri> --yes` | Delete a playlist. Without `--yes` it refuses |
| `spotr devices` | List Spotify Connect devices |
| `spotr devices use <name\|id>` | Move playback to another device |
| `spotr watch` | Print a line whenever the track or play state changes. Ctrl+C stops |
| `spotr launch` | Start Spotify with its DevTools port open |
| `spotr doctor` | Check that spotr can reach and drive Spotify |

A deleted playlist can be recovered for a while at spotify.com/account/recover-playlists.

Wherever a command takes a URI, you can also paste an `open.spotify.com` link.

Every command accepts `--json` for machine-readable output, and `--port` (or `SPOTR_PORT`) for a DevTools port other than 9222. `watch --json` prints one JSON object per line.

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

The code layout and conventions are in [AGENTS.md](AGENTS.md). `npm run check` runs the typecheck, lint and tests, and must pass before a commit.
