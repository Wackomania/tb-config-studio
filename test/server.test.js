'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const h = require('./helpers');
const { create } = require('../src/server/server');

const PORT = 2793;
function req(method, p, { body, headers = {}, cookie, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const hd = { host: host || '127.0.0.1:' + PORT, connection: 'close', ...headers };
    if (cookie) hd.cookie = 'tbs=' + cookie;
    if (data !== null) { hd['content-type'] = 'application/json'; hd['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: hd }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text: t, json: j }); });
    });
    r.on('error', reject); if (data !== null) r.write(data); r.end();
  });
}

async function withServer(fn) {
  const root = h.tmpdir('srv');
  const srv = create({ dataDir: path.join(root, 'data'), port: PORT, noWindow: true });
  await srv.start();
  try { await fn(srv, root); } finally { await srv.stop(); h.cleanup(root); }
}
const post = (srv, p, body, extra = {}) => req('POST', p, { body, cookie: srv.token, headers: { 'x-tbs': '1' }, ...extra });
const get = (srv, p) => req('GET', p, { cookie: srv.token });

test('the server listens on 127.0.0.1 only, on the chosen port, and writes control.json', async () => {
  await withServer(async (srv) => {
    assert.equal(srv.server.address().address, '127.0.0.1');
    assert.equal(srv.port, PORT);
    const c = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'control.json'), 'utf8'));
    assert.equal(c.port, PORT); assert.equal(c.pid, process.pid);
  });
});

test('the API needs the session cookie, the right Host, the x-tbs header and a local origin', async () => {
  await withServer(async (srv) => {
    assert.equal((await req('GET', '/api/state')).status, 401);
    assert.equal((await req('GET', '/api/state', { cookie: 'wrong' })).status, 401);
    assert.equal((await get(srv, '/api/state')).status, 200);
    assert.equal((await req('GET', '/api/state', { cookie: srv.token, host: 'evil.example:' + PORT })).status, 403);   // DNS rebinding
    assert.equal((await req('GET', '/', { host: 'evil.example' })).status, 403);
    assert.equal((await req('POST', '/api/ping', { body: {}, cookie: srv.token })).status, 403);                         // no x-tbs
    assert.equal((await post(srv, '/api/ping', {}, { headers: { 'x-tbs': '1', origin: 'http://evil.example' } })).status, 403);
    assert.equal((await post(srv, '/api/ping', {}, { headers: { 'x-tbs': '1', origin: 'http://127.0.0.1:' + PORT } })).status, 200);
    assert.equal((await post(srv, '/api/nothing', {})).status, 404);
    assert.equal((await post(srv, '/api/ping', '[1,2]')).status, 400);
    assert.equal((await post(srv, '/api/ping', '{broken')).status, 400);
  });
});

test('the one-time link sets the session cookie; a wrong token is refused', async () => {
  await withServer(async (srv) => {
    const bad = await req('GET', '/?t=nope');
    assert.equal(bad.status, 403);
    const ok = await req('GET', '/?t=' + srv.token);
    assert.equal(ok.status, 302);
    assert.match(ok.headers['set-cookie'][0], /^tbs=.*HttpOnly.*SameSite=Strict/);
    assert.equal(ok.headers.location, '/');
  });
});

test('security headers on every answer; static files cannot escape the ui folder', async () => {
  await withServer(async (srv) => {
    const idx = await req('GET', '/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers['content-security-policy'], /default-src 'self'/);
    assert.match(idx.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(idx.headers['x-content-type-options'], 'nosniff');
    assert.ok(idx.text.includes('TB Config Studio'));
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..\\package.json', '/js/../../../package.json', '/%00', '/js/%2e%2e%2f..%2fpackage.json']) {
      const r = await req('GET', p);
      assert.ok(r.status === 400 || r.status === 404, p + ' -> ' + r.status);
      assert.ok(!r.text.includes('"tb-config-studio"'), p);
    }
    assert.equal((await req('GET', '/does-not-exist.js')).status, 404);
  });
});

test('oversized request bodies are refused', async () => {
  await withServer(async (srv) => {
    const big = JSON.stringify({ a: 'x'.repeat(13 * 1048576) });
    let status = 0;
    try { status = (await post(srv, '/api/ping', big)).status; } catch (e) { status = 'closed'; }
    assert.ok(status === 413 || status === 'closed', String(status));
  });
});

test('open, view, plan, save, history and restore through the API', async () => {
  const fx = h.openFixture();
  await withServer(async (srv) => {
    assert.equal((await get(srv, '/api/file?path=Global/AdminConfig.json')).status, 409);          // nothing open yet
    const bad = await post(srv, '/api/open', { path: '\\\\server\\share' }); assert.equal(bad.status, 400);
    const o = await post(srv, '/api/open', { path: fx.profileDir });
    assert.equal(o.status, 200); assert.ok(o.json.overview.mods.length >= 6);
    const st = (await get(srv, '/api/state')).json;
    assert.equal(st.recent.length, 1); assert.ok(st.schemaMods.length >= 14); assert.equal(st.overview.mods.length, o.json.overview.mods.length);
    const rel = 'TBVehicleLockSystem/GeneralConfig.json';
    const f = (await get(srv, '/api/file?path=' + encodeURIComponent(rel))).json;
    assert.ok(f.schema.file.fields.length > 5 && f.schema.mod.name);
    const key = Object.keys(f.value).find((k) => typeof f.value[k] === 'number');
    const ops = [{ op: 'set', path: [key], value: f.value[key] + 1 }];
    const pl = await post(srv, '/api/plan', { path: rel, ops, base: { sha256: f.sha256 } });
    assert.equal(pl.json.valid, true); assert.equal(pl.json.changed, true); assert.match(pl.json.restartNote, /restart/i);
    const sv = await post(srv, '/api/save', { path: rel, ops, base: { sha256: f.sha256 } });
    assert.equal(sv.status, 200); assert.ok(sv.json.backup);
    assert.equal(JSON.parse(fs.readFileSync(fx.abs(rel), 'utf8'))[key], f.value[key] + 1);
    const conflict = await post(srv, '/api/save', { path: rel, ops: [{ op: 'set', path: [key], value: f.value[key] + 2 }], base: { sha256: f.sha256 } });          // stale base now
    assert.equal(conflict.status, 409); assert.equal(conflict.json.extra.code, 'changed');
    const hist = (await get(srv, '/api/history?path=' + encodeURIComponent(rel))).json;
    assert.equal(hist.backups.length, 1);
    const bv = (await get(srv, '/api/backup?path=' + encodeURIComponent(rel) + '&id=' + hist.backups[0].id)).json;
    assert.equal(bv.sameAsNow, false);
    const rs = await post(srv, '/api/restore', { path: rel, backupId: hist.backups[0].id });
    assert.equal(rs.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(fx.abs(rel), 'utf8'))[key], f.value[key]);
    assert.equal((await get(srv, '/api/file?path=..%2f..%2fsecret.json')).status, 400);
    assert.equal((await get(srv, '/api/backups')).json.backups.length, 2);
    assert.equal((await get(srv, '/api/licence')).status, 200);
    assert.equal((await get(srv, '/api/presets')).json.types.pve.name.length > 0, true);
    assert.equal((await post(srv, '/api/compare', { mode: 'defaults' })).status, 200);
    assert.ok((await get(srv, '/api/search?q=alarm')).json.results.length > 0);
    // errors never leak absolute paths
    const miss = await get(srv, '/api/file?path=Global/Nope.json');
    assert.equal(miss.status, 404); assert.ok(!/[A-Za-z]:\\/.test(miss.text));
  });
  h.cleanup(fx.root);
});

test('the app makes no outgoing connection: no network module is used by the app code', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [...walk(path.join(h.REPO, 'src', 'core')), ...walk(path.join(h.REPO, 'src', 'server'))].filter((x) => x.endsWith('.js'))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/require\('node:(https|net|dgram|tls|dns)'\)|require\('(https|net|dgram|tls|dns)'\)/.test(t), f);
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket\(/.test(t), f);
    if (!f.endsWith('main.js') && !f.endsWith('server.js')) assert.ok(!/require\('node:http'\)/.test(t), f);
  }
  const ui = walk(path.join(h.REPO, 'src', 'ui')).filter((x) => /\.(js|html|css)$/.test(x));
  for (const f of ui) { const t = fs.readFileSync(f, 'utf8'); assert.ok(!/https?:\/\/(?!127\.0\.0\.1)[a-z]/i.test(t.replace(/xmlns="http:\/\/www\.w3\.org\/[^"]+"/g, '')), f); }
});
