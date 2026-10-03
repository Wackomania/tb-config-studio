'use strict';
// The TB licence helper. It never reads the content of a licence file: only whether one exists per mod. It reads the game port from
// serverDZ.cfg when the file has one (or from -port= in a start script of the same server folder, clearly labelled) and the licence IP mode
// from TheModBase\Config\IPSettings.txt when it holds a plain mode word.
const fs = require('node:fs');
const path = require('node:path');

const MAX = 262144;
const readText = (p) => { try { const st = fs.statSync(p); if (!st.isFile() || st.size > MAX) return null; return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// Candidate server folders: the profile's parent (a typical server has its profile folder inside the server folder) and the profile itself.
function serverDirs(profileDir) {
  if (!profileDir) return [];
  const a = path.dirname(profileDir);
  return [a, profileDir];
}

function readPort(profileDir) {
  const found = [];
  for (const dir of serverDirs(profileDir)) {
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; }
    // serverDZ.cfg first, then other serverDZ*.cfg; a port written there is the one DayZ listens on
    const cfgs = names.filter((n) => /^serverDZ.*\.cfg$/i.test(n)).sort((x, y) => (x.toLowerCase() === 'serverdz.cfg' ? -1 : y.toLowerCase() === 'serverdz.cfg' ? 1 : x.localeCompare(y)));
    for (const n of cfgs) {
      const t = readText(path.join(dir, n));
      if (!t) continue;
      const clean = t.replace(/\/\/.*$/gm, '');
      const mp = /^\s*(?:game)?port\s*=\s*(\d{2,5})\s*;/im.exec(clean);
      const mq = /^\s*steamQueryPort\s*=\s*(\d{2,5})\s*;/im.exec(clean);
      const mh = /^\s*hostname\s*=\s*"([^"]{0,80})"/im.exec(clean);
      if (mp) found.push({ port: Number(mp[1]), source: n + ' (port = ' + mp[1] + ')', kind: 'cfg', hostname: mh ? mh[1] : '', queryPort: mq ? Number(mq[1]) : null });
      else if (mh || mq) found.push({ port: null, source: n, kind: 'cfg-no-port', hostname: mh ? mh[1] : '', queryPort: mq ? Number(mq[1]) : null });
    }
    for (const n of names.filter((x) => /\.(bat|cmd|ps1)$/i.test(x)).slice(0, 40)) {
      const t = readText(path.join(dir, n));
      const m = t && /(?:^|\s)-port=(\d{2,5})\b/i.exec(t);
      if (m) found.push({ port: Number(m[1]), source: n + ' (start script, -port=' + m[1] + ')', kind: 'script' });
    }
  }
  const withPort = found.find((f) => f.port);
  const info = found.find((f) => f.hostname || f.queryPort) || {};
  return { port: withPort ? withPort.port : null, source: withPort ? withPort.source : null, sourceKind: withPort ? withPort.kind : null, all: found.filter((f) => f.port).map((f) => ({ port: f.port, source: f.source })).slice(0, 8), hostname: info.hostname || '', queryPort: info.queryPort || null };
}

function inspect(profileDir, mods) {
  const out = { profileDir: profileDir || null, port: null, ipMode: null, licences: [], tbConfigFolders: mods.map((m) => m.folder) };
  if (!profileDir) return out;
  const tm = path.join(profileDir, 'TheModBase');
  out.hasTheModBaseFolder = fs.existsSync(tm);
  const ip = (readText(path.join(tm, 'Config', 'IPSettings.txt')) || '').trim();
  out.ipMode = /^(ipv4|ipv6|mixed|auto)$/i.test(ip) ? ip.toLowerCase() : (ip ? 'set (not shown)' : null);
  let lic = []; try { lic = fs.readdirSync(path.join(tm, 'Licenses')); } catch (e) { lic = []; }
  const have = new Set(lic.map((n) => n.replace(/License\.txt$/i, '').toLowerCase()).filter(Boolean));
  out.licenceFilesFound = lic.length;
  out.licences = mods.filter((m) => m.folder !== 'Global').map((m) => ({ folder: m.folder, name: m.name, present: have.has(m.folder.toLowerCase()) }));
  Object.assign(out, readPort(profileDir));
  return out;
}

module.exports = { inspect, readPort };
