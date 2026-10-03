'use strict';
// Config packs: a pack is a plain folder copy (<pack>\TBMods\Config\<Mod>\...) that can also be dropped into a server profile by hand.
// Export copies the chosen mods; with stripSecrets the webhook addresses, keys and Steam ids are removed from the copy.
// Import compares a pack (or any other profile folder) with the open workspace, shows what would change and writes only the chosen files,
// each with a backup first.
const fs = require('node:fs');
const path = require('node:path');
const json = require('./json');
const mask = require('./mask');
const fsx = require('./fsx');
const locate = require('./locate');
const pathsafe = require('./pathsafe');
const compare = require('./compare');

const MANIFEST = 'tb-config-studio-pack.json';

function stripSecretsFrom(text, rel) {
  let doc; try { doc = json.parseDoc(text); } catch (e) { return text; }
  const val = doc.value; let changed = false;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) {
        if (/^7656119\d{10}$/.test(k)) { changed = true; continue; }                       // a player entry: dropped
        Object.defineProperty(o, k, { value: walk(v[k], k), enumerable: true, writable: true, configurable: true });
      }
      return o;
    }
    if (mask.secretValue(key, v, rel)) { changed = true; return ''; }
    return v;
  };
  const nv = walk(val, null);
  if (!changed) return text;
  try { return doc.apply(nv); } catch (e) { return JSON.stringify(nv, null, 2) + '\n'; }
}

function exportPack(ws, destInput, { mods, stripSecrets = true, name = '' } = {}) {
  const dest = locate.cleanInput(destInput);
  if (pathsafe.isInside(ws.root.real, dest) || pathsafe.isInside(dest, ws.root.real)) throw fsx.bad('Choose a folder outside the config folder (and not a parent of it).');
  if (fs.existsSync(dest)) {
    const st = fs.lstatSync(dest);
    if (!st.isDirectory()) throw fsx.bad('That is not a folder.');
    if (fs.readdirSync(dest).length) throw fsx.bad('The folder is not empty. Choose a new or empty folder so nothing is overwritten.', 409);
  }
  const { files } = fsx.scan(ws.root);
  const picked = files.filter((f) => !mods || !mods.length || mods.includes(f.mod));
  if (!picked.length) throw fsx.bad('There is nothing to export.');
  const outRoot = path.join(dest, 'TBMods', 'Config');
  const manifest = { app: 'TB Config Studio', format: 1, name: String(name || '').slice(0, 80), createdAt: new Date().toISOString(), secretsRemoved: !!stripSecrets, files: [] };
  for (const f of picked) {
    const src = fsx.read(ws.root, f.path, { max: fsx.MAX_VIEW });
    let buf = src.buf;
    if (stripSecrets && src.utf8) buf = Buffer.from(stripSecretsFrom(src.text, f.path), 'utf8');
    const target = path.join(outRoot, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf, { flag: 'wx' });
    manifest.files.push({ path: f.path, sha256: fsx.sha(buf), size: buf.length });
  }
  fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { ok: true, files: picked.length, folder: dest, secretsRemoved: !!stripSecrets };
}

function packRoot(input) {
  const loc = locate.locate(input);
  if (loc.candidates) throw fsx.bad('That folder holds several profiles. Pick one of them.', 409);
  return { loc, root: pathsafe.openRoot({ name: 'pack', dir: loc.configDir }) };
}

// What an import would do: [{ path, status: 'new'|'changed' }] and the files that are identical.
function importPreview(ws, srcInput, { mods } = {}) {
  const { loc, root } = packRoot(srcInput);
  if (pathsafe.samePath(root.real, ws.root.real)) throw fsx.bad('That is the folder that is open now. Pick a different one.');
  const A = fsx.scan(root).files.filter((f) => !mods || !mods.length || mods.includes(f.mod));
  const B = new Map(fsx.scan(ws.root).files.map((f) => [f.path, f]));
  const items = []; let same = 0;
  for (const f of A) {
    const g = B.get(f.path);
    if (!g) { items.push({ path: f.path, status: 'new', size: f.size }); continue; }
    let identical = false; try { identical = f.size === g.size && fsx.read(root, f.path).sha256 === fsx.read(ws.root, f.path).sha256; } catch (e) { identical = false; }
    if (identical) same++; else items.push({ path: f.path, status: 'changed', size: f.size });
  }
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(loc.configDir)), MANIFEST), 'utf8')); } catch (e) { manifest = null; }
  return { ok: true, source: loc.configDir, pack: manifest ? { name: manifest.name || '', createdAt: manifest.createdAt || '', secretsRemoved: !!manifest.secretsRemoved } : null, items, same };
}

async function importApply(ws, srcInput, { files, confirmRunning = false, mods } = {}) {
  const prev = importPreview(ws, srcInput, { mods });
  const { root } = packRoot(srcInput);
  const want = new Set(files && files.length ? files : prev.items.map((i) => i.path));
  const done = [];
  for (const it of prev.items) {
    if (!want.has(it.path)) continue;
    const src = fsx.read(root, it.path, { max: fsx.MAX_EDIT });
    try {
      const r = await ws.writeFile(it.path, src.buf, { reason: 'before import of a pack', confirmRunning });
      done.push({ path: it.path, changed: r.changed, created: !!r.created, backup: r.backup || null });
    } catch (e) { throw Object.assign(e, { extra: { ...(e.extra || {}), done, failedFile: it.path } }); }
  }
  return { ok: true, done, restartNote: ws.RESTART_NOTE };
}

module.exports = { exportPack, importPreview, importApply, stripSecretsFrom, MANIFEST };
