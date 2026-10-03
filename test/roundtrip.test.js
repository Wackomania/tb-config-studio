'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const json = require('../src/core/json');
const fsx = require('../src/core/fsx');
const pathsafe = require('../src/core/pathsafe');
const h = require('./helpers');

function walkJson(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walkJson(path.join(dir, e.name), p));
    else if (/\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}

test('untouched files are byte identical after parse and apply: committed fixtures', () => {
  const files = walkJson(path.join(h.FIXTURE, 'TBMods', 'Config'));
  assert.ok(files.length >= 20);
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(h.FIXTURE, 'TBMods', 'Config', ...rel.split('/')));
    const text = buf.toString('utf8');
    const d = json.parseDoc(text);
    assert.equal(d.apply(d.value), text, rel);
  }
});

test('untouched files are byte identical across all copied real files', (t) => {
  const sets = h.sampleProfiles();
  if (!sets.length) return t.skip('no sample profiles under ' + h.SAMPLES);
  let n = 0;
  for (const p of sets) {
    const cfg = path.join(p, 'TBMods', 'Config');
    for (const rel of walkJson(cfg)) {
      if (/\.(bak|dayzhub-backup)/.test(rel)) continue;
      const buf = fs.readFileSync(path.join(cfg, ...rel.split('/')));
      const text = buf.toString('utf8');
      let d; try { d = json.parseDoc(text); } catch (e) { assert.fail(rel + ' did not parse: ' + e.message); }
      assert.equal(d.apply(d.value), text, p + ' ' + rel);
      n++;
    }
  }
  assert.ok(n > 20, 'checked ' + n);
});

test('the real files are never changed by opening them (workspace read + plan without edits)', () => {
  const fx = h.openFixture();
  const before = new Map();
  for (const rel of walkJson(fx.configDir)) before.set(rel, fs.readFileSync(fx.abs(rel)).toString('hex'));
  for (const rel of before.keys()) { fx.ws.view(rel); const p = fx.ws.plan(rel, { ops: [] }); assert.equal(p.changed, false, rel); }
  for (const [rel, hex] of before) assert.equal(fs.readFileSync(fx.abs(rel)).toString('hex'), hex);
  h.cleanup(fx.root);
});

test('formatting survives an edit: comments, BOM, CRLF, tabs, odd numbers', () => {
  const text = '﻿{\r\n\t// keep me\r\n\t"a": 0.8999999761581421,\r\n\t"b": [1, 2, 3],\r\n\t"c": "x" /* inline */\r\n}\r\n';
  const d = json.parseDoc(text);
  assert.ok(d.hasComments);
  const v = d.value; v.b = [1, 2, 4];
  const out = d.apply(v);
  assert.equal(out, text.replace('[1, 2, 3]', '[1, 2, 4]'));
  const v2 = d.value; v2.c = 'y';
  const out2 = d.apply(v2);
  assert.ok(out2.includes('// keep me') && out2.includes('0.8999999761581421') && out2.includes('/* inline */') && out2.includes('"y"') && out2.startsWith('﻿'));
  assert.equal(json.parseDoc(out2).value.a, 0.8999999761581421);
});

test('adding, removing and inserting keeps neighbours untouched', () => {
  const text = '{\n  "a": 1,\n  "list": [\n    1,\n    2\n  ],\n  "z": {\n    "k": true\n  }\n}\n';
  const d = json.parseDoc(text);
  const nv = json.applyOps(d.value, [{ op: 'set', path: ['a'], value: 5 }, { op: 'insert', path: ['list', 2], value: 3 }, { op: 'set', path: ['z', 'n'], value: 'new', create: true }, { op: 'remove', path: ['z', 'k'] }]);
  const out = d.apply(nv);
  assert.deepEqual(json.parseDoc(out).value, nv);
  assert.ok(out.includes('"a": 5'));
  assert.ok(out.endsWith('\n'));
});

test('a field keeps its kind and unknown fields are preserved', () => {
  const fx = h.openFixture();
  const rel = 'TBVehicleLockSystem/GeneralConfig.json';
  const cur = fx.ws.view(rel);
  const key = Object.keys(cur.value).find((k) => typeof cur.value[k] === 'number');
  const p = fx.ws.plan(rel, { ops: [{ op: 'set', path: [key], value: 'text now' }] });
  assert.ok(p.errors.length, 'number cannot become text');
  h.cleanup(fx.root);
});

test('all fixture files classify as editable config files; backups and licences are not', () => {
  assert.ok(fsx.classify('TBCarry/TBCarryGlobalConfig.json'));
  assert.equal(fsx.classify('TBCarry/TBCarryGlobalConfig.json.bak-20260926'), null);
  assert.equal(fsx.classify('Global/Logger.json.dayzhub-backup'), null);
  assert.equal(fsx.classify('TheModBase/Licenses/TBCarryLicense.txt'), null);
  assert.equal(fsx.classify('Global/x.bisign'), null);
  assert.equal(fsx.classify('Global/notes.txt'), null);
  assert.equal(fsx.classify('Global/76561198000000001.json'), null);
  assert.ok(pathsafe.nameProblem('con.json'));
});
