'use strict';
// The local server of TB Config Studio: serves the window (static files) and a small JSON API. It listens on 127.0.0.1 only, makes no network
// calls to anything else, and has no telemetry. Every API call needs the session cookie (set when the window is opened with the one-time
// token in its address), a matching Host header (DNS rebinding) and, for POST, the custom header x-tbs (cross-site requests).
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const locate = require('../core/locate');
const schemaLib = require('../core/schema');
const workspaceLib = require('../core/workspace');
const searchLib = require('../core/search');
const compare = require('../core/compare');
const presetLib = require('../core/presets');
const licence = require('../core/licence');
const pack = require('../core/pack');
const windowLib = require('./window');
const pkg = require('../../package.json');

const ROOT = path.join(__dirname, '..', '..');
const UI = process.env.TBS_UI_DIR ? path.resolve(process.env.TBS_UI_DIR) : path.join(ROOT, 'src', 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const MAX_BODY = 12 * 1048576;

const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });

function create({ dataDir, port = 0, onQuit = () => {}, noWindow = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  const schemaDirs = () => [{ dir: path.join(ROOT, 'schemas'), origin: 'built-in' }, { dir: path.join(dataDir, 'schemas-user'), origin: 'user' }];
  let schemas = schemaLib.load(schemaDirs());
  const presets = presetLib.load(path.join(ROOT, 'presets'));
  let ws = null, search = null;
  let lastPing = 0, pinged = false, started = Date.now();
  let win = null;
  const logFile = path.join(dataDir, 'app.log');
  const log = (m) => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + m + '\n'); } catch (e) { /* no log */ } };

  // ---- settings (recent folders, first run); nothing secret is stored
  const settingsFile = path.join(dataDir, 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { return {}; } };
  const writeSettings = (s) => { try { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); } catch (e) { log('settings not saved: ' + e.message); } };
  const remember = (dir) => {
    const s = readSettings(); const list = (s.recent || []).filter((p) => p.toLowerCase() !== dir.toLowerCase());
    list.unshift(dir); s.recent = list.slice(0, 8); writeSettings(s);
  };

  const needWs = () => { if (!ws) throw httpErr(409, 'Open a server profile folder first.'); return ws; };
  function openWorkspace(loc) {
    ws = workspaceLib.open({ configDir: loc.configDir, profileDir: loc.profileDir, dataDir, schemas: () => schemas });
    search = searchLib.make(ws);
    remember(loc.profileDir);
    return ws;
  }
  const state = () => {
    const s = readSettings();
    const alive = (s.recent || []).filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } });
    return {
      app: { name: 'TB Config Studio', version: pkg.version }, recent: s.recent || [], recentAlive: alive, firstRunDone: !!s.firstRunDone,
      overview: ws ? ws.overview() : null,
      schemaMods: schemas.mods.map((m) => ({ id: m.mod.id, folder: m.mod.folder, name: m.mod.name, coverage: m.mod.coverage, origin: m._origin, files: m.files.length, fields: m.files.reduce((a, f) => a + f._fields.length, 0), described: m.files.reduce((a, f) => a + f._fields.filter((x) => x.label && x.help).length, 0), docs: m.mod.docs || '', summary: m.mod.summary, notes: m.mod.notes || '' })),
      schemaErrors: schemas.errors, presetTypes: presetLib.TYPES, presetErrors: presets.errors,
    };
  };

  function pickFolder() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve({ path: null, note: 'The folder picker is available on Windows only. Type the path instead.' });
      const script = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.WindowState = 'Minimized'; $f.Show(); $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose the server profile folder (the one that contains TBMods)'; $d.ShowNewFolderButton = $false; if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }; $f.Close()";
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script], { timeout: 180000, windowsHide: true }, (err, out) => {
        if (err) return resolve({ path: null, note: 'The folder picker could not be opened. Type the path instead.' });
        resolve({ path: String(out || '').trim() || null });
      });
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------ routes
  const routes = {
    'GET /api/state': () => state(),
    'POST /api/ping': () => { lastPing = Date.now(); pinged = true; return { ok: true }; },
    'POST /api/pick-folder': () => pickFolder(),
    'POST /api/open': (b) => {
      const loc = locate.locate(b.path);
      if (loc.candidates) return { ok: true, candidates: loc.candidates };
      openWorkspace(loc);
      return { ok: true, overview: ws.overview() };
    },
    'POST /api/close': () => { ws = null; search = null; return { ok: true }; },
    'POST /api/rescan': () => ({ ok: true, overview: needWs().overview() }),
    'POST /api/forget': (b) => { const s = readSettings(); s.recent = (s.recent || []).filter((p) => p !== b.path); writeSettings(s); return { ok: true }; },
    'POST /api/settings': (b) => { const s = readSettings(); if (typeof b.firstRunDone === 'boolean') s.firstRunDone = b.firstRunDone; writeSettings(s); return { ok: true }; },
    'POST /api/schemas/reload': () => { schemas = schemaLib.load(schemaDirs()); return { ok: true, errors: schemas.errors }; },
    'GET /api/file': (b, q) => needWs().view(q.get('path') || ''),
    'POST /api/plan': (b) => needWs().publicPlan(needWs().plan(b.path, b)),
    'POST /api/save': async (b) => { const r = await needWs().commit(b.path, b); log('saved ' + b.path + (r.backup ? ' backup ' + r.backup : '')); return r; },
    'GET /api/history': (b, q) => needWs().history(q.get('path') || ''),
    'GET /api/backups': () => needWs().allBackups(),
    'GET /api/backup': (b, q) => needWs().backupView(q.get('path') || '', q.get('id') || ''),
    'POST /api/restore': async (b) => { const r = await needWs().restore(b.path, b); log('restored ' + b.path + ' from ' + b.backupId); return r; },
    'GET /api/search': (b, q) => { needWs(); return search.search(q.get('q') || '', { mod: q.get('mod') || '' }); },
    'POST /api/compare': (b) => {
      const w = needWs();
      if (b.mode === 'defaults') return { ok: true, mode: 'defaults', ...compare.compareDefaults(w.root, schemas, b.mods) };
      const loc = locate.locate(b.path);
      if (loc.candidates) throw httpErr(409, 'That folder holds several profiles. Pick one of them.', { candidates: loc.candidates });
      const other = require('../core/pathsafe').openRoot({ name: 'other', dir: loc.configDir });
      return { ok: true, mode: 'folder', other: loc.profileDir, ...compare.compareFolders(w.root, other, schemas) };
    },
    'GET /api/presets': () => ({ types: presets.types, counts: Object.fromEntries(Object.entries(presets.byType).map(([k, v]) => [k, v.reduce((a, g) => a + g.changes.length, 0)])), errors: presets.errors }),
    'POST /api/presets/preview': (b) => presetLib.preview(needWs(), presets, b.type, b.keys, { mods: b.mods }),
    'POST /api/presets/apply': async (b) => { const r = await presetLib.apply(needWs(), presets, b.type, b.keys, { mods: b.mods, confirmRunning: !!b.confirmRunning }); log('preset ' + b.type + ' applied to ' + r.done.length + ' files'); return r; },
    'GET /api/licence': () => { const w = needWs(); return licence.inspect(w.profileDir, w.overview().mods); },
    'POST /api/pack/export': (b) => pack.exportPack(needWs(), b.path, { mods: b.mods, stripSecrets: b.stripSecrets !== false, name: b.name }),
    'POST /api/pack/preview': (b) => pack.importPreview(needWs(), b.path, { mods: b.mods }),
    'POST /api/pack/import': async (b) => { const r = await pack.importApply(needWs(), b.path, { files: b.files, confirmRunning: !!b.confirmRunning, mods: b.mods }); log('pack imported: ' + r.done.length + ' files'); return r; },
    'POST /api/quit': () => { setTimeout(() => onQuit(), 100); return { ok: true }; },
  };

  // ------------------------------------------------------------------------------------------------------------------------ http
  const hostOk = (req, p) => { const h = String(req.headers.host || '').toLowerCase(); return h === '127.0.0.1:' + p || h === 'localhost:' + p; };
  const cookieOk = (req) => (String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('tbs=')) || '').slice(4) === token;
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", ...extra });
    res.end(buf);
  };
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(httpErr(413, 'The request is too large.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { const t = Buffer.concat(chunks).toString('utf8'); resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(httpErr(400, 'The request is not valid JSON.')); } });
      req.on('error', reject);
    });
  }

  let boundPort = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (!hostOk(req, boundPort)) return send(res, 403, { error: 'Wrong host.' });
      const url = new URL(req.url, 'http://127.0.0.1:' + boundPort);
      if (url.pathname === '/_alive') return send(res, 200, 'tbs', 'text/plain');
      if (url.pathname === '/' && url.searchParams.get('t')) {
        if (url.searchParams.get('t') !== token) return send(res, 403, 'The link is not valid for this session.', 'text/plain');
        return send(res, 302, '', 'text/plain', { location: '/', 'set-cookie': 'tbs=' + token + '; Path=/; HttpOnly; SameSite=Strict' });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!cookieOk(req)) return send(res, 401, { error: 'Open the app from its window or shortcut.' });
        const key = req.method + ' ' + url.pathname;
        const fn = routes[key];
        if (!fn) return send(res, 404, { error: 'Unknown request.' });
        let body = {};
        if (req.method === 'POST') {
          if (req.headers['x-tbs'] !== '1') return send(res, 403, { error: 'Missing header.' });
          const o = req.headers.origin; if (o && o !== 'http://127.0.0.1:' + boundPort && o !== 'http://localhost:' + boundPort) return send(res, 403, { error: 'Wrong origin.' });
          body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpErr(400, 'The request must be an object.');
        }
        const out = await fn(body, url.searchParams);
        return send(res, 200, out);
      }
      // static files of the window
      let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
      if (rel.includes('..') || rel.includes('\\') || rel.includes('\0')) return send(res, 400, 'Bad path', 'text/plain');
      const file = path.join(UI, rel);
      if (!file.startsWith(UI + path.sep)) return send(res, 400, 'Bad path', 'text/plain');
      let st; try { st = fs.statSync(file); } catch (e) { return send(res, 404, 'Not found', 'text/plain'); }
      if (!st.isFile()) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status === 500) log('error ' + req.method + ' ' + req.url + ': ' + (e.stack || e.message));
      send(res, status, { error: status === 500 ? 'Something went wrong in the app. Details are in app.log.' : e.message, ...(e.extra ? { extra: e.extra } : {}) });
    }
  });

  let timer = null;
  const api = {
    token, server, dataDir,
    get port() { return boundPort; },
    url: () => `http://127.0.0.1:${boundPort}/?t=${token}`,
    start() {
      return new Promise((resolve, reject) => {
        const tryPort = (p) => {
          server.once('error', (e) => { if (e.code === 'EADDRINUSE' && port && p < port + 8) tryPort(p + 1); else reject(e); });
          server.listen(p, '127.0.0.1', () => {
            boundPort = server.address().port;
            fs.writeFileSync(path.join(dataDir, 'control.json'), JSON.stringify({ port: boundPort, token, pid: process.pid }));
            timer = setInterval(() => {
              const idle = Date.now() - (pinged ? lastPing : started);
              if (idle > (pinged ? 30000 : 90000) && !noWindow) onQuit();
            }, 5000);
            timer.unref();
            resolve(boundPort);
          });
        };
        tryPort(port);
      });
    },
    openWindow() {
      win = windowLib.open(api.url(), path.join(dataDir, 'window-profile'));
      if (win) win.child.on('exit', () => { setTimeout(() => { if (Date.now() - lastPing > 6000) onQuit(); }, 6000).unref(); });
      return win;
    },
    stop() {
      return new Promise((resolve) => {
        clearInterval(timer);
        try { fs.rmSync(path.join(dataDir, 'control.json'), { force: true }); } catch (e) { /* gone */ }
        server.close(() => resolve());
        server.closeAllConnections && server.closeAllConnections();
      });
    },
    state, openWorkspace, routes,
  };
  return api;
}

module.exports = { create };
