'use strict';
// Development helper for the UI QA run: drives a headless Edge/Chrome through the DevTools protocol using only Node built-ins
// (global WebSocket, fetch). Not used in production. Usage: const b = await launch({ port: 2419 }); const p = await b.page(); ...
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launch({ port = 2419, exe } = {}) {
  const bin = exe || EXES.find(p => fs.existsSync(p));
  if (!bin) throw new Error('No Edge or Chrome found');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-qa-browser-'));
  const proc = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars=false', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: process.env.QA_DEBUG ? 'inherit' : 'ignore' });
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ok = true; } catch (e) { await sleep(250); } }
  if (!ok) { proc.kill(); throw new Error('Browser did not start'); }
  const browser = {
    proc, port, dir,
    async page() {
      const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      return openPage(t.webSocketDebuggerUrl);
    },
    async close() { try { proc.kill(); } catch (e) { /* ignore */ } await sleep(400); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } },
  };
  return browser;
}

async function openPage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method) {
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push({ type: msg.params.type, text: msg.params.args.map(a => a.value ?? a.description ?? '').join(' ') });
      if (msg.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text });
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) logs.push({ type: 'log-' + msg.params.entry.level, text: msg.params.entry.text + ' ' + (msg.params.entry.url || '') });
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  const page = {
    send, logs,
    async viewport(w, h, mobile = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); },
    async goto(url, wait = 700) {
      await send('Page.navigate', { url });
      await sleep(wait);
      for (let i = 0; i < 40; i++) { const r = await page.eval('document.readyState'); if (r === 'complete') break; await sleep(100); }
      await sleep(wait);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, { full = false } = {}) {
      let params = { format: 'png' };
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        const w = Math.ceil(m.cssContentSize.width), hh = Math.min(Math.ceil(m.cssContentSize.height), 6000);
        params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: hh, scale: 1 } };
      }
      const r = await send('Page.captureScreenshot', params);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async click(sel) { const ok = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`); if (!ok) throw new Error('click: not found ' + sel); await sleep(250); },
    async clickText(text, scope = 'button, a, .tab, [role=tab], .cardsel, li') {
      const ok = await page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(x=>x.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())})&&x.offsetParent!==null);if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`);
      if (!ok) throw new Error('clickText: not found ' + text); await sleep(300);
    },
    async type(sel, text) {
      await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.select&&e.select();})()`);
      await send('Input.insertText', { text });
    },
    async key(key, opts = {}) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ' ': 32, k: 75 };
      const base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: codes[key] || key.toUpperCase().charCodeAt(0), modifiers: opts.modifiers || 0 };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(120);
    },
    async wait(ms) { await sleep(ms); },
    async waitFor(expr, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await page.eval(expr)) return true; } catch (e) { /* retry */ } await sleep(150); } return false; },
    async cookie(url, name, value) { await send('Network.setCookie', { url, name, value }); },
    on(fn) { listeners.push(fn); },
    async close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
  return page;
}

module.exports = { launch, sleep };
