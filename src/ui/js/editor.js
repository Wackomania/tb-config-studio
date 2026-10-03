// The file editor: explains every field (label, help, unit, range, default, risk), edits values, and saves through a reviewed diff.
import { h, t, api, ApiError, toast, dialog, confirmDialog, diffView, makeMatcher, normPath, isMarker, markerLabel, fmtTime, fmtBytes, show } from './util.js';

const HIDDEN = '⟦hidden⟧';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCont = (v) => v !== null && typeof v === 'object';
const getAt = (root, p) => { let c = root; for (const k of p) { if (c === null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
const pkey = (p) => JSON.stringify(p);
const NAMEY = ['name', 'Name', 'id', 'Id', 'className', 'ClassName', 'type', 'Type', 'title', 'zoneName', 'itemName', 'uniqueName', 'fileName'];

export function createEditor(fd, { focusPath, onChange, onSaved } = {}) {
  const schema = fd.schema || {};
  const fileSchema = schema.file;
  const match = makeMatcher(fileSchema ? fileSchema.fields : []);
  const st = { orig: clone(fd.value), cur: clone(fd.value), ops: [], base: fd.sha256 };
  const root = h('div');
  const rows = new Map();                                    // path key -> row element (for change marks and focus)
  let filterText = '', hideAdv = false, onlyChanged = false;

  const setDirty = () => { if (onChange) onChange(st.ops.length); refreshBar(); };
  function pushOp(op) {
    const last = st.ops[st.ops.length - 1];
    if (op.op === 'set' && last && last.op === 'set' && same(last.path, op.path)) last.value = clone(op.value); else st.ops.push(op);
  }
  function applyLocal(op) {
    const parent = getAt(st.cur, op.path.slice(0, -1)); const key = op.path[op.path.length - 1];
    if (op.op === 'set') parent[key] = clone(op.value);
    else if (op.op === 'remove') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else if (op.op === 'insert') parent.splice(key, 0, clone(op.value));
  }
  function edit(op) { pushOp(op); applyLocal(op); }
  const markRow = (p) => { const row = rows.get(pkey(p)); if (row) row.classList.toggle('changed', !same(getAt(st.orig, p), getAt(st.cur, p))); };

  // ------------------------------------------------------------------ controls
  function control(v, p, d) {
    const type = d && d.type ? d.type : Array.isArray(v) ? 'list' : typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'number') : 'string';
    const err = h('div', { class: 'err', hidden: true });
    const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; };
    const label = d && d.label ? d.label : String(p[p.length - 1]);
    let el;
    const setv = (nv) => { edit({ op: 'set', path: p, value: nv }); markRow(p); setDirty(); };
    if (type === 'flag' || type === 'bool') {
      const on = type === 'flag' ? v === 1 : v === true;
      const cb = h('input', { type: 'checkbox', checked: on, role: 'switch', 'aria-label': label });
      const txt = h('span', { text: on ? t('on') : t('off') });
      cb.addEventListener('change', () => { txt.textContent = cb.checked ? t('on') : t('off'); setv(type === 'flag' ? (cb.checked ? 1 : 0) : cb.checked); });
      el = h('label', { class: 'sw' }, cb, h('span', { class: 'track' }), txt);
    } else if (type === 'enum' && d.enum) {
      const sel = h('select', { 'aria-label': label });
      const opts = d.enum.slice(); if (!opts.some((o) => o.value === v)) opts.unshift({ value: v, label: String(v) + ' (current)' });
      for (const o of opts) sel.append(h('option', { value: JSON.stringify(o.value), selected: o.value === v }, o.label + ' [' + o.value + ']'));
      sel.addEventListener('change', () => setv(JSON.parse(sel.value)));
      el = sel;
    } else if (type === 'int' || type === 'number' || (typeof v === 'number' && !d)) {
      const inp = h('input', { type: 'number', value: String(v), step: type === 'int' ? '1' : 'any', 'aria-label': label });
      if (d && d.min !== undefined) inp.min = d.min; if (d && d.max !== undefined) inp.max = d.max;
      inp.addEventListener('input', () => {
        const raw = inp.value.trim(); const n = Number(raw);
        inp.classList.remove('bad');
        if (raw === '' || !Number.isFinite(n)) { inp.classList.add('bad'); showErr(t('ed.needNumber')); return; }
        if (type === 'int' && !Number.isInteger(n)) { inp.classList.add('bad'); showErr(t('ed.needWhole')); setv(n); return; }
        const special = d && d.special && Object.prototype.hasOwnProperty.call(d.special, String(n));
        if (d && !special && ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max))) { inp.classList.add('bad'); showErr(t('ed.range')); } else showErr('');
        setv(n);
      });
      el = h('span', { class: 'row' }, inp, d && d.unit ? h('span', { class: 'muted', text: d.unit }) : null, d && d.special && d.special[String(v)] ? h('span', { class: 'badge', text: d.special[String(v)] }) : null);
    } else if (type === 'secret' || type === 'url' || v === HIDDEN) {
      const hidden = v === HIDDEN;
      const inp = h('input', { type: hidden || type === 'secret' ? 'password' : 'text', class: 'wide', placeholder: hidden ? t('ed.hiddenPh') : '', value: hidden ? '' : String(v), autocomplete: 'off', 'aria-label': label });
      inp.addEventListener('change', () => { if (hidden && inp.value === '') return; setv(inp.value); });
      el = h('span', { class: 'row' }, inp, hidden ? h('span', { class: 'badge warn', text: t('ed.hiddenBadge') }) : null);
    } else if (type === 'text') {
      const ta = h('textarea', { 'aria-label': label }, String(v));
      ta.addEventListener('change', () => setv(ta.value));
      el = ta;
    } else if (typeof v === 'string' || v === null || type === 'string' || type === 'steamid' || type === 'classname' || type === 'time' || type === 'color') {
      const inp = h('input', { type: 'text', value: v === null ? '' : String(v), 'aria-label': label, spellcheck: 'false' });
      inp.addEventListener('change', () => { setv(inp.value); });
      el = type === 'color' ? h('span', { class: 'row' }, inp, h('span', { class: 'badge', text: 'hex' })) : inp;
    } else el = h('code', { text: show(v) });
    return { el, err };
  }

  function fieldRow(v, p, d) {
    const label = d && d.label ? d.label : String(p[p.length - 1]);
    const lab = h('div', { class: 'lab' }, isMarker(String(p[p.length - 1])) ? markerLabel(String(p[p.length - 1])) : label, h('span', { class: 'p', text: normPath(p) }));
    const { el, err } = control(v, p, d);
    const row = h('div', { class: 'field', 'data-search': (label + ' ' + normPath(p) + ' ' + (d ? (d.help || '') : '')).toLowerCase(), 'data-adv': d && (d.level === 'advanced' || d.level === 'danger' || d.internal) ? '1' : '0' }, lab, h('div', { class: 'ctl' }, el));
    if (d && d.help) row.append(h('div', { class: 'help', text: d.help }));
    else row.append(h('div', { class: 'help' }, h('span', { class: 'badge', text: t('ed.undescribed') }), ' ', t('ed.undescribedHelp')));
    const meta = h('div', { class: 'meta' });
    if (d) {
      if (d.internal) meta.append(h('span', { class: 'badge warn', text: t('ed.internal') }));
      if (d.level === 'danger') meta.append(h('span', { class: 'badge bad', text: t('ed.danger') }));
      else if (d.level === 'advanced') meta.append(h('span', { class: 'badge', text: t('ed.advanced') }));
      if (d.typical) meta.append(h('span', { text: t('ed.typical') + ': ' + d.typical }));
      if (d.min !== undefined || d.max !== undefined) meta.append(h('span', { text: t('ed.rangeLabel') + ': ' + (d.min !== undefined && d.max !== undefined ? d.min + ' – ' + d.max : d.min !== undefined ? t('ed.from', { v: d.min }) : t('ed.upTo', { v: d.max })) + (d.unit ? ' ' + d.unit : '') }));
      if (d.default !== undefined && !same(d.default, v)) {
        const b = h('button', { class: 'btn small', type: 'button', title: t('ed.useDefault'), onclick: () => { edit({ op: 'set', path: p, value: d.default }); refreshField(row, p); setDirty(); } }, t('ed.default') + ': ' + (typeof d.default === 'object' ? JSON.stringify(d.default).slice(0, 40) : String(d.default)));
        meta.append(b);
      }
      if (d.confidence === 'inferred') meta.append(h('span', { class: 'badge', title: t('ed.inferredTip'), text: t('ed.inferred') }));
      if (d.risk) meta.append(h('span', { class: 'risk', text: '⚠ ' + d.risk }));
    }
    row.append(err);
    if (meta.childNodes.length) row.append(meta);
    rows.set(pkey(p), row);
    if (!same(getAt(st.orig, p), v)) row.classList.add('changed');
    return row;
  }
  function refreshField(row, p) {
    const d = match(p); const nv = getAt(st.cur, p);
    const fresh = fieldRow(nv, p, d);
    row.replaceWith(fresh); rows.set(pkey(p), fresh); applyFilter();
  }

  // ------------------------------------------------------------------ containers
  function titleOf(v, p, d) {
    const last = p[p.length - 1];
    let name = d && d.label ? d.label : typeof last === 'number' ? t('ed.item') + ' ' + (last + 1) : String(last);
    if (isMarker(String(last))) name = markerLabel(String(last));
    if (isObj(v)) for (const k of NAMEY) if (typeof v[k] === 'string' && v[k]) { name += ' – ' + v[k]; break; }
    return name;
  }
  function section(v, p, depth) {
    const d = match(p);
    const det = h('details', { class: 'sect', open: depth < 2 || (focusPath && pkey(focusPath).startsWith(pkey(p).slice(0, -1))) });
    const count = Array.isArray(v) ? v.length + ' ' + t('ed.items') : Object.keys(v).length + ' ' + t('ed.entries');
    det.append(h('summary', null, titleOf(v, p, d), h('span', { class: 'muted small', text: count }), d && d.level === 'danger' ? h('span', { class: 'badge bad', text: t('ed.danger') }) : null));
    const body = h('div', { class: 'body' });
    if (d && d.help) body.append(h('div', { class: 'help muted small', text: d.help }));
    fill(body, v, p, depth + 1);
    det.append(body);
    return det;
  }
  function fill(body, v, p, depth) {
    if (Array.isArray(v)) {
      if (v.every((x) => !isCont(x))) { body.append(scalarList(v, p)); return; }
      v.forEach((x, i) => body.append(isCont(x) ? itemCard(x, [...p, i], depth) : fieldRow(x, [...p, i], match([...p, i]))));
      body.append(h('div', { class: 'row mt' }, h('button', { class: 'btn small', type: 'button', onclick: () => addItem(v, p, body) }, t('ed.addItem'))));
      return;
    }
    const keys = Object.keys(v);
    if (!keys.length) { body.append(h('div', { class: 'muted small', text: t('ed.empty') })); }
    const mapLike = keys.length > 0 && keys.every((k) => isObj(v[k]));
    for (const k of keys.filter((k) => !isCont(v[k]))) body.append(fieldRow(v[k], [...p, k], match([...p, k])));
    for (const k of keys.filter((k) => isCont(v[k]))) {
      const child = v[k];
      if (Array.isArray(child) && child.every((x) => !isCont(x))) { body.append(scalarListField(child, [...p, k])); continue; }
      body.append(section(child, [...p, k], depth));
    }
    if (mapLike && p.length) body.append(h('div', { class: 'row mt' }, h('button', { class: 'btn small', type: 'button', onclick: () => addEntry(v, p) }, t('ed.addEntry'))));
  }
  function itemCard(v, p, depth) {
    const d = match(p);
    const card = h('div', { class: 'itemcard' });
    const hd = h('div', { class: 'hd' }, h('strong', { text: titleOf(v, p, d) }), h('span', { style: 'flex:1' }),
      h('button', { class: 'btn small', type: 'button', onclick: () => dupItem(p) }, t('ed.duplicate')),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: t('ed.removeTitle'), body: t('ed.removeBody'), ok: t('ed.remove'), danger: true })) removeAt(p); } }, t('ed.remove')));
    const bd = h('div', { class: 'bd' });
    fill(bd, v, p, depth + 1);
    card.append(hd, bd);
    return card;
  }
  function scalarListField(list, p) {
    const d = match(p);
    const wrap = h('div', { class: 'field', 'data-search': (((d && d.label) || '') + ' ' + normPath(p)).toLowerCase(), 'data-adv': '0' });
    wrap.append(h('div', { class: 'lab' }, d && d.label ? d.label : String(p[p.length - 1]), h('span', { class: 'p', text: normPath(p) })), h('div', { class: 'ctl' }, scalarList(list, p)));
    if (d && d.help) wrap.append(h('div', { class: 'help', text: d.help }));
    else wrap.append(h('div', { class: 'help' }, h('span', { class: 'badge', text: t('ed.undescribed') })));
    if (d && d.risk) wrap.append(h('div', { class: 'meta' }, h('span', { class: 'risk', text: '⚠ ' + d.risk })));
    rows.set(pkey(p), wrap);
    return wrap;
  }
  function scalarList(list, p) {
    const box = h('div');
    const draw = () => {
      box.textContent = '';
      const cur = getAt(st.cur, p) || [];
      cur.forEach((x, i) => {
        const ip = [...p, i]; const d = match(ip);
        const { el, err } = control(x, ip, d);
        box.append(h('div', { class: 'row mb' }, h('span', { class: 'muted small', text: '#' + (i + 1) }), el, h('button', { class: 'btn small', type: 'button', 'aria-label': t('ed.remove'), onclick: () => { removeAt(ip, true); draw(); } }, '✕'), err));
      });
      const tmpl = cur.length ? cur[cur.length - 1] : '';
      box.append(h('button', { class: 'btn small', type: 'button', onclick: () => { const nv = typeof tmpl === 'number' ? 0 : typeof tmpl === 'boolean' ? false : ''; edit({ op: 'insert', path: [...p, cur.length], value: nv }); markRow(p); setDirty(); draw(); } }, t('ed.addItem')));
    };
    draw();
    return box;
  }

  // ------------------------------------------------------------------ structure edits (add / remove / duplicate)
  function rerender() { const y = document.getElementById('main').scrollTop; build(); document.getElementById('main').scrollTop = y; applyFilter(); setDirty(); }
  function removeAt(p, quiet) { edit({ op: 'remove', path: p }); if (!quiet) rerender(); else { markRow(p.slice(0, -1)); setDirty(); } }
  function dupItem(p) { const arr = getAt(st.cur, p.slice(0, -1)); const i = p[p.length - 1]; edit({ op: 'insert', path: [...p.slice(0, -1), i + 1], value: noMarkers(arr[i]) }); rerender(); }
  function addItem(arr, p) { if (!arr.length) { toast(t('ed.noTemplate'), 'warn'); return; } edit({ op: 'insert', path: [...p, arr.length], value: noMarkers(arr[arr.length - 1]) }); rerender(); }
  function noMarkers(v) { return JSON.parse(JSON.stringify(v), (k, x) => (x === HIDDEN ? '' : x)); }
  function addEntry(obj, p) {
    const keys = Object.keys(obj).filter((k) => !isMarker(k));
    const tmplKey = keys.find((k) => /^add here/i.test(k)) || keys[0];
    if (!tmplKey) { toast(t('ed.noTemplate'), 'warn'); return; }
    dialog((box, close) => {
      const inp = h('input', { type: 'text', class: 'wide', 'aria-label': t('ed.newKey'), spellcheck: 'false' });
      box.append(h('h2', { text: t('ed.addEntry') }), h('p', { class: 'muted', text: t('ed.addEntryHelp', { tmpl: tmplKey }) }), inp,
        h('div', { class: 'row mt' }, h('button', { class: 'btn primary', onclick: () => {
          const k = inp.value.trim();
          if (!k || k === '__proto__' || k.length > 120) { toast(t('ed.badKey'), 'bad'); return; }
          if (Object.prototype.hasOwnProperty.call(obj, k)) { toast(t('ed.dupKey'), 'bad'); return; }
          edit({ op: 'set', path: [...p, k], value: noMarkers(obj[tmplKey]), create: true }); close(); rerender();
        } }, t('btn.add')), h('button', { class: 'btn', onclick: close }, t('btn.cancel'))));
      inp.focus();
    });
  }

  // ------------------------------------------------------------------ toolbar, filter, save bar
  const tool = h('div', { class: 'row mb' });
  const search = h('input', { type: 'text', placeholder: t('ed.filter'), 'aria-label': t('ed.filter') });
  const cbAdv = h('input', { type: 'checkbox' }), cbChg = h('input', { type: 'checkbox' });
  tool.append(search, h('label', { class: 'row small' }, cbAdv, t('ed.hideAdv')), h('label', { class: 'row small' }, cbChg, t('ed.onlyChanged')));
  search.addEventListener('input', () => { filterText = search.value.trim().toLowerCase(); applyFilter(); });
  cbAdv.addEventListener('change', () => { hideAdv = cbAdv.checked; applyFilter(); });
  cbChg.addEventListener('change', () => { onlyChanged = cbChg.checked; applyFilter(); });
  function applyFilter() {
    const words = filterText.split(/\s+/).filter(Boolean);
    for (const row of formEl.querySelectorAll('.field')) {
      const s = row.getAttribute('data-search') || '';
      let vis = words.every((w) => s.includes(w));
      if (hideAdv && row.getAttribute('data-adv') === '1') vis = false;
      if (onlyChanged && !row.classList.contains('changed')) vis = false;
      row.hidden = !vis;
    }
    const filtering = words.length || hideAdv || onlyChanged;
    for (const sec of [...formEl.querySelectorAll('details.sect, .itemcard')].reverse()) {
      const any = sec.querySelector('.field:not([hidden])');
      sec.hidden = filtering && !any;
      if (filtering && any && sec.tagName === 'DETAILS') sec.open = true;
    }
  }
  const formEl = h('div');
  const bar = h('div', { class: 'savebar', hidden: true });
  const barText = h('span');
  const btnReview = h('button', { class: 'btn primary', onclick: () => review({ ops: st.ops }) }, t('ed.review'));
  const btnDiscard = h('button', { class: 'btn', onclick: async () => { if (await confirmDialog({ title: t('ed.discardTitle'), body: t('ed.discardBody'), ok: t('ed.discard') })) { st.cur = clone(st.orig); st.ops = []; rerender(); } } }, t('ed.discard'));
  bar.append(barText, h('span', { style: 'flex:1' }), btnDiscard, btnReview);
  function refreshBar() { bar.hidden = st.ops.length === 0 && !rawDirty(); barText.textContent = rawDirty() ? t('ed.rawChanged') : t('ed.changes', { n: st.ops.length }); }
  let rawArea = null;
  const rawDirty = () => rawArea && rawArea.value !== fd.raw;

  async function review(req) {
    let plan;
    try { plan = await api('/api/plan', { path: fd.path, ...req, base: { sha256: st.base } }); } catch (e) { toast(e.message, 'bad'); return; }
    dialog((box, close) => {
      box.append(h('h2', { text: t('ed.reviewTitle', { file: fd.name }) }));
      if (!plan.changed) box.append(h('p', { class: 'muted', text: t('ed.noChange') }));
      for (const e of plan.errors) box.append(h('div', { class: 'notice bad', text: (e.path ? normPath(e.path) + ': ' : '') + e.message }));
      for (const e of plan.warnings) box.append(h('div', { class: 'notice warn', text: (e.path ? normPath(e.path) + ': ' : '') + e.message }));
      if (plan.conflict) box.append(h('div', { class: 'notice bad', text: t('ed.conflict') }));
      if (plan.running) box.append(h('div', { class: 'notice warn', text: t('ed.running') }));
      box.append(h('div', { class: 'muted small', text: t('ed.diffInfo', { a: plan.diff.added, r: plan.diff.removed }) }), diffView(plan.diff.unified));
      box.append(h('div', { class: 'notice' }, h('strong', { text: t('ed.restartTitle') }), ' ', plan.restartNote));
      const saveBtn = h('button', { class: 'btn primary', disabled: !plan.valid || !plan.changed, onclick: async () => {
        saveBtn.disabled = true;
        const send = async (extra) => api('/api/save', { path: fd.path, ...req, base: { sha256: st.base }, ...extra });
        try {
          let r;
          try { r = await send({}); } catch (e) {
            if (e.status === 409 && e.extra && e.extra.code === 'changed') {
              if (!await confirmDialog({ title: t('ed.conflictTitle'), body: t('ed.conflictBody'), ok: t('ed.overwrite'), danger: true })) { saveBtn.disabled = false; return; }
              r = await send({ overwrite: true, confirmRunning: true });
            } else if (e.status === 409 && e.extra && e.extra.code === 'running') {
              if (!await confirmDialog({ title: t('ed.runningTitle'), body: e.message, ok: t('ed.saveAnyway'), danger: true })) { saveBtn.disabled = false; return; }
              r = await send({ confirmRunning: true });
            } else throw e;
          }
          close(); toast(t('ed.saved'));
          if (onSaved) onSaved(r);
        } catch (e) { saveBtn.disabled = false; toast(e.message, 'bad'); }
      } }, t('ed.saveFile'));
      box.append(h('div', { class: 'row mt' }, saveBtn, h('button', { class: 'btn', onclick: close }, t('btn.close'))));
    });
  }

  // ------------------------------------------------------------------ assemble
  function build() {
    formEl.textContent = ''; rows.clear();
    if (!isCont(st.cur)) { formEl.append(h('div', { class: 'notice', text: t('ed.notContainer') })); return; }
    if (Array.isArray(st.cur)) fill(formEl, st.cur, [], 0); else fill(formEl, st.cur, [], 0);
  }
  function rawTab() {
    const wrap = h('div');
    if (fd.parseError) wrap.append(h('div', { class: 'notice bad' }, t('ed.parseError'), ' ', fd.parseError));
    if (fd.note) wrap.append(h('div', { class: 'notice warn', text: fd.note }));
    if (fd.hiddenCount) wrap.append(h('div', { class: 'notice warn', text: t('ed.rawSecrets') }));
    rawArea = h('textarea', { style: 'min-height:420px', spellcheck: 'false', readonly: !fd.rawEditable, 'aria-label': t('ed.rawTab') }, fd.raw || '');
    rawArea.addEventListener('input', () => { refreshBar(); });
    wrap.append(rawArea);
    if (fd.rawEditable) wrap.append(h('div', { class: 'row mt' }, h('button', { class: 'btn', onclick: () => review({ raw: rawArea.value }) }, t('ed.reviewRaw'))));
    return wrap;
  }
  async function historyTab(host) {
    host.textContent = t('loading');
    try {
      const r = await api('/api/history?path=' + encodeURIComponent(fd.path));
      host.textContent = '';
      if (!r.backups.length) { host.append(h('p', { class: 'muted', text: t('ed.noBackups') })); return; }
      const tb = h('table', null, h('thead', null, h('tr', null, h('th', { text: t('hist.when') }), h('th', { text: t('hist.reason') }), h('th', { text: t('hist.size') }), h('th'))));
      const body = h('tbody');
      for (const b of r.backups) body.append(h('tr', null, h('td', { text: fmtTime(b.at) }), h('td', { text: b.reason || '' }), h('td', { text: fmtBytes(b.size) }), h('td', null, h('button', { class: 'btn small', onclick: () => backupDialog(fd.path, b.id, () => onSaved && onSaved({})) }, t('hist.view')))));
      tb.append(body); host.append(tb);
    } catch (e) { host.textContent = e.message; }
  }

  build();
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panelForm = h('div'), panelRaw = h('div', { hidden: true }), panelHist = h('div', { hidden: true });
  panelForm.append(tool, formEl);
  const mk = (id, label, panel, onShow) => { const b = h('button', { role: 'tab', 'aria-selected': id === 'form' ? 'true' : 'false', onclick: () => { for (const x of tabs.children) x.setAttribute('aria-selected', 'false'); b.setAttribute('aria-selected', 'true'); for (const pn of [panelForm, panelRaw, panelHist]) pn.hidden = pn !== panel; if (onShow) onShow(); } }, label); tabs.append(b); };
  mk('form', t('ed.formTab'), panelForm);
  mk('raw', t('ed.rawTab'), panelRaw, () => { if (!panelRaw.firstChild) panelRaw.append(rawTab()); });
  mk('hist', t('ed.historyTab'), panelHist, () => historyTab(panelHist));
  if (fd.parseError) { /* the file cannot be shown as a form */ panelRaw.append(rawTab()); }
  root.append(tabs, panelForm, panelRaw, panelHist, bar);
  if (fd.parseError) { panelForm.hidden = true; panelRaw.hidden = false; tabs.children[0].setAttribute('aria-selected', 'false'); tabs.children[1].setAttribute('aria-selected', 'true'); }
  setTimeout(() => {
    if (focusPath) {
      const row = rows.get(pkey(focusPath));
      if (row) { for (let e = row.parentElement; e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true; row.classList.add('hit'); row.scrollIntoView({ block: 'center' }); }
    }
  }, 30);
  return { el: root, dirty: () => st.ops.length > 0 || !!rawDirty() };
}

// A backup of a file: what restoring it would change, and the restore button.
export async function backupDialog(path, id, done) {
  let v;
  try { v = await api('/api/backup?path=' + encodeURIComponent(path) + '&id=' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'bad'); return; }
  dialog((box, close) => {
    box.append(h('h2', { text: t('hist.title', { file: path }) }), h('div', { class: 'muted small', text: t('hist.diffNote') }));
    if (v.sameAsNow) box.append(h('div', { class: 'notice ok', text: t('hist.same') }));
    box.append(diffView(v.diff.unified));
    const btn = h('button', { class: 'btn danger', disabled: v.sameAsNow, onclick: async () => {
      try {
        let r;
        try { r = await api('/api/restore', { path, backupId: id }); } catch (e) {
          if (e.status === 409 && e.extra && e.extra.code === 'running') { if (!await confirmDialog({ title: t('ed.runningTitle'), body: e.message, ok: t('hist.restoreAnyway'), danger: true })) return; r = await api('/api/restore', { path, backupId: id, confirmRunning: true }); } else throw e;
        }
        close(); toast(t('hist.restored') + ' ' + (r.restartNote || '')); if (done) done(r);
      } catch (e) { toast(e.message, 'bad'); }
    } }, t('hist.restore'));
    box.append(h('div', { class: 'row mt' }, btn, h('button', { class: 'btn', onclick: close }, t('btn.close'))));
  });
}
