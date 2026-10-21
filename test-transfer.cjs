const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('PS4 background download survives query stripping and supports concurrent ranges', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-transfer-'));
  const file = path.join(tmp, 'fixture.pkg');
  const bytes = Buffer.from('PKG regression fixture 0123456789');
  fs.writeFileSync(file, bytes);
  const fakePS4 = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const original = new URL(JSON.parse(body).packages[0]);
    // Initial RPI reads and the background downloader can use different URLs.
    const background = new URL(original); background.search = '';
    try {
      assert.equal(original.search, '');
      const head = await fetch(background, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), bytes.length);
      const results = await Promise.all(['bytes=0-3', 'bytes=4-9'].map(async range => {
        const r = await fetch(background, { headers: { Range: range } });
        assert.equal(r.status, 206); return Buffer.from(await r.arrayBuffer());
      }));
      assert.deepEqual(results[0], bytes.subarray(0, 4));
      assert.deepEqual(results[1], bytes.subarray(4, 10));
      const invalid = new URL(background); invalid.pathname = invalid.pathname.replace(/\/[a-f0-9]{64}\//, '/bad/');
      assert.equal((await fetch(invalid)).status, 403);
      assert.equal((await fetch(background, {headers:{Range:'bytes=999-'}})).status, 416);
      res.end(JSON.stringify({status:'success', task_id:1}));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({error:e.message})); }
  });
  await new Promise(r => fakePS4.listen(12800, '127.0.0.1', r));
  const child = spawn(process.execPath, ['server.js'], {env:{...process.env, PKG_FILE:file, UI_PORT:'14173', FILE_PORT:'18080'}});
  t.after(async () => { child.kill(); await new Promise(r => fakePS4.close(r)); fs.rmSync(tmp,{recursive:true,force:true}); });
  await new Promise((resolve,reject) => { let out=''; child.stdout.on('data', c => {out+=c; if(out.includes('Servidor de pacotes')) resolve();}); child.on('error',reject); child.on('exit', code => reject(new Error(`server exit ${code}`))); });
  const r = await fetch('http://127.0.0.1:14173/api/install', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ps4Ip:'127.0.0.1',macIp:'127.0.0.1'})});
  const result = await r.json();
  assert.equal(result.httpStatus, 200, JSON.stringify(result));
  assert.equal(result.result.status, 'success');
});
