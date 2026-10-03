'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./helpers');
const json = require('../src/core/json');
const mask = require('../src/core/mask');
const fsx = require('../src/core/fsx');
const locate = require('../src/core/locate');
const pathsafe = require('../src/core/pathsafe');

const STEAM = '76561198000000001';

test('typed folder paths: UNC, device paths, "..", streams, control characters and nonsense are refused', () => {
  const bad = ['\\\\server\\share\\x', '//server/share', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', 'C:\\a\\..\\b', 'C:/a/../../b', 'relative\\path', 'C:\\x\\f.json:stream', 'D:\\a\u0000b', 'C:\\a\\%2e%2e\\b', '', '   ', 'C:\\' + 'a'.repeat(600), 'C:\\a|b', 'C:\\a?b'];
  for (const p of bad) assert.throws(() => locate.cleanInput(p), (e) => e.status === 400, JSON.stringify(p.slice(0, 40)));
  assert.throws(() => locate.cleanInput(42), (e) => e.status === 400);
  assert.ok(locate.cleanInput('"X:\\dhm-test\\tbstudio"').toLowerCase().startsWith('x:\\dhm-test'));
});

test('locate accepts the profile folder, TBMods, Config, and a server folder with one profile; says so when there are several', () => {
  const fx = h.openFixture();
  const abs = fs.realpathSync.native(fx.profileDir);
  assert.equal(locate.locate(abs).configDir, fs.realpathSync.native(fx.configDir));
  assert.equal(locate.locate(path.join(abs, 'TBMods')).configDir, fs.realpathSync.native(fx.configDir));
  assert.equal(locate.locate(fx.configDir).profileDir, abs);
  assert.equal(locate.locate(fx.root).configDir, fs.realpathSync.native(fx.configDir));                    // the root holds one profile
  h.copyTree(abs, path.join(fx.root, 'profile2'));
  assert.equal(locate.locate(fx.root).candidates.length, 2);
  assert.throws(() => locate.locate(fx.dataDir), (e) => e.status === 404);
  assert.throws(() => locate.locate(path.join(fx.root, 'nothing-here')), (e) => e.status === 404);
  h.cleanup(fx.root);
});

test('relative paths that try to leave the config folder are refused', () => {
  const fx = h.openFixture();
  fs.writeFileSync(path.join(fx.root, 'secret.json'), '{"x":1}');
  const tries = ['../secret.json', '..\\secret.json', 'Global/../../secret.json', '%2e%2e/secret.json', '%252e%252e/secret.json', '/secret.json', 'C:/secret.json', '\\\\server\\x\\y.json', 'Global/AdminConfig.json:stream', 'Global\\..\\..\\secret.json', '\uff0e\uff0e/secret.json', 'Global/CON.json', 'Global/AdminConfig.json.', 'Global/ADMINC~1.JSO'];
  for (const rel of tries) assert.throws(() => fx.ws.view(rel), (e) => e.status >= 400 && e.status < 500, rel);
  assert.throws(() => fx.ws.view('Global/'), (e) => e.status >= 400);
  h.cleanup(fx.root);
});

test('a junction or symlink that leads outside is never followed (scan, read, write)', async (t) => {
  const fx = h.openFixture();
  const outside = path.join(fx.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'Evil.json'), '{"leak":true}');
  const link = path.join(fx.configDir, 'LinkedMod');
  try { fs.symlinkSync(outside, link, 'junction'); } catch (e) { return t.skip('cannot create a junction here: ' + e.code); }
  const ov = fx.ws.overview();
  assert.ok(!ov.mods.some((m) => m.folder === 'LinkedMod'), 'link not listed as a mod');
  assert.ok(ov.skipped.some((s) => s.path === 'LinkedMod'));
  assert.throws(() => fx.ws.view('LinkedMod/Evil.json'), (e) => e.status === 403);
  await assert.rejects(fx.ws.writeFile('LinkedMod/Evil.json', Buffer.from('{"a":1}')), (e) => e.status === 403);
  assert.equal(fs.readFileSync(path.join(outside, 'Evil.json'), 'utf8'), '{"leak":true}');
  // a file symlink to somewhere outside
  try { fs.symlinkSync(path.join(outside, 'Evil.json'), path.join(fx.configDir, 'Global', 'Linked.json'), 'file'); assert.throws(() => fx.ws.view('Global/Linked.json'), (e) => e.status >= 400); } catch (e) { if (e.code !== 'EPERM') throw e; }
  h.cleanup(fx.root);
});

test('huge files are listed but not opened; the app stays responsive', () => {
  const fx = h.openFixture();
  const big = fx.abs('TBCarry/Huge.json');
  fs.writeFileSync(big, '{"a":"' + 'x'.repeat(9 * 1048576) + '"}');           // above the 8 MiB edit limit
  assert.throws(() => fx.ws.plan('TBCarry/Huge.json', { ops: [] }), (e) => e.status === 413);
  const huge = fx.abs('TBCarry/Huger.json');
  const fd = fs.openSync(huge, 'w'); fs.ftruncateSync(fd, 17 * 1048576); fs.closeSync(fd);
  assert.throws(() => fx.ws.view('TBCarry/Huger.json'), (e) => e.status === 413);
  const ov = fx.ws.overview();
  assert.equal(ov.mods.find((m) => m.folder === 'TBCarry').files.find((f) => f.name === 'Huger.json').tooLarge, true);
  h.cleanup(fx.root);
});

test('deeply nested JSON is refused with a message, not a crash', () => {
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  assert.throws(() => json.parseDoc(deep), /nested too deeply/);
  const objs = '{"a":'.repeat(5000) + '1' + '}'.repeat(5000);
  assert.throws(() => json.parseDoc(objs), /nested too deeply/);
  const ok = '['.repeat(100) + ']'.repeat(100);
  assert.doesNotThrow(() => json.parseDoc(ok));
  const fx = h.openFixture();
  fs.writeFileSync(fx.abs('TBCarry/Deep.json'), deep);
  const v = fx.ws.view('TBCarry/Deep.json');
  assert.ok(v.parseError && v.editable === false);
  h.cleanup(fx.root);
});

test('__proto__, constructor and prototype keys are plain data and never reach Object.prototype', async () => {
  const text = '{"__proto__": {"polluted": true}, "a": {"__proto__": 1}, "constructor": {"prototype": {"x": 1}}}';
  const d = json.parseDoc(text);
  const v = d.value;
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.keys(v)[0], '__proto__');
  assert.equal(d.apply(v), text);                                              // untouched stays byte identical
  assert.throws(() => json.applyOps({ a: 1 }, [{ op: 'set', path: ['__proto__'], value: { polluted: 1 }, create: true }]), /cannot be used/);
  assert.throws(() => json.applyOps({ a: { b: 1 } }, [{ op: 'rename', path: ['a'], to: '__proto__' }]), /rename/);
  json.applyOps({ a: 1 }, [{ op: 'set', path: ['constructor'], value: 1, create: true }]);
  assert.equal(({}).polluted, undefined);
  // through the workspace
  const fx = h.openFixture();
  fs.writeFileSync(fx.abs('TBCarry/Proto.json'), text);
  const view = fx.ws.view('TBCarry/Proto.json');
  assert.ok(Object.prototype.hasOwnProperty.call(view.value, '__proto__'));
  assert.equal(({}).polluted, undefined);
  h.cleanup(fx.root);
});

test('hostile operations are refused: bad paths, missing fields, wrong ops, huge lists', () => {
  const v = { a: 1, l: [1, 2] };
  assert.throws(() => json.applyOps(v, [{ op: 'set', path: ['zzz'], value: 1 }]), /does not exist/);
  assert.throws(() => json.applyOps(v, [{ op: 'set', path: ['l', 5], value: 1 }]), /past the end/);
  assert.throws(() => json.applyOps(v, [{ op: 'explode', path: ['a'] }]), /Unknown kind/);
  assert.throws(() => json.applyOps(v, [{ op: 'set', path: new Array(50).fill('a'), value: 1 }]), /not valid/);
  assert.throws(() => json.applyOps(v, 'x'), /missing or too long/);
  assert.throws(() => json.applyOps(v, new Array(20001).fill({ op: 'set', path: ['a'], value: 1 })), /too long/);
  assert.throws(() => json.applyOps(v, [{ op: 'set', path: [{}], value: 1 }]), /not valid/);
});

test('secret masking: webhook addresses, tokens, keys and Steam ids never reach the window', () => {
  const value = { discordWebhookURL: 'https://discord.com/api/webhooks/1/abc', apiToken: 'tok_123', licenseKey: 'LIC-1', plain: 'hello', n: 5, admins: { [STEAM]: { flag: 1 }, 'Add here Steam Or DayZ ID': { flag: 0 } }, owner: STEAM, nested: [{ secretKey: 'zzz', note: 'https://example.org/page' }] };
  const m = mask.maskValue(value, 'Global/Logger.json');
  const text = JSON.stringify(m.value);
  for (const secret of ['discord.com/api', 'tok_123', 'LIC-1', STEAM, 'zzz']) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes('hello') && text.includes('Add here Steam Or DayZ ID'));
  assert.ok(Object.keys(m.value.admins).some((k) => /^⟦hidden:\d+:0001⟧$/.test(k)));
  assert.ok(m.hidden >= 6);
  const t = mask.maskText('{"discordWebhookURL": "https://discord.com/api/webhooks/1/abc", "x": "' + STEAM + '"} token=abc');
  assert.ok(!t.includes('webhooks/1') && !t.includes(STEAM));
  // a hidden entry can be addressed but its real name is never needed by the client
  assert.deepEqual(mask.realPath(['admins', Object.keys(m.value.admins)[0], 'flag'], value), ['admins', STEAM, 'flag']);
});

test('the workspace view, diff and plan of a file with secrets expose none of them', async () => {
  const fx = h.openFixture();
  const abs = fx.abs('Global/Logger.json');
  const d = json.parseDoc(fs.readFileSync(abs, 'utf8')); const v = d.value;
  const wh = Object.keys(v).find((k) => /webhook/i.test(k));
  assert.ok(wh, 'a webhook field exists');
  v[wh] = 'https://discord.com/api/webhooks/123/SECRETTOKEN';
  fs.writeFileSync(abs, d.apply(v));
  const view = fx.ws.view('Global/Logger.json');
  assert.ok(!JSON.stringify(view).includes('SECRETTOKEN'));
  assert.equal(view.value[wh], mask.HIDDEN);
  assert.equal(view.rawEditable, false);
  // raw editing a file with secrets is refused
  assert.throws(() => fx.ws.plan('Global/Logger.json', { raw: '{}' }), (e) => e.status === 403);
  // the hidden value can be replaced by typing a new one; the diff never shows old or new secret
  const f = fsx.read(fx.ws.root, 'Global/Logger.json');
  const p = fx.ws.plan('Global/Logger.json', { ops: [{ op: 'set', path: [wh], value: 'https://discord.com/api/webhooks/9/NEWTOKEN' }] });
  assert.ok(!p.diff.unified.includes('SECRETTOKEN') && !p.diff.unified.includes('NEWTOKEN'));
  // sending the marker back changes nothing
  const same = fx.ws.plan('Global/Logger.json', { ops: [{ op: 'set', path: [wh], value: mask.HIDDEN }] });
  assert.equal(same.changed, false);
  assert.throws(() => fx.ws.plan('Global/Logger.json', { ops: [{ op: 'set', path: [wh], value: [mask.HIDDEN] }] }), /hidden value/);
  await fx.ws.commit('Global/Logger.json', { ops: [{ op: 'set', path: [wh], value: 'https://discord.com/api/webhooks/9/NEWTOKEN' }], base: { sha256: f.sha256 } });
  assert.ok(fs.readFileSync(abs, 'utf8').includes('NEWTOKEN'));
  h.cleanup(fx.root);
});

test('licence files are never listed, read or returned', () => {
  const fx = h.openFixture();
  fs.mkdirSync(path.join(fx.profileDir, 'TheModBase', 'Licenses'), { recursive: true });
  fs.writeFileSync(path.join(fx.profileDir, 'TheModBase', 'Licenses', 'TBCarryLicense.txt'), 'SENTINEL-LICENCE-CONTENT');
  fs.writeFileSync(path.join(fx.configDir, 'TBCarry', 'TBCarryLicense.json'), '{"k":"SENTINEL-LICENCE-CONTENT"}');
  const ov = fx.ws.overview();
  assert.ok(!JSON.stringify(ov).includes('SENTINEL'));
  assert.ok(!ov.mods.find((m) => m.folder === 'TBCarry').files.some((f) => /licen/i.test(f.name)));
  assert.throws(() => fx.ws.view('TBCarry/TBCarryLicense.json'), (e) => e.status === 400);
  const lic = require('../src/core/licence').inspect(fx.profileDir, ov.mods);
  assert.ok(!JSON.stringify(lic).includes('SENTINEL'));
  assert.equal(lic.licences.find((l) => l.folder === 'TBCarry').present, true);
  h.cleanup(fx.root);
});

test('names Windows cannot handle are skipped when scanning', () => {
  assert.ok(pathsafe.nameProblem('a b.json ') );
  assert.ok(pathsafe.nameProblem('..'));
  assert.ok(pathsafe.nameProblem('x\u202e.json'));
  assert.equal(pathsafe.nameProblem('Chernogorsk.json'), null);
});
