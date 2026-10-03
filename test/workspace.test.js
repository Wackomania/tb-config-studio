'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const json = require('../src/core/json');
const fsx = require('../src/core/fsx');

const REL = 'TBVehicleLockSystem/GeneralConfig.json';
const firstNumber = (v) => Object.keys(v).find((k) => typeof v[k] === 'number');

async function save(fx, rel, ops, extra = {}) {
  const f = fsx.read(fx.ws.root, rel);
  return fx.ws.commit(rel, { ops, base: { sha256: f.sha256 }, ...extra });
}

test('overview groups mods, reads versions and lists unknown folders', () => {
  const fx = h.openFixture();
  fs.mkdirSync(path.join(fx.configDir, 'SomeNewMod'));
  fs.writeFileSync(path.join(fx.configDir, 'SomeNewMod', 'Settings.json'), '{"version":"3","x":1}');
  const ov = fx.ws.overview();
  const names = ov.mods.map((m) => m.folder);
  assert.ok(names.includes('TBVehicleLockSystem') && names.includes('Global') && names.includes('SomeNewMod'));
  const unknown = ov.mods.find((m) => m.folder === 'SomeNewMod');
  assert.equal(unknown.known, false);
  assert.equal(unknown.coverage, 'none');
  assert.deepEqual(unknown.versions, ['3']);
  assert.ok(ov.missing.length > 5);
  h.cleanup(fx.root);
});

test('a save changes only the edited value, makes a backup first and writes atomically', async () => {
  const fx = h.openFixture();
  const before = fs.readFileSync(fx.abs(REL), 'utf8');
  const v = json.parseDoc(before).value;
  const key = firstNumber(v);
  const r = await save(fx, REL, [{ op: 'set', path: [key], value: v[key] + 1 }]);
  assert.equal(r.changed, true);
  const after = fs.readFileSync(fx.abs(REL), 'utf8');
  assert.deepEqual(json.parseDoc(after).value, { ...v, [key]: v[key] + 1 });
  assert.equal(after.split('\n').length, before.split('\n').length);
  // backup holds the old bytes
  const hist = fx.ws.history(REL);
  assert.equal(hist.backups.length, 1);
  assert.equal(fsx.readBackup(fx.ws.backupBase, fx.ws.id, REL, hist.backups[0].id).text, before);
  // no temp files left next to the config
  assert.deepEqual(fs.readdirSync(path.dirname(fx.abs(REL))).filter((n) => n.includes('.tbstmp')), []);
  h.cleanup(fx.root);
});

test('conflict detection: a file changed after it was opened is refused unless overwrite is chosen', async () => {
  const fx = h.openFixture();
  const f = fsx.read(fx.ws.root, REL);
  const v = json.parseDoc(f.text).value; const key = firstNumber(v);
  fs.appendFileSync(fx.abs(REL), '\n');                                   // something else wrote
  await assert.rejects(fx.ws.commit(REL, { ops: [{ op: 'set', path: [key], value: 5 }], base: { sha256: f.sha256 } }), (e) => e.status === 409 && e.extra.code === 'changed');
  const r = await fx.ws.commit(REL, { ops: [{ op: 'set', path: [key], value: 5 }], base: { sha256: f.sha256 }, overwrite: true });
  assert.equal(r.changed, true);
  assert.equal(fx.ws.history(REL).backups.length, 1);                     // the other writer's version is in the backup
  h.cleanup(fx.root);
});

test('the base sha is required for a save', async () => {
  const fx = h.openFixture();
  const v = json.parseDoc(fs.readFileSync(fx.abs(REL), 'utf8')).value;
  await assert.rejects(fx.ws.commit(REL, { ops: [{ op: 'set', path: [firstNumber(v)], value: 9 }] }), /base/);
  h.cleanup(fx.root);
});

test('rollback restores an older version, backs up the current one and can be undone', async () => {
  const fx = h.openFixture();
  const original = fs.readFileSync(fx.abs(REL), 'utf8');
  const v = json.parseDoc(original).value; const key = firstNumber(v);
  await save(fx, REL, [{ op: 'set', path: [key], value: v[key] + 7 }]);
  await new Promise((r) => setTimeout(r, 5));
  const b = fx.ws.history(REL).backups[0];
  const view = fx.ws.backupView(REL, b.id);
  assert.equal(view.sameAsNow, false);
  assert.ok(view.diff.added + view.diff.removed > 0);
  const r = await fx.ws.restore(REL, { backupId: b.id });
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(fx.abs(REL), 'utf8'), original);
  assert.equal(fx.ws.history(REL).backups.length, 2);                     // the version before the restore is kept too
  assert.equal(fx.ws.allBackups().backups.length, 2);
  h.cleanup(fx.root);
});

test('rollback of a file that was deleted brings it back', async () => {
  const fx = h.openFixture();
  const original = fs.readFileSync(fx.abs(REL), 'utf8');
  const v = json.parseDoc(original).value;
  await save(fx, REL, [{ op: 'set', path: [firstNumber(v)], value: 1234 }]);
  fs.rmSync(fx.abs(REL));
  const b = fx.ws.allBackups().backups[0];
  const r = await fx.ws.restore(b.path, { backupId: b.id });
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(fx.abs(REL), 'utf8'), original);
  h.cleanup(fx.root);
});

test('backups are limited to the newest N per file', async () => {
  const fx = h.openFixture({ keep: 3 });
  const v = json.parseDoc(fs.readFileSync(fx.abs(REL), 'utf8')).value; const key = firstNumber(v);
  for (let i = 1; i <= 6; i++) { await save(fx, REL, [{ op: 'set', path: [key], value: v[key] + i }]); await new Promise((r) => setTimeout(r, 3)); }
  assert.equal(fx.ws.history(REL).backups.length, 3);
  h.cleanup(fx.root);
});

test('a server that seems to be running needs a confirmation', async () => {
  const fx = h.openFixture();
  fs.writeFileSync(path.join(fx.profileDir, 'DayZServer_x64_2026-10-03.RPT'), 'log');
  assert.equal(fx.ws.runningHint(), true);
  const v = json.parseDoc(fs.readFileSync(fx.abs(REL), 'utf8')).value; const key = firstNumber(v);
  await assert.rejects(save(fx, REL, [{ op: 'set', path: [key], value: v[key] + 1 }]), (e) => e.status === 409 && e.extra.code === 'running');
  const r = await save(fx, REL, [{ op: 'set', path: [key], value: v[key] + 1 }], { confirmRunning: true });
  assert.equal(r.changed, true);
  h.cleanup(fx.root);
});

test('validation: out of range and wrong type block the save, older problems only warn', async () => {
  const fx = h.openFixture();
  const rel = 'TBVehicleLockSystem/GeneralConfig.json';
  const sch = fx.ws.schemaOf(rel).file;
  const f = sch._fields.find((x) => !x._wild && !x.path.includes('[]') && (x.type === 'int' || x.type === 'number') && x.min !== undefined);
  assert.ok(f, 'a bounded numeric field exists');
  const p = fx.ws.plan(rel, { ops: [{ op: 'set', path: f.path.split('.'), value: f.min - 1 }] });
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0].message, /cannot be below/);
  await assert.rejects(save(fx, rel, [{ op: 'set', path: f.path.split('.'), value: f.min - 1 }]), /cannot be below/);
  const ok = fx.ws.plan(rel, { ops: [{ op: 'set', path: f.path.split('.'), value: f.min }] });
  assert.equal(ok.errors.length, 0);
  // an existing out-of-range value is a warning, not a blocker, so unrelated edits can still be saved
  const bad = json.parseDoc(fs.readFileSync(fx.abs(rel), 'utf8')).value; bad[f.path.split('.')[0]] = f.min - 5;
  if (f.path.split('.').length === 1) {
    fs.writeFileSync(fx.abs(rel), json.parseDoc(fs.readFileSync(fx.abs(rel), 'utf8')).apply(bad));
    const other = firstNumber(bad) === f.path ? Object.keys(bad).find((k) => typeof bad[k] === 'number' && k !== f.path) : firstNumber(bad);
    const p2 = fx.ws.plan(rel, { ops: [{ op: 'set', path: [other], value: bad[other] }] });
    assert.equal(p2.errors.length, 0);
  }
  h.cleanup(fx.root);
});

test('raw text edits are validated as JSON and keep the file style', async () => {
  const fx = h.openFixture();
  const f = fsx.read(fx.ws.root, 'TBCarry/TBCarryGlobalConfig.json');
  const p = fx.ws.plan('TBCarry/TBCarryGlobalConfig.json', { raw: '{ not json' });
  assert.ok(p.errors.length);
  await assert.rejects(fx.ws.commit('TBCarry/TBCarryGlobalConfig.json', { raw: '{ not json', base: { sha256: f.sha256 } }), /not valid JSON/);
  const r = await fx.ws.commit('TBCarry/TBCarryGlobalConfig.json', { raw: f.text.replace(/: 0/, ': 1').replace(/: 1\b/, ': 1'), base: { sha256: f.sha256 } });
  assert.ok(r.ok);
  h.cleanup(fx.root);
});

test('unknown fields are shown and editable, a mod update never hides settings', async () => {
  const fx = h.openFixture();
  const abs = fx.abs('TBCarry/TBCarryGlobalConfig.json');
  const d = json.parseDoc(fs.readFileSync(abs, 'utf8')); const v = d.value; v.brandNewSetting = 42;
  fs.writeFileSync(abs, d.apply(v));
  const view = fx.ws.view('TBCarry/TBCarryGlobalConfig.json');
  assert.equal(view.value.brandNewSetting, 42);
  assert.ok(!view.schema.file.fields.some((x) => x.path === 'brandNewSetting'));
  const r = await save(fx, 'TBCarry/TBCarryGlobalConfig.json', [{ op: 'set', path: ['brandNewSetting'], value: 43 }]);
  assert.equal(r.changed, true);
  assert.equal(json.parseDoc(fs.readFileSync(abs, 'utf8')).value.brandNewSetting, 43);
  h.cleanup(fx.root);
});

test('structure edits: add an entry, duplicate and remove list items', async () => {
  const fx = h.openFixture();
  const rel = 'Global/AdminConfig.json';
  const view = fx.ws.view(rel);
  const tmplKey = Object.keys(view.value.admins).find((k) => /^add here/i.test(k));
  assert.ok(tmplKey);
  const entry = view.value.admins[tmplKey];
  const r = await save(fx, rel, [{ op: 'set', path: ['admins', '76561198000000001'], value: entry, create: true }]);
  assert.equal(r.changed, true);
  const after = json.parseDoc(fs.readFileSync(fx.abs(rel), 'utf8')).value;
  assert.ok(after.admins['76561198000000001']);
  const view2 = fx.ws.view(rel);
  assert.ok(Object.keys(view2.value.admins).some((k) => /^⟦hidden:\d+:0001⟧$/.test(k)), 'the new Steam id is masked in the view');
  h.cleanup(fx.root);
});
