'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const json = require('../src/core/json');
const fsx = require('../src/core/fsx');
const compare = require('../src/core/compare');
const presetLib = require('../src/core/presets');
const searchLib = require('../src/core/search');
const pack = require('../src/core/pack');
const licence = require('../src/core/licence');
const pathsafe = require('../src/core/pathsafe');

const presets = () => presetLib.load(path.join(h.REPO, 'presets'));
const STEAM = '76561198000000001';

// ---------------------------------------------------------------------------------------------------------------- presets
test('presets: the plan shows current and suggested values and statuses; nothing is written', () => {
  const fx = h.openFixture();
  const before = fs.readFileSync(fx.abs('TBVehicleLockSystem/RaidVehicleConfig.json'));
  const p = presetLib.plan(fx.ws, presets(), 'pve', { mods: ['TBVehicleLockSystem'] });
  assert.ok(p.items.length > 0);
  for (const it of p.items) assert.ok(['change', 'same', 'missing-file', 'missing-field', 'invalid', 'unreadable'].includes(it.status));
  assert.ok(p.items.some((i) => i.status === 'change'));
  assert.deepEqual(fs.readFileSync(fx.abs('TBVehicleLockSystem/RaidVehicleConfig.json')), before);
  assert.throws(() => presetLib.plan(fx.ws, presets(), 'nope'), (e) => e.status === 404);
  h.cleanup(fx.root);
});

test('presets: the preview is a diff per file, applying makes backups and is idempotent', async () => {
  const fx = h.openFixture();
  const o = { mods: ['TBVehicleLockSystem'] };
  const pv = presetLib.preview(fx.ws, presets(), 'pve', null, o);
  assert.ok(pv.files.length >= 1 && pv.files.every((f) => f.valid && f.diff.unified.includes('@@')));
  const r = await presetLib.apply(fx.ws, presets(), 'pve', null, o);
  assert.equal(r.done.length, pv.files.length);
  assert.ok(r.done.every((d) => d.backup));
  const again = presetLib.plan(fx.ws, presets(), 'pve', o);
  assert.ok(again.items.every((i) => i.status !== 'change'), 'everything applied now reads "same"');
  const r2 = await presetLib.apply(fx.ws, presets(), 'pve', null, o);
  assert.equal(r2.done.length, 0);
  h.cleanup(fx.root);
});

test('presets: a chosen subset only changes the chosen fields', async () => {
  const fx = h.openFixture();
  const o = { mods: ['TBVehicleLockSystem'] };
  const p = presetLib.plan(fx.ws, presets(), 'pve', o);
  const first = p.items.find((i) => i.status === 'change');
  await presetLib.apply(fx.ws, presets(), 'pve', [first.key], o);
  const after = presetLib.plan(fx.ws, presets(), 'pve', o);
  assert.equal(after.items.find((i) => i.key === first.key).status, 'same');
  assert.equal(after.items.filter((i) => i.status === 'change').length, p.items.filter((i) => i.status === 'change').length - 1);
  h.cleanup(fx.root);
});

test('presets: missing files and fields are reported, invalid values never applied', () => {
  const fx = h.openFixture();
  fs.rmSync(fx.abs('TBVehicleLockSystem/RaidVehicleConfig.json'));
  const fake = { byType: { pve: [{ mod: 'TBVehicleLockSystem', changes: [{ file: 'RaidVehicleConfig.json', path: 'x', value: 1, why: 'w' }, { file: 'GeneralConfig.json', path: 'nonexistentField', value: 1, why: 'w' }, { file: 'GeneralConfig.json', path: 'alarmTimeInSeconds', value: -50, why: 'w' }] }] }, types: presetLib.TYPES };
  const p = presetLib.plan(fx.ws, fake, 'pve');
  assert.deepEqual(p.items.map((i) => i.status), ['missing-file', 'missing-field', 'invalid']);
  assert.equal(presetLib.opsFor(p.items).length, 0);
  h.cleanup(fx.root);
});

// ---------------------------------------------------------------------------------------------------------------- compare
test('compare two folders at field level, with only-here and only-there files', async () => {
  const a = h.openFixture(), b = h.openFixture();
  const rel = 'TBVehicleLockSystem/GeneralConfig.json';
  const v = json.parseDoc(fs.readFileSync(b.abs(rel), 'utf8')).value; const key = Object.keys(v).find((k) => typeof v[k] === 'number');
  await b.ws.commit(rel, { ops: [{ op: 'set', path: [key], value: v[key] + 100 }], base: { sha256: fsx.read(b.ws.root, rel).sha256 } });
  fs.rmSync(b.abs('TBCarry/TBCarryGlobalConfig.json'));
  fs.writeFileSync(b.abs('TBCarry/Extra.json'), '{"a":1}');
  const r = compare.compareFolders(a.ws.root, b.ws.root, h.schemas());
  assert.equal(r.changed.length, 1);
  assert.equal(r.changed[0].file, rel);
  assert.equal(r.changed[0].fields.length, 1);
  assert.equal(r.changed[0].fields[0].a, v[key]); assert.equal(r.changed[0].fields[0].b, v[key] + 100);
  assert.deepEqual(r.onlyA, ['TBCarry/TBCarryGlobalConfig.json']);
  assert.deepEqual(r.onlyB, ['TBCarry/Extra.json']);
  assert.ok(r.same > 5);
  h.cleanup(a.root); h.cleanup(b.root);
});

test('compare against defaults lists exactly the fields that differ from what TB wrote', async () => {
  const fx = h.openFixture();
  const rel = 'TBVehicleLockSystem/GeneralConfig.json';
  assert.equal(compare.compareDefaults(fx.ws.root, h.schemas(), ['TBVehicleLockSystem']).changed.length, 0);
  const v = json.parseDoc(fs.readFileSync(fx.abs(rel), 'utf8')).value; const key = Object.keys(v).find((k) => typeof v[k] === 'number');
  await fx.ws.commit(rel, { ops: [{ op: 'set', path: [key], value: v[key] + 1 }], base: { sha256: fsx.read(fx.ws.root, rel).sha256 } });
  const r = compare.compareDefaults(fx.ws.root, h.schemas(), ['TBVehicleLockSystem']);
  assert.equal(r.changed.length, 1);
  assert.equal(r.changed[0].fields[0].pathText, key);
  assert.equal(r.changed[0].fields[0].a, v[key]);
  h.cleanup(fx.root);
});

test('compare masks secret values on both sides', () => {
  const a = h.openFixture(), b = h.openFixture();
  for (const [fx, url] of [[a, 'https://discord.com/api/webhooks/1/AAA'], [b, 'https://discord.com/api/webhooks/2/BBB']]) {
    const d = json.parseDoc(fs.readFileSync(fx.abs('Global/Logger.json'), 'utf8')); const v = d.value;
    v[Object.keys(v).find((k) => /webhook/i.test(k))] = url; fs.writeFileSync(fx.abs('Global/Logger.json'), d.apply(v));
  }
  const r = JSON.stringify(compare.compareFolders(a.ws.root, b.ws.root, h.schemas()));
  assert.ok(!r.includes('AAA') && !r.includes('BBB') && !r.includes('webhooks/'));
  h.cleanup(a.root); h.cleanup(b.root);
});

// ---------------------------------------------------------------------------------------------------------------- search
test('search finds files, labels, help text and values; AND of words; secrets are not searchable', () => {
  const fx = h.openFixture();
  const s = searchLib.make(fx.ws);
  const r1 = s.search('alarm');
  assert.ok(r1.results.some((x) => x.kind === 'field' && /GeneralConfig/.test(x.file)));
  const r2 = s.search('raid vehicle', {});
  assert.ok(r2.results.length > 0);
  assert.equal(s.search('zzzz-not-there').results.length, 0);
  assert.equal(s.search('').results.length, 0);
  assert.ok(s.search('carry').results.some((x) => x.kind === 'file'));
  const abs = fx.abs('Global/Logger.json');
  const d = json.parseDoc(fs.readFileSync(abs, 'utf8')); const v = d.value;
  v[Object.keys(v).find((k) => /webhook/i.test(k))] = 'https://discord.com/api/webhooks/1/FINDME'; fs.writeFileSync(abs, d.apply(v));
  assert.equal(searchLib.make(fx.ws).search('FINDME').results.length, 0);
  h.cleanup(fx.root);
});

// ---------------------------------------------------------------------------------------------------------------- packs
test('export a pack: plain folder copy, secrets removed, manifest; refuses a non-empty or nested folder', () => {
  const fx = h.openFixture();
  const abs = fx.abs('Global/AdminConfig.json');
  const d = json.parseDoc(fs.readFileSync(abs, 'utf8')); const v = d.value;
  v.admins[STEAM] = { ...Object.values(v.admins)[0], notes: 'me' }; fs.writeFileSync(abs, d.apply(v));
  const logger = fx.abs('Global/Logger.json');
  const dl = json.parseDoc(fs.readFileSync(logger, 'utf8')); const lv = dl.value; lv[Object.keys(lv).find((k) => /webhook/i.test(k))] = 'https://discord.com/api/webhooks/1/ZZZ'; fs.writeFileSync(logger, dl.apply(lv));
  const dest = path.join(fx.root, 'pack1');
  const r = pack.exportPack(fx.ws, dest, { mods: ['Global', 'TBCarry'], stripSecrets: true, name: 'test pack' });
  assert.ok(r.files >= 9);
  const copied = fs.readFileSync(path.join(dest, 'TBMods', 'Config', 'Global', 'AdminConfig.json'), 'utf8');
  assert.ok(!copied.includes(STEAM));
  assert.ok(!fs.readFileSync(path.join(dest, 'TBMods', 'Config', 'Global', 'Logger.json'), 'utf8').includes('ZZZ'));
  assert.ok(fs.existsSync(path.join(dest, 'tb-config-studio-pack.json')));
  assert.ok(!fs.existsSync(path.join(dest, 'TBMods', 'Config', 'TBVehicleLockSystem')));
  // untouched files in a pack are byte identical copies
  assert.deepEqual(fs.readFileSync(path.join(dest, 'TBMods', 'Config', 'TBCarry', 'TBCarryGlobalConfig.json')), fs.readFileSync(fx.abs('TBCarry/TBCarryGlobalConfig.json')));
  assert.throws(() => pack.exportPack(fx.ws, dest, {}), (e) => e.status === 409);
  assert.throws(() => pack.exportPack(fx.ws, path.join(fx.configDir, 'inside'), {}), /outside/);
  assert.throws(() => pack.exportPack(fx.ws, '\\\\server\\share\\x', {}), (e) => e.status === 400);
  const raw = pack.exportPack(fx.ws, path.join(fx.root, 'pack2'), { mods: ['Global'], stripSecrets: false });
  assert.ok(fs.readFileSync(path.join(fx.root, 'pack2', 'TBMods', 'Config', 'Global', 'AdminConfig.json'), 'utf8').includes(STEAM));
  assert.equal(raw.secretsRemoved, false);
  h.cleanup(fx.root);
});

test('import a pack: preview shows new and changed files, apply writes only the chosen ones with backups', async () => {
  const src = h.openFixture(), dst = h.openFixture();
  const rel = 'TBVehicleLockSystem/GeneralConfig.json';
  const v = json.parseDoc(fs.readFileSync(src.abs(rel), 'utf8')).value; const key = Object.keys(v).find((k) => typeof v[k] === 'number');
  await src.ws.commit(rel, { ops: [{ op: 'set', path: [key], value: v[key] + 9 }], base: { sha256: fsx.read(src.ws.root, rel).sha256 } });
  fs.writeFileSync(src.abs('TBCarry/New.json'), '{"fresh":true}');
  const out = path.join(src.root, 'pk');
  pack.exportPack(src.ws, out, { stripSecrets: false, name: 'p' });
  const pv = pack.importPreview(dst.ws, out);
  assert.deepEqual(pv.items.map((i) => i.path + ':' + i.status).sort(), ['TBCarry/New.json:new', rel + ':changed']);
  assert.equal(pv.pack.name, 'p');
  const r = await pack.importApply(dst.ws, out, { files: [rel] });
  assert.equal(r.done.length, 1);
  assert.ok(r.done[0].backup);
  assert.equal(json.parseDoc(fs.readFileSync(dst.abs(rel), 'utf8')).value[key], v[key] + 9);
  assert.ok(!fs.existsSync(dst.abs('TBCarry/New.json')));
  const r2 = await pack.importApply(dst.ws, out, {});
  assert.equal(r2.done.length, 1);                                       // the remaining new file
  assert.ok(fs.existsSync(dst.abs('TBCarry/New.json')));
  assert.throws(() => pack.importPreview(dst.ws, dst.profileDir), /open now/);
  h.cleanup(src.root); h.cleanup(dst.root);
});

test('import refuses invalid JSON and paths that are not configs', async () => {
  const dst = h.openFixture();
  await assert.rejects(dst.ws.writeFile('TBCarry/Bad.json', Buffer.from('{ nope')), /not valid JSON/);
  await assert.rejects(dst.ws.writeFile('TBCarry/readme.txt', Buffer.from('x')), (e) => e.status === 400);
  await assert.rejects(dst.ws.writeFile('../escape.json', Buffer.from('{}')), (e) => e.status === 400);
  h.cleanup(dst.root);
});

// ---------------------------------------------------------------------------------------------------------------- licence helper
test('licence helper reads the game port from serverDZ.cfg, or from a start script, and says where it came from', () => {
  const fx = h.openFixture();
  const server = path.dirname(fx.profileDir);
  fs.writeFileSync(path.join(server, 'serverDZ.cfg'), 'hostname = "My Server";\n// port = 1111;\nsteamQueryPort = 27016;\n');
  let r = licence.readPort(fx.profileDir);
  assert.equal(r.port, null);
  assert.equal(r.hostname, 'My Server'); assert.equal(r.queryPort, 27016);
  fs.writeFileSync(path.join(server, 'start.bat'), 'DayZServer_x64.exe -config=serverDZ.cfg -port=2402 -profiles=profile\r\n');
  r = licence.readPort(fx.profileDir);
  assert.equal(r.port, 2402); assert.equal(r.sourceKind, 'script');
  fs.writeFileSync(path.join(server, 'serverDZ.cfg'), 'hostname = "My Server";\nport = 2302;\n');
  r = licence.readPort(fx.profileDir);
  assert.equal(r.port, 2302); assert.equal(r.sourceKind, 'cfg'); assert.match(r.source, /serverDZ\.cfg/);
  h.cleanup(fx.root);
});

test('licence helper: IP mode word is shown, anything else is not; only the presence of licence files is reported', () => {
  const fx = h.openFixture();
  fs.mkdirSync(path.join(fx.profileDir, 'TheModBase', 'Config'), { recursive: true });
  fs.mkdirSync(path.join(fx.profileDir, 'TheModBase', 'Licenses'), { recursive: true });
  fs.writeFileSync(path.join(fx.profileDir, 'TheModBase', 'Config', 'IPSettings.txt'), 'ipv4');
  fs.writeFileSync(path.join(fx.profileDir, 'TheModBase', 'Licenses', 'TBCarryLicense.txt'), 'SECRET-LIC');
  const mods = fx.ws.overview().mods;
  let r = licence.inspect(fx.profileDir, mods);
  assert.equal(r.ipMode, 'ipv4');
  assert.equal(r.licences.find((l) => l.folder === 'TBCarry').present, true);
  assert.equal(r.licences.find((l) => l.folder === 'TBVehicleLockSystem').present, false);
  fs.writeFileSync(path.join(fx.profileDir, 'TheModBase', 'Config', 'IPSettings.txt'), 'some-secret-key-material');
  r = licence.inspect(fx.profileDir, mods);
  assert.equal(r.ipMode, 'set (not shown)');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  h.cleanup(fx.root);
});

test('pathsafe: names and paths used for backups stay inside the backup folder', () => {
  const fx = h.openFixture();
  assert.throws(() => fsx.readBackup(fx.ws.backupBase, fx.ws.id, 'Global/AdminConfig.json', '../../x'), /not a backup id/);
  assert.throws(() => fsx.readBackup(fx.ws.backupBase, fx.ws.id, 'Global/AdminConfig.json', '20260101T000000000Z'), (e) => e.status === 404);
  assert.ok(pathsafe.isInside(fx.ws.root.real, fx.ws.root.real));
  h.cleanup(fx.root);
});
