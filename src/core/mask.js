'use strict';
// Secrets never leave the app toward the window: not in the API, the diff, a preset, an exported pack summary or a log line.
// A Steam id used as a key shows only its last four digits (marker "hidden:<position>:<last4>").
// Values are replaced by a marker. A hidden value can be replaced by typing a new one, but it can never be read back.
const HIDDEN = '⟦hidden⟧';
const KEY_RE = /(webhook|token|secret|passw(or)?d|passphrase|api[-_ ]?key|apikey|licen[cs]e|steam[-_ ]?id|\bguid\b|bearer|credential|poll[-_ ]?url|response[-_ ]?url|private[-_ ]?key|serverid$)/i;
const URL_KEY_RE = /(^|[a-z])url$/i;
const VALUE_RES = [/discord(app)?\.com\/api\/webhooks/i, /hooks\.slack\.com/i, /\/api\/webhooks\//i];
const STEAM64 = /^7656119\d{10}$/;
const KEY_MARK = /^⟦hidden:(\d+)(?::\d{4})?⟧$/;

const isWebhookFile = (file) => /webhook/i.test(String(file || ''));
function secretValue(key, v, file) {
  if (typeof v !== 'string' || v === '') return false;
  if (STEAM64.test(v)) return true;
  if (VALUE_RES.some((re) => re.test(v))) return true;
  if (typeof key === 'string') {
    if (KEY_RE.test(key)) return true;
    if (URL_KEY_RE.test(key) && /^https?:\/\//i.test(v) && (isWebhookFile(file) || /(hook|api|poll|response|discord)/i.test(key))) return true;
  }
  return false;
}

// A masked copy of a parsed value plus how many values (and object keys) were hidden.
function maskValue(value, file) {
  let hidden = 0;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o = {}; let i = 0;
      for (const k of Object.keys(v)) {
        const nk = STEAM64.test(k) ? (hidden++, `⟦hidden:${i}:${k.slice(-4)}⟧`) : k;
        Object.defineProperty(o, nk, { value: walk(v[k], k), enumerable: true, writable: true, configurable: true });
        i++;
      }
      return o;
    }
    if (secretValue(key, v, file)) { hidden++; return HIDDEN; }
    return v;
  };
  return { value: walk(value, null), hidden };
}

// Turns the path a client sends (which may contain a hidden-key marker) into the real path in the real value.
function realPath(path, real) {
  const out = []; let cur = real;
  for (const k of path) {
    let key = k;
    if (typeof k === 'string' && KEY_MARK.test(k)) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) throw Object.assign(new Error('A path in the changes does not exist in the file.'), { status: 400 });
      const names = Object.keys(cur); key = names[Number(KEY_MARK.exec(k)[1])];
      if (key === undefined) throw Object.assign(new Error('A path in the changes does not exist in the file.'), { status: 400 });
    }
    out.push(key);
    cur = cur && typeof cur === 'object' ? cur[key] : undefined;
  }
  return out;
}
const hasMarker = (v) => {
  if (v === HIDDEN) return true;
  if (Array.isArray(v)) return v.some(hasMarker);
  if (v && typeof v === 'object') return Object.keys(v).some((k) => KEY_MARK.test(k) || hasMarker(v[k]));
  return false;
};

// Plain text (raw JSON, .cfg, .txt, diff lines): values after a secret-looking name, webhook addresses and Steam ids.
const JSON_KV = /("[^"\n]*(?:webhook|token|secret|passw(?:or)?d|passphrase|api[-_ ]?key|apikey|licen[cs]e|steam[-_ ]?id|guid|bearer|credential|poll[-_ ]?url|response[-_ ]?url|private[-_ ]?key|serverid)[^"\n]*"\s*:\s*)("(?:[^"\\\n]|\\.)*"|\d{5,})/gi;
const CFG_KV = /((?:^|[\s;,])(?:[A-Za-z_]*(?:passw(?:or)?d|token|secret|api[-_ ]?key|apikey|licen[cs]e)[A-Za-z_]*)\s*[=:]\s*)([^\s;,]+)/gi;
function maskText(t) {
  return String(t)
    .replace(JSON_KV, (m, a) => a + JSON.stringify(HIDDEN))
    .replace(CFG_KV, (m, a) => a + HIDDEN)
    .replace(/https?:\/\/[^\s"']*(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com)[^\s"']*/gi, HIDDEN)
    .replace(/\b7656119\d{10}\b/g, HIDDEN);
}
// One diff or log line (also hides the value of a key named like a Url inside a webhook file).
const maskLine = (s) => maskText(s);

module.exports = { HIDDEN, KEY_MARK, maskValue, realPath, hasMarker, maskText, maskLine, secretValue };
