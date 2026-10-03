# Security review notes

Scope: TB Config Studio 0.1.0 (local server and window, core library, installer). Review done by reading the code and by the tests listed here.

## Assets and threats

The app reads and writes the config files of game server mods on the owner's PC. Those files can hold secrets (Discord webhook addresses, API tokens,
Steam ids of admins). The threats considered: another program or web page on the same PC talking to the local server, a hostile or damaged config
folder (links, huge or deeply nested files, odd names), a typed path that escapes the chosen folder, secrets leaking into the window, logs, diffs, packs
or screenshots, a destructive or half-finished write, and the installer doing more than it says.

## Network

- The app code makes no outgoing connection and has no telemetry. A test scans the source for network modules (`https`, `net`, `dgram`, `tls`, `dns`),
  `fetch`, `XMLHttpRequest` and `WebSocket`, and for external addresses in the window files. Only the local server uses `node:http`, to answer its own window.
- The server binds `127.0.0.1` only (an ephemeral port, or the port given on the command line).
- Documentation addresses in the schemas are shown as text; the app never opens them.

## Local server hardening (`src/server/server.js`)

- Session token: 24 random bytes per run. The window is opened with a one-time link; the server answers it with a `HttpOnly; SameSite=Strict` cookie and
  a redirect. Every API call needs the cookie.
- `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). Every POST needs the custom header `x-tbs: 1` and, when an `Origin`
  is sent, a local one (cross-site requests). Bodies are limited to 12 MiB, must be JSON objects.
- Content-Security-Policy `default-src 'self'` (no remote scripts, no framing), `nosniff`, `no-referrer`, `no-store`.
- Static files are served from the UI folder only; `..`, backslashes, encoded traversal and NUL are refused (tested).
- Errors never contain absolute paths; unexpected errors are logged to `app.log` in the data folder and the window gets a generic message.
- Residual risk: the one-time token is on the command line of the browser process, readable by other processes of the same Windows user. Another
  program running as the same user can already read and write the owner's files, so this does not widen access. The window and the host exit when the
  window is closed (heartbeat plus browser exit), so the port is not left open.
- Single instance per user: a second start opens another window on the first host (control.json holds port, token and PID in the user's data folder).

## Files and paths

- Typed folders must be local absolute paths: no UNC or device paths (`\\server`, `\\?\`, `\\.\`), no `..` in any spelling (also percent-encoded), no
  colon after the drive letter (data streams), no control characters or characters Windows forbids; at most 520 characters.
- Inside the chosen `TBMods\Config` folder, every relative path goes through the path checks inherited from the DayzHUB Manager file manager: no `..`,
  drive letters, UNC, streams, device names, 8.3 short names, trailing dots or spaces, look-alike and direction-changing characters; the resolved
  real path must stay inside the folder and equal the name asked for.
- Links and junctions are never followed while scanning; a link is listed as skipped and cannot be read or written (tested with a real junction and
  a file link that point outside).
- Only `.json` files of a mod folder are handled. Backups (`.bak*`, `.dayzhub-backup`), licence files and keys (`*licen[cs]e*`, `.bikey`, `.bisign`, ...)
  and per-player files (names with a Steam id) are not listed, read or returned (tested with a sentinel in a licence file).
- Limits: files above 8 MiB are not opened for editing, above 16 MiB not opened at all (still listed); scans stop at 30,000 files and 8 levels; JSON
  nesting above 120 levels is refused with a message instead of exhausting the stack; a list of changes is limited to 20,000 operations and 40 path
  levels; compare and search cap their output.
- JSON keys named `__proto__`, `constructor` and `prototype` are plain data: values are built with `defineProperty`, an operation on `__proto__` is
  refused, and a test checks `Object.prototype` stays clean.
- Writes: validate, build the new text, parse it again and compare with the intended value (otherwise nothing is written), copy the current file to the
  backup folder, write a temp file in the same folder, flush it, rename over the target. A conflict check (SHA-256 of what the window opened) and a
  "server seems to be running" check ask for confirmation. A failed write removes its temp file. Pack imports and restores use the same path.
- Backup and restore ids must match `YYYYMMDDTHHMMSSmmmZ[-n]`; backup folders are derived from the checked relative path.

## Secrets

- Values are hidden in the window by field name (`webhook`, `token`, `secret`, `password`, `api key`, `licence`, `steam id`, ...) and by form (Discord and
  Slack webhook addresses, 17-digit Steam ids). Steam ids used as names show only their last four digits (`...4856`).
- Hidden values are replaced by a marker. The window can type a new value but cannot read the old one; sending the marker back changes nothing and a
  marker inside a larger value is rejected. Files that hold secrets cannot be edited as raw text.
- Diffs, compare results, search results and search indexes use masked values; the app keeps no log of values (`app.log` holds file names,
  backup ids and errors only).
- Schemas and presets contain no defaults for secret fields; a test scans `schemas`, `presets` and the fixtures for webhook addresses, tokens and Steam ids.
- Pack export removes secret values and Steam id entries by default. The licence helper never opens a licence file, shows only whether it exists, and shows
  the IP mode file only when it holds a plain mode word.
- The window profile of the browser lives in the app's own data folder (`window-profile`), not in the user's normal browser profile.

## Installer and uninstaller

- Per user, no administrator rights: `requestedExecutionLevel asInvoker` in an embedded manifest (without it, Windows installer detection could
  prompt for elevation because of the file name). Writes only to the chosen folder (not a drive root, UNC path, Windows or Program Files), the user's
  Start menu and Desktop, and `HKCU\...\Uninstall`.
- The package is checked against `manifest.json` (SHA-256 of every file) after extraction; an entry that would extract outside the folder aborts. The
  executables are not code-signed, so SmartScreen may warn. There is no auto-update and no download.
- An existing installation is replaced only when its `manifest.json` is there; a non-empty foreign folder is refused. Before replacing or removing, the
  installer stops only the host process named in the app's own `control.json` and only when that process runs from the install folder. It never kills
  by name.
- The uninstaller removes the files listed in the manifest, the shortcuts and the registry key; files the user added stay; settings and backups are kept
  unless the user asks to delete them.
- `/TESTID` gives tests their own registry key and shortcut names so a test never touches a real installation. `/DRYRUN` prints the plan and changes nothing.

## Known limits

- The app cannot know whether a value is right for a given server, only whether it fits the descriptions (type, range, kind). Descriptions come from real
  files and public documentation read in summarised form; they were not tested in game.
- The "server seems to be running" check is a heuristic (a log file in the profile changed in the last two minutes).
- The app does not stop a mod from rewriting its files when the server shuts down, which can undo an edit made while the server runs.
- Backups are stored unencrypted next to the app data and may hold secrets that the config files held; they are readable by the Windows user only through
  normal folder permissions.
