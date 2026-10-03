// TB Config Studio: screens and navigation.
import { h, t, api, loadStrings, toast, dialog, closeDialog, confirmDialog, diffView, fmtBytes, fmtTime, show, normPath } from './util.js';
import { createEditor, backupDialog } from './editor.js';

const main = document.getElementById('main');
let S = null;                       // state from the server
let view = { name: 'home' };
let editorRef = null;

const covBadge = (c) => h('span', { class: 'badge ' + (c === 'in-depth' ? 'ok' : c === 'partial' ? 'warn' : 'info'), title: t('cov.' + c + '.tip'), text: t('cov.' + c) });

async function refresh() { S = await api('/api/state'); renderChrome(); }
function renderChrome() {
  document.getElementById('ver').textContent = 'v' + S.app.version;
  const ov = S.overview;
  document.getElementById('topProfile').textContent = ov ? ov.profileDir || ov.configDir : '';
  const box = document.getElementById('profileBox'); box.textContent = '';
  if (ov) {
    box.append(h('div', { class: 'small muted', text: t('nav.profile') }), h('div', { class: 'path', text: ov.profileDir || ov.configDir }),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => go({ name: 'home', choose: true }) }, t('nav.change')), h('button', { class: 'btn small', onclick: async () => { const r = await api('/api/rescan', {}); S.overview = r.overview; renderChrome(); route(); toast(t('nav.rescanned')); } }, t('nav.rescan'))));
  } else box.append(h('div', { class: 'muted small', text: t('nav.noProfile') }));
  const nav = document.getElementById('nav'); nav.textContent = '';
  const item = (label, v, n) => nav.append(h('button', { 'aria-current': view.name === v.name && (v.name !== 'mod' || view.folder === v.folder) ? 'page' : null, onclick: () => go(v) }, h('span', { text: label }), n !== undefined ? h('span', { class: 'n', text: n }) : null));
  const grp = (label) => nav.append(h('div', { class: 'grp', text: label }));
  if (ov) {
    item(t('nav.overview'), { name: 'overview' });
    grp(t('nav.mods'));
    for (const m of ov.mods) item(m.name, { name: 'mod', folder: m.folder }, m.fileCount);
    grp(t('nav.tools'));
    item(t('nav.search'), { name: 'search' }); item(t('nav.compare'), { name: 'compare' }); item(t('nav.presets'), { name: 'presets' });
    item(t('nav.licence'), { name: 'licence' }); item(t('nav.backups'), { name: 'backups' }); item(t('nav.packs'), { name: 'packs' });
  } else item(t('nav.open'), { name: 'home' });
  grp(t('nav.help'));
  item(t('nav.guide'), { name: 'guide' }); item(t('nav.coverage'), { name: 'coverage' });
}

async function go(v) {
  if (editorRef && editorRef.dirty() && !(await confirmDialog({ title: t('nav.leaveTitle'), body: t('nav.leaveBody'), ok: t('nav.leave'), danger: true }))) return;
  editorRef = null; view = v; closeDialog();
  document.getElementById('side').classList.remove('open'); document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
  renderChrome(); await route();
  main.scrollTop = 0;
}
async function route() {
  main.textContent = '';
  try {
    const fn = { home: vHome, overview: vOverview, mod: vMod, file: vFile, search: vSearch, compare: vCompare, presets: vPresets, licence: vLicence, backups: vBackups, packs: vPacks, guide: vGuide, coverage: vCoverage }[view.name] || vHome;
    await fn();
  } catch (e) { main.append(h('div', { class: 'notice bad', text: e.message })); }
}
const needProfile = () => { if (!S.overview) { view = { name: 'home' }; return false; } return true; };
const crumbs = (...parts) => h('div', { class: 'crumbs' }, parts.flatMap((p, i) => [i ? h('span', { text: '›' }) : null, p.go ? h('button', { onclick: () => go(p.go) }, p.text) : h('span', { text: p.text })]));

// ---------------------------------------------------------------------------------------------------------------- home
async function openPath(p) {
  if (!p || !p.trim()) { toast(t('home.typePath'), 'warn'); return; }
  try {
    const r = await api('/api/open', { path: p });
    if (r.candidates) {
      dialog((box, close) => {
        box.append(h('h2', { text: t('home.severalTitle') }), h('p', { class: 'muted', text: t('home.severalBody') }));
        for (const c of r.candidates) box.append(h('div', { class: 'row mb' }, h('code', { text: c }), h('button', { class: 'btn small primary', onclick: async () => { close(); await openPath(c); } }, t('btn.open'))));
        box.append(h('button', { class: 'btn', onclick: close }, t('btn.cancel')));
      });
      return;
    }
    await refresh(); await go({ name: 'overview' });
  } catch (e) { toast(e.message, 'bad'); }
}
async function vHome() {
  if (S.overview && !view.choose) { view = { name: 'overview' }; return vOverview(); }
  main.append(h('h1', { text: t('home.title') }), h('p', { class: 'muted', text: t('home.intro') }));
  const inp = h('input', { type: 'text', class: 'wide', placeholder: 'D:\\DayZServer\\profiles', 'aria-label': t('home.pathLabel'), spellcheck: 'false' });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') openPath(inp.value); });
  main.append(h('div', { class: 'card' }, h('h2', { text: t('home.openTitle') }), h('p', { class: 'muted small', text: t('home.openHelp') }),
    h('div', { class: 'row mb' }, h('button', { class: 'btn primary', onclick: async () => { const r = await api('/api/pick-folder', {}); if (r.path) openPath(r.path); else if (r.note) toast(r.note, 'warn'); } }, t('home.choose')), h('span', { class: 'muted', text: t('home.or') })),
    h('div', { class: 'row' }, inp, h('button', { class: 'btn', onclick: () => openPath(inp.value) }, t('btn.open')))));
  if (S.recent.length) {
    const card = h('div', { class: 'card' }, h('h2', { text: t('home.recent') }));
    for (const p of S.recent) {
      const alive = S.recentAlive.includes(p);
      card.append(h('div', { class: 'row sp mb' }, h('code', { text: p }), h('span', { class: 'row' }, !alive ? h('span', { class: 'badge bad', text: t('home.missing') }) : null,
        h('button', { class: 'btn small primary', disabled: !alive, onclick: () => openPath(p) }, t('btn.open')), h('button', { class: 'btn small ghost', onclick: async () => { await api('/api/forget', { path: p }); await refresh(); route(); } }, t('home.forget')))));
    }
    main.append(card);
  }
  if (!S.firstRunDone) main.append(firstRunCard());
}
function firstRunCard() {
  const card = h('div', { class: 'card' }, h('h2', { text: t('first.title') }));
  card.append(h('ol', { class: 'steps' }, ['first.1', 'first.2', 'first.3', 'first.4', 'first.5'].map((k) => h('li', { text: t(k) }))));
  card.append(h('button', { class: 'btn', onclick: async () => { await api('/api/settings', { firstRunDone: true }); S.firstRunDone = true; route(); } }, t('first.done')));
  return card;
}

// ---------------------------------------------------------------------------------------------------------------- overview
async function vOverview() {
  if (!needProfile()) return vHome();
  const ov = S.overview;
  main.append(h('h1', { text: t('ov.title') }), h('p', { class: 'muted', text: t('ov.summary', { n: ov.mods.length, f: ov.fileCount }) }));
  main.append(h('div', { class: 'notice warn' }, h('strong', { text: t('ov.restartTitle') }), ' ', t('ov.restartBody')));
  if (ov.truncated) main.append(h('div', { class: 'notice bad', text: t('ov.truncated') }));
  if (ov.skipped.length) main.append(h('div', { class: 'notice', text: t('ov.skipped', { n: ov.skipped.length }) }));
  for (const e of ov.schemaErrors) main.append(h('div', { class: 'notice bad', text: t('ov.schemaError', { f: e.file, m: e.message }) }));
  const grid = h('div', { class: 'grid' });
  for (const m of ov.mods) {
    grid.append(h('button', { class: 'card modcard', onclick: () => go({ name: 'mod', folder: m.folder }) },
      h('div', { class: 'row sp' }, h('strong', { text: m.name }), covBadge(m.coverage)),
      h('div', { class: 'muted small mt', text: m.summary.length > 150 ? m.summary.slice(0, 147) + '…' : m.summary }),
      h('div', { class: 'row small muted mt' }, h('span', { text: t('ov.files', { n: m.fileCount }) }), m.versions.length ? h('span', { title: t('ov.verTip'), text: t('ov.ver', { v: m.versions.join(', ') }) }) : null, m.undescribed ? h('span', { class: 'badge warn', text: t('ov.undescribed', { n: m.undescribed }) }) : null)));
  }
  main.append(grid);
  if (!ov.mods.length) main.append(h('div', { class: 'notice', text: t('ov.none') }));
  if (ov.missing.length) main.append(h('details', { class: 'sect mt' }, h('summary', { text: t('ov.missing', { n: ov.missing.length }) }), h('div', { class: 'body' }, h('p', { class: 'muted small', text: t('ov.missingHelp') }), h('ul', null, ov.missing.map((m) => h('li', { text: m.name }))))));
}

// ---------------------------------------------------------------------------------------------------------------- mod
async function vMod() {
  if (!needProfile()) return vHome();
  const m = S.overview.mods.find((x) => x.folder === view.folder);
  if (!m) { view = { name: 'overview' }; return vOverview(); }
  main.append(crumbs({ text: t('nav.overview'), go: { name: 'overview' } }, { text: m.name }));
  main.append(h('div', { class: 'row sp' }, h('h1', { text: m.name }), covBadge(m.coverage)), h('p', { text: m.summary }));
  if (m.docs) main.append(h('p', { class: 'muted small' }, t('mod.docs') + ': ', h('code', { text: m.docs })));
  const meta = S.schemaMods.find((x) => x.folder === m.folder);
  if (meta && meta.notes) main.append(h('div', { class: 'notice', text: meta.notes }));
  if (!m.known) main.append(h('div', { class: 'notice warn', text: t('mod.unknown') }));
  const inp = h('input', { type: 'text', placeholder: t('mod.filter'), 'aria-label': t('mod.filter') });
  const host = h('div');
  const draw = () => {
    host.textContent = '';
    const q = inp.value.trim().toLowerCase();
    const list = m.files.filter((f) => !q || (f.path + ' ' + f.title).toLowerCase().includes(q));
    const groups = new Map();
    for (const f of list) (groups.get(f.group) || groups.set(f.group, []).get(f.group)).push(f);
    for (const [g, files] of groups) {
      const shown = files.slice(0, 120);
      const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('mod.file') }), h('th', { text: t('mod.what') }), h('th', { text: t('mod.size') }), h('th'))));
      const body = h('tbody');
      for (const f of shown) body.append(h('tr', null, h('td', null, h('code', { text: f.name })), h('td', { text: f.described ? f.title : t('mod.notDescribed') }), h('td', { text: fmtBytes(f.size) }), h('td', null, h('button', { class: 'btn small', onclick: () => go({ name: 'file', path: f.path }) }, t('btn.open')))));
      tb.append(body);
      host.append(h('h3', { class: 'mt', text: (g || t('mod.mainFolder')) + ' (' + files.length + ')' }), tb, files.length > shown.length ? h('div', { class: 'muted small', text: t('mod.more', { n: files.length - shown.length }) }) : null);
    }
    if (!list.length) host.append(h('p', { class: 'muted', text: t('mod.noFiles') }));
  };
  inp.addEventListener('input', draw);
  main.append(h('div', { class: 'mt' }, inp), host); draw();
}

// ---------------------------------------------------------------------------------------------------------------- file
async function vFile() {
  if (!needProfile()) return vHome();
  const fd = await api('/api/file?path=' + encodeURIComponent(view.path));
  const modName = fd.schema.mod ? fd.schema.mod.name : fd.mod;
  main.append(crumbs({ text: t('nav.overview'), go: { name: 'overview' } }, { text: modName, go: { name: 'mod', folder: fd.mod } }, { text: fd.name }));
  const title = fd.schema.file ? fd.schema.file.title : fd.name;
  main.append(h('div', { class: 'row sp' }, h('h1', { text: title }), fd.schema.mod ? covBadge(fd.schema.mod.coverage) : null));
  if (fd.schema.file && fd.schema.file.summary) main.append(h('p', { text: fd.schema.file.summary }));
  if (!fd.schema.file) main.append(h('div', { class: 'notice warn', text: t('file.notDescribed') }));
  main.append(h('div', { class: 'muted small mb' }, h('code', { text: fd.path }), ' · ' + fmtBytes(fd.size) + (fd.style ? ' · ' + t('file.style', { indent: fd.style.indent, eol: fd.style.eol }) : '')));
  main.append(h('div', { class: 'notice' }, h('strong', { text: t('ov.restartTitle') }), ' ', fd.restartNote));
  if (fd.hiddenCount) main.append(h('div', { class: 'notice', text: t('file.hidden', { n: fd.hiddenCount }) }));
  if (fd.runningHint) main.append(h('div', { class: 'notice warn', text: t('file.running') }));
  if (fd.style && (fd.style.comments || fd.style.duplicateKeys)) main.append(h('div', { class: 'notice warn', text: t('file.odd') }));
  const ed = createEditor(fd, { focusPath: view.focus, onSaved: async () => { editorRef = null; await refresh(); const keep = view; view = { name: 'file', path: keep.path }; renderChrome(); await route(); } });
  editorRef = ed; main.append(ed.el);
}

// ---------------------------------------------------------------------------------------------------------------- search
async function vSearch() {
  if (!needProfile()) return vHome();
  main.append(h('h1', { text: t('search.title') }), h('p', { class: 'muted', text: t('search.intro') }));
  const inp = h('input', { type: 'text', class: 'wide', placeholder: t('search.ph'), 'aria-label': t('search.title'), value: view.q || '' });
  const out = h('div', { class: 'mt' });
  let timer = null;
  const run = async () => {
    const q = inp.value.trim(); view.q = q;
    if (!q) { out.textContent = ''; return; }
    out.textContent = t('loading');
    try {
      const r = await api('/api/search?q=' + encodeURIComponent(q));
      out.textContent = '';
      if (!r.results.length) { out.append(h('p', { class: 'muted', text: t('search.none') })); return; }
      out.append(h('p', { class: 'muted small', text: t('search.count', { n: r.results.length }) + (r.truncated ? ' ' + t('search.trunc') : '') }));
      const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('search.where') }), h('th', { text: t('search.field') }), h('th', { text: t('search.value') }))));
      const body = h('tbody');
      for (const x of r.results) {
        const open = () => go({ name: 'file', path: x.file, focus: x.path });
        body.append(h('tr', null, h('td', null, h('div', { text: x.modName }), h('code', { class: 'muted', text: x.file.split('/').slice(1).join('/') })),
          h('td', null, x.kind === 'file' ? h('em', { text: t('search.fileHit', { t: x.title }) }) : h('div', null, h('div', { text: x.label || x.pathText }), x.label ? h('code', { class: 'muted', text: x.pathText }) : null)),
          h('td', null, x.kind === 'field' ? h('code', { text: String(show(x.value)).slice(0, 80) }) : null, ' ', h('button', { class: 'btn small', onclick: open }, t('btn.open')))));
      }
      tb.append(body); out.append(tb);
    } catch (e) { out.textContent = ''; out.append(h('div', { class: 'notice bad', text: e.message })); }
  };
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  main.append(inp, out); inp.focus(); if (view.q) run();
}

// ---------------------------------------------------------------------------------------------------------------- compare
function fieldTable(fields, aLabel, bLabel) {
  const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('cmp.field') }), h('th', { text: aLabel }), h('th', { text: bLabel }))));
  const body = h('tbody');
  for (const f of fields) body.append(h('tr', null, h('td', null, h('div', { text: f.label || f.pathText }), f.label ? h('code', { class: 'muted', text: f.pathText }) : null), h('td', null, h('code', { text: f.a === undefined ? '—' : String(show(f.a)).slice(0, 90) })), h('td', null, h('code', { text: f.b === undefined ? '—' : String(show(f.b)).slice(0, 90) }))));
  tb.append(body); return tb;
}
function compareResult(r, aLabel, bLabel) {
  const box = h('div', { class: 'mt' });
  box.append(h('p', { class: 'muted', text: t('cmp.summary', { c: r.changed.length, s: r.same, a: r.onlyA.length, b: r.onlyB.length }) }));
  if (r.mode === 'defaults') box.append(h('p', { class: 'muted small', text: t('cmp.defaultsNote') }));
  if (!r.changed.length && !r.onlyA.length && !r.onlyB.length) box.append(h('div', { class: 'notice ok', text: t('cmp.identical') }));
  for (const c of r.changed) box.append(h('details', { class: 'sect' }, h('summary', null, c.file, h('span', { class: 'badge', text: c.unreadable ? t('cmp.unreadable') : t('cmp.n', { n: c.fields.length }) })), h('div', { class: 'body' }, c.fields.length ? fieldTable(c.fields, aLabel, bLabel) : null, h('button', { class: 'btn small mt', onclick: () => go({ name: 'file', path: c.file }) }, t('cmp.openFile')))));
  if (r.onlyA.length) box.append(h('details', { class: 'sect' }, h('summary', { text: t('cmp.onlyA', { n: r.onlyA.length }) }), h('div', { class: 'body' }, r.onlyA.slice(0, 300).map((p) => h('div', null, h('code', { text: p }))))));
  if (r.onlyB.length) box.append(h('details', { class: 'sect' }, h('summary', { text: t('cmp.onlyB', { n: r.onlyB.length }) }), h('div', { class: 'body' }, r.onlyB.slice(0, 300).map((p) => h('div', null, h('code', { text: p }))))));
  if (r.truncated) box.append(h('div', { class: 'notice warn', text: t('cmp.truncated') }));
  return box;
}
async function vCompare() {
  if (!needProfile()) return vHome();
  main.append(h('h1', { text: t('cmp.title') }), h('p', { class: 'muted', text: t('cmp.intro') }));
  const out = h('div');
  const defCard = h('div', { class: 'card' }, h('h2', { text: t('cmp.defaults') }), h('p', { class: 'muted small', text: t('cmp.defaultsHelp') }),
    h('button', { class: 'btn primary', onclick: async () => { out.textContent = t('loading'); try { const r = await api('/api/compare', { mode: 'defaults' }); out.textContent = ''; out.append(compareResult(r, t('cmp.default'), t('cmp.yours'))); } catch (e) { out.textContent = ''; toast(e.message, 'bad'); } } }, t('cmp.run')));
  const inp = h('input', { type: 'text', class: 'wide', placeholder: 'D:\\OtherServer\\profiles', 'aria-label': t('cmp.folder'), spellcheck: 'false' });
  const run = async () => { out.textContent = t('loading'); try { const r = await api('/api/compare', { mode: 'folder', path: inp.value }); out.textContent = ''; out.append(compareResult(r, t('cmp.other'), t('cmp.yours'))); } catch (e) { out.textContent = ''; toast(e.message, 'bad'); } };
  const folCard = h('div', { class: 'card' }, h('h2', { text: t('cmp.folder') }), h('p', { class: 'muted small', text: t('cmp.folderHelp') }),
    h('div', { class: 'row' }, inp, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/pick-folder', {}); if (r.path) { inp.value = r.path; run(); } else if (r.note) toast(r.note, 'warn'); } }, t('home.choose')), h('button', { class: 'btn primary', onclick: run }, t('cmp.run'))));
  main.append(defCard, folCard, out);
}

// ---------------------------------------------------------------------------------------------------------------- presets
async function vPresets() {
  if (!needProfile()) return vHome();
  const info = await api('/api/presets');
  main.append(h('h1', { text: t('pre.title') }), h('div', { class: 'notice warn' }, h('strong', { text: t('pre.suggestion') }), ' ', t('pre.suggestionBody')));
  const out = h('div', { class: 'mt' });
  const grid = h('div', { class: 'grid' });
  for (const [k, v] of Object.entries(info.types)) grid.append(h('button', { class: 'card modcard', onclick: () => showPreset(k) }, h('strong', { text: v.name }), h('div', { class: 'muted small mt', text: v.note }), h('div', { class: 'small mt muted', text: t('pre.count', { n: info.counts[k] || 0 }) })));
  main.append(grid, out);
  async function showPreset(type) {
    out.textContent = t('loading');
    let p;
    try { p = await api('/api/presets/preview', { type }); } catch (e) { out.textContent = ''; toast(e.message, 'bad'); return; }
    out.textContent = '';
    out.append(h('h2', { text: p.name }), h('p', { class: 'muted', text: p.note }));
    const checks = new Map();
    const byMod = new Map();
    for (const it of p.items) (byMod.get(it.modName) || byMod.set(it.modName, []).get(it.modName)).push(it);
    if (!p.items.length) out.append(h('p', { class: 'muted', text: t('pre.nothing') }));
    for (const [mod, items] of byMod) {
      const tb = h('table', null, h('thead', null, h('tr', null, h('th'), h('th', { text: t('cmp.field') }), h('th', { text: t('pre.now') }), h('th', { text: t('pre.suggested') }), h('th', { text: t('pre.why') }))));
      const body = h('tbody');
      for (const it of items) {
        const cb = h('input', { type: 'checkbox', checked: it.status === 'change', disabled: it.status !== 'change', 'aria-label': it.label || it.path });
        checks.set(it.key, cb);
        const note = it.status === 'same' ? t('pre.same') : it.status === 'invalid' ? it.error : it.status === 'missing-file' ? t('pre.missingFile') : it.status === 'missing-field' ? t('pre.missingField') : '';
        body.append(h('tr', { class: it.status === 'change' ? '' : 'muted' }, h('td', null, cb), h('td', null, h('div', { text: it.label || it.path }), h('code', { class: 'muted', text: it.file.split('/').slice(1).join('/') + ' › ' + it.path })), h('td', null, h('code', { text: show(it.current) })), h('td', null, h('code', { text: show(it.value) })), h('td', { text: note || it.why })));
      }
      tb.append(body);
      out.append(h('details', { class: 'sect', open: true }, h('summary', { text: mod + ' (' + items.length + ')' }), h('div', { class: 'body' }, tb)));
    }
    const sel = () => [...checks].filter(([, cb]) => cb.checked).map(([k]) => k);
    const diffHost = h('div');
    out.append(h('div', { class: 'row mt' },
      h('button', { class: 'btn', onclick: async () => { diffHost.textContent = t('loading'); try { const pv = await api('/api/presets/preview', { type, keys: sel() }); diffHost.textContent = ''; for (const f of pv.files) diffHost.append(h('h3', { text: f.file }), f.errors.length ? h('div', { class: 'notice bad', text: f.errors.join(' ') }) : null, diffView(f.diff.unified)); if (!pv.files.length) diffHost.append(h('p', { class: 'muted', text: t('pre.nothing') })); } catch (e) { diffHost.textContent = ''; toast(e.message, 'bad'); } } }, t('pre.showDiff')),
      h('button', { class: 'btn primary', onclick: async () => {
        const keys = sel(); if (!keys.length) { toast(t('pre.nothing'), 'warn'); return; }
        if (!await confirmDialog({ title: t('pre.applyTitle', { n: keys.length }), body: t('pre.applyBody'), ok: t('pre.apply') })) return;
        try {
          let r; try { r = await api('/api/presets/apply', { type, keys }); } catch (e) { if (e.status === 409 && e.extra && e.extra.code === 'running') { if (!await confirmDialog({ title: t('ed.runningTitle'), body: e.message, ok: t('ed.saveAnyway'), danger: true })) return; r = await api('/api/presets/apply', { type, keys, confirmRunning: true }); } else throw e; }
          toast(t('pre.applied', { n: r.done.length })); await refresh(); showPreset(type);
          out.prepend(h('div', { class: 'notice ok' }, t('pre.appliedLong', { n: r.done.length }), ' ', r.restartNote));
        } catch (e) { toast(e.message + (e.extra && e.extra.done ? ' ' + t('pre.partial', { n: e.extra.done.length }) : ''), 'bad'); }
      } }, t('pre.apply'))), diffHost);
  }
}

// ---------------------------------------------------------------------------------------------------------------- licence
async function vLicence() {
  if (!needProfile()) return vHome();
  const L = await api('/api/licence');
  main.append(h('h1', { text: t('lic.title') }), h('p', { text: t('lic.intro') }));
  main.append(h('div', { class: 'notice' }, h('strong', { text: t('lic.factTitle') }), ' ', t('lic.fact')));
  const dl = h('dl', { class: 'kv' });
  dl.append(h('dt', { text: t('lic.port') }), h('dd', null, L.port ? h('span', null, h('strong', { text: String(L.port) }), ' ', h('span', { class: 'muted small', text: '(' + L.source + ')' })) : h('span', { class: 'muted', text: t('lic.noPort') })));
  if (L.all && L.all.length > 1) dl.append(h('dt', { text: t('lic.otherPorts') }), h('dd', { text: L.all.map((x) => x.port + ' (' + x.source + ')').join('; ') }));
  if (L.hostname) dl.append(h('dt', { text: t('lic.hostname') }), h('dd', { text: L.hostname }));
  if (L.queryPort) dl.append(h('dt', { text: t('lic.query') }), h('dd', { text: String(L.queryPort) }));
  dl.append(h('dt', { text: t('lic.ipmode') }), h('dd', { text: L.ipMode || t('lic.ipmodeNone') }));
  dl.append(h('dt', { text: t('lic.folder') }), h('dd', null, L.hasTheModBaseFolder ? t('lic.folderYes') : t('lic.folderNo')));
  main.append(h('div', { class: 'card' }, h('h2', { text: t('lic.detected') }), dl));
  if (L.licences.length) {
    const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('lic.mod') }), h('th', { text: t('lic.file') }))));
    const body = h('tbody');
    for (const x of L.licences) body.append(h('tr', null, h('td', { text: x.name }), h('td', null, x.present ? h('span', { class: 'badge ok', text: t('lic.present') }) : h('span', { class: 'badge warn', text: t('lic.absent') }))));
    tb.append(body); main.append(h('div', { class: 'card' }, h('h2', { text: t('lic.files') }), h('p', { class: 'muted small', text: t('lic.filesNote') }), tb));
  }
  const list = h('div', { class: 'card' }, h('h2', { text: t('lic.checklist') }), h('p', { class: 'muted small', text: t('lic.checklistIntro') }));
  for (let i = 1; i <= 8; i++) list.append(h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', { text: t('lic.c' + i) })));
  main.append(list);
}

// ---------------------------------------------------------------------------------------------------------------- backups
async function vBackups() {
  if (!needProfile()) return vHome();
  main.append(h('h1', { text: t('bk.title') }), h('p', { class: 'muted', text: t('bk.intro') }));
  const r = await api('/api/backups');
  if (!r.backups.length) { main.append(h('div', { class: 'notice', text: t('bk.none') })); return; }
  const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('hist.when') }), h('th', { text: t('mod.file') }), h('th', { text: t('hist.reason') }), h('th', { text: t('hist.size') }), h('th'))));
  const body = h('tbody');
  for (const b of r.backups.slice(0, 300)) body.append(h('tr', null, h('td', { text: fmtTime(b.at) }), h('td', null, h('code', { text: b.path })), h('td', { text: b.reason }), h('td', { text: fmtBytes(b.size) }), h('td', null, h('button', { class: 'btn small', onclick: () => backupDialog(b.path, b.id, async () => { await refresh(); route(); }) }, t('bk.restore')))));
  tb.append(body); main.append(tb);
}

// ---------------------------------------------------------------------------------------------------------------- packs
async function vPacks() {
  if (!needProfile()) return vHome();
  main.append(h('h1', { text: t('pk.title') }), h('p', { class: 'muted', text: t('pk.intro') }));
  const mods = S.overview.mods;
  // export
  const checks = mods.map((m) => ({ m, cb: h('input', { type: 'checkbox', checked: true }) }));
  const dest = h('input', { type: 'text', class: 'wide', placeholder: 'D:\\TB-packs\\my-pack', 'aria-label': t('pk.dest'), spellcheck: 'false' });
  const strip = h('input', { type: 'checkbox', checked: true });
  main.append(h('div', { class: 'card' }, h('h2', { text: t('pk.export') }), h('p', { class: 'muted small', text: t('pk.exportHelp') }),
    h('div', { class: 'row mb' }, checks.map(({ m, cb }) => h('label', { class: 'row small' }, cb, m.name))),
    h('label', { class: 'row mb' }, strip, t('pk.strip')), h('div', { class: 'row' }, dest, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/pick-folder', {}); if (r.path) dest.value = r.path.replace(/[\\/]$/, '') + '\\tb-config-pack'; } }, t('home.choose')),
      h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('/api/pack/export', { path: dest.value, mods: checks.filter((c) => c.cb.checked).map((c) => c.m.folder), stripSecrets: strip.checked }); toast(t('pk.exported', { n: r.files })); } catch (e) { toast(e.message, 'bad'); } } }, t('pk.exportBtn')))));
  // import
  const src = h('input', { type: 'text', class: 'wide', placeholder: 'D:\\TB-packs\\my-pack', 'aria-label': t('pk.src'), spellcheck: 'false' });
  const out = h('div');
  const preview = async () => {
    out.textContent = t('loading');
    try {
      const r = await api('/api/pack/preview', { path: src.value });
      out.textContent = '';
      if (r.pack) out.append(h('div', { class: 'notice', text: t('pk.packInfo', { n: r.pack.name || '–', d: r.pack.createdAt ? fmtTime(r.pack.createdAt) : '–' }) + (r.pack.secretsRemoved ? ' ' + t('pk.secretsRemoved') : '') }));
      out.append(h('p', { class: 'muted', text: t('pk.previewSummary', { c: r.items.length, s: r.same }) }));
      if (!r.items.length) return;
      const cbs = [];
      const tb = h('table', null, h('thead', null, h('tr', null, h('th'), h('th', { text: t('mod.file') }), h('th', { text: t('pk.status') }))));
      const body = h('tbody');
      for (const it of r.items.slice(0, 500)) { const cb = h('input', { type: 'checkbox', checked: true }); cbs.push([it.path, cb]); body.append(h('tr', null, h('td', null, cb), h('td', null, h('code', { text: it.path })), h('td', { text: it.status === 'new' ? t('pk.new') : t('pk.changed') }))); }
      tb.append(body); out.append(tb);
      out.append(h('div', { class: 'row mt' }, h('button', { class: 'btn primary', onclick: async () => {
        const files = cbs.filter(([, cb]) => cb.checked).map(([p]) => p);
        if (!files.length) return;
        if (!await confirmDialog({ title: t('pk.importTitle', { n: files.length }), body: t('pk.importBody'), ok: t('pk.importBtn') })) return;
        try {
          let res; try { res = await api('/api/pack/import', { path: src.value, files }); } catch (e) { if (e.status === 409 && e.extra && e.extra.code === 'running') { if (!await confirmDialog({ title: t('ed.runningTitle'), body: e.message, ok: t('ed.saveAnyway'), danger: true })) return; res = await api('/api/pack/import', { path: src.value, files, confirmRunning: true }); } else throw e; }
          toast(t('pk.imported', { n: res.done.length })); await refresh(); out.textContent = ''; out.append(h('div', { class: 'notice ok' }, t('pk.imported', { n: res.done.length }), ' ', res.restartNote));
        } catch (e) { toast(e.message, 'bad'); }
      } }, t('pk.importBtn'))));
    } catch (e) { out.textContent = ''; toast(e.message, 'bad'); }
  };
  main.append(h('div', { class: 'card' }, h('h2', { text: t('pk.import') }), h('p', { class: 'muted small', text: t('pk.importHelp') }),
    h('div', { class: 'row' }, src, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/pick-folder', {}); if (r.path) { src.value = r.path; preview(); } } }, t('home.choose')), h('button', { class: 'btn primary', onclick: preview }, t('pk.preview'))), out));
}

// ---------------------------------------------------------------------------------------------------------------- guide, coverage
async function vGuide() {
  main.append(h('h1', { text: t('guide.title') }));
  main.append(h('div', { class: 'card' }, h('h2', { text: t('first.title') }), h('ol', { class: 'steps' }, ['first.1', 'first.2', 'first.3', 'first.4', 'first.5'].map((k) => h('li', { text: t(k) })))));
  for (const k of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) main.append(h('div', { class: 'card' }, h('h2', { text: t('guide.' + k + '.t') }), h('p', { text: t('guide.' + k + '.b') })));
}
async function vCoverage() {
  main.append(h('h1', { text: t('covw.title') }), h('p', { class: 'muted', text: t('covw.intro') }));
  const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('covw.mod') }), h('th', { text: t('covw.level') }), h('th', { text: t('covw.files') }), h('th', { text: t('covw.fields') }), h('th', { text: t('covw.origin') }))));
  const body = h('tbody');
  for (const m of S.schemaMods) body.append(h('tr', null, h('td', null, h('div', { text: m.name }), h('code', { class: 'muted', text: m.folder })), h('td', null, covBadge(m.coverage)), h('td', { text: String(m.files) }), h('td', { text: m.described + ' / ' + m.fields }), h('td', { text: m.origin })));
  tb.append(body); main.append(tb);
  for (const e of S.schemaErrors) main.append(h('div', { class: 'notice bad', text: e.file + ': ' + e.message }));
  main.append(h('div', { class: 'card mt' }, h('h2', { text: t('covw.add') }), h('p', { text: t('covw.addBody') }), h('button', { class: 'btn', onclick: async () => { const r = await api('/api/schemas/reload', {}); await refresh(); route(); toast(r.errors.length ? t('covw.reloadErrors', { n: r.errors.length }) : t('covw.reloaded'), r.errors.length ? 'warn' : ''); } }, t('covw.reload'))));
}

// ---------------------------------------------------------------------------------------------------------------- start
document.getElementById('menuBtn').addEventListener('click', () => { const s = document.getElementById('side'); const o = s.classList.toggle('open'); document.getElementById('menuBtn').setAttribute('aria-expanded', String(o)); });
window.addEventListener('beforeunload', (e) => { if (editorRef && editorRef.dirty()) { e.preventDefault(); e.returnValue = ''; } });
(async () => {
  await loadStrings();
  try { await refresh(); } catch (e) { main.append(h('div', { class: 'notice bad', text: e.message })); return; }
  view = S.overview ? { name: 'overview' } : { name: 'home' };
  renderChrome(); await route();
  const ping = () => api('/api/ping', {}).catch(() => {});
  ping(); setInterval(ping, 4000);
  window.__tbs = { go, get state() { return S; } };
})();
