# Changelog

## 0.1.0

First version.

- Lossless JSON editing (untouched files stay byte identical; comments, key order, line endings and number spelling are kept), atomic saves with a
  backup first, conflict detection, rollback list.
- Descriptions for 13 paid TB mods and the shared Global configs: 14 schema files, about 1,440 described fields, 10 preset files.
- Search, compare (folders and TB defaults), presets with diff, licence helper, config packs, first-run guide.
- Per-user installer, uninstaller and portable folder, built by `scripts/build-installer.ps1` (with a dry-run mode).
- Tests: parsing and round trip, save, backup, rollback, conflicts, validation, presets, packs, path traversal and hostile input, secret masking,
  local server hardening, installer dry runs.
