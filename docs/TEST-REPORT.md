# Test report, version 0.1.0

All test data lives under `X:\dhm-test\tbstudio`. The owner's real TB configs were only read (copied with robocopy), never changed. No live server, CFTools
Architect, Steam, production host or Discord was touched. The only ports used were 2791 to 2798 on 127.0.0.1, and only processes started by the tests
were stopped (by PID).

## Unit and integration tests: `npm test`

64 tests, 64 passed (node:test, no packages).

| File | Tests | Covers |
|---|---|---|
| `roundtrip.test.js` | 7 | parse and re-apply is byte identical for every config of the committed fixtures and for all 1,593 files of the copied real TB profile (test server defaults) and the copy of the live server's configs; formatting survives edits (comments, BOM, CRLF, tabs, odd numbers); opening a file never changes it |
| `workspace.test.js` | 12 | overview and unknown folders, save changes one value and makes a backup holding the old bytes, atomic write leaves no temp file, conflict detection and overwrite, rollback (also of a deleted file), backup limit, running-server confirmation, validation (new problems block, old ones warn), raw text, unknown fields stay editable, add entry |
| `schema.test.js` | 9 | every schema valid, paid mods and Global present, no schema for free mods, no secrets or Steam ids in schemas, presets and fixtures, no tool names in the project, every field of the real sample files has a description, presets valid against schemas, user schema folder adds and overrides mods |
| `security.test.js` | 12 | hostile typed paths (UNC, device, `..`, streams, control characters, long), relative traversal in many spellings, a real junction and a file link that lead outside, huge files, JSON nested 100,000 deep, `__proto__` keys and operations, hostile operations, secret masking in values and text and in the view/diff/plan, licence files never listed or read |
| `features.test.js` | 14 | presets (plan, preview, apply, subset, invalid), compare (folders, defaults, masking), search, pack export and import, licence helper (cfg port, start script port, IP mode, presence only) |
| `server.test.js` | 7 | loopback binding and control file, cookie, Host, `x-tbs`, Origin checks, one-time link, security headers, static traversal, body limit, full open/view/plan/save/conflict/history/restore flow through the HTTP API, no network code in the app |
| `installer.test.js` | 3 | build script dry run (PLAN lines, writes nothing), setup `/DRYRUN` (plan, nothing written, no registry entry, bad folders refused, uninstall dry run), manifest `asInvoker`, per-user only, never kills by name |

## UI QA: `node scripts/ui-qa.js`

33 checks, 33 passed, in a headless Edge at the app window size (1360 x 880) and at 420 x 860: first-run page, refused network path, overview with 14 mod
folders, every field of a file explained, editing, review dialog with diff, saving (one line changed, backup made), search, compare with defaults,
presets with diff and apply, licence helper, backups list and restore (byte-identical), pack export, coverage page, guide, no horizontal scroll, menu
on the narrow layout, no console errors. Screenshots are in `docs/screenshots` (taken from the real app on the masked copy).

## Real run: `node scripts/real-run.js`

40 checks, 40 passed, on this PC, from the built `TBConfigStudio-Setup.exe`:

- silent per-user install into a test folder (own registry key and shortcut names through `/TESTID`), no administrator prompt; 58 files, all matching the
  manifest hashes; HKCU uninstall entry, Start menu and Desktop shortcuts created; nothing under Program Files or ProgramData;
- the installed launcher starts the bundled `runtime\node.exe` host on the chosen port;
- opened a copy of real TB configs; edited and saved a value in six mods (Vehicle Lock System, Real Estate, Second Hand Market, Death Insurance, Carry,
  War Party): each file changed in exactly one line, files that were not edited stayed byte identical, no temp files, one backup per file holding the
  original bytes;
- a write by something else after opening was detected (409); rollback restored the original file byte for byte; a preset was previewed (nothing
  written) and applied with backups; the licence helper answered without licence content;
- the real app window (Edge in app mode, started by the exe) loaded the page and sent its heartbeat; closing the window ended the host process;
- silent uninstall removed the program folder, registry entry and shortcuts, kept settings and backups, and left the edited configs alone.

The portable folder was also started once: it kept its data in the `data` folder beside the exe and answered on its port.

## What was not verified

- No TB licence was available, so nothing was checked against a live licensed server and the licence helper only checks what is visible on disk.
- None of the described values were tested in game. Descriptions come from real config files written by TB mods and from the public documentation,
  which was read in summarised form; a few documentation statements disagree with the files (listed in the field help).
- The folder picker button (a Windows folder dialog started from the host) was not exercised: there was no interactive desktop in the test session. Typed
  paths and the recent list were tested.
- The mod release version cannot be read from the config files; the app shows the config format versions the mods wrote. Files of other TB mod versions
  than the ones the schemas were built from may carry fields the app shows as "not described".
- The executables are not code-signed, so Windows SmartScreen may warn.
