'use strict';
// node scripts/check-schemas.js [folder...]  - checks schema files and prints coverage per mod (fields with a label and help text / all fields).
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../src/core/schema');

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(__dirname, '..', 'schemas')];
let bad = 0;
for (const dir of dirs) {
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { console.log(n, 'INVALID JSON', e.message); bad++; continue; }
    const pr = schema.problems(d);
    const fields = d.files.flatMap((f) => Object.values(f.fields || {}));
    const lab = fields.filter((f) => f.label && f.help).length;
    console.log(`${n.padEnd(28)} ${String(d.mod && d.mod.coverage).padEnd(9)} files ${String(d.files.length).padStart(2)}  fields ${String(fields.length).padStart(4)}  described ${String(lab).padStart(4)}  ${pr.length ? 'PROBLEMS ' + pr.length : 'ok'}`);
    for (const p of pr.slice(0, 15)) console.log('   - ' + p);
    bad += pr.length;
  }
}
process.exit(bad ? 1 : 0);
