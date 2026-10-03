'use strict';
// One opened TheModBase config folder (TBMods\Config of a server profile): overview, viewing a file, planning a change (validation + diff,
// nothing written), saving (conflict check, backup, atomic write), history and rollback. Every write goes through commit() or restore(), so
// every write is validated, backed up and written the same way.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const json = require('./json');
const mask = require('./mask');
const fsx = require('./fsx');
const pathsafe = require('./pathsafe');
const schemaLib = require('./schema');
const { unifiedDiff } = require('./diff');

const bad = fsx.bad;
const conflict = (msg, code, extra = {}) => Object.assign(new Error(msg), { status: 409, extra: { code, ...extra } });
const kindOf = (v) => (Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v);

const RESTART_NOTE = 'The TB mods read their config files only when the server starts. Restart the server for this change to take effect.';

function makeLocks() {
  const m = new Map();
  return async (key, fn) => {
    const prev = m.get(key) || Promise.resolve();
    let release; const mine = new Promise((r) => { release = r; });
    const chain = prev.then(() => mine);
    m.set(key, chain);
    await prev;
    try { return await fn(); } finally { release(); if (m.get(key) === chain) m.delete(key); }
  };
}

function open({ configDir, profileDir, dataDir, schemas, keep = 60 }) {
  const root = pathsafe.openRoot({ name: 'config', dir: configDir });
  const id = crypto.createHash('sha256').update(pathsafe.norm(root.real)).digest('hex').slice(0, 16);
  const backupBase = path.join(dataDir, 'backups');
  const locks = makeLocks();
  const sch = () => (typeof schemas === 'function' ? schemas() : schemas);
  const detectEol = (t) => (/\r\n/.test(t) ? '\r\n' : '\n');
  const problemKey = (p) => (p.path ? p.path.join('.') : '') + '|' + p.message;
  const schemaOf = (rel) => { const c = fsx.classify(rel); return c ? schemaLib.findFile(sch(), c.mod, rel.split('/').slice(1).join('/')) : { mod: null, file: null }; };

  // ------------------------------------------------------------------------------------------------------------------------ overview
  function overview() {
    const { files, truncated, skipped } = fsx.scan(root);
    const byMod = new Map();
    for (const f of files) {
      const rel = f.path.split('/').slice(1).join('/');
      const s = schemaLib.findFile(sch(), f.mod, rel);
      const e = byMod.get(f.mod) || byMod.set(f.mod, { folder: f.mod, files: [] }).get(f.mod);
      e.files.push({ path: f.path, name: f.name, group: f.group, size: f.size, tooLarge: f.tooLarge, title: s.file ? s.file.title : f.name.replace(/\.json$/i, ''), described: !!s.file, mtimeMs: f.mtimeMs });
    }
    const mods = [];
    for (const e of byMod.values()) {
      const s = schemaLib.findFile(sch(), e.folder, 'x.json').mod;
      mods.push({
        folder: e.folder, id: s ? s.mod.id : e.folder, name: s ? s.mod.name : e.folder, known: !!s, summary: s ? s.mod.summary : 'This folder is not described by the app yet. Its files are still shown and can be edited as plain values.',
        coverage: s ? s.mod.coverage : 'none', docs: s ? s.mod.docs || '' : '', fileCount: e.files.length, files: e.files,
        versions: versionsOf(e.folder, e.files),
        undescribed: e.files.filter((f) => !f.described).length,
      });
    }
    mods.sort((a, b) => a.name.localeCompare(b.name));
    const missing = sch().mods.filter((s) => !byMod.has(s.mod.folder) && !mods.some((m) => m.folder.toLowerCase() === s.mod.folder.toLowerCase())).map((s) => ({ id: s.mod.id, folder: s.mod.folder, name: s.mod.name, coverage: s.mod.coverage }));
    return { id, configDir: root.real, profileDir: profileDir || null, mods, missing, fileCount: files.length, truncated, skipped: skipped.slice(0, 50), schemaErrors: sch().errors || [] };
  }
  // The "version" value found at the top level of a mod's own files (the config format version the mod wrote), when there is one.
  const verCache = new Map();
  function versionsOf(folder, files) {
    const out = new Set();
    for (const f of files.filter((x) => !x.group && !x.tooLarge && x.size < 300000).slice(0, 8)) {
      const key = f.path + '|' + f.mtimeMs + '|' + f.size;
      let v = verCache.get(key);
      if (v === undefined) {
        v = null;
        try { const val = json.parseDoc(fs.readFileSync(path.join(root.real, ...f.path.split('/')), 'utf8')).value; if (val && typeof val === 'object' && !Array.isArray(val) && (typeof val.version === 'string' || typeof val.version === 'number')) v = String(val.version); } catch (e) { v = null; }
        verCache.set(key, v);
      }
      if (v) out.add(v);
    }
    return [...out].slice(0, 4);
  }

  // ------------------------------------------------------------------------------------------------------------------------ view
  function publicSchema(rel) {
    const s = schemaOf(rel);
    if (!s.mod) return { mod: null, file: null };
    const m = s.mod.mod;
    return {
      mod: { id: m.id, name: m.name, summary: m.summary, coverage: m.coverage, docs: m.docs || '', notes: m.notes || '' },
      file: s.file ? {
        id: s.file.id, title: s.file.title, summary: s.file.summary || '', restart: s.file.restart !== false, role: s.file.role || '', instances: s.file.instances || 0,
        fields: s.file._fields.map(({ _re, _wild, ...f }) => ({ ...f, wild: _wild })),
      } : null,
    };
  }
  function view(rel) {
    const f = fsx.read(root, rel);
    const c = f.class;
    const out = { path: f.rel, mod: c.mod, group: c.group, name: c.name, sha256: f.sha256, size: f.size, mtimeMs: f.mtimeMs, utf8: f.utf8, restartNote: RESTART_NOTE, runningHint: runningHint() };
    out.schema = publicSchema(f.rel);
    const bom = f.text.charCodeAt(0) === 0xfeff;
    const body = bom ? f.text.slice(1) : f.text;
    let doc;
    try { doc = json.parseDoc(f.text); } catch (e) {
      out.parseError = e.message; out.editable = false;
      const masked = mask.maskText(body);
      out.raw = masked; out.rawEditable = f.utf8 && masked === body;
      return out;
    }
    const m = mask.maskValue(doc.value, f.rel);
    out.value = m.value; out.hiddenCount = m.hidden;
    out.style = { indent: doc.style.unit === '\t' ? 'tab' : doc.style.unit.length, eol: doc.style.eol === '\r\n' ? 'CRLF' : 'LF', bom, comments: doc.hasComments, duplicateKeys: doc.hasDuplicateKeys, trailingNewline: /\n$/.test(body) };
    out.rawEditable = m.hidden === 0 && f.utf8;
    out.raw = m.hidden ? mask.maskText(body) : body;
    out.editable = f.utf8 && !doc.hasDuplicateKeys;
    if (doc.hasDuplicateKeys) out.note = 'The file repeats a key inside one object, so it can only be edited as raw text.';
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------------------ plan / commit
  function plan(rel, req) {
    const f = fsx.read(root, rel, { max: fsx.MAX_EDIT });
    if (!f.utf8) throw bad('The file is not UTF-8 text, so it is not edited here.', 422);
    const out = { rel: f.rel, file: f, errors: [], warnings: [], changed: false, newText: f.text };
    const eol = detectEol(f.text);
    const bom = f.text.charCodeAt(0) === 0xfeff;
    const body = bom ? f.text.slice(1) : f.text;
    const cleanRaw = (raw) => (bom ? '﻿' : '') + String(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n/g, eol);
    if (req.raw !== undefined) {
      if (typeof req.raw !== 'string' || req.raw.length > fsx.MAX_EDIT) throw bad('The text is missing or too long.');
      if (mask.maskText(body) !== body) throw bad('This file holds secrets (webhook addresses, keys, Steam ids), so it is edited field by field, not as raw text.', 403);
      let oldDoc; try { oldDoc = json.parseDoc(f.text); } catch (e) { oldDoc = null; }
      if (oldDoc && mask.maskValue(oldDoc.value, f.rel).hidden) throw bad('This file holds secrets, so it is edited field by field, not as raw text.', 403);
      try { out.newValue = json.parseDoc(req.raw).value; } catch (e) { out.errors.push({ message: 'The text is not valid JSON: ' + e.message }); }
      out.oldValue = oldDoc ? oldDoc.value : undefined;
      out.newText = cleanRaw(req.raw);
    } else {
      let doc; try { doc = json.parseDoc(f.text); } catch (e) { throw bad('The file is not valid JSON, so only the raw text can be changed: ' + e.message, 422); }
      const real = doc.value;
      let ops = req.ops;
      if (!Array.isArray(ops)) throw bad('The list of changes is missing.');
      ops = ops.filter((op) => !(op && op.op === 'set' && op.value === mask.HIDDEN)).map((op) => {
        if (op && Array.isArray(op.path)) op = { ...op, path: mask.realPath(op.path, real) };
        if (op && op.value !== undefined && mask.hasMarker(op.value)) throw bad('A hidden value cannot be written back. Type the new value instead.');
        return op;
      });
      const nv = json.applyOps(real, ops);
      // a field keeps its kind: a number stays a number (a blank is never turned into 0), text stays text
      for (const op of ops) {
        if (op.op !== 'set' || !op.path.length) continue;
        const was = json.getAt(real, op.path);
        if (was !== undefined && was !== null && op.value !== null && kindOf(was) !== kindOf(op.value)) out.errors.push({ path: op.path, message: `The value of "${String(op.path[op.path.length - 1])}" is ${kindOf(was)}, it cannot become ${kindOf(op.value)}.` });
      }
      out.oldValue = real; out.newValue = nv;
      try { out.newText = doc.apply(nv); } catch (e) { throw bad(e.message, e.status || 422); }
    }
    // the new text must parse and hold exactly the intended value: otherwise it is never written
    if (out.newValue !== undefined && !out.errors.length) {
      let back; try { back = json.parseDoc(out.newText).value; } catch (e) { throw Object.assign(new Error('The new file could not be built safely (' + e.message + '). Nothing was written.'), { status: 500 }); }
      if (json.canonValue(back) !== json.canonValue(out.newValue)) throw Object.assign(new Error('The new file does not match the change that was asked for. Nothing was written.'), { status: 500 });
    }
    // checks: new problems block saving, problems that were already there are only shown
    if (out.newValue !== undefined) {
      const fs2 = schemaOf(f.rel).file;
      let before = []; try { before = out.oldValue !== undefined ? schemaLib.validate(fs2, out.oldValue) : []; } catch (e) { before = []; }
      const after = schemaLib.validate(fs2, out.newValue);
      const had = new Set(before.map(problemKey));
      for (const p of after) { if (p.level === 'warn' || had.has(problemKey(p))) out.warnings.push(p); else out.errors.push(p); }
    }
    out.changed = out.newText !== f.text;
    const d = unifiedDiff(body, out.newText.replace(/^﻿/, ''), { labelA: f.rel + ' (now)', labelB: f.rel + ' (after saving)', redact: mask.maskLine, maxLines: 4000 });
    out.diff = { identical: d.identical, added: d.added, removed: d.removed, unified: d.unified, truncated: d.truncated };
    if (req.base && req.base.sha256 && req.base.sha256 !== f.sha256) out.conflict = true;
    out.running = runningHint();
    return out;
  }
  const pe = (x) => ({ path: x.path, message: x.message, level: x.level || 'error' });
  const publicPlan = (p) => ({ ok: true, path: p.rel, changed: p.changed, valid: !p.errors.length, errors: p.errors.map(pe), warnings: p.warnings.map(pe), diff: p.diff, conflict: !!p.conflict, running: p.running, sha256: p.file.sha256, restartNote: RESTART_NOTE });

  async function commit(rel, req) {
    return locks(String(rel).toLowerCase(), async () => {
      const p = plan(rel, req);
      if (p.errors.length) throw Object.assign(bad(p.errors[0].message, 422), { extra: { errors: p.errors.map(pe) } });
      if (!p.changed) return { ok: true, changed: false, path: p.rel };
      if (!(req.base && req.base.sha256)) throw bad('The save needs the "base" of the file that was opened (its sha256).');
      if (p.conflict && !req.overwrite) throw conflict('The file was changed by someone or something else after you opened it. Reload it, or save over it anyway.', 'changed', { current: p.file.sha256 });
      if (p.running && !req.confirmRunning) throw conflict('The server seems to be running (its log changed in the last minutes). The mods may write their files again when the server stops, which would undo this change. Confirm to save anyway.', 'running');
      const backup = fsx.makeBackup(backupBase, id, p.rel, p.file, { reason: req.reason || 'before save', note: req.note || '' }, keep);
      const sha = await fsx.atomicWrite(p.file.abs, p.newText);
      return { ok: true, changed: true, path: p.rel, backup, sha256: sha, added: p.diff.added, removed: p.diff.removed, restartNote: RESTART_NOTE };
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------ history / rollback
  function history(rel) { const t = fsx.read(root, rel, { max: fsx.MAX_VIEW }); return { path: t.rel, backups: fsx.listBackups(backupBase, id, t.rel) }; }
  function allBackups() { return { backups: fsx.listAllBackups(backupBase, id) }; }
  function backupView(rel, bid) {
    let curText = '';
    let cur = null;
    try { cur = fsx.read(root, rel, { max: fsx.MAX_VIEW }); curText = cur.text; } catch (e) { if (e.status !== 404) throw e; }
    const b = fsx.readBackup(backupBase, id, rel, bid);
    const body = (t) => t.replace(/^﻿/, '');
    const d = unifiedDiff(body(curText), body(b.text), { labelA: 'now', labelB: 'backup ' + bid, redact: mask.maskLine, maxLines: 4000 });
    return { ok: true, path: rel, id: bid, size: b.size, sha256: b.sha256, diff: { identical: d.identical, added: d.added, removed: d.removed, unified: d.unified, truncated: d.truncated }, sameAsNow: !!cur && b.sha256 === cur.sha256, fileMissing: !cur };
  }
  async function restore(rel, req) {
    return locks(String(rel).toLowerCase(), async () => {
      const t = pathsafe.resolve(root, rel);
      const c = fsx.classify(t.rel);
      if (!c) throw bad('That kind of file is not handled by the app.');
      const cur = t.exists ? fsx.read(root, rel, { max: fsx.MAX_EDIT }) : null;
      const b = fsx.readBackup(backupBase, id, t.rel, req.backupId);
      if (req.base && req.base.sha256 && cur && req.base.sha256 !== cur.sha256 && !req.overwrite) throw conflict('The file was changed after you opened it. Reload, or restore over it anyway.', 'changed', { current: cur.sha256 });
      if (runningHint() && !req.confirmRunning) throw conflict('The server seems to be running. The mods may write their files again when the server stops. Confirm to restore anyway.', 'running');
      if (cur && b.sha256 === cur.sha256) return { ok: true, changed: false, path: t.rel };
      let undo = null;
      if (cur) undo = fsx.makeBackup(backupBase, id, t.rel, cur, { reason: 'before restoring ' + req.backupId }, keep);
      else fs.mkdirSync(path.dirname(t.abs), { recursive: true });
      const sha = await fsx.atomicWrite(t.abs, b.buf);
      return { ok: true, changed: true, path: t.rel, undoBackup: undo, sha256: sha, restartNote: RESTART_NOTE };
    });
  }

  // Whole-file write (pack import): same backup and atomic write. buf is the new content; the file is created when missing.
  async function writeFile(rel, buf, { reason = 'before import', confirmRunning = false } = {}) {
    return locks(String(rel).toLowerCase(), async () => {
      const t = pathsafe.resolve(root, rel);
      const c = fsx.classify(t.rel);
      if (!c) throw bad('That kind of file is not handled by the app.', 400);
      if (t.exists && !(t.lst && t.lst.isFile())) throw bad('That is not a file.');
      try { json.parseDoc(fsx.decode(buf).text); } catch (e) { throw bad(t.rel + ' is not valid JSON: ' + e.message, 422); }
      const cur = t.exists ? fsx.read(root, rel, { max: fsx.MAX_EDIT }) : null;
      if (cur && cur.sha256 === fsx.sha(buf)) return { ok: true, changed: false, path: t.rel };
      if (runningHint() && !confirmRunning) throw conflict('The server seems to be running. Confirm to write anyway.', 'running');
      let backup = null;
      if (cur) backup = fsx.makeBackup(backupBase, id, t.rel, cur, { reason }, keep); else fs.mkdirSync(path.dirname(t.abs), { recursive: true });
      const sha = await fsx.atomicWrite(t.abs, buf);
      return { ok: true, changed: true, path: t.rel, backup, created: !cur, sha256: sha };
    });
  }

  // A running server writes its log all the time: a recent .RPT / script log in the profile folder means it is probably running.
  function runningHint(now = Date.now()) {
    if (!profileDir) return false;
    try {
      for (const n of fs.readdirSync(profileDir)) {
        if (!/\.(rpt|adm)$|^script.*\.log$/i.test(n)) continue;
        const st = fs.statSync(path.join(profileDir, n));
        if (now - st.mtimeMs < 120000) return true;
      }
    } catch (e) { /* no profile folder access */ }
    return false;
  }

  const api = { id, root, configDir: root.real, profileDir: profileDir || null, overview, view, plan, publicPlan, commit, history, allBackups, backupView, restore, writeFile, runningHint, schemaOf, schemas: sch, backupBase, locks, RESTART_NOTE };
  return api;
}

module.exports = { open, conflict, RESTART_NOTE };
