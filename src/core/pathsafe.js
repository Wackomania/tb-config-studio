'use strict';
// Path safety for the file manager. Everything a client sends as a path goes through parseRel() (pure text checks) and then
// resolve() (walks the real folder tree component by component and refuses anything that leads outside the root).
// Rules (applied on every OS so a folder behaves the same everywhere):
//   - relative to a root only: no drive letters, no UNC (\\server\share, \\?\C:\), no ':' anywhere (also blocks NTFS streams "a.txt:s")
//   - '..' is refused in any spelling: plain, back-slashed, percent-encoded (also double encoded), full-width or other look-alikes
//   - Windows name traps are refused: trailing dot/space, device names (CON, NUL, COM1...), 8.3 short names (PROGRA~1), < > " | ? *
//   - symlinks and junctions are followed only when their real target is inside the root (or in config files.allowedLinkTargets);
//     a link that leads elsewhere is never entered, but the link itself can still be listed, renamed and deleted
//   - names starting with ".dhm" are reserved for the Manager (trash, upload temp files)
//   - errors never contain absolute paths
const fs = require('node:fs');
const path = require('node:path');

const isWin = process.platform === 'win32';
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });
const norm = (p) => (isWin ? String(p).toLowerCase() : String(p));

const MAX_REL = 1024;
const MAX_COMP = 255;
const MAX_DEPTH = 64;
const RESERVED_NAME = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
const SHORT_8_3 = /^[^.~]{1,6}~\d+(\.[^.]{0,3})?$/;
const BAD_CHARS = /[<>:"|?*\u0000-\u001f\u007f]/;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00ad]/;
const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;

function isInside(root, p) {
  const r = norm(root), q = norm(p);
  return q === r || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}
const samePath = (a, b) => norm(path.resolve(a)) === norm(path.resolve(b));

// Reason a single name is unusable, or null.
function nameProblem(name) {
  if (typeof name !== 'string' || !name) return 'empty name';
  if (name.length > MAX_COMP) return 'name too long';
  if (BAD_CHARS.test(name)) return 'forbidden character';
  if (INVISIBLE.test(name)) return 'invisible or direction-changing character';
  if (/^\.+$/.test(name)) return 'dots only';
  if (/[. ]$/.test(name)) return 'ends with a dot or space';
  if (/^ /.test(name)) return 'starts with a space';
  if (RESERVED_NAME.test(name.split('.')[0].trim())) return 'reserved device name';
  if (SHORT_8_3.test(name)) return 'short (8.3) name';
  if (/^\.dhm/i.test(name)) return 'reserved by the Manager';
  const n = name.normalize('NFKC');
  if (n !== name && (/^\.+$/.test(n) || /[<>:"|?*/\\]/.test(n) || /^\.dhm/i.test(n))) return 'look-alike character';
  return null;
}

// Text -> list of safe path components (empty list = the root itself). Throws 400 with a readable message.
function parseRel(input) {
  if (input === undefined || input === null) input = '';
  if (typeof input !== 'string') throw fail(400, 'The path must be text.');
  if (input.length > MAX_REL) throw fail(400, 'The path is too long.');
  if (/[\u0000-\u001f\u007f]/.test(input)) throw fail(400, 'The path contains control characters.');
  if (/^[\\/]{2}/.test(input)) throw fail(400, 'Network (UNC) and device paths are not allowed.');
  if (/^[A-Za-z]:/.test(input)) throw fail(400, 'Use a path relative to the folder, without a drive letter.');
  // '..' and encoded separators in any spelling (percent-encoding up to three levels, Unicode compatibility forms)
  let probe = input;
  const seps = (s) => (s.match(/[\\/]/g) || []).length;
  for (let i = 0; i < 5; i++) {
    for (const f of [probe, probe.normalize('NFKC')]) {
      if (TRAVERSAL.test(f) || /^\.\.$/.test(f)) throw fail(400, 'Paths with ".." are not allowed.');
      if (f.includes(':')) throw fail(400, 'A colon in a path is not allowed (drive letters and data streams are refused).');
      if (/^[\\/]{2}/.test(f)) throw fail(400, 'Network (UNC) and device paths are not allowed.');
      if (seps(f) > seps(input)) throw fail(400, 'Encoded path separators are not allowed.');
    }
    let d;
    try { d = decodeURIComponent(probe); } catch (e) { break; }
    if (d === probe) break;
    probe = d;
  }
  const comps = [];
  for (const c of input.split(/[\\/]+/)) {
    if (c === '' || c === '.') continue;
    if (c === '..') throw fail(400, 'Paths with ".." are not allowed.');
    const p = nameProblem(c);
    if (p) throw fail(400, `The name "${printable(c)}" cannot be used (${p}).`);
    comps.push(c);
  }
  if (comps.length > MAX_DEPTH) throw fail(400, 'The path is nested too deeply.');
  return comps;
}
function printable(s) { return String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '?').slice(0, 80); }

// Opens a root: a real directory plus the rules that go with it.
//   dir: absolute folder; paths: servers.paths(server) when this is the server root (its inside() is the first gate)
//   protect: absolute paths inside the root that can never be deleted/moved (the exe, keys, ...)
function openRoot({ name, dir, paths = null, protect = [], allowedLinks = [], guards = [] }) {
  let real;
  try { real = fs.realpathSync.native(dir); } catch (e) { throw fail(404, 'That folder does not exist on this machine.'); }
  let st; try { st = fs.statSync(real); } catch (e) { st = null; }
  if (!st || !st.isDirectory()) throw fail(404, 'That folder does not exist on this machine.');
  const links = [];
  for (const l of allowedLinks || []) { try { links.push(fs.realpathSync.native(l)); } catch (e) { /* target missing: ignore */ } }
  const guardReal = [];
  for (const g of guards || []) { try { const gr = fs.realpathSync.native(g); if (isInside(real, gr) && !samePath(real, gr)) guardReal.push(gr); } catch (e) { /* not there */ } }
  const protectedAbs = [];
  for (const p of protect) {
    if (!p) continue;
    const rel = path.relative(path.resolve(dir), path.resolve(p));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const lexical = path.join(real, rel);
    protectedAbs.push(lexical);
    try { const rp = fs.realpathSync.native(lexical); if (!samePath(rp, lexical)) protectedAbs.push(rp); } catch (e) { /* not there yet */ }
  }
  return { name, real, paths, protectedAbs, links, guardReal };
}

function allowedTarget(root, real) {
  if (isInside(root.real, real)) return true;
  return root.links.some(l => isInside(l, real));
}

// True when abs is a protected path, or contains one (deleting a parent would delete it).
function isProtected(root, abs) {
  if (samePath(abs, root.real)) return true;
  return root.protectedAbs.some(p => samePath(p, abs) || isInside(abs, p)) || root.guardReal.some(g => isInside(abs, g));
}

// Resolves text relative to a root. opts.leaf: 'follow' (default) | 'nofollow' (operate on a link itself).
// Returns { comps, rel, abs, exists, lst, isLink, isRoot, missing, parent } where abs is built on real directories.
function resolve(root, input, opts = {}) {
  const comps = parseRel(input);
  if (root.paths && comps.length) root.paths.inside(comps.join(path.sep));      // the registry's own confinement check (first gate)
  const nofollow = opts.leaf === 'nofollow';
  let cur = root.real, lst = null, isLink = false, exists = true, missing = 0, lastExisting = root.real;
  try { lst = fs.lstatSync(root.real); } catch (e) { throw fail(404, 'That folder does not exist on this machine.'); }
  for (let i = 0; i < comps.length; i++) {
    const next = path.join(cur, comps[i]);
    const last = i === comps.length - 1;
    let st;
    try { st = fs.lstatSync(next); } catch (e) {
      if (e.code === 'ENOENT') { exists = false; missing = comps.length - i; cur = path.join(cur, ...comps.slice(i)); lst = null; break; }
      if (e.code === 'ENOTDIR') throw fail(400, 'Part of that path is a file, not a folder.');
      throw fsError(e);
    }
    if (st.isSymbolicLink()) {
      if (last && nofollow) { cur = next; lst = st; isLink = true; lastExisting = path.dirname(next); break; }
      let real;
      try { real = fs.realpathSync.native(next); } catch (e) { throw fail(403, 'That item is a link whose target is missing, so it cannot be opened.'); }
      if (!allowedTarget(root, real)) throw fail(403, 'That item is a link that leads outside the allowed folder, so it cannot be opened.');
      let rs; try { rs = fs.lstatSync(real); } catch (e) { throw fail(404, 'Not found.'); }
      cur = real; lst = rs; isLink = true; lastExisting = real;
      if (!last && !rs.isDirectory()) throw fail(400, 'Part of that path is a file, not a folder.');
      continue;
    }
    if (!last && !st.isDirectory()) throw fail(400, 'Part of that path is a file, not a folder.');
    cur = next; lst = st; lastExisting = next;
  }
  // Short names, case aliases of mount points and anything else that resolves elsewhere: compare with the OS's own answer.
  const probe = exists ? ((isLink && nofollow && comps.length) ? path.dirname(cur) : cur) : lastExisting;
  let rp;
  try { rp = fs.realpathSync.native(probe); } catch (e) { throw fail(404, 'Not found.'); }
  if (norm(rp) !== norm(probe)) throw fail(403, 'That path resolves to a different place than it names (short name or link), so it was refused.');
  if (!allowedTarget(root, cur)) throw fail(403, 'That path is outside the allowed folder.');
  if (root.guardReal.some(g => isInside(g, cur))) throw fail(403, 'That area belongs to the Manager and cannot be used.');
  return { comps, rel: comps.join('/'), abs: cur, exists, lst, isLink, isRoot: comps.length === 0, missing, parent: path.dirname(cur) };
}

// Checks that a resolved path still names the same place (called right after opening, against swaps during the request).
function stillSame(root, t) {
  try {
    const probe = t.exists && !(t.isLink && t.lst && t.lst.isSymbolicLink()) ? t.abs : path.dirname(t.abs);
    const rp = fs.realpathSync.native(probe);
    return norm(rp) === norm(probe) && allowedTarget(root, rp);
  } catch (e) { return false; }
}

function fsError(e) {
  const c = e && e.code;
  if (c === 'ENOENT') return fail(404, 'Not found.');
  if (c === 'ENOTDIR') return fail(400, 'Part of that path is a file, not a folder.');
  if (c === 'EISDIR') return fail(400, 'That is a folder.');
  if (c === 'EEXIST') return fail(409, 'Something with that name already exists.');
  if (c === 'ENOTEMPTY') return fail(409, 'The folder is not empty.');
  if (c === 'EBUSY' || c === 'ETXTBSY') return fail(423, 'The file is in use by another program (for example the running server). Try again later.');
  if (c === 'EPERM' || c === 'EACCES') return fail(423, 'Windows refused access. The item may be read-only, locked by another program, or protected.');
  if (c === 'ENOSPC') return fail(507, 'The disk is full.');
  if (c === 'EMFILE' || c === 'ENFILE') return fail(503, 'Too many files are open right now. Try again in a moment.');
  if (c === 'ENAMETOOLONG') return fail(400, 'The path is too long for the operating system.');
  if (c === 'EXDEV') return fail(409, 'That move crosses drives and is not supported.');
  if (e && e.status) return e;
  return fail(500, 'The file operation failed.');
}

module.exports = { parseRel, nameProblem, openRoot, resolve, stillSame, isProtected, isInside, samePath, allowedTarget, fsError, fail, printable, norm, isWin };
