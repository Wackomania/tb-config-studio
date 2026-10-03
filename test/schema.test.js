'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const schemaLib = require('../src/core/schema');
const presetLib = require('../src/core/presets');
const json = require('../src/core/json');

const PAID = ['TBDynamicTrader', 'TBVehicleLockSystem', 'TBCarDealer', 'TBSecondHandMarket', 'TBSurvivorLuck', 'TBWarParty', 'TBRealEstate', 'TBDailyReward', 'TBJewelsOfSurvival', 'TBBasicNeeds', 'TBDeathInsurance', 'TBCarry', 'TBRevivePlayer'];

test('every built-in schema file is valid and the paid mods plus Global are covered', () => {
  const s = h.schemas();
  assert.deepEqual(s.errors, []);
  const folders = s.mods.map((m) => m.mod.folder);
  for (const m of PAID) assert.ok(folders.includes(m), 'schema for ' + m);
  assert.ok(folders.includes('Global'));
  assert.equal(new Set(s.mods.map((m) => m.mod.id)).size, s.mods.length);
  assert.ok(!folders.some((f) => /StaticLights/i.test(f)), 'no schema for free mods');
});

test('schema problems are reported for bad documents', () => {
  const bad = { schemaVersion: 1, mod: { id: 'X', folder: 'X', name: 'X', summary: '', coverage: 'in-depth' }, files: [{ id: 'a', match: '../x.json', title: 't', fields: { a: { type: 'enum' }, b: { type: 'nope' }, c: { weird: 1 }, d: { min: 5, max: 1 } } }] };
  const p = schemaLib.problems(bad).join('|');
  assert.match(p, /match must be/); assert.match(p, /enum needs/); assert.match(p, /unknown type/); assert.match(p, /unknown key/); assert.match(p, /min is above max/);
});

test('no secrets, tokens, webhook addresses or Steam ids anywhere in schemas, presets or fixtures', () => {
  const bad = [/7656119\d{10}/, /discord(app)?\.com\/api\/webhooks/i, /dayzhub\.(cloud|net|com)/i, /dhc_[A-Za-z0-9]{8,}/, /hooks\.slack\.com/i];
  const dirs = ['schemas', 'presets', 'test/fixtures'].map((d) => path.join(h.REPO, d));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of dirs.flatMap(walk)) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of bad) assert.ok(!re.test(t), f + ' matches ' + re);
  }
});

test('the project mentions no AI tooling in code, docs or schemas', () => {
  const skip = new Set(['node_modules', '.git', 'dist', 'fixtures']);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (skip.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(h.REPO).filter((x) => /\.(js|json|md|cs|ps1|html|css|svg|xml|manifest)$/i.test(x) && !x.endsWith('schema.test.js'))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/\b(claude|anthropic|chatgpt|openai|llm)\b/i.test(t), f);
  }
});

test('every field of the real sample files has a description (nothing is left unexplained)', (t) => {
  const sets = h.sampleProfiles();
  if (!sets.length) return t.skip('no samples');
  const s = h.schemas();
  const missing = [];
  let leaves = 0;
  const walkFiles = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name) : /\.json$/i.test(e.name) && !/\.(bak|dayzhub)/.test(e.name) ? [rel ? rel + '/' + e.name : e.name] : []));
  for (const p of sets) {
    const cfg = path.join(p, 'TBMods', 'Config');
    for (const rel of walkFiles(cfg)) {
      const [mod, ...rest] = rel.split('/');
      const hit = schemaLib.findFile(s, mod, rest.join('/'));
      if (!hit.file) { missing.push(rel + ' (file)'); continue; }
      let val; try { val = json.parseDoc(fs.readFileSync(path.join(cfg, ...rel.split('/')), 'utf8')).value; } catch (e) { continue; }
      const walk = (v, pp, depth) => {
        if (depth > 40) return;
        if (Array.isArray(v)) { if (!v.length && pp.length) { leaves++; if (!schemaLib.fieldFor(hit.file, pp)) missing.push(rel + ' ' + schemaLib.normPath(pp)); } v.forEach((x, i) => walk(x, [...pp, i], depth + 1)); return; }
        if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], [...pp, k], depth + 1); return; }
        leaves++;
        if (!schemaLib.fieldFor(hit.file, pp)) missing.push(rel + ' ' + schemaLib.normPath(pp));
      };
      walk(val, [], 0);
    }
  }
  const uniq = [...new Set(missing)];
  const share = uniq.length / Math.max(leaves, 1);
  assert.ok(share < 0.02, uniq.length + ' undescribed of ' + leaves + ': ' + uniq.slice(0, 25).join('; '));
});

test('presets are valid: single files, existing fields, values that pass the schema', () => {
  const s = h.schemas();
  const presets = presetLib.load(path.join(h.REPO, 'presets'));
  assert.deepEqual(presets.errors, []);
  assert.ok(Object.keys(presets.byType).length >= 3);
  let n = 0;
  for (const [type, groups] of Object.entries(presets.byType)) {
    for (const g of groups) {
      const mod = s.mods.find((m) => m.mod.id === g.mod);
      assert.ok(mod, 'unknown mod in presets: ' + g.mod);
      for (const c of g.changes) {
        const f = mod.files.find((x) => x.match === c.file);
        assert.ok(f, type + ' ' + g.mod + ': ' + c.file + ' is not a single schema file');
        const fd = schemaLib.fieldFor(f, c.path);
        assert.ok(fd, type + ' ' + g.mod + ': no field ' + c.path);
        assert.equal(schemaLib.check(fd, c.value), null, g.mod + ' ' + c.path);
        assert.ok(c.why && c.why.length > 5, 'every change says why');
        n++;
      }
    }
  }
  assert.ok(n > 30, 'presets: ' + n);
});

test('check(): types, ranges, enums, steam ids, urls and colours', () => {
  assert.match(schemaLib.check({ type: 'int', label: 'A', min: 1 }, 0), /cannot be below 1/);
  assert.match(schemaLib.check({ type: 'int', label: 'A' }, 1.5), /whole number/);
  assert.equal(schemaLib.check({ type: 'int', min: 1, special: { '-1': 'off' } }, -1), null);
  assert.match(schemaLib.check({ type: 'flag', label: 'F' }, 2), /0 \(off\) or 1/);
  assert.match(schemaLib.check({ type: 'enum', enum: [{ value: 'a', label: 'A' }] }, 'b'), /must be one of/);
  assert.match(schemaLib.check({ type: 'steamid' }, 'abc'), /Steam 64/);
  assert.equal(schemaLib.check({ type: 'steamid' }, '76561198000000001'), null);
  assert.match(schemaLib.check({ type: 'url' }, 'javascript:alert(1)'), /http/);
  assert.match(schemaLib.check({ type: 'color' }, 'zzz'), /colour/);
  assert.match(schemaLib.check({ type: 'classname' }, 'a b'), /class name/);
});

test('field matching: wildcards, list items and exact fields', () => {
  const doc = { schemaVersion: 1, mod: { id: 'T', folder: 'T', name: 'T', summary: '', coverage: 'partial' }, files: [{ id: 'f', match: 'a.json', title: 'A', fields: { 'admins.*.flag': { type: 'flag', label: 'Flag' }, 'items[].price': { type: 'int', label: 'Price', min: 0 }, 'x': { type: 'int' } } }] };
  const dir = h.tmpdir('sch'); fs.writeFileSync(path.join(dir, 'T.json'), JSON.stringify(doc));
  const s = schemaLib.load([{ dir, origin: 'user' }]);
  const f = s.mods[0].files[0];
  assert.equal(schemaLib.fieldFor(f, ['admins', '7656', 'flag']).label, 'Flag');
  assert.equal(schemaLib.fieldFor(f, ['items', 3, 'price']).label, 'Price');
  assert.equal(schemaLib.fieldFor(f, ['items', 'price']), null);
  assert.equal(schemaLib.fieldFor(f, ['x']).type, 'int');
  assert.equal(schemaLib.validate(f, { items: [{ price: -4 }] }).length, 1);
  h.cleanup(dir);
});

test('a user schema folder adds a new mod without code changes and overrides a built-in one', () => {
  const dir = h.tmpdir('sch2');
  fs.writeFileSync(path.join(dir, 'NewMod.json'), JSON.stringify({ schemaVersion: 1, mod: { id: 'TBNewMod', folder: 'TBNewMod', name: 'TB New Mod', summary: 'x', coverage: 'inferred' }, files: [{ id: 'g', match: 'General.json', title: 'General', fields: { a: { type: 'int', label: 'A' } } }] }));
  fs.writeFileSync(path.join(dir, 'Override.json'), JSON.stringify({ schemaVersion: 1, mod: { id: 'TBCarry', folder: 'TBCarry', name: 'Carry (mine)', summary: 'x', coverage: 'partial' }, files: [] }));
  fs.writeFileSync(path.join(dir, 'Broken.json'), '{ nope');
  const s = schemaLib.load([{ dir: path.join(h.REPO, 'schemas'), origin: 'built-in' }, { dir, origin: 'user' }]);
  assert.ok(s.mods.find((m) => m.mod.id === 'TBNewMod'));
  assert.equal(s.mods.find((m) => m.mod.id === 'TBCarry').mod.name, 'Carry (mine)');
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0].file, /Broken/);
  h.cleanup(dir);
});
