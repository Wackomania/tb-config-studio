'use strict';
// Authoring aid: reads a real TBMods/Config folder (a server's profile\TBMods\Config) and writes a schema skeleton per mod folder into schemas/.
// Every field that exists in the sample files gets an entry (path, guessed type, the sample value as the default for single-file groups).
// A person then fills in label/help/unit/range/risk. Existing schema files are merged, never overwritten: written descriptions are kept.
// Usage: node scripts/gen-skeleton.js <Config folder> [--out schemas]
const fs = require('node:fs');
const path = require('node:path');

const cfg = process.argv[2];
const out = path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(__dirname, '..', 'schemas'));
if (!cfg) { console.error('Usage: node scripts/gen-skeleton.js <Config folder> [--out schemas]'); process.exit(1); }
const SKIP = /(\.(bak|old|tmp)[^/]*$|dayzhub-backup$)/i;

function walk(dir, rel = '') {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) r.push(...walk(path.join(dir, e.name), p));
    else if (/\.json$/i.test(e.name) && !SKIP.test(e.name)) r.push(p);
  }
  return r;
}
function paths(v, p, acc) {
  if (Array.isArray(v)) { if (!v.length) acc.set(p, acc.get(p) || { kinds: new Set(['list']), sample: [] }); for (const x of v) paths(x, p + '[]', acc); acc.set(p, acc.get(p) || { kinds: new Set(), sample: undefined }); acc.get(p).kinds.add('list'); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) paths(v[k], p ? p + '.' + k : k, acc); return; }
  const e = acc.get(p) || { kinds: new Set(), sample: v };
  e.kinds.add(v === null ? 'null' : Number.isInteger(v) ? 'int' : typeof v === 'number' ? 'number' : typeof v);
  if (e.sample === undefined) e.sample = v;
  e.values = e.values || new Set(); if (e.values.size < 6) e.values.add(v);
  acc.set(p, e);
}
const guess = (e) => {
  if (e.kinds.has('list') && e.kinds.size === 1) return 'list';
  if (e.kinds.has('string')) return 'string';
  if (e.kinds.has('boolean')) return 'bool';
  if (e.kinds.has('number')) return 'number';
  if (e.kinds.has('int')) { const vs = [...(e.values || [])]; return vs.length && vs.every((x) => x === 0 || x === 1) ? 'flag' : 'int'; }
  return 'string';
};

const files = walk(cfg);
const byMod = new Map();
for (const f of files) { const [mod, ...rest] = f.split('/'); if (!rest.length) continue; (byMod.get(mod) || byMod.set(mod, []).get(mod)).push(rest.join('/')); }
for (const [mod, list] of byMod) {
  const groups = new Map();                                     // match -> [files]
  for (const rel of list) { const i = rel.lastIndexOf('/'); const m = i < 0 ? rel : rel.slice(0, i) + '/*.json'; (groups.get(m) || groups.set(m, []).get(m)).push(rel); }
  const target = path.join(out, mod + '.json');
  let doc = { schemaVersion: 1, mod: { id: mod, folder: mod, name: mod, summary: '', coverage: 'inferred', docs: '' }, files: [] };
  try { doc = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { /* new */ }
  for (const [match, members] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const acc = new Map();
    for (const rel of members) { try { paths(JSON.parse(fs.readFileSync(path.join(cfg, mod, rel), 'utf8').replace(/^\uFEFF/, '')), '', acc); } catch (e) { console.error('skip', mod, rel, e.message); } }
    let entry = doc.files.find((x) => x.match === match);
    if (!entry) { entry = { id: match.replace(/\/\*\.json$/i, '-files').replace(/\.json$/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(), match, title: match.replace(/\.json$/i, ''), summary: '', restart: true, fields: {} }; doc.files.push(entry); }
    if (members.length > 1 || match.includes('*')) entry.instances = members.length;
    for (const [p, e] of acc) {
      if (!p || (entry.fields[p] && entry.fields[p].label)) { if (p && entry.fields[p]) entry.fields[p].default = entry.fields[p].default; continue; }
      const f = entry.fields[p] || (entry.fields[p] = {});
      f.type = f.type || guess(e);
      if (members.length === 1 && e.sample !== undefined && !(Array.isArray(e.sample) && !e.sample.length && f.type === 'list' && false)) f.default = e.sample;
    }
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(doc, null, 2) + '\n');
  console.log(mod, doc.files.length, 'file entries', doc.files.reduce((a, f) => a + Object.keys(f.fields).length, 0), 'fields');
}
