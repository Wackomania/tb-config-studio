'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const h = require('./helpers');

const isWin = process.platform === 'win32';
const SETUP = path.join(h.REPO, 'dist', 'installer', 'TBConfigStudio-Setup.exe');
const run = (file, args, o = {}) => spawnSync(file, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...o });

test('the build script has a dry-run mode that prints every step and writes nothing', (t) => {
  if (!isWin) return t.skip('Windows only');
  const out = h.tmpdir('build');
  const r = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(h.REPO, 'scripts', 'build-installer.ps1'), '-DryRun', '-OutDir', path.join(out, 'inst')]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('PLAN: '));
  assert.ok(lines.length >= 8, r.stdout);
  for (const needle of ['TBConfigStudio.exe', 'uninstall.exe', 'manifest.json', 'TBConfigStudio-Setup.exe', 'portable', 'runtime\\node.exe']) assert.ok(lines.some((l) => l.includes(needle)), needle);
  assert.match(r.stdout, /Dry run: nothing was written/);
  assert.deepEqual(fs.readdirSync(out), [], 'the dry run created nothing');
  h.cleanup(out);
});

test('the setup program: /DRYRUN prints the plan and changes nothing; bad folders are refused', (t) => {
  if (!isWin) return t.skip('Windows only');
  if (!fs.existsSync(SETUP)) return t.skip('build the installer first (scripts/build-installer.ps1)');
  const base = h.tmpdir('setup');
  const target = path.join(base, 'TB Config Studio');
  const id = 'unittest';
  const r = run(SETUP, ['/S', '/DRYRUN', '/DIR=' + target, '/TESTID=' + id]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PLAN: install folder/); assert.match(r.stdout, /no administrator rights/); assert.match(r.stdout, /nothing was written/);
  assert.ok(!fs.existsSync(target));
  const q = run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TBConfigStudio-' + id]);
  assert.notEqual(q.status, 0, 'no uninstall entry was written');
  for (const bad of ['C:\\', '\\\\server\\share\\x', 'relative\\dir', 'C:\\Windows\\TBS', 'C:\\Program Files\\TBS']) {
    const b = run(SETUP, ['/S', '/DRYRUN', '/DIR=' + bad, '/TESTID=' + id]);
    assert.equal(b.status, 1, bad + ': ' + b.stdout);
    assert.match(b.stdout, /ERROR/);
  }
  const u = run(path.join(h.REPO, 'dist', 'installer', 'uninstall.exe'), ['/S', '/DRYRUN', '/UNINSTALL', '/DIR=' + target, '/TESTID=' + id]);
  assert.equal(u.status, 0, u.stdout);
  assert.match(u.stdout, /nothing was removed/);
  h.cleanup(base);
});

test('the setup and launcher declare asInvoker (no administrator prompt) and the package carries no private data', (t) => {
  const m = fs.readFileSync(path.join(h.REPO, 'installer', 'app.manifest'), 'utf8');
  assert.match(m, /requestedExecutionLevel level="asInvoker"/);
  const ps = fs.readFileSync(path.join(h.REPO, 'scripts', 'build-installer.ps1'), 'utf8');
  assert.ok(!/Start-Process[^\n]*-Verb RunAs/.test(ps));
  assert.match(ps, /win32manifest/);
  const setup = fs.readFileSync(path.join(h.REPO, 'installer', 'Setup.cs'), 'utf8');
  assert.ok(!/HKEY_LOCAL_MACHINE|Registry\.LocalMachine|ProgramData/.test(setup), 'per-user only');
  assert.match(setup, /Registry\.CurrentUser/);
  assert.ok(!/taskkill|Kill\(\)\s*;[^}]*GetProcessesByName/.test(setup), 'never kills by name');
});
