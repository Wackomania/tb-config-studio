'use strict';
// Search across all TB configs of an opened workspace: file names, field names, explanations and (non-secret) values.
const fs = require('node:fs');
const path = require('node:path');
const json = require('./json');
const mask = require('./mask');
const fsx = require('./fsx');
const schemaLib = require('./schema');

const MAX_LEAVES = 3000;

function make(ws) {
  const cache = new Map();                                    // rel -> { key, leaves }
  function leavesOf(f) {
    const key = f.mtimeMs + '|' + f.size;
    const hit = cache.get(f.path);
    if (hit && hit.key === key) return hit.leaves;
    let leaves = [];
    try {
      if (f.size > 2 * 1048576) throw new Error('large');
      const val = json.parseDoc(fs.readFileSync(path.join(ws.configDir, ...f.path.split('/')), 'utf8')).value;
      const m = mask.maskValue(val, f.path).value;
      const walk = (v, p, depth) => {
        if (leaves.length >= MAX_LEAVES || depth > 60) return;
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...p, i], depth + 1)); return; }
        if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], [...p, k], depth + 1); return; }
        leaves.push({ p, v });
      };
      walk(m, [], 0);
    } catch (e) { leaves = []; }
    cache.set(f.path, { key, leaves });
    return leaves;
  }

  // q: words, all must match (case-insensitive). opts.mod limits to one mod folder.
  function search(q, opts = {}) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return { results: [], truncated: false };
    const { files } = fsx.scan(ws.root);
    const results = []; let truncated = false;
    for (const f of files) {
      if (opts.mod && f.mod !== opts.mod) continue;
      if (f.tooLarge) continue;
      const rel = f.path.split('/').slice(1).join('/');
      const s = schemaLib.findFile(ws.schemas(), f.mod, rel);
      const fileText = (f.path + ' ' + (s.file ? s.file.title + ' ' + (s.file.summary || '') : '')).toLowerCase();
      const fileHit = words.every((w) => fileText.includes(w));
      if (fileHit) results.push({ kind: 'file', file: f.path, title: s.file ? s.file.title : f.name, modName: s.mod ? s.mod.mod.name : f.mod });
      for (const l of leavesOf(f)) {
        const fd = s.file ? schemaLib.fieldFor(s.file, l.p) : null;
        const label = fd ? (fd.label || '') + ' ' + (fd.help || '') : '';
        const hay = (f.path + ' ' + schemaLib.normPath(l.p) + ' ' + label + ' ' + (typeof l.v === 'string' ? l.v : String(l.v))).toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        if (fileHit && results.length && results[results.length - 1].file === f.path && words.every((w) => fileText.includes(w)) && !fd) continue;
        results.push({ kind: 'field', file: f.path, path: l.p, pathText: schemaLib.normPath(l.p), label: fd ? fd.label || '' : '', value: l.v, modName: s.mod ? s.mod.mod.name : f.mod });
        if (results.length >= 300) { truncated = true; break; }
      }
      if (truncated) break;
    }
    return { results, truncated };
  }
  return { search };
}

module.exports = { make };
