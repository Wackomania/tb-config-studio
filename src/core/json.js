'use strict';
// Lossless JSON for the mod config editor. The text is parsed into a tree that remembers where every value sits in the file
// (tolerates a BOM, // and /* */ comments and trailing commas). An edit does not rewrite the file: apply(newValue) walks the old tree and the
// new value together, keeps the original text of everything that did not change (numbers such as 0.8999999761581421, comments, spacing,
// key order, line endings, the final newline) and writes new text only where a value changed, was added or removed.
// Pure functions, no dependencies.

const fail = (msg, line, col) => Object.assign(new Error(msg), { line, col, status: 422 });

// ---------------------------------------------------------------------------------------------------------------------------- parsing
function parseTree(text) {
  let i = 0; const n = text.length;
  let dups = false, nest = 0;
  const MAX_NEST = 120;
  const where = (pos) => { let line = 1, last = -1; for (let k = 0; k < pos && k < n; k++) if (text.charCodeAt(k) === 10) { line++; last = k; } return { line, col: pos - last }; };
  const err = (msg, pos = i) => { const w = where(pos); return fail(`${msg} (line ${w.line}, column ${w.col})`, w.line, w.col); };
  // Whitespace and comments. Returns the index of the first comment-free position and notes whether a comma was met (only when asked).
  function skip() {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
      if (c === 47) {
        const d = text.charCodeAt(i + 1);
        if (d === 47) { i += 2; while (i < n && text.charCodeAt(i) !== 10) i++; continue; }
        if (d === 42) { const e = text.indexOf('*/', i + 2); if (e < 0) throw err('A comment is not closed'); i = e + 2; continue; }
      }
      return;
    }
  }
  function str() {
    const s = i; i++;
    let out = '';
    for (;;) {
      if (i >= n) throw err('A string is not closed', s);
      const c = text[i];
      if (c === '"') { i++; break; }
      if (c === '\\') {
        const d = text[i + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (d in map) { out += map[d]; i += 2; continue; }
        if (d === 'u' && /^[0-9a-fA-F]{4}$/.test(text.substr(i + 2, 4))) { out += String.fromCharCode(parseInt(text.substr(i + 2, 4), 16)); i += 6; continue; }
        throw err('Bad escape in a string');
      }
      if (c === '\n' || c === '\r') throw err('A string runs over the end of the line', s);
      out += c; i++;
    }
    return { t: 'str', s, e: i, v: out };
  }
  function value() {
    skip();
    if (i >= n) throw err('The text ends too early');
    const c = text[i];
    if (c === '{' || c === '[') {
      if (++nest > MAX_NEST) throw err('The file is nested too deeply (more than ' + MAX_NEST + ' levels)');
      try { return c === '{' ? obj() : arr(); } finally { nest--; }
    }
    if (c === '"') return str();
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (m) { const s = i; i += m[0].length; return { t: 'num', s, e: i, raw: m[0], v: Number(m[0]) }; }
    for (const [w, v] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(w, i) && !/[\w$]/.test(text[i + w.length] || '')) { const s = i; i += w.length; return { t: 'lit', s, e: i, v }; }
    throw err('Unexpected character ' + JSON.stringify(c));
  }
  function arr() {
    const s = i; i++;
    const items = []; let commaAfterLast = -1;
    for (;;) {
      skip();
      if (i >= n) throw err('An array is not closed', s);
      if (text[i] === ']') { i++; break; }
      if (items.length) { /* the comma was consumed below */ }
      items.push(value());
      skip();
      if (text[i] === ',') { commaAfterLast = i; i++; skip(); if (text[i] === ']') { i++; break; } else commaAfterLast = -1; continue; }
      if (text[i] === ']') { i++; commaAfterLast = -1; break; }
      throw err('Expected "," or "]"');
    }
    return { t: 'arr', s, e: i, items, close: i - 1, commaAfterLast };
  }
  function obj() {
    const s = i; i++;
    const members = []; const seen = new Set(); let commaAfterLast = -1;
    for (;;) {
      skip();
      if (i >= n) throw err('An object is not closed', s);
      if (text[i] === '}') { i++; break; }
      if (text[i] !== '"') throw err('Expected a key in quotes');
      const k = str();
      skip();
      if (text[i] !== ':') throw err('Expected ":" after the key');
      i++;
      const v = value();
      if (seen.has(k.v)) dups = true; seen.add(k.v);
      members.push({ key: k.v, ks: k.s, ke: k.e, node: v, s: k.s, e: v.e, colon: text.slice(k.e, v.s) });
      skip();
      if (text[i] === ',') { commaAfterLast = i; i++; skip(); if (text[i] === '}') { i++; break; } else commaAfterLast = -1; continue; }
      if (text[i] === '}') { i++; commaAfterLast = -1; break; }
      throw err('Expected "," or "}"');
    }
    return { t: 'obj', s, e: i, members, close: i - 1, commaAfterLast };
  }
  const root = value();
  skip();
  if (i < n) throw err('Unexpected text after the end of the value');
  return { root, dups };
}

function toValue(node) {
  switch (node.t) {
    case 'arr': return node.items.map(toValue);
    case 'obj': { const o = {}; for (const m of node.members) Object.defineProperty(o, m.key, { value: toValue(m.node), enumerable: true, writable: true, configurable: true }); return o; }
    default: return node.v;
  }
}

// A canonical text of a value (sorted keys), used to compare without caring about order or number spelling.
function canonValue(v) {
  if (Array.isArray(v)) return '[' + v.map(canonValue).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonValue(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function canonNode(node) {
  if (node.c !== undefined) return node.c;
  let c;
  if (node.t === 'arr') c = '[' + node.items.map(canonNode).join(',') + ']';
  else if (node.t === 'obj') c = '{' + node.members.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((m) => JSON.stringify(m.key) + ':' + canonNode(m.node)).join(',') + '}';
  else c = JSON.stringify(node.v);
  node.c = c;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------------- style
function detectStyle(text, root) {
  const nl = text.indexOf('\n');
  const eol = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const multiline = nl >= 0;
  let unit = '  ';
  const m = /\n([ \t]+)\S/.exec(text);
  if (m) {
    if (m[1][0] === '\t') unit = '\t';
    else {
      // the indent step: the smallest indent found on a line that follows an opening bracket, else the first indent
      const after = /[\[{][ \t]*\r?\n([ \t]+)\S/.exec(text);
      unit = ' '.repeat((after ? after[1] : m[1]).length);
    }
  }
  let colon = ': ';
  const find = (node) => {
    if (node.t === 'obj' && node.members.length) return node.members[0].colon;
    if (node.t === 'obj' || node.t === 'arr') { for (const ch of node.t === 'obj' ? node.members.map((x) => x.node) : node.items) { const r = find(ch); if (r !== undefined) return r; } }
    return undefined;
  };
  const c = find(root);
  if (typeof c === 'string' && /^\s*:\s*$/.test(c)) colon = c.replace(/[\r\n]/g, '');
  return { eol, multiline, unit, colon };
}

// ---------------------------------------------------------------------------------------------------------------------------- emitting
const NL = (style) => style.eol;
const pad = (style, depth) => style.unit.repeat(depth);

function emitNumber(v, hint) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw fail('A number is not valid.');
  let t = String(v);
  if (hint && /^-?\d+\.\d+$/.test(hint) && /^-?\d+$/.test(t)) t += '.0';
  return t;
}
function emit(v, depth, style, hint) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return emitNumber(v, hint);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (!style.multiline) return '[' + v.map((x) => emit(x, depth + 1, style)).join(',') + ']';
    const inner = pad(style, depth + 1);
    return '[' + NL(style) + v.map((x) => inner + emit(x, depth + 1, style)).join(',' + NL(style)) + NL(style) + pad(style, depth) + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return '{}';
    const colon = style.multiline ? style.colon : ':';
    if (!style.multiline) return '{' + keys.map((k) => JSON.stringify(k) + colon + emit(v[k], depth + 1, style)).join(',') + '}';
    const inner = pad(style, depth + 1);
    return '{' + NL(style) + keys.map((k) => inner + JSON.stringify(k) + colon + emit(v[k], depth + 1, style)).join(',' + NL(style)) + NL(style) + pad(style, depth) + '}';
  }
  throw fail('A value of this kind cannot be written to JSON.');
}

// ---------------------------------------------------------------------------------------------------------------------------- reconcile
const kindOf = (v) => (Array.isArray(v) ? 'arr' : v === null ? 'lit' : typeof v === 'object' ? 'obj' : typeof v === 'string' ? 'str' : typeof v === 'number' ? 'num' : 'lit');

// Which old items survive in the new array: common start and end, then the longest common run in the middle (for big middles: none, items are paired by position).
function align(oldC, newC) {
  const pairs = []; // [oldIndex, newIndex] of items that stay exactly as they were
  let pre = 0; while (pre < oldC.length && pre < newC.length && oldC[pre] === newC[pre]) pre++;
  let suf = 0; while (suf < oldC.length - pre && suf < newC.length - pre && oldC[oldC.length - 1 - suf] === newC[newC.length - 1 - suf]) suf++;
  for (let k = 0; k < pre; k++) pairs.push([k, k]);
  const a = oldC.slice(pre, oldC.length - suf), b = newC.slice(pre, newC.length - suf);
  if (a.length && b.length && a.length * b.length <= 4e6) {
    const w = b.length + 1; const dp = new Uint32Array((a.length + 1) * w);
    for (let x = a.length - 1; x >= 0; x--) for (let y = b.length - 1; y >= 0; y--) dp[x * w + y] = a[x] === b[y] ? dp[(x + 1) * w + y + 1] + 1 : Math.max(dp[(x + 1) * w + y], dp[x * w + y + 1]);
    let x = 0, y = 0;
    while (x < a.length && y < b.length) { if (a[x] === b[y]) { pairs.push([pre + x, pre + y]); x++; y++; } else if (dp[(x + 1) * w + y] >= dp[x * w + y + 1]) x++; else y++; }
  }
  for (let k = 0; k < suf; k++) pairs.push([oldC.length - suf + k, newC.length - suf + k]);
  return pairs;
}

function make(text, tree, style) {
  const slice = (a, b) => text.slice(a, b);
  const eolFix = (s) => (style.eol === '\r\n' ? s.replace(/\r?\n/g, '\r\n') : s);

  function rec(node, v, depth) {
    if (canonNode(node) === canonValue(v)) return slice(node.s, node.e);
    const k = kindOf(v);
    if (k === 'arr' && node.t === 'arr') return container(node, v.map((x) => ({ v: x })), 'arr', depth);
    if (k === 'obj' && node.t === 'obj') {
      return container(node, null, 'obj', depth, v);
    }
    if (k === 'num' && node.t === 'num') return emitNumber(v, node.raw);
    return emit(v, depth, style);
  }

  // Rebuilds an array or object, keeping the text of the parts that stayed.
  function container(node, newItems, kind, depth, newObj) {
    const open = kind === 'arr' ? '[' : '{', close = kind === 'arr' ? ']' : '}';
    const oldItems = kind === 'arr' ? node.items : node.members;
    const out = []; // { text, orig }
    if (kind === 'arr') {
      const oldC = oldItems.map(canonNode), newC = newItems.map((x) => canonValue(x.v));
      const pairs = align(oldC, newC);
      const keep = new Map(pairs.map(([o, nn]) => [nn, o]));
      // positions between kept anchors: pair the rest by position so an edited item keeps its own layout
      let po = 0, pn = 0; // next unprocessed old/new index
      const flushGap = (oEnd, nEnd) => {
        const og = oEnd - po, ng = nEnd - pn;
        for (let g = 0; g < Math.max(og, ng); g++) {
          if (g < ng) {
            if (g < og) { const o = po + g; out.push({ text: rec(oldItems[o], newItems[pn + g].v, depth + 1), orig: o }); }
            else out.push({ text: emit(newItems[pn + g].v, depth + 1, style), orig: -1 });
          }
        }
      };
      for (const [o, nn] of pairs) {
        flushGap(o, nn);
        out.push({ text: slice(oldItems[o].s, oldItems[o].e), orig: o });
        po = o + 1; pn = nn + 1;
      }
      flushGap(oldItems.length, newItems.length);
      void keep;
    } else {
      const byKey = new Map(oldItems.map((m, ix) => [m.key, ix]));
      const newKeys = Object.keys(newObj).filter((x) => newObj[x] !== undefined);
      const used = new Set();
      oldItems.forEach((m, ix) => {
        if (!Object.prototype.hasOwnProperty.call(newObj, m.key) || newObj[m.key] === undefined) return;
        used.add(m.key);
        const same = canonNode(m.node) === canonValue(newObj[m.key]);
        if (same) out.push({ text: slice(m.s, m.e), orig: ix });
        else out.push({ text: slice(m.s, m.node.s) + rec(m.node, newObj[m.key], depth + 1), orig: ix });
      });
      for (const key of newKeys) if (!used.has(key)) { void byKey; out.push({ text: JSON.stringify(key) + (style.multiline ? style.colon : ':') + emit(newObj[key], depth + 1, style), orig: -1 }); }
    }
    if (!out.length) return open + close;
    // separators and the space inside the brackets
    let prefix, suffix, S;
    if (oldItems.length) {
      prefix = slice(node.s + 1, oldItems[0].s);
      const last = oldItems[oldItems.length - 1];
      suffix = slice(last.e, node.close);
      if (node.commaAfterLast >= 0) suffix = slice(last.e, node.commaAfterLast) + slice(node.commaAfterLast + 1, node.close);
      S = oldItems.length > 1 ? slice(oldItems[0].e, oldItems[1].s) : null;
      if (S === null) { S = style.multiline ? ',' + NL(style) + pad(style, depth + 1) : ','; if (!/\n/.test(prefix) && prefix !== '') S = ', '; }
    } else if (style.multiline) {
      prefix = NL(style) + pad(style, depth + 1); suffix = NL(style) + pad(style, depth); S = ',' + NL(style) + pad(style, depth + 1);
    } else { prefix = ''; suffix = ''; S = ','; }
    let res = open + prefix;
    for (let k = 0; k < out.length; k++) {
      if (k) {
        const a = out[k - 1], b = out[k];
        res += a.orig >= 0 && b.orig === a.orig + 1 ? slice(oldItems[a.orig].e, oldItems[b.orig].s) : S;
      }
      res += out[k].text;
    }
    return res + suffix + close;
  }

  return { rec, eolFix };
}

// A parsed document: .value is the plain JS value (a copy: change it freely), .apply(newValue) gives the new file text.
function parseDoc(input) {
  let text = String(input);
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const { root, dups } = parseTree(text);
  const style = detectStyle(text, root);
  const doc = {
    bom, style, hasDuplicateKeys: dups,
    hasComments: /\/\/|\/\*/.test(text) && hasComment(text),
    get value() { return toValue(root); },
    // text of the new document for a changed value; untouched parts are byte-identical to the old text
    apply(newValue) {
      if (dups) throw fail('The file repeats a key inside one object, so it can only be edited as raw text.');
      const m = make(text, root, style);
      const body = m.rec(root, newValue, 0);
      return (bom ? '﻿' : '') + text.slice(0, root.s) + body + text.slice(root.e);
    },
    text: () => (bom ? '﻿' : '') + text,
  };
  return doc;
}

// True when // or /* occur outside strings.
function hasComment(text) {
  let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') { i++; while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) return true;
    i++;
  }
  return false;
}

// For a new file or a value without a tree: text in the same style as another document.
function stringify(value, style = { eol: '\n', multiline: true, unit: '  ', colon: ': ' }) { return emit(value, 0, style); }

// ---------------------------------------------------------------------------------------------------------------------------- paths and edits
const isIdx = (k) => Number.isInteger(k) && k >= 0;
function getAt(root, p) {
  let cur = root;
  for (const k of p) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) { if (!isIdx(k)) return undefined; cur = cur[k]; } else { if (typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined; cur = cur[k]; }
  }
  return cur;
}
const badOp = (m) => Object.assign(new Error(m), { status: 400 });
function checkPath(p) {
  if (!Array.isArray(p) || p.length > 40 || p.some((k) => !(typeof k === 'string' || Number.isInteger(k)))) throw badOp('A path in the changes is not valid.');
}
// Applies change operations to a copy of the value: set, remove, insert (array), move (array item to another index), rename (object key).
function applyOps(value, ops) {
  if (!Array.isArray(ops) || ops.length > 20000) throw badOp('The list of changes is missing or too long.');
  const root = { v: structuredClone(value) };
  const parentOf = (path) => { const p = ['v', ...path]; const parent = getAt(root, p.slice(0, -1)); const key = p[p.length - 1]; return { parent, key }; };
  for (const op of ops) {
    if (!op || typeof op !== 'object') throw badOp('A change is not valid.');
    checkPath(op.path);
    const { parent, key } = parentOf(op.path);
    if (op.path.length === 0) { if (op.op !== 'set') throw badOp('Only "set" can change the whole document.'); root.v = structuredClone(op.value); continue; }
    if (parent === null || typeof parent !== 'object') throw badOp('A path in the changes does not exist in the file.');
    const arrP = Array.isArray(parent);
    if (arrP && !isIdx(key)) throw badOp('An array needs a number in the path.');
    if (!arrP && typeof key !== 'string') throw badOp('An object needs a name in the path.');
    if (key === '__proto__') throw badOp('That name cannot be used.');
    if (op.op === 'set') {
      if (op.value === undefined) throw badOp('A "set" needs a value.');
      if (arrP && key >= parent.length) throw badOp('That position is past the end of the list.');
      if (!arrP && !Object.prototype.hasOwnProperty.call(parent, key) && op.create !== true) throw badOp('The field "' + String(key).slice(0, 60) + '" does not exist (a new field must be created explicitly).');
      Object.defineProperty(parent, key, { value: structuredClone(op.value), enumerable: true, writable: true, configurable: true });
    } else if (op.op === 'remove') {
      if (arrP) { if (key >= parent.length) throw badOp('That position is past the end of the list.'); parent.splice(key, 1); } else delete parent[key];
    } else if (op.op === 'insert') {
      if (!arrP) throw badOp('"insert" works on lists.');
      if (key > parent.length) throw badOp('That position is past the end of the list.');
      if (op.value === undefined) throw badOp('An "insert" needs a value.');
      parent.splice(key, 0, structuredClone(op.value));
    } else if (op.op === 'copy') {
      if (!arrP || key >= parent.length) throw badOp('A copy needs the position of an item in a list.');
      parent.splice(key + 1, 0, structuredClone(parent[key]));
    } else if (op.op === 'move') {
      if (!arrP || !isIdx(op.to) || op.to > parent.length - 1 || key >= parent.length) throw badOp('A move needs two positions inside the list.');
      const [x] = parent.splice(key, 1); parent.splice(op.to, 0, x);
    } else if (op.op === 'rename') {
      if (arrP || typeof op.to !== 'string' || !op.to || op.to === '__proto__' || !Object.prototype.hasOwnProperty.call(parent, key)) throw badOp('A rename needs an existing field and a new name.');
      if (Object.prototype.hasOwnProperty.call(parent, op.to)) throw badOp('A field with that name exists already.');
      const entries = Object.entries(parent).map(([k, x]) => [k === key ? op.to : k, x]);
      for (const k of Object.keys(parent)) delete parent[k];
      for (const [k, x] of entries) Object.defineProperty(parent, k, { value: x, enumerable: true, writable: true, configurable: true });
    } else throw badOp('Unknown kind of change "' + String(op.op).slice(0, 20) + '".');
  }
  return root.v;
}

module.exports = { parseDoc, stringify, applyOps, getAt, canonValue, hasComment };
