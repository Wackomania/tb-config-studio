'use strict';
// UI QA: drives the real app (its server and window page) in a headless Edge/Chrome at the app window size and at a narrow size, checks the
// screens, makes real edits on a copy of the masked profile, and writes the screenshots used by docs/USER-GUIDE.md.
// Usage: node scripts/ui-qa.js [--shots docs/screenshots]   (needs X:\dhm-test\tbstudio\masked\profile, made by make-masked-sample.js)
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./ui-cdp');
const { create } = require('../src/server/server');

const BASE = 'X:\\dhm-test\\tbstudio\\qa';
const SRC = 'X:\\dhm-test\\tbstudio\\masked\\profile';
const SHOTS = path.resolve(process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : path.join(__dirname, '..', 'docs', 'screenshots'));
const PORT = 2795;
const results = [];
const ok = (name, cond, extra) => { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? ' ' + extra : '')); };

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(BASE, { recursive: true });
  fs.cpSync(SRC, path.join(BASE, 'profile'), { recursive: true });
  const profile = path.join(BASE, 'profile');
  const server = create({ dataDir: path.join(BASE, 'data'), port: PORT, noWindow: true });
  await server.start();
  const browser = await launch({ port: 2796 });
  try {
    const p = await browser.page();
    await p.viewport(1360, 880);
    await p.cookie('http://127.0.0.1:' + PORT, 'tbs', server.token);
    const shot = (n, o) => p.shot(path.join(SHOTS, n + '.png'), o);
    const text = () => p.eval('document.getElementById("main").innerText');
    const waitText = (s, ms = 8000) => p.waitFor(`document.getElementById('main').innerText.includes(${JSON.stringify(s)})`, ms);
    await p.goto('http://127.0.0.1:' + PORT + '/', 600);

    // ---- home
    ok('home shows the open-folder card and the first-run guide', (await text()).includes('Open a server profile folder') && (await text()).includes('First run guide'));
    await shot('01-home');
    // typed path with a hostile value shows a readable error
    await p.type('input.wide', '\\\\server\\share'); await p.clickText('Open', '#main .row button');
    ok('a network path is refused with a message', await p.waitFor(`document.getElementById('toasts').innerText.includes('Network')`));
    await p.eval(`document.getElementById('toasts').textContent=''`);
    await p.type('input.wide', profile); await p.clickText('Open', '#main .row button');
    ok('opening the folder shows the overview', await waitText('TB mod folders with'));
    ok('overview lists 14 mod folders', (await p.eval(`document.querySelectorAll('#main .modcard').length`)) === 14, String(await p.eval(`document.querySelectorAll('#main .modcard').length`)));
    await shot('02-overview');

    // ---- mod page
    await p.clickText('Vehicle Lock System', '#nav button');
    ok('mod page lists the files with explanations', await waitText('GeneralConfig.json') && (await text()).includes('Raid'));
    await shot('03-mod');

    // ---- file page: explanation, edit, review, save
    const openRow = async (name) => p.eval(`(()=>{const tr=[...document.querySelectorAll('#main tbody tr')].find(r=>r.innerText.includes(${JSON.stringify(name)}));if(!tr)return false;tr.querySelector('button').click();return true})()`);
    ok('open RaidVehicleConfig', await openRow('RaidVehicleConfig.json'));
    ok('the file shows fields with help text', await p.waitFor(`document.querySelectorAll('#main .field .help').length > 3`));
    const fieldCount = await p.eval(`document.querySelectorAll('#main .field').length`);
    const helpCount = await p.eval(`[...document.querySelectorAll('#main .field .help')].filter(h=>!h.querySelector('.badge')).length`);
    ok('every field of the file has an explanation', helpCount === fieldCount, helpCount + '/' + fieldCount);
    await shot('04-file');
    const rel = 'TBVehicleLockSystem/RaidVehicleConfig.json';
    const abs = path.join(profile, 'TBMods', 'Config', ...rel.split('/'));
    const before = fs.readFileSync(abs, 'utf8');
    // change one switch or number
    const changed = await p.eval(`(()=>{const sw=document.querySelector('#main .field .sw input');if(sw){sw.click();return 'switch'}const n=document.querySelector('#main .field input[type=number]');if(n){n.value=String(Number(n.value)+1);n.dispatchEvent(new Event('input',{bubbles:true}));return 'number'}return ''})()`);
    ok('edit a value (' + changed + ')', !!changed);
    ok('the save bar and the changed mark appear', await p.waitFor(`!document.querySelector('.savebar').hidden && document.querySelector('#main .field.changed')`));
    await shot('05-file-edited');
    await p.clickText('Review and save', '.savebar button');
    ok('review dialog shows the diff and the restart notice', await p.waitFor(`document.querySelector('.dialog pre.diff') && document.querySelector('.dialog').innerText.includes('Restart needed')`));
    await shot('06-review');
    await p.clickText('Save file', '.dialog button');
    ok('saving shows a confirmation', await p.waitFor(`document.getElementById('toasts').innerText.includes('Saved')`));
    const after = fs.readFileSync(abs, 'utf8');
    ok('the file on disk changed, in one place only', after !== before && Math.abs(after.split('\n').length - before.split('\n').length) === 0 && after.split('\n').filter((l, i) => l !== before.split('\n')[i]).length === 1);
    const backups = fs.readdirSync(path.join(BASE, 'data', 'backups')).length;
    ok('a backup was made', backups === 1);

    // ---- search
    await p.clickText('Search all configs', '#nav button'); await p.waitFor(`document.querySelector('#main input')`);
    await p.type('#main input', 'raid');
    ok('search finds fields', await waitText('matches'));
    await shot('07-search');

    // ---- compare against defaults
    await p.clickText('Compare', '#nav button'); await p.clickText('Compare', '#main .card button');
    ok('compare with defaults shows the changed field', await waitText('RaidVehicleConfig'));
    await shot('08-compare');

    // ---- presets
    await p.clickText('Presets', '#nav button'); await p.waitFor(`document.querySelectorAll('#main .modcard').length === 4`);
    await p.clickText('PvE / friendly', '#main .modcard');
    ok('preset preview lists suggested changes with reasons', await waitText('Suggested'));
    await p.clickText('Show the diff', '#main button');
    ok('preset diff is shown before applying', await p.waitFor(`document.querySelector('#main pre.diff')`));
    await shot('09-presets', { full: false });
    await p.clickText('Apply selected', '#main button'); await p.clickText('Apply selected', '.dialog button');
    ok('applying a preset reports the files updated', await p.waitFor(`document.getElementById('toasts').innerText.includes('files updated')`));
    ok('the preset made more backups', fs.readdirSync(path.join(BASE, 'data', 'backups')).length === 1 && fs.readdirSync(path.join(BASE, 'data', 'backups', fs.readdirSync(path.join(BASE, 'data', 'backups'))[0], 'TBVehicleLockSystem')).length >= 1);

    // ---- licence helper
    await p.clickText('Licence helper', '#nav button');
    ok('licence helper explains IP and port', await waitText('public IP address') && (await text()).includes('Checklist'));
    await shot('10-licence');

    // ---- backups and rollback
    await p.clickText('Backups and rollback', '#nav button'); await p.waitFor(`document.querySelectorAll('#main tbody tr').length >= 2`);
    await shot('11-backups');
    const oldest = await p.eval(`(()=>{const b=[...document.querySelectorAll('#main tbody tr')];b[b.length-1].querySelector('button').click();return b.length})()`);
    ok('backup list has entries', oldest >= 2);
    ok('restore dialog shows what changes', await p.waitFor(`document.querySelector('.dialog pre.diff')`));
    await shot('12-restore');
    await p.clickText('Restore this version', '.dialog button');
    ok('restoring brings the original file back byte for byte', await p.waitFor(`document.getElementById('toasts').innerText.includes('Restored')`) && fs.readFileSync(abs, 'utf8') === before);
    await p.eval(`document.getElementById('toasts').textContent=''`);

    // ---- packs: export
    await p.clickText('Config packs', '#nav button');
    const dest = path.join(BASE, 'pack-out');
    await p.type('#main input[aria-label="Pack folder"]', dest);
    await p.clickText('Export', '#main .card button');
    ok('export writes a plain folder copy', await p.waitFor(`document.getElementById('toasts').innerText.includes('Exported')`) && fs.existsSync(path.join(dest, 'TBMods', 'Config', 'TBCarry', 'TBCarryGlobalConfig.json')));
    await shot('13-packs');

    // ---- coverage, guide
    await p.clickText('Mods and schemas', '#nav button');
    ok('coverage page lists all mods', (await p.eval(`document.querySelectorAll('#main tbody tr').length`)) >= 14);
    await shot('14-coverage');
    await p.clickText('Guide', '#nav button');
    ok('guide page', (await text()).includes('Saving safely'));

    // ---- keyboard: tab order reaches the nav and a field
    await p.clickText('Overview', '#nav button');
    ok('nav buttons are focusable', await p.eval(`document.querySelector('#nav button').tabIndex >= 0`));
    ok('no horizontal page scroll at app size', await p.eval(`document.documentElement.scrollWidth <= window.innerWidth`));

    // ---- narrow window
    await p.viewport(420, 860, true);
    await p.goto('http://127.0.0.1:' + PORT + '/', 700);
    ok('narrow: top bar with menu button, side menu hidden', await p.eval(`getComputedStyle(document.querySelector('.topbar')).display !== 'none' && document.getElementById('side').getBoundingClientRect().right <= 0`));
    await shot('n1-narrow-overview');
    await p.click('#menuBtn'); await p.wait(300);
    ok('narrow: the menu opens', await p.eval(`document.getElementById('side').getBoundingClientRect().left >= 0`));
    await shot('n2-narrow-menu');
    await p.eval(`window.__tbs.go({name:'file',path:'${rel}'})`); await p.wait(700);
    ok('narrow: fields stack and nothing scrolls sideways', await p.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('main').scrollWidth <= document.getElementById('main').clientWidth + 1`));
    await shot('n3-narrow-file');
    await p.eval(`window.__tbs.go({name:'presets'})`); await p.wait(500);
    await shot('n4-narrow-presets');
    const errs = p.logs.filter((l) => (l.type === 'exception' || l.type === 'error' || l.type === 'log-error') && !/api[/]open/.test(l.text));   // the refused UNC path is a deliberate 400
    ok('no console errors or exceptions', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  } finally {
    await browser.close();
    await server.stop();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nUI QA: ${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(BASE, 'ui-qa-result.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
