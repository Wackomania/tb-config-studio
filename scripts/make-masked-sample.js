'use strict';
// Copies a TBMods\Config folder (or any folder of TB configs) to another folder and masks what must not appear in screenshots or docs:
// Steam ids become 7656119XXXXXXXXX<n>, webhook addresses and tokens in URLs become empty, licence-like files are not copied.
// Usage: node scripts/make-masked-sample.js <source Config folder> <destination Config folder>
const fs = require('node:fs');
const path = require('node:path');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('Usage: node scripts/make-masked-sample.js <source> <destination>'); process.exit(1); }
const ids = new Map();
const maskId = (m) => { if (!ids.has(m)) ids.set(m, '7656119XXXXXXXXX' + String(ids.size + 1).slice(-1)); return ids.get(m); };
const URL_VALUE = /"(https?:\/\/[^"\n]*)"/g;
let n = 0;
function walk(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isSymbolicLink() || /licen[cs]e|\.(bak|dayzhub-backup)/i.test(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { walk(a, b); continue; }
    if (!/\.json$/i.test(e.name)) { continue; }
    let t = fs.readFileSync(a, 'utf8');
    t = t.replace(/7656119\d{10}/g, maskId).replace(URL_VALUE, '""').replace(/"(?=[^"\n]*(?:token|secret))([^"\n]*)"\s*:\s*"[^"\n]+"/gi, (m, k) => `"${k}": ""`);
    fs.writeFileSync(b, t); n++;
  }
}
walk(path.resolve(src), path.resolve(dst));
console.log('copied', n, 'files,', ids.size, 'Steam ids masked');
