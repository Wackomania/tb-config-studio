# Schema format: how to add or update a mod description

The app knows a mod only through a JSON file. There is no mod-specific code. To describe a new mod, or to update the description after a mod update,
write or edit one file and reload (Mods and schemas, Reload descriptions) or restart the app.

New mods can be added this way at any time, including mods this app does not cover today (for example free mods of the same author). The built-in set
covers only the paid TheModBase mods and the shared Global configs.

## Where files go

| Folder | What it is |
|---|---|
| `schemas\` (in the program folder) | built-in descriptions, one file per mod |
| `%LOCALAPPDATA%\TBConfigStudio\schemas-user\` | your own descriptions. A file here replaces the built-in description of the same `mod.id`. In the portable build it is `data\schemas-user\` beside the program. |
| `presets\` | suggested changes per server type, one file per mod |

A file that cannot be used (invalid JSON, a problem in the rules below) is skipped and listed under Mods and schemas; it never stops the app.
A folder with no description is still shown: its values are visible and editable, marked "not described".

## Start from the real files

`node scripts/gen-skeleton.js <profile>\TBMods\Config` reads a real config folder and writes a skeleton for every mod folder into `schemas\` (every
field found, a guessed type, the sample value as default for files that exist once). It merges into existing files and never overwrites a field that
already has a label. Fill in the explanations, then run `node scripts/check-schemas.js`, which validates the files and prints how many fields have a
label and help text.

## File layout

```json
{
  "schemaVersion": 1,
  "mod": {
    "id": "TBExample",
    "folder": "TBExample",
    "name": "TB Example",
    "summary": "What the mod does for players and owners, in your own words.",
    "coverage": "in-depth",
    "docs": "https://example.org/docs/page",
    "sources": ["pages you read"],
    "notes": "optional: caveats shown on the mod page"
  },
  "files": [
    {
      "id": "general",
      "match": "GeneralConfig.json",
      "title": "General settings",
      "summary": "What this file is for.",
      "restart": true,
      "role": "settings",
      "fields": {
        "alarmTimeInSeconds": {
          "label": "Alarm duration",
          "help": "How long the alarm sounds. Plain language, 1 to 3 sentences, including what can go wrong.",
          "type": "int", "unit": "seconds", "min": 0, "default": 600,
          "typical": "300-900", "level": "normal", "confidence": "documented"
        }
      }
    }
  ]
}
```

### mod

- `id`: a plain name (letters, digits, `_ . -`). The same id in `schemas-user` replaces the built-in file.
- `folder`: the folder name under `TBMods\Config`. This is what links a folder on disk to the description (compared without case).
- `coverage`: say it honestly.
  - `in-depth`: every field was checked against real config files and the public documentation.
  - `partial`: most fields are described that way, some parts are general.
  - `inferred`: described from field names and real files only. The app tells the user to check such fields on a test server.
- `docs` is shown as text only (the app makes no network calls).

### files[]

- `id`: unique inside the mod.
- `match`: path relative to the mod folder. `*` is one path segment, `**` is any number of segments. `Logger.json` matches one file,
  `DealerPoints/*.json` matches every file in that folder (one description for all of them). When several entries match, the one without a wildcard wins.
- `restart`: default `true` (TB reads its configs at server start).
- `role`: free text hint (`settings`, `list`, `records`).
- `instances`: optional, how many files of this kind the sample had.

### fields

The key is a path: dotted names, `[]` after the name of a list for its items, `*` for a name that is data.

| Path | Matches |
|---|---|
| `alarmTimeInSeconds` | a top-level field |
| `extensions[].price` | `price` in every item of the list `extensions` |
| `admins.*.carDealerAdmin` | `carDealerAdmin` inside every entry of `admins`, whatever the entry is called (for example a player id) |
| `openTimes[].*.hour` | a field inside every value of an object inside a list |

Keys of a field description (all optional except what you want shown):

| Key | Meaning |
|---|---|
| `label` | short name |
| `help` | plain-language explanation, at most 900 characters. Write it yourself; do not paste text from a website. |
| `type` | `int`, `number`, `flag` (integer 0 or 1), `bool` (true or false), `string`, `text` (multi-line), `enum`, `color`, `secret`, `steamid`, `classname`, `url`, `time`, `list`, `object`. Without a type the type of the value in the file is used. |
| `unit` | `seconds`, `minutes`, `percent`, `coins`, ... shown next to the value |
| `min`, `max` | range. Only when documented or clearly right; a wrong limit blocks valid configs. |
| `special` | values that are exempt from the range and get a name, for example `{ "-1": "unlimited" }` |
| `default` | the value the mod writes the first time. Used by "Compare with the TB defaults" and the Default button. Never put secrets here. |
| `enum` | `[{ "value": 1, "label": "Hospital" }]`, required for `type: enum` |
| `typical` | text, for example `300-900` |
| `risk` | what can go wrong. Shown with a warning mark. With `level: danger` a change from the default also raises a warning. |
| `level` | `normal`, `advanced` or `danger` (expert settings) |
| `internal` | `true` for fields the mod manages itself (versions, flags it writes). Shown with a "managed by the mod" mark. |
| `pattern`, `maxLength` | extra checks for text |
| `confidence` | `documented`, `observed` (deduced from real files and documented neighbours) or `inferred` (a guess from the name). Inferred fields are marked in the window. |
| `group` | reserved |

Webhook addresses, tokens and keys: use `type: secret` or `url`, give them no `default`, and say in `help` that the address works like a password.
The app hides values by their name and by their form anyway (webhook addresses, `token`, `key`, `secret`, Steam ids).

## Fields the description does not know

A field in the file that no entry describes is shown and can be edited as a plain value, with the mark "not described". A mod update that adds
a setting therefore never hides it. After an update, run `gen-skeleton.js` against a new sample and fill in the new fields.

## Presets

`presets/<ModId>.json`:

```json
{ "mod": "TBExample", "presets": {
  "pve": { "changes": [ { "file": "GeneralConfig.json", "path": "alarmTimeInSeconds", "value": 300, "why": "short reason" } ] }
} }
```

Server types: `pve`, `pvp`, `hardcore`, `casual`. `file` must be the exact `match` of a file entry without wildcards, `path` a field of that file without
wildcards or `[]`, and the value has to satisfy the schema. Presets only change existing fields. They are suggestions and are shown as a diff before they
are applied. The tests check every preset against the schemas.

## Validation rules

Values are checked on save: type, whole number, range, enum, colour, class name, Steam id, address, time, pattern. A problem that is new blocks the save;
a problem that was already in the file only produces a warning. Wrong kinds are always refused (a number cannot become text).
