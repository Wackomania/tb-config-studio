// Small helpers shared by the screens: element builder, API calls, translations, dialogs, toasts, schema path matching.
// append(null) would write the text "null": skip empty values everywhere
const nativeAppend = Element.prototype.append;
Element.prototype.append = function (...kids) { return nativeAppend.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); };

let strings = {};
export async function loadStrings() { try { strings = await (await fetch('/i18n/en.json')).json(); } catch (e) { strings = {}; } }
export const t = (key, vars) => {
  let s = strings[key] !== undefined ? strings[key] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
};

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}

export class ApiError extends Error { constructor(msg, status, extra) { super(msg); this.status = status; this.extra = extra; } }
export async function api(path, body) {
  const opts = body === undefined ? { headers: {} } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-tbs': '1' }, body: JSON.stringify(body) };
  let res;
  try { res = await fetch(path, opts); } catch (e) { throw new ApiError(t('err.offline'), 0); }
  let data = null; try { data = await res.json(); } catch (e) { /* not json */ }
  if (!res.ok) throw new ApiError((data && data.error) || t('err.failed'), res.status, data && data.extra);
  return data;
}

export function toast(msg, kind = '') {
  const el = h('div', { class: 'toast ' + kind, text: msg });
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 4500);
}

let dialogOpen = null;
export function dialog(build) {
  closeDialog();
  const scrim = document.getElementById('scrim'); scrim.hidden = false;
  const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  const close = () => closeDialog();
  build(box, close);
  document.getElementById('dialogs').append(box);
  dialogOpen = box;
  box.focus();
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  scrim.onclick = close;
  return close;
}
export function closeDialog() { if (dialogOpen) dialogOpen.remove(); dialogOpen = null; document.getElementById('scrim').hidden = true; }

export function confirmDialog({ title, body, ok = t('btn.ok'), danger = false }) {
  return new Promise((resolve) => {
    dialog((box, close) => {
      box.append(h('h2', { text: title }), typeof body === 'string' ? h('p', { text: body }) : body,
        h('div', { class: 'row mt' }, h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { close(); resolve(true); } }, ok), h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, t('btn.cancel'))));
    });
  });
}

export function diffView(unified) {
  const pre = h('pre', { class: 'diff', tabindex: '0' });
  for (const line of String(unified || '').split('\n')) {
    if (line === '') continue;
    const cls = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') ? 'h' : line.startsWith('+') ? 'a' : line.startsWith('-') ? 'r' : '';
    pre.append(cls ? h('span', { class: cls, text: line }) : document.createTextNode(line + '\n'));
  }
  return pre;
}

export const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
export const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso || ''); } };
export const show = (v) => (v === undefined ? '(none)' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));

// ---- schema paths: the same rules as src/core/schema.js
export function normPath(p) { let acc = ''; for (const k of p) acc = typeof k === 'number' ? acc + '[]' : (acc ? acc + '.' + k : String(k)); return acc; }
const patRe = (p) => new RegExp('^' + String(p).split('.').map((seg) => seg.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^.\\[\\]]*')).join('\\.') + '$');
export function makeMatcher(fields) {
  const exact = new Map(); const wild = [];
  for (const f of fields || []) { if (f.wild) wild.push({ ...f, re: patRe(f.path) }); else exact.set(f.path, f); }
  return (p) => { const k = normPath(p); return exact.get(k) || (wild.find((f) => f.re.test(k)) || null); };
}
export const isMarker = (k) => /^⟦hidden:\d+(?::\d{4})?⟧$/.test(k);
export const markerLabel = (k) => { const m = /^⟦hidden:\d+:(\d{4})⟧$/.exec(k); return m ? 'Steam id …' + m[1] : 'hidden entry'; };
