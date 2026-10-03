'use strict';
// Finds the TheModBase config folder from what the owner picked or typed: a server's profile folder (the one that holds TBMods), the TBMods
// folder, the Config folder itself, or a server folder that contains profile folders. Typed paths are checked before anything is opened:
// local absolute paths only (no UNC / device paths, no "..", no data streams, no control characters).
const fs = require('node:fs');
const path = require('node:path');
const pathsafe = require('./pathsafe');

const isWin = process.platform === 'win32';
const fail = pathsafe.fail;

// Text typed by a person -> a normalised absolute path, or throws a 400 with a readable message.
function cleanInput(input) {
  if (typeof input !== 'string') throw fail(400, 'Enter the path of a folder.');
  let s = input.trim().replace(/^"(.*)"$/, '$1').trim();
  if (!s) throw fail(400, 'Enter the path of a folder.');
  if (s.length > 520) throw fail(400, 'That path is too long.');
  if (/[\u0000-\u001f\u007f]/.test(s)) throw fail(400, 'The path contains control characters.');
  if (/^[\\/]{2}/.test(s)) throw fail(400, 'Network (UNC) and device paths are not supported. Use a folder on this PC (copy the files here first).');
  if (isWin) {
    if (!/^[A-Za-z]:[\\/]/.test(s) && !/^[A-Za-z]:$/.test(s)) throw fail(400, 'Use a full path that starts with a drive letter, for example D:\\DayZServer\\profiles.');
    if (s.slice(2).includes(':')) throw fail(400, 'A colon after the drive letter is not allowed (data streams are refused).');
    if (/[<>"|?*]/.test(s)) throw fail(400, 'The path contains characters Windows does not allow in names.');
  } else if (!s.startsWith('/')) throw fail(400, 'Use a full path.');
  const comps = s.split(/[\\/]+/);
  if (comps.includes('..')) throw fail(400, 'Paths with ".." are not allowed. Type the full path.');
  const dec = (() => { try { return decodeURIComponent(s); } catch (e) { return s; } })();
  if (/(^|[\\/])\.\.([\\/]|$)/.test(dec)) throw fail(400, 'Paths with ".." are not allowed.');
  return path.resolve(s);
}

const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch (e) { return false; } };
// a folder that is itself a link is not entered while searching below the chosen folder
const realDir = (p) => { try { return fs.realpathSync.native(p); } catch (e) { return null; } };

function configIn(dir) {
  const c = path.join(dir, 'TBMods', 'Config');
  return isDir(path.join(dir, 'TBMods')) && isDir(c) ? c : null;
}

// -> { configDir, profileDir } | { candidates: [profileDir...] } ; throws 404/400 with a readable message.
function locate(input) {
  const start = cleanInput(input);
  const real = realDir(start);
  if (!real || !isDir(real)) throw fail(404, 'That folder does not exist on this PC.');
  const base = path.basename(real).toLowerCase();
  const parent = path.dirname(real);
  if (base === 'config' && path.basename(parent).toLowerCase() === 'tbmods') return { configDir: real, profileDir: path.dirname(parent) };
  if (base === 'tbmods' && isDir(path.join(real, 'Config'))) return { configDir: path.join(real, 'Config'), profileDir: parent };
  const direct = configIn(real);
  if (direct) return { configDir: direct, profileDir: real };
  // look one or two levels below (a server folder with profile folders; a workspace folder); links are not followed
  const found = [];
  const look = (dir, depth) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      if (!e.isDirectory() || e.isSymbolicLink() || pathsafe.nameProblem(e.name)) continue;
      const p = path.join(dir, e.name);
      if (configIn(p)) found.push(p); else if (depth < 2) look(p, depth + 1);
      if (found.length > 20) return;
    }
  };
  look(real, 1);
  if (found.length === 1) return { configDir: configIn(found[0]), profileDir: found[0] };
  if (found.length > 1) return { candidates: found };
  throw fail(404, 'No TheModBase configs found there. Pick the server profile folder: the one that contains a TBMods folder (TBMods\\Config\\...). The mods create their configs when the server starts for the first time.');
}

module.exports = { locate, cleanInput };
