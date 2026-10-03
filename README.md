# TB Config Studio

An unofficial, offline Windows desktop app that helps DayZ server owners configure the paid TheModBase (TB) mods and the shared TB library configs.
It explains every field of the TB config files in plain language, checks values, shows differences, applies suggested presets after showing you a diff,
and saves safely to the real files with a backup before every write.

Made by DayzHUB. Not made by, endorsed by or affiliated with TheModBase. It contains no TheModBase logo, artwork or copied text: the field
explanations are written from the real config files and paraphrased facts from the public documentation.

## What it does

- Open a server profile folder (folder picker, typed path, recent list). Finds `TBMods\Config`, lists which TB mods have configs there and the
  config format versions the mods wrote.
- Shows each mod's files with an explanation for every field: what it does, unit, typical values, range, default, what can go wrong, and how sure the
  description is (documented, observed or inferred). Fields the app does not know are always shown and editable.
- Validation with clear messages. A new problem blocks the save, a problem that was already in the file is only a warning.
- Search across all TB configs, compare two config folders or a folder against the TB defaults (field level diff).
- Presets per server type (PvE, PvP, hardcore, casual), labelled as suggestions, shown as a diff before applying.
- Licence helper: explains that licences are tied to the server's public IP and game port, reads the port from `serverDZ.cfg` or a start script, checks
  which licence files exist (never reads their content) and gives a checklist for the "Your Server is deactivated" message.
- Safe saving: backup before each write into a backups folder next to the app data, atomic write (temp file, flush, rename), conflict detection when the
  file changed after you opened it, a warning that TB reads its files only at server start, a rollback list with one-click restore.
- Config packs: export and import as a plain folder copy (secrets can be removed from the copy), with a preview before importing.
- English UI, strings in `src/ui/i18n/en.json` (ready for translations). Dark theme, works at narrow window sizes.
- New or updated mods are added by dropping a JSON description into a folder, no code change (see `docs/SCHEMA-FORMAT.md`).

The app makes no network calls and has no telemetry. It listens on 127.0.0.1 only, for its own window.

## Coverage

13 paid mods plus the shared Global (TBLib) configs. See `docs/USER-GUIDE.md` for the table and what "in depth" means here.

## Install

Run `TBConfigStudio-Setup.exe` (per-user install, no administrator rights, adds Start menu and Desktop shortcuts, has an uninstaller), or copy the
portable folder `TBConfigStudio` anywhere and start `TBConfigStudio.exe` (a `portable.txt` file keeps the data beside the program). The window is
Microsoft Edge or Google Chrome in app mode; one of them is on every current Windows.

## Build

Needs Windows PowerShell 5.1, the .NET Framework C# compiler (part of Windows) and Node.js 22 on the build PC. No packages.

```
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -DryRun   (prints the plan, writes nothing)
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1           (dist\installer and dist\portable)
```

## Run from source, test

```
node src/server/main.js          (opens the window)
npm test                         (node:test, no packages)
node scripts/ui-qa.js            (headless browser QA run, writes docs/screenshots)
node scripts/check-schemas.js    (validates the mod descriptions and shows coverage)
```

## Layout

```
src/core      lossless JSON round trip, path safety, schema, workspace (view, plan, save, rollback), search, compare, presets, packs, licence helper
src/server    local server (127.0.0.1), entry point, window launcher
src/ui        the window (plain HTML, CSS and JavaScript modules, i18n/en.json)
schemas       one JSON description per mod
presets       suggested changes per server type
cs, installer launcher exe, setup and uninstall programs (C# 5, built with csc.exe)
scripts       build script, icon generator, schema authoring helper, UI QA
test          unit and integration tests, small fixture profile
docs          user guide, schema format, security review, test report, screenshots
```

The unsigned executables may make Windows SmartScreen show a warning. Nothing in this repository is published or distributed.
