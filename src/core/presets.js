'use strict';
// Recommended presets per server type. They are suggestions (not official settings of the mod author) shown as a diff before anything is applied.
// presets/<Mod>.json: { "mod": "TBX", "presets": { "pve": { "changes": [ { "file": "GeneralConfig.json", "path": "a.b", "value": 1, "why": "..." } ] } } }
const fs = require('node:fs');
const path = require('node:path');
const json = require('./json');
const fsx = require('./fsx');
const schemaLib = require('./schema');
const compare = require('./compare');

const TYPES = {
  pve: { name: 'PvE / friendly', note: 'Players mostly cooperate or play against the environment. Fewer ways to lose progress to other players.' },
  pvp: { name: 'PvP', note: 'Players fight each other. Raiding and theft stay possible, with some friction.' },
  hardcore: { name: 'Hardcore', note: 'Harsh survival: losses hurt, help is scarce.' },
  casual: { name: 'Casual', note: 'Relaxed play: generous rewards, forgiving rules.' },
};

function load(dir) {
  const byType = {}; const errors = [];
  let names = []; try { names = fs.readdirSync(dir).filter((n) => /\.json$/i.test(n)).sort(); } catch (e) { names = []; }
  for (const n of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^﻿/, ''));
      if (!d || typeof d.mod !== 'string' || !d.presets || typeof d.presets !== 'object') throw new Error('needs "mod" and "presets"');
      for (const [type, p] of Object.entries(d.presets)) {
        if (!TYPES[type]) throw new Error('unknown server type "' + type + '"');
        if (!Array.isArray(p.changes)) throw new Error(type + ': "changes" must be a list');
        for (const c of p.changes) if (!c || typeof c.file !== 'string' || typeof c.path !== 'string' || c.value === undefined) throw new Error(type + ': a change needs file, path and value');
        (byType[type] || (byType[type] = [])).push({ mod: d.mod, changes: p.changes });
      }
    } catch (e) { errors.push({ file: n, message: e.message }); }
  }
  return { types: TYPES, byType, errors };
}

// What a preset would do to the opened workspace: one item per change, with the current value. Nothing is written.
function plan(ws, presets, type, { mods } = {}) {
  const set = presets.byType[type];
  if (!set) throw fsx.bad('Unknown server type.', 404);
  const items = [];
  for (const group of set) {
    const sMod = ws.schemas().mods.find((s) => s.mod.id === group.mod);
    const folder = sMod ? sMod.mod.folder : group.mod;
    if (mods && mods.length && !mods.includes(folder)) continue;
    for (const c of group.changes) {
      const rel = folder + '/' + c.file;
      const item = { key: rel + '|' + c.path, mod: folder, modName: sMod ? sMod.mod.name : folder, file: rel, path: c.path, value: c.value, why: c.why || '', label: '', current: undefined, status: 'change' };
      const fileSchema = sMod ? schemaLib.findFile(ws.schemas(), folder, c.file).file : null;
      const fd = fileSchema ? schemaLib.fieldFor(fileSchema, c.path) : null;
      item.label = fd ? fd.label || '' : '';
      if (fd) { const m = schemaLib.check(fd, c.value); if (m) { item.status = 'invalid'; item.error = m; } }
      try {
        const f = fsx.read(ws.root, rel, { max: fsx.MAX_EDIT });
        const val = json.parseDoc(f.text).value;
        const cur = compare.getByNorm(val, c.path);
        item.current = cur;
        if (cur === undefined) item.status = 'missing-field';
        else if (JSON.stringify(cur) === JSON.stringify(c.value)) item.status = 'same';
        else if (typeof cur !== typeof c.value && item.status === 'change') { item.status = 'invalid'; item.error = 'The current value is a ' + typeof cur + ' but the preset has a ' + typeof c.value + '.'; }
      } catch (e) { item.status = e.status === 404 ? 'missing-file' : 'unreadable'; }
      items.push(item);
    }
  }
  return { type, name: TYPES[type].name, note: TYPES[type].note, items };
}

// Per-file change requests for the chosen items: [{ file, ops, items }]
function opsFor(items, keys) {
  const chosen = items.filter((i) => i.status === 'change' && (!keys || keys.includes(i.key)));
  const byFile = new Map();
  for (const i of chosen) (byFile.get(i.file) || byFile.set(i.file, []).get(i.file)).push(i);
  return [...byFile].map(([file, list]) => ({ file, items: list, ops: list.map((i) => ({ op: 'set', path: i.path.split('.'), value: i.value })) }));
}

// Preview: the unified diff of every file the preset would change.
function preview(ws, presets, type, keys, o = {}) {
  const p = plan(ws, presets, type, o);
  const files = opsFor(p.items, keys).map((g) => {
    const pl = ws.plan(g.file, { ops: g.ops });
    return { file: g.file, changes: g.items.length, valid: !pl.errors.length, errors: pl.errors.map((e) => e.message), diff: pl.diff };
  });
  return { ...p, files };
}

// Apply: every file is saved with a backup first. Stops at the first file that cannot be saved and says which ones were done.
async function apply(ws, presets, type, keys, o = {}) {
  const p = plan(ws, presets, type, o);
  const done = [];
  for (const g of opsFor(p.items, keys)) {
    const cur = fsx.read(ws.root, g.file, { max: fsx.MAX_EDIT });
    try {
      const r = await ws.commit(g.file, { ops: g.ops, base: { sha256: cur.sha256 }, reason: 'before preset "' + type + '"', note: 'preset ' + type, confirmRunning: !!o.confirmRunning });
      done.push({ file: g.file, changed: r.changed, backup: r.backup || null, fields: g.items.length });
    } catch (e) { throw Object.assign(e, { extra: { ...(e.extra || {}), done, failedFile: g.file } }); }
  }
  return { ok: true, done, restartNote: ws.RESTART_NOTE };
}

module.exports = { load, plan, preview, apply, opsFor, TYPES };
