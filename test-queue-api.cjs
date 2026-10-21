const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('queue API captures selected package, tracks real RPI responses and restores restricted serving after restart', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-api-'));
  const file = path.join(tmp, 'first.pkg'); const bytes = Buffer.from('7f434e540102030405', 'hex'); fs.writeFileSync(file, bytes);
  let installs = 0, packageUrl, progressCalls = 0;
  const fakePS4 = http.createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const body = JSON.parse(text);
    if (req.url === '/api/install') { installs++; packageUrl = body.packages[0]; res.end('{"status":"success","task_id":42}'); }
    else if (req.url === '/api/get_task_progress') { assert.equal(body.task_id, 42); progressCalls++; res.end('{"status":"success","bits":0x1,"error":0,"length_total":0x9,"transferred_total":0x9,"rest_sec":0}'); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => fakePS4.listen(12800, '127.0.0.1', r));
  let child;
  async function start(pkg = file) {
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PKG_FILE: pkg, UI_PORT: '14177', FILE_PORT: '18084', LIBRARY_DATA_DIR: path.join(tmp, 'library'), QUEUE_DATA_DIR: path.join(tmp, 'queue') } });
    await new Promise((resolve, reject) => { let out = ''; child.stdout.on('data', c => { out += c; if (out.includes('Servidor de pacotes')) resolve(); }); child.on('error', reject); child.on('exit', code => reject(new Error('server exit ' + code))); });
  }
  async function stop() { const ended = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await ended; }
  t.after(async () => { if (child?.exitCode == null) await stop(); await new Promise(r => fakePS4.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); });
  const call = async (route, body = {}, headers = {}) => { const r = await fetch('http://127.0.0.1:14177/api/queue/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  const state = async () => (await fetch('http://127.0.0.1:14177/api/queue')).json();
  await start();
  assert.equal((await call('add', { kind: 'send' }, { Origin: 'https://example.com' })).status, 403);
  const queued = await call('add', { kind: 'send', ps4Ip: '127.0.0.1', macIp: '127.0.0.1' });
  assert.equal(queued.status, 201); assert.equal(installs, 0);
  await stop(); await start('/different-selection.pkg'); assert.equal(installs, 0);
  assert.equal((await state()).jobs[0].file, file);
  assert.equal((await call('start')).status, 202);
  let result;
  for (let n = 0; n < 100; n++) { result = await state(); if (result.jobs[0].status !== 'running') break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal(result.jobs[0].status, 'success'); assert.equal(result.jobs[0].progress.transferred, 9); assert.equal(installs, 1); assert.equal(progressCalls, 1);
  assert.equal(result.jobs[0].token, undefined);
  // Allowed peer must use the selected PS4 address, including after restart.
  await stop(); await start();
  assert.equal((await fetch(packageUrl.replace(/\/[a-f0-9]{64}\//, '/wrong/'))).status, 403);
  const read = () => new Promise((resolve, reject) => { const req = http.get(packageUrl, { localAddress: '127.0.0.1', headers: { Range: 'bytes=0-3' } }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks) })); }); req.on('error', reject); });
  let range = await read(); assert.equal(range.status, 206); assert.deepEqual(range.bytes, bytes.subarray(0, 4));
  fs.appendFileSync(file, 'changed'); range = await read(); assert.equal(range.status, 409);
  assert.equal(installs, 1);
});
