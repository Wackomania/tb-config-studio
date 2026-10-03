'use strict';
// Entry of the app host (started by TBConfigStudio.exe, or by hand: node src/server/main.js).
//   --data <folder>   private folder of the app (default %LOCALAPPDATA%\TBConfigStudio, or TBS_DATA)
//   --port <n>        first port to try (default: any free port; tests use 2791)
//   --no-window       start the server only (tests)
// Only one host runs per Windows user: a second start opens another window on the first one and exits.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { create } = require('./server');

function parseArgs(argv) {
  const o = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data' || a === '--port') o[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) o.flags.add(a.slice(2));
  }
  return o;
}
const defaultDataDir = () => (process.env.TBS_DATA ? path.resolve(process.env.TBS_DATA) : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'TBConfigStudio'));

function alive(control) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: control.port, path: '/_alive', timeout: 2000, headers: { host: '127.0.0.1:' + control.port } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d === 'tbs')); });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const dataDir = o.data ? path.resolve(o.data) : defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const controlFile = path.join(dataDir, 'control.json');
  if (fs.existsSync(controlFile) && !o.flags.has('no-window')) {
    try {
      const control = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
      if (await alive(control)) {
        const w = require('./window').open(`http://127.0.0.1:${control.port}/?t=${control.token}`, path.join(dataDir, 'window-profile'));
        console.log(w ? 'TB Config Studio is already running; its window was opened.' : 'TB Config Studio is already running.');
        return null;
      }
    } catch (e) { /* stale control file: start a new host */ }
  }
  const host = create({ dataDir, port: o.port ? Number(o.port) : 0, noWindow: o.flags.has('no-window'), onQuit: () => { host.stop().finally(() => process.exit(0)); } });
  await host.start();
  console.log(`TB Config Studio: http://127.0.0.1:${host.port}/ (data ${dataDir})`);
  if (o.flags.has('print-url')) console.log('URL ' + host.url());
  if (!o.flags.has('no-window')) {
    const w = host.openWindow();
    if (!w) console.log('No Microsoft Edge or Google Chrome was found. Open this address in a browser: ' + host.url());
  }
  process.on('SIGINT', () => host.stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => host.stop().finally(() => process.exit(0)));
  process.on('uncaughtException', (e) => { try { fs.appendFileSync(path.join(dataDir, 'app.log'), `${new Date().toISOString()} uncaught: ${e.stack || e.message}\n`); } catch (x) { /* nothing more to do */ } });
  process.on('unhandledRejection', (e) => { try { fs.appendFileSync(path.join(dataDir, 'app.log'), `${new Date().toISOString()} unhandled: ${(e && e.stack) || e}\n`); } catch (x) { /* nothing more to do */ } });
  return host;
}

if (require.main === module) main().catch((e) => { console.error('The app could not start: ' + e.message); process.exit(1); });
module.exports = { main, parseArgs, defaultDataDir };
