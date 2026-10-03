'use strict';
// File access of the app: what counts as a TB config file, scanning, reading, atomic writing, backups.
// Everything is confined to the chosen TBMods\Config folder: paths go through pathsafe (no "..", drives, UNC, streams, links that lead
// outside) and links are never followed while scanning.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pathsafe = require('./pathsafe');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_VIEW = 16 * 1048576, MAX_EDIT = 8 * 1048576;
const NEVER = [/licen[cs]e/i, /\.(lic|key|bikey|bisign|pem|pfx|p12|ppk)$/i];              // licences and keys: not even listed
const BACKUP = /(\.(bak|old|orig|tmp|swp|temp|dhmtmp|tbstmp)[^/]*$|~$|\.dayzhub-backup$|\.bak-)/i;
const PLAYER_ID = /7656119\d{10}/;

// What a path relative to TBMods\Config is: { mod, group, name } or null when it is not an editable config file.
function classify(rel) {
  const parts = String(rel).split('/');
  const name = parts[parts.length - 1];
  if (parts.length < 2) return null;                       // files directly in Config belong to no mod folder
  if (NEVER.some((re) => re.test(name) || parts.some((p) => re.test(p)))) return null;
  if (BACKUP.test(name) || parts.some((p) => p.startsWith('.tbs'))) return null;
  if (parts.some((p) => PLAYER_ID.test(p))) return null;   // per-player files are data, not settings
  if (!/\.json$/i.test(name)) return null;
  return { mod: parts[0], group: parts.slice(1, -1).join('/'), name };
}

// Walks the Config folder (no links followed). Returns the config files.
function scan(root, { maxFiles = 30000, maxDepth = 8 } = {}) {
  const files = []; let seen = 0, truncated = false;
  const skipped = [];
  const walk = (abs, rel, depth) => {
    if (depth > maxDepth || truncated) return;
    let list; try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of list) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isSymbolicLink()) { skipped.push({ path: r, why: 'link (not followed)' }); continue; }
      if (pathsafe.nameProblem(e.name)) { skipped.push({ path: r, why: 'unusable name' }); continue; }
      if (e.isDirectory()) { walk(path.join(abs, e.name), r, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (++seen > maxFiles) { truncated = true; return; }
      const c = classify(r);
      if (!c) continue;
      let st; try { st = fs.statSync(path.join(abs, e.name)); } catch (err) { continue; }
      files.push({ path: r, ...c, size: st.size, mtimeMs: Math.round(st.mtimeMs), tooLarge: st.size > MAX_VIEW });
    }
  };
  walk(root.real, '', 0);
  return { files, truncated, skipped };
}

function decode(buf) {
  try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf), utf8: true }; } catch (e) { return { text: buf.toString('latin1'), utf8: false }; }
}

// Reads one file: { abs, rel, class, text (BOM kept as a character), buf, sha256, size, mtimeMs, utf8 }.
function read(root, rel, { max = MAX_VIEW } = {}) {
  const t = pathsafe.resolve(root, rel);
  if (!t.exists) throw bad('That file does not exist.', 404);
  if (!t.lst || !t.lst.isFile()) throw bad('That is not a file.', 400);
  const c = classify(t.rel);
  if (!c) throw bad('That kind of file is not handled by the app.', 400);
  if (t.lst.size > max) throw bad('The file is larger than ' + Math.round(max / 1048576) + ' MiB and is not opened in the app.', 413);
  let buf; try { buf = fs.readFileSync(t.abs); } catch (e) { throw pathsafe.fsError(e); }
  const d = decode(buf);
  return { abs: t.abs, rel: t.rel, class: c, text: d.text, buf, sha256: sha(buf), size: buf.length, mtimeMs: Math.round(t.lst.mtimeMs), utf8: d.utf8 };
}

// Windows file operations fail transiently when antivirus or the game holds a file: bounded retries.
async function retry(fn, { tries = 6, base = 40 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); } catch (e) {
      last = e;
      if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN'].includes(e.code)) throw e;
      await sleep(Math.min(400, base * 2 ** i));
    }
  }
  throw last;
}

// Write temp file + fsync + rename over the target (a crash leaves the old file or the new one, never half of one).
async function atomicWrite(abs, data) {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, '.' + path.basename(abs) + '.tbstmp-' + crypto.randomBytes(4).toString('hex'));
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  try {
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    await retry(() => fs.renameSync(tmp, abs));
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* nothing to clean */ }
    throw pathsafe.fsError(e);
  }
  return sha(buf);
}

// ---------------------------------------------------------------------------------------------------------------------------- backups
// <backups>/<workspace id>/<path of the file>/<timestamp>  (+ <timestamp>.meta.json). Newest first; the oldest beyond `keep` are removed.
const ID_RE = /^\d{8}T\d{9}Z(-\d+)?$/;
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('.', '');
const backupDirOf = (base, wsId, rel) => path.join(base, wsId, ...rel.split('/'));
function makeBackup(base, wsId, rel, file, meta = {}, keep = 60) {
  const dir = backupDirOf(base, wsId, rel);
  fs.mkdirSync(dir, { recursive: true });
  let id = stamp(); let n = 0;
  while (fs.existsSync(path.join(dir, id))) id = stamp() + '-' + (++n);
  fs.writeFileSync(path.join(dir, id), file.buf);
  fs.writeFileSync(path.join(dir, id + '.meta.json'), JSON.stringify({ at: new Date().toISOString(), sha256: file.sha256, size: file.size, reason: meta.reason || '', note: meta.note || '' }));
  const ids = listBackupIds(dir);
  for (const old of ids.slice(keep)) for (const x of [old, old + '.meta.json']) { try { fs.rmSync(path.join(dir, x), { force: true }); } catch (e) { /* kept */ } }
  return id;
}
function listBackupIds(dir) {
  let names = []; try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.filter((n) => ID_RE.test(n)).sort().reverse();
}
function listBackups(base, wsId, rel) {
  const dir = backupDirOf(base, wsId, rel);
  return listBackupIds(dir).map((id) => {
    let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(dir, id + '.meta.json'), 'utf8')); } catch (e) { /* no sidecar */ }
    let size = m.size; if (size === undefined) { try { size = fs.statSync(path.join(dir, id)).size; } catch (e) { size = 0; } }
    return { id, path: rel, at: m.at || null, reason: m.reason || '', note: m.note || '', sha256: m.sha256 || null, size };
  });
}
// Every backup of the workspace, newest first (the rollback list).
function listAllBackups(base, wsId, limit = 500) {
  const top = path.join(base, wsId); const out = [];
  const walk = (dir, rel) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const hasIds = list.some((e) => e.isFile() && ID_RE.test(e.name));
    if (hasIds) out.push(...listBackups(base, wsId, rel));
    for (const e of list) if (e.isDirectory()) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name);
  };
  walk(top, '');
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}
function readBackup(base, wsId, rel, id) {
  if (!ID_RE.test(String(id))) throw bad('That is not a backup id.');
  const f = path.join(backupDirOf(base, wsId, rel), id);
  let buf; try { buf = fs.readFileSync(f); } catch (e) { throw bad('That backup does not exist (any more).', 404); }
  const d = decode(buf);
  return { buf, text: d.text, utf8: d.utf8, sha256: sha(buf), size: buf.length };
}

module.exports = { classify, scan, read, atomicWrite, makeBackup, listBackups, listAllBackups, readBackup, sha, bad, decode, MAX_EDIT, MAX_VIEW, ID_RE };
