'use strict';
// Test helpers. Test data lives under X:\dhm-test\tbstudio\t (or the OS temp folder when there is no X: drive), never anywhere else.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const schema = require('../src/core/schema');
const workspaceLib = require('../src/core/workspace');
const locate = require('../src/core/locate');

const REPO = path.join(__dirname, '..');
const BASE = fs.existsSync('X:\\dhm-test') ? 'X:\\dhm-test\\tbstudio\\t' : path.join(os.tmpdir(), 'tbstudio-t');
const SAMPLES = process.env.TBS_SAMPLES || 'X:\\dhm-test\\tbstudio\\samples';
const FIXTURE = path.join(__dirname, 'fixtures', 'profile');

function tmpdir(name = 'x') {
  const d = path.join(BASE, name + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const cleanup = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* left behind */ } };
function copyTree(from, to) { fs.cpSync(from, to, { recursive: true }); }

function schemas() { return schema.load([{ dir: path.join(REPO, 'schemas'), origin: 'built-in' }]); }

// A fresh copy of the committed fixture profile: { root, profileDir, configDir, dataDir, ws }
function openFixture(opts = {}) {
  const root = tmpdir('fx');
  const profileDir = path.join(root, 'profile');
  copyTree(FIXTURE, profileDir);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const loc = locate.locate(profileDir);
  const ws = workspaceLib.open({ configDir: loc.configDir, profileDir: loc.profileDir, dataDir, schemas: opts.schemas || schemas(), keep: opts.keep });
  return { root, profileDir, configDir: loc.configDir, dataDir, ws, abs: (rel) => path.join(loc.configDir, ...rel.split('/')) };
}
const read = (p) => fs.readFileSync(p);
const sampleProfiles = () => ['lbtest', 'breathless'].map((n) => path.join(SAMPLES, n)).filter((p) => fs.existsSync(path.join(p, 'TBMods', 'Config')));

module.exports = { REPO, BASE, SAMPLES, FIXTURE, tmpdir, cleanup, copyTree, schemas, openFixture, read, sampleProfiles };
