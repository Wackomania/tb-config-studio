'use strict';
// Line diff (Myers O(ND)) and unified-diff output. Pure functions, no dependencies.

function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

// Returns an array of ops: { t: '=' | '-' | '+', a?: index in A, b?: index in B }, or null when the middle is too different (> maxD edits).
function myers(A, B, maxD) {
  const N = A.length, M = B.length;
  if (N === 0 && M === 0) return [];
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1]; else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return null;
  const ops = [];
  let x = N, y = M;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]; const w = d - 1;
    const k = x - y;
    const prevK = (k === -d || (k !== d && prev[k - 1 + w] < prev[k + 1 + w])) ? k + 1 : k - 1;
    const prevX = prev[prevK + w], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ t: '=', a: x, b: y }); }
    if (x === prevX) { y--; ops.push({ t: '+', b: y }); } else { x--; ops.push({ t: '-', a: x }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: '=', a: x, b: y }); }
  return ops.reverse();
}

function diffLines(a, b, { maxD = 2500 } = {}) {
  const A = splitLines(a), B = splitLines(b);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const midA = A.slice(pre, A.length - suf), midB = B.slice(pre, B.length - suf);
  let truncated = false;
  let mid = myers(midA, midB, maxD);
  if (!mid) {                                            // too different: show the middle as one replaced block
    truncated = true;
    mid = [...midA.map((_, i) => ({ t: '-', a: i })), ...midB.map((_, i) => ({ t: '+', b: i }))];
  }
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ t: '=', a: i, b: i });
  for (const o of mid) ops.push(o.t === '=' ? { t: '=', a: o.a + pre, b: o.b + pre } : o.t === '-' ? { t: '-', a: o.a + pre } : { t: '+', b: o.b + pre });
  for (let i = 0; i < suf; i++) ops.push({ t: '=', a: A.length - suf + i, b: B.length - suf + i });
  return { A, B, ops, truncated };
}

// Unified diff. Returns { identical, added, removed, hunks, unified, truncated }.
function unifiedDiff(a, b, { labelA = 'a', labelB = 'b', context = 3, maxLines = 5000, redact = null } = {}) {
  const { A, B, ops, truncated } = diffLines(a, b);
  let added = 0, removed = 0;
  for (const o of ops) { if (o.t === '+') added++; else if (o.t === '-') removed++; }
  if (!added && !removed) return { identical: true, added: 0, removed: 0, hunks: [], unified: '', truncated: false };
  const show = (s) => (redact ? redact(s) : s);
  const hunks = [];
  const groups = [];
  ops.forEach((o, idx) => {
    if (o.t === '=') return;
    const g = groups[groups.length - 1];
    if (g && idx - g.last - 1 <= context * 2) g.last = idx; else groups.push({ first: idx, last: idx });
  });
  for (const g of groups) {
    const start = Math.max(0, g.first - context), end = Math.min(ops.length, g.last + context + 1);
    const slice = ops.slice(start, end);
    const lines = slice.map(o => (o.t === '=' ? ' ' + show(A[o.a]) : o.t === '-' ? '-' + show(A[o.a]) : '+' + show(B[o.b])));
    const firstA = slice.find(o => o.a !== undefined), firstB = slice.find(o => o.b !== undefined);
    const countA = slice.filter(o => o.t !== '+').length, countB = slice.filter(o => o.t !== '-').length;
    hunks.push({
      oldStart: firstA ? firstA.a + 1 : 0, oldLines: countA, newStart: firstB ? firstB.b + 1 : 0, newLines: countB, lines,
    });
  }
  const out = [`--- ${labelA}`, `+++ ${labelB}`];
  let outTruncated = false;
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) out.push(l);
    if (out.length > maxLines) { outTruncated = true; out.length = maxLines; out.push('... (diff cut here, it is too long to show) ...'); break; }
  }
  return { identical: false, added, removed, hunks: outTruncated ? hunks.slice(0, 50) : hunks, unified: out.join('\n') + '\n', truncated: truncated || outTruncated };
}

module.exports = { splitLines, diffLines, unifiedDiff };
