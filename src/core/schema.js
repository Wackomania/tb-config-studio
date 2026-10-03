'use strict';
// Schema descriptors: schemas/<Mod>.json (and, in the user's data folder, schemas-user/*.json). One file per mod, no code is needed to add a mod.
// See docs/SCHEMA-FORMAT.md. A descriptor says how to explain and check the fields of a mod's files; a field it does not name is still shown
// (its type is read from the value), so a mod update that adds a setting never hides it.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = new Set(['int', 'number', 'flag', 'bool', 'string', 'text', 'enum', 'color', 'secret', 'steamid', 'classname', 'url', 'time', 'list', 'object']);
const LEVELS = new Set(['normal', 'advanced', 'danger']);
const CONFIDENCE = new Set(['documented', 'observed', 'inferred']);
const COVERAGE = new Set(['in-depth', 'partial', 'inferred']);
const FIELD_KEYS = new Set(['label', 'help', 'type', 'unit', 'min', 'max', 'default', 'enum', 'typical', 'risk', 'level', 'special', 'pattern', 'maxLength', 'internal', 'confidence', 'group']);

const globRe = (g) => new RegExp('^' + String(g).split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*') + '$', 'i');
const patRe = (p) => new RegExp('^' + String(p).split('.').map((seg) => seg.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^.\\[\\]]*')).join('\\.') + '$');

// Problems of one schema document: a list of strings (empty = fine). Used by the loader and by scripts/check-schemas.js.
function problems(d) {
  const out = [];
  const add = (m) => out.push(m);
  if (!d || typeof d !== 'object') return ['not an object'];
  if (d.schemaVersion !== 1) add('schemaVersion must be 1');
  const m = d.mod;
  if (!m || typeof m.id !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(m.id)) add('mod.id is missing or not a plain name');
  else {
    if (typeof m.folder !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(m.folder)) add('mod.folder is missing or not a plain folder name');
    if (typeof m.name !== 'string' || !m.name) add('mod.name is missing');
    if (typeof m.summary !== 'string') add('mod.summary must be text');
    if (!COVERAGE.has(m.coverage)) add('mod.coverage must be in-depth, partial or inferred');
  }
  if (!Array.isArray(d.files)) { add('files must be a list'); return out; }
  const ids = new Set();
  d.files.forEach((f, i) => {
    const w = `files[${i}]${f && f.id ? ' (' + f.id + ')' : ''}`;
    if (!f || typeof f !== 'object') return add(w + ' is not an object');
    if (typeof f.id !== 'string' || !f.id) add(w + ': id missing'); else if (ids.has(f.id)) add(w + ': duplicate id'); else ids.add(f.id);
    if (typeof f.match !== 'string' || !f.match || /^\/|\.\.|:|\\/.test(f.match)) add(w + ': match must be a relative path pattern with /');
    if (typeof f.title !== 'string' || !f.title) add(w + ': title missing');
    if (f.summary !== undefined && typeof f.summary !== 'string') add(w + ': summary must be text');
    for (const [k, fd] of Object.entries(f.fields || {})) {
      const n = `${w} field "${k}"`;
      if (!fd || typeof fd !== 'object' || Array.isArray(fd)) { add(n + ' is not an object'); continue; }
      for (const key of Object.keys(fd)) if (!FIELD_KEYS.has(key)) add(`${n}: unknown key "${key}"`);
      if (fd.type !== undefined && !TYPES.has(fd.type)) add(`${n}: unknown type "${fd.type}"`);
      if (fd.type === 'enum' && !(Array.isArray(fd.enum) && fd.enum.length && fd.enum.every((e) => e && typeof e === 'object' && 'value' in e && typeof e.label === 'string'))) add(`${n}: an enum needs "enum": [{"value":..,"label":".."}]`);
      if (fd.level !== undefined && !LEVELS.has(fd.level)) add(`${n}: level must be normal, advanced or danger`);
      if (fd.confidence !== undefined && !CONFIDENCE.has(fd.confidence)) add(`${n}: confidence must be documented, observed or inferred`);
      if (fd.min !== undefined && fd.max !== undefined && fd.min > fd.max) add(`${n}: min is above max`);
      for (const t of ['label', 'help', 'unit', 'typical', 'risk', 'pattern', 'group']) if (fd[t] !== undefined && typeof fd[t] !== 'string') add(`${n}: ${t} must be text`);
      if (fd.pattern !== undefined) { try { new RegExp(fd.pattern); } catch (e) { add(`${n}: pattern is not a valid expression`); } }
      if (fd.help && fd.help.length > 900) add(`${n}: help is longer than 900 characters`);
    }
  });
  return out;
}

function readDir(dir, origin, list, errors) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names.sort()) {
    if (!/\.json$/i.test(n)) continue;
    const p = path.join(dir, n);
    try {
      if (fs.statSync(p).size > 4 * 1048576) throw new Error('larger than 4 MiB');
      const d = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
      const pr = problems(d);
      if (pr.length) throw new Error(pr.slice(0, 3).join('; '));
      list.push(prepare(d, origin, n));
    } catch (e) { errors.push({ file: origin + '/' + n, message: e.message }); }
  }
}
function prepare(d, origin, file) {
  const files = d.files.map((f) => ({
    ...f, _re: globRe(f.match),
    _fields: Object.entries(f.fields || {}).map(([k, v]) => ({ ...v, path: k, _re: patRe(k), _wild: k.includes('*') })),
  }));
  return { ...d, files, _origin: origin, _file: file };
}

// dirs: [{ dir, origin }]. A mod found twice (built in and user): the user's file wins.
function load(dirs) {
  const list = [], errors = [];
  for (const { dir, origin } of dirs) readDir(dir, origin, list, errors);
  const byId = new Map();
  for (const d of list) byId.set(d.mod.id, d);
  return { mods: [...byId.values()].sort((a, b) => a.mod.name.localeCompare(b.mod.name)), errors };
}

// Path of a value as the schema writes it: ['items', 3, 'name'] -> 'items[].name'
function normPath(p) {
  let acc = '';
  for (const k of p) acc = typeof k === 'number' ? acc + '[]' : (acc ? acc + '.' + k : String(k));
  return acc;
}
function fieldFor(fileSchema, p) {
  if (!fileSchema) return null;
  const key = Array.isArray(p) ? normPath(p) : p;
  const exact = fileSchema._fields.find((f) => !f._wild && f.path === key);
  return exact || fileSchema._fields.find((f) => f._wild && f._re.test(key)) || null;
}
function findFile(schemas, modFolder, rel) {
  for (const s of schemas.mods) {
    if (s.mod.folder.toLowerCase() !== String(modFolder).toLowerCase()) continue;
    const hit = s.files.filter((f) => f._re.test(rel)).sort((a, b) => (a.match.includes('*') ? 1 : 0) - (b.match.includes('*') ? 1 : 0))[0];
    return { mod: s, file: hit || null };
  }
  return { mod: null, file: null };
}

const label = (f) => (f && f.label) || 'This value';
// A message for a value that does not fit its descriptor, or null.
function check(f, v) {
  if (!f || !f.type) return null;
  const name = label(f);
  const special = f.special && Object.prototype.hasOwnProperty.call(f.special, String(v));
  switch (f.type) {
    case 'int': case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${name} must be a number.`;
      if (f.type === 'int' && !Number.isInteger(v)) return `${name} must be a whole number.`;
      if (!special && f.min !== undefined && v < f.min) return `${name} cannot be below ${f.min}${f.unit ? ' ' + f.unit : ''}.`;
      if (!special && f.max !== undefined && v > f.max) return `${name} cannot be above ${f.max}${f.unit ? ' ' + f.unit : ''}.`;
      return null;
    case 'flag': return v === 0 || v === 1 ? null : `${name} must be 0 (off) or 1 (on).`;
    case 'bool': return typeof v === 'boolean' ? null : `${name} must be true or false.`;
    case 'enum': return (f.enum || []).some((e) => e.value === v) ? null : `${name} must be one of: ${(f.enum || []).map((e) => e.value).join(', ')}.`;
    case 'string': case 'text': case 'secret': case 'steamid': case 'classname': case 'url': case 'time': case 'color':
      if (typeof v !== 'string') return `${name} must be text.`;
      if (f.maxLength && v.length > f.maxLength) return `${name} is longer than ${f.maxLength} characters.`;
      if (f.type === 'color' && v !== '' && !/^(#|0x)?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(v)) return `${name} must be a colour in hex (for example FF6FA8DC).`;
      if (f.type === 'steamid' && v !== '' && !/^7656119\d{10}$/.test(v) && !/^[A-Za-z0-9+/=_-]{20,60}$/.test(v) && !/^Add here/i.test(v)) return `${name} must be a Steam 64 id (17 digits starting 7656119) or a DayZ player id.`;
      if (f.type === 'url' && v !== '' && !/^https?:\/\/\S+$/i.test(v)) return `${name} must be an address starting with http:// or https://.`;
      if (f.type === 'time' && v !== '' && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) return `${name} must be a time such as 18:30.`;
      if (f.type === 'classname' && v !== '' && !/^[A-Za-z0-9_]{1,120}$/.test(v)) return `${name} must be a DayZ class name (letters, digits and underscore only).`;
      if (f.pattern && v !== '' && !new RegExp(f.pattern).test(v)) return `${name} does not have the expected form.`;
      return null;
    case 'list': return Array.isArray(v) ? null : `${name} must be a list.`;
    case 'object': return v && typeof v === 'object' && !Array.isArray(v) ? null : `${name} must be an object.`;
    default: return null;
  }
}

// All problems of a value against a file schema: [{ path, message, level }]. Depth is limited (hostile files).
function validate(fileSchema, value) {
  const out = [];
  if (!fileSchema) return out;
  const walk = (v, p, depth) => {
    if (depth > 60 || out.length > 500) return;
    const f = fieldFor(fileSchema, p);
    if (f && p.length) {
      const m = check(f, v);
      if (m) out.push({ path: p, message: m, level: 'error' });
      else if (f.level === 'danger' && f.default !== undefined && v !== f.default && f.risk) out.push({ path: p, message: f.risk, level: 'warn' });
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i], depth + 1));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], [...p, k], depth + 1);
  };
  walk(value, [], 0);
  return out;
}

module.exports = { load, problems, normPath, fieldFor, findFile, check, validate, TYPES, globRe };
