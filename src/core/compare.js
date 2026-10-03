'use strict';
// Compare two config folders, or a folder against the defaults the schema knows (the values TB writes the first time).
// Output is field level: { onlyA, onlyB, changed: [{ file, fields: [{ pathText, path, a, b, label }] }], same }. Secret values are masked.
const fs = require('node:fs');
const path = require('node:path');
const json = require('./json');
const mask = require('./mask');
const fsx = require('./fsx');
const pathsafe = require('./pathsafe');
const schemaLib = require('./schema');

const MAX_DIFFS_PER_FILE = 400, MAX_FILES = 400;

function flatten(v) {
  const out = new Map();
  const walk = (x, p, depth) => {
    if (depth > 60 || out.size > 20000) return;
    if (Array.isArray(x)) { if (!x.length) out.set(JSON.stringify(p), { p, v: [] }); x.forEach((y, i) => walk(y, [...p, i], depth + 1)); return; }
    if (x && typeof x === 'object') { const ks = Object.keys(x); if (!ks.length) out.set(JSON.stringify(p), { p, v: {} }); for (const k of ks) walk(x[k], [...p, k], depth + 1); return; }
    out.set(JSON.stringify(p), { p, v: x });
  };
  walk(v, [], 0);
  return out;
}
function parseFile(root, rel) {
  try { const f = fsx.read(root, rel, { max: fsx.MAX_EDIT }); return json.parseDoc(f.text).value; } catch (e) { return undefined; }
}
const show = (rel, v) => mask.maskValue({ x: v }, rel).value.x;

function diffValues(rel, a, b, fileSchema, labels = true) {
  const A = flatten(a), B = flatten(b);
  const keys = new Set([...A.keys(), ...B.keys()]);
  const fields = [];
  for (const k of keys) {
    const x = A.get(k), y = B.get(k);
    if (x && y && JSON.stringify(x.v) === JSON.stringify(y.v)) continue;
    const p = (x || y).p;
    const fd = labels && fileSchema ? schemaLib.fieldFor(fileSchema, p) : null;
    fields.push({ path: p, pathText: schemaLib.normPath(p), label: fd ? fd.label || '' : '', a: x ? show(rel, x.v) : undefined, b: y ? show(rel, y.v) : undefined, onlyIn: !x ? 'b' : !y ? 'a' : '' });
    if (fields.length >= MAX_DIFFS_PER_FILE) break;
  }
  return fields;
}

// Two Config roots (pathsafe roots).
function compareFolders(rootA, rootB, schemas) {
  const A = new Map(fsx.scan(rootA).files.map((f) => [f.path, f]));
  const B = new Map(fsx.scan(rootB).files.map((f) => [f.path, f]));
  const onlyA = [], onlyB = [], changed = []; let same = 0, truncated = false;
  for (const [p, f] of A) {
    const g = B.get(p);
    if (!g) { onlyA.push(p); continue; }
    if (changed.length >= MAX_FILES) { truncated = true; continue; }
    if (f.size === g.size) {
      try { if (fsx.read(rootA, p).sha256 === fsx.read(rootB, p).sha256) { same++; continue; } } catch (e) { /* compare by value below */ }
    }
    const a = parseFile(rootA, p), b = parseFile(rootB, p);
    const rel = p.split('/').slice(1).join('/');
    const fileSchema = schemaLib.findFile(schemas, f.mod, rel).file;
    if (a === undefined || b === undefined) { changed.push({ file: p, fields: [], unreadable: true }); continue; }
    const fields = diffValues(p, a, b, fileSchema);
    if (!fields.length) same++; else changed.push({ file: p, fields });
  }
  for (const p of B.keys()) if (!A.has(p)) onlyB.push(p);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort(), changed, same, truncated };
}

// The defaults of single-file entries: { field path -> default } for fields the schema gives a default (no wildcards, no list items).
function defaultsOf(fileSchema) {
  const d = {};
  for (const f of fileSchema._fields) if (!f._wild && !f.path.includes('[]') && f.default !== undefined) d[f.path] = f.default;
  return d;
}
function getByNorm(value, norm) {
  let cur = value;
  for (const k of norm.split('.')) { if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined; cur = cur[k]; }
  return cur;
}
// A = what TB writes by default (from the schema), B = the folder.
function compareDefaults(root, schemas, mods) {
  const { files } = fsx.scan(root);
  const changed = []; let same = 0, checked = 0;
  for (const f of files) {
    if (mods && mods.length && !mods.includes(f.mod)) continue;
    const rel = f.path.split('/').slice(1).join('/');
    const s = schemaLib.findFile(schemas, f.mod, rel).file;
    if (!s || s.match.includes('*')) continue;                 // defaults only make sense for a file that exists once
    const def = defaultsOf(s);
    if (!Object.keys(def).length) continue;
    const val = parseFile(root, f.path);
    if (val === undefined) continue;
    const fields = [];
    for (const [np, dv] of Object.entries(def)) {
      checked++;
      const cur = getByNorm(val, np);
      if (cur === undefined || JSON.stringify(cur) === JSON.stringify(dv)) { if (cur !== undefined) same++; continue; }
      const fd = schemaLib.fieldFor(s, np);
      fields.push({ path: np.split('.'), pathText: np, label: fd ? fd.label || '' : '', a: show(f.path, dv), b: show(f.path, cur), onlyIn: '' });
    }
    if (fields.length) changed.push({ file: f.path, fields });
  }
  return { onlyA: [], onlyB: [], changed, same, checked, truncated: false };
}

module.exports = { compareFolders, compareDefaults, diffValues, defaultsOf, getByNorm };
