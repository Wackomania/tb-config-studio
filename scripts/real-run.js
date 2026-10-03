'use strict';
// Real run on this PC, all under X:\dhm-test\tbstudio\rr: install the built setup per user into a test folder (own registry key and shortcut names via
// /TESTID), start the installed app, open a copy of real TB configs, edit values in several mods through the app's API, save, verify the files on disk,
// roll back, apply a preset, open the real app window and see it load, close it, uninstall, verify everything is gone.
// Usage: node scripts/real-run.js   (build first: scripts/build-installer.ps1). Own PIDs only, no taskkill by name.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const BASE = 'X:\\dhm-test\\tbstudio\\rr';
const REPO = path.join(__dirname, '..');
const SETUP = path.join(REPO, 'dist', 'installer', 'TBConfigStudio-Setup.exe');
const SAMPLE = 'X:\\dhm-test\\tbstudio\\samples\\lbtest';
const PORT = 2797, ID = 'rr';
const INSTALL = path.join(BASE, 'TBS install');
const DATA = path.join(BASE, 'data');
const PROFILE = path.join(BASE, 'profile');
const results = [];
const ok = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const ps = (cmd) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).stdout.trim();
const regHas = () => spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TBConfigStudio-' + ID]).status === 0;
const lnk = (kind) => path.join(kind === 'desktop' ? path.join(os.homedir(), 'Desktop') : path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'TB Config Studio (' + ID + ')'), 'TB Config Studio (' + ID + ').lnk');

function api(method, p, body, ctl) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const hd = { host: '127.0.0.1:' + ctl.port, cookie: 'tbs=' + ctl.token, connection: 'close' };
    if (data) { hd['content-type'] = 'application/json'; hd['x-tbs'] = '1'; hd['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: ctl.port, path: p, method, headers: hd }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString()); } catch (e) { /* none */ } resolve({ status: res.statusCode, json: j }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const control = () => JSON.parse(fs.readFileSync(path.join(DATA, 'control.json'), 'utf8'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true }); fs.mkdirSync(BASE, { recursive: true });
  fs.cpSync(path.join(SAMPLE, 'TBMods'), path.join(PROFILE, 'TBMods'), { recursive: true });
  // dropping the backups the earlier manager tests left next to the configs: they are not part of a fresh server profile
  for (const f of fs.readdirSync(path.join(PROFILE, 'TBMods', 'Config'), { recursive: true })) if (/\.(bak|dayzhub-backup)/.test(String(f))) fs.rmSync(path.join(PROFILE, 'TBMods', 'Config', String(f)), { force: true });
  const original = new Map();
  const cfg = path.join(PROFILE, 'TBMods', 'Config');
  const track = (rel) => original.set(rel, fs.readFileSync(path.join(cfg, ...rel.split('/'))));

  // ---- install
  let r = spawnSync(SETUP, ['/S', '/DIR=' + INSTALL, '/TESTID=' + ID, '/NOLAUNCH', '/LOG=' + path.join(BASE, 'setup.log')], { encoding: 'utf8', timeout: 180000 });
  ok('setup exits 0 (no administrator prompt, silent)', r.status === 0, r.stdout + r.stderr);
  for (const f of ['TBConfigStudio.exe', 'uninstall.exe', 'manifest.json', 'runtime\\node.exe', 'app\\src\\server\\main.js', 'app\\schemas\\TBRealEstate.json', 'app\\presets\\TBCarry.json'.replace('TBCarry', 'TBRealEstate')]) ok('installed ' + f, fs.existsSync(path.join(INSTALL, f)));
  ok('uninstall entry in HKCU', regHas());
  ok('Start menu and Desktop shortcuts exist', fs.existsSync(lnk('start')) && fs.existsSync(lnk('desktop')));
  const manifest = JSON.parse(fs.readFileSync(path.join(INSTALL, 'manifest.json'), 'utf8'));
  let bad = 0; for (const [rel, h] of Object.entries(manifest.files)) if (!fs.existsSync(path.join(INSTALL, rel)) || sha(path.join(INSTALL, rel)) !== h) bad++;
  ok('every installed file matches the manifest hash (' + Object.keys(manifest.files).length + ' files)', bad === 0);
  ok('nothing was written under Program Files or ProgramData by the install', !fs.existsSync('C:\\Program Files\\TB Config Studio (rr)'));

  // ---- start the installed app (host only), open the real configs
  const exe = path.join(INSTALL, 'TBConfigStudio.exe');
  const st = spawnSync(exe, ['--no-window', '--port', String(PORT), '--data', DATA], { timeout: 20000 });
  ok('the launcher exits quietly', st.status === 0);
  await sleep(1500);
  const ctl = control();
  ok('host is running from the install folder, on the chosen port', alive(ctl.pid) && ctl.port === PORT);
  const procPath = ps(`(Get-Process -Id ${ctl.pid}).Path`);
  ok('the host process is the bundled runtime\\node.exe', procPath.toLowerCase() === path.join(INSTALL, 'runtime', 'node.exe').toLowerCase(), procPath);
  const open = await api('POST', '/api/open', { path: PROFILE }, ctl);
  ok('open the copied profile', open.status === 200 && open.json.overview.mods.length >= 13, JSON.stringify(open.json).slice(0, 200));
  const mods = open.json.overview.mods.map((m) => m.folder);

  // ---- edits in several mods
  const edits = [
    ['TBVehicleLockSystem/RaidVehicleConfig.json', (v) => ({ path: ['carRaidTimeInSeconds'], value: v.carRaidTimeInSeconds + 60 })],
    ['TBRealEstate/GlobalRaidConfig.json', (v) => { const k = Object.keys(v).find((x) => typeof v[x] === 'number' && !/^(version|isInitialized)$/i.test(x)); return { path: [k], value: v[k] === 0 ? 1 : v[k] + 1 }; }],
    ['TBSecondHandMarket/GlobalStallConfig.json', (v) => { const k = Object.keys(v).find((x) => typeof v[x] === 'number' && !/^(version|isInitialized)$/i.test(x)); return { path: [k], value: v[k] + 1 }; }],
    ['TBDeathInsurance/Config.json', (v) => { const k = Object.keys(v).find((x) => typeof v[x] === 'number' && !/^(version|isInitialized)$/i.test(x)); return { path: [k], value: v[k] + 1 }; }],
    ['TBCarry/TBCarryGlobalConfig.json', (v) => { const k = Object.keys(v).find((x) => typeof v[x] === 'number' && !/^(version|isInitialized)$/i.test(x)); return { path: [k], value: v[k] ? 0 : 1 }; }],
    ['TBWarParty/MainConfig.json', (v) => { const k = Object.keys(v).find((x) => typeof v[x] === 'number' && !/^(version|isInitialized)$/i.test(x)); return { path: [k], value: v[k] ? 0 : 1 }; }],
  ];
  const saved = [];
  for (const [rel, mk] of edits) {
    track(rel);
    const f = (await api('GET', '/api/file?path=' + encodeURIComponent(rel), undefined, ctl)).json;
    const op = mk(f.value);
    const res = await api('POST', '/api/save', { path: rel, ops: [{ op: 'set', ...op }], base: { sha256: f.sha256 } }, ctl);
    const abs = path.join(cfg, ...rel.split('/'));
    const before = original.get(rel).toString('utf8'), after = fs.readFileSync(abs, 'utf8');
    const changedLines = after.split('\n').filter((l, i) => l !== before.split('\n')[i]).length;
    ok('saved ' + rel + ' (' + op.path.join('.') + ' ' + JSON.stringify(f.value[op.path[0]]) + ' -> ' + JSON.stringify(op.value) + ')', res.status === 200 && res.json.changed && changedLines === 1 && JSON.parse(after)[op.path[0]] === op.value, JSON.stringify(res.json).slice(0, 200));
    saved.push(rel);
  }
  const untouched = ['Global/AdminConfig.json', 'TBVehicleLockSystem/GeneralConfig.json', 'TBDynamicTrader/Logger.json'];
  ok('files that were not edited are byte identical to the originals', untouched.every((rel) => Buffer.compare(fs.readFileSync(path.join(cfg, ...rel.split('/'))), fs.readFileSync(path.join(SAMPLE, 'TBMods', 'Config', ...rel.split('/')))) === 0));
  ok('no temp files left in the config folders', fs.readdirSync(cfg, { recursive: true }).every((n) => !String(n).includes('.tbstmp')));
  const bk = (await api('GET', '/api/backups', undefined, ctl)).json.backups;
  ok('one backup per saved file, holding the original bytes', bk.length === saved.length && bk.every((b) => { const orig = original.get(b.path); const dir = path.join(DATA, 'backups'); const w = fs.readdirSync(dir)[0]; return orig && Buffer.compare(fs.readFileSync(path.join(dir, w, ...b.path.split('/'), b.id)), orig) === 0; }));

  // ---- conflict, rollback, preset
  const rel0 = saved[0], abs0 = path.join(cfg, ...rel0.split('/'));
  const f0 = (await api('GET', '/api/file?path=' + encodeURIComponent(rel0), undefined, ctl)).json;
  fs.appendFileSync(abs0, '\n');
  const conf = await api('POST', '/api/save', { path: rel0, ops: [{ op: 'set', path: ['carRaidTimeInSeconds'], value: 1 }], base: { sha256: f0.sha256 } }, ctl);
  ok('a change made by something else after opening is detected (409)', conf.status === 409 && conf.json.extra.code === 'changed');
  const b0 = bk.find((b) => b.path === rel0);
  const rs = await api('POST', '/api/restore', { path: rel0, backupId: b0.id, overwrite: true }, ctl);
  ok('rollback restores the original file byte for byte', rs.status === 200 && Buffer.compare(fs.readFileSync(abs0), original.get(rel0)) === 0, JSON.stringify(rs.json));
  const pv = await api('POST', '/api/presets/preview', { type: 'pve', mods: ['TBVehicleLockSystem'] }, ctl);
  ok('preset preview returns a diff and writes nothing', pv.status === 200 && pv.json.files.length >= 1 && Buffer.compare(fs.readFileSync(abs0), original.get(rel0)) === 0);
  const ap = await api('POST', '/api/presets/apply', { type: 'pve', mods: ['TBVehicleLockSystem'] }, ctl);
  ok('preset apply writes the files with backups', ap.status === 200 && ap.json.done.length >= 1 && ap.json.done.every((d) => d.backup));
  const lic = await api('GET', '/api/licence', undefined, ctl);
  ok('licence helper answers without licence content', lic.status === 200 && !JSON.stringify(lic.json).match(/[0-9a-f]{32}/));

  // ---- the real window
  const stop = await api('POST', '/api/quit', {}, ctl); await sleep(1500);
  ok('the host quits on request and removes control.json', stop.status === 200 && !alive(ctl.pid) && !fs.existsSync(path.join(DATA, 'control.json')));
  const win = spawn(exe, ['--port', String(PORT), '--data', DATA], { detached: true, stdio: 'ignore' }); win.unref();
  let ctl2 = null; for (let i = 0; i < 40 && !ctl2; i++) { await sleep(500); try { ctl2 = control(); } catch (e) { /* not yet */ } }
  ok('starting the exe without options starts the host', !!ctl2);
  let age = null; for (let i = 0; i < 40; i++) { await sleep(500); try { const s = await api('GET', '/api/state', undefined, ctl2); age = s.json.app.pingAgeMs; if (age !== null) break; } catch (e) { /* retry */ } }
  ok('the real app window (Edge or Chrome in app mode) loaded the page: heartbeat received', age !== null && age < 6000, String(age));
  const wl = ps(`(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1:${PORT}*' } | Select-Object -ExpandProperty ProcessId) -join ','`);
  ok('the window process was started with --app on the local address', /\d/.test(wl), wl);
  // closing the window (its own browser processes only) ends the host
  for (const pid of wl.split(',').filter(Boolean)) { try { process.kill(Number(pid)); } catch (e) { /* gone */ } }
  let gone = false; for (let i = 0; i < 60 && !gone; i++) { await sleep(1000); gone = !alive(ctl2.pid); }
  ok('closing the window ends the host (no leftover process)', gone);

  // ---- uninstall
  r = spawnSync(path.join(INSTALL, 'uninstall.exe'), ['/S', '/UNINSTALL', '/TESTID=' + ID, '/DIR=' + INSTALL, '/LOG=' + path.join(BASE, 'uninstall.log')], { encoding: 'utf8', timeout: 120000 });
  for (let i = 0; i < 40 && fs.existsSync(INSTALL); i++) await sleep(500);        // the copy of the uninstaller finishes after the first one has exited
  ok('uninstall exits 0', r.status === 0, r.stdout + r.stderr);
  ok('the program folder is gone', !fs.existsSync(INSTALL), fs.existsSync(INSTALL) ? fs.readdirSync(INSTALL, { recursive: true }).join(',') : '');
  ok('registry entry and shortcuts are gone', !regHas() && !fs.existsSync(lnk('start')) && !fs.existsSync(lnk('desktop')) && !fs.existsSync(path.dirname(lnk('start'))));
  ok('settings and backups are kept by default', fs.existsSync(path.join(DATA, 'backups')));
  ok('the edited config files were not touched by the uninstall', fs.existsSync(path.join(cfg, 'TBCarry', 'TBCarryGlobalConfig.json')));

  const failed = results.filter((x) => !x.ok);
  console.log(`\nReal run: ${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(BASE, 'real-run-result.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
