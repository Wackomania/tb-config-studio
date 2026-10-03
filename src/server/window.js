'use strict';
// The app window: Microsoft Edge (always on Windows 10/11 and on Server 2022) or Google Chrome in "app mode" (--app=URL): a window with
// no address bar and no tabs, with its own profile folder, so it never touches the owner's normal browser profile. Nothing is installed.
// Why not WebView2: its runtime is not guaranteed on a Server or a fresh Windows 10, and using it from the in-box C# compiler needs a
// third-party DLL. Why not mshta/HTA: it runs the page with the old IE engine, which cannot run the the app's screens.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function candidates(env = process.env) {
  const pf = env.ProgramFiles || 'C:\\Program Files', pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', la = env.LOCALAPPDATA || '';
  const j = (...p) => path.join(...p);
  return [
    { name: 'Microsoft Edge', exe: j(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', exe: j(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Google Chrome', exe: j(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', exe: j(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    ...(la ? [{ name: 'Google Chrome', exe: j(la, 'Google', 'Chrome', 'Application', 'chrome.exe') }] : []),
  ];
}

// -> { name, exe } or null. TBS_BROWSER (a full path) overrides the search, for tests and unusual machines.
function findBrowser({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.TBS_BROWSER && exists(env.TBS_BROWSER)) return { name: 'custom browser', exe: env.TBS_BROWSER };
  return candidates(env).find((c) => exists(c.exe)) || null;
}

function args(url, profileDir, { debugPort = 0, width = 1360, height = 880 } = {}) {
  return [
    `--app=${url}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,msEdgeSidebarV2',
    `--window-size=${width},${height}`, '--disable-sync', '--disable-background-networking',
    ...(debugPort ? [`--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*'] : []),
  ];
}

// Opens the window. Returns { name, pid, child } or null when no browser exists (the caller then says how to open the address by hand).
function open(url, profileDir, opts = {}) {
  const b = findBrowser(opts);
  if (!b) return null;
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(b.exe, args(url, profileDir, opts), { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  const rec = { name: b.name, pid: child.pid, child, alive: true };
  child.on('exit', () => { rec.alive = false; });
  child.on('error', () => { rec.alive = false; });
  return rec;
}

module.exports = { findBrowser, candidates, args, open };
