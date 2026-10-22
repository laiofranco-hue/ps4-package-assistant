const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskQueue } = require('./queue');
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const iso = path.join(dir, 'a.iso'), pkg = path.join(dir, 'a.pkg');
  fs.writeFileSync(iso, 'BOOT2 = test'); fs.writeFileSync(pkg, Buffer.from('7f434e540000', 'hex'));
  const q = new TaskQueue({ dataDir: path.join(dir, 'private'), pollMs: 1, runConversion: async () => pkg, cancelConversion: () => {}, ...options });
  return { dir, iso, pkg, q, send: { kind: 'send', file: pkg, options: { ps4Ip: '127.0.0.1', macIp: '127.0.0.1' } } };
}
test('queue persists ordered jobs, captures options, pauses between jobs and preserves output history', async t => {
  let release, calls = 0; const gate = new Promise(r => release = r);
  const f = fixture(t, { runConversion: async (job, update) => { calls++; update({ status: 'running', log: ['etapa real'] }); if (calls === 1) await gate; return f.pkg; } });
  const opts = { title: 'Título', emulator: 'Rogue v1', resolution: '1x1', cover: '/private/cover.png' };
  await f.q.add({ kind: 'convert', file: f.iso, options: opts }); opts.title = 'Mudou';
  await f.q.add(f.send);
  assert.equal(calls, 0); assert.equal(f.q.jobs[0].options.title, 'Título');
  f.q.start(); assert.throws(() => f.q.start(), /andamento/);
  f.q.pause(); release(); await f.q.done;
  assert.equal(calls, 1); assert.equal(f.q.jobs[0].status, 'success'); assert.equal(f.q.jobs[1].status, 'pending');
  assert.equal(f.q.jobs[0].output, f.pkg); assert.deepEqual(f.q.jobs[0].log, ['etapa real']);
  const restored = new TaskQueue({ dataDir: f.q.dir }); assert.equal(restored.enabled, false); assert.equal(restored.jobs[0].output, f.pkg);
});
test('send tracks hexadecimal console bytes and never equates acceptance or zero length with completion', async t => {
  let installs = 0, polls = 0;
  const f = fixture(t, { install: async (file, options, remember) => { installs++; remember('a'.repeat(64)); return { httpStatus: 200, result: { status: 'success', task_id: 42 } }; }, progress: async () => { polls++; return { status: 'success', length_total: polls === 1 ? '0x0' : '0x100', transferred_total: polls === 3 ? '0x100' : '0x10', error: 0 }; } });
  await f.q.add(f.send); f.q.start(); await f.q.done;
  assert.equal(installs, 1); assert.equal(polls, 3); assert.equal(f.q.jobs[0].status, 'success'); assert.equal(f.q.jobs[0].taskId, 42);
  assert.equal(f.q.jobs[0].progress.transferred, 256); assert.equal(f.q.state().jobs[0].token, undefined);
});
test('lost progress pauses queue, recheck never reinstalls and retry requires explicit confirmation', async t => {
  let installs = 0, offline = true;
  const f = fixture(t, { install: async () => { installs++; return { httpStatus: 200, result: { status: 'success', task_id: 1 } }; }, progress: async () => { if (offline) throw new Error('offline'); return { status: 'success', length_total: 10, transferred_total: 10, error: 0 }; } });
  await f.q.add(f.send); await f.q.add({ kind: 'convert', file: f.iso }); f.q.start(); await f.q.done;
  assert.equal(f.q.jobs[0].status, 'attention'); assert.equal(f.q.jobs[1].status, 'pending');
  assert.throws(() => f.q.start(), /Confira/); await assert.rejects(f.q.retry(f.q.jobs[0].id), /Confir/);
  offline = false; await f.q.recheck(f.q.jobs[0].id); await f.q.done;
  assert.equal(installs, 1); assert.equal(f.q.jobs[0].status, 'success');
});
test('restart preserves pending tasks and marks running sends uncertain without automatic network calls', async t => {
  const f = fixture(t); await f.q.add(f.send); await f.q.add({ kind: 'convert', file: f.iso });
  f.q.jobs[0].status = 'running'; f.q.jobs[0].taskId = 7; f.q.save();
  const q = new TaskQueue({ dataDir: f.q.dir, install: () => assert.fail('no automatic install') });
  assert.equal(q.enabled, false); assert.equal(q.jobs[0].status, 'attention'); assert.equal(q.jobs[1].status, 'pending');
  await q.retry(q.jobs[0].id, true); assert.equal(q.jobs[0].status, 'retried'); assert.equal(q.jobs[2].retryOf, q.jobs[0].id);
});
test('changed/missing/invalid files, duplicates and invalid IPs are rejected without deleting originals', async t => {
  const f = fixture(t, { runConversion: () => assert.fail('must not execute changed source') });
  await assert.rejects(f.q.add({ ...f.send, options: { ps4Ip: '999.0.0.1' } }), /IPv4/);
  await f.q.add({ kind: 'convert', file: f.iso }); await assert.rejects(f.q.add({ kind: 'convert', file: f.iso }), /já tem/);
  fs.appendFileSync(f.iso, 'changed'); f.q.start(); await f.q.done;
  assert.equal(f.q.jobs[0].status, 'error'); assert.match(f.q.jobs[0].error, /alterado/);
  fs.writeFileSync(f.pkg, 'bad'); await assert.rejects(f.q.add(f.send), /Cabeçalho/);
  assert.ok(fs.existsSync(f.iso)); assert.ok(fs.existsSync(f.pkg));
});
test('cancel stops only the current conversion; pending cancel and failed retry keep history', async t => {
  let release, stopped = 0; const wait = new Promise(r => release = r);
  const f = fixture(t, { runConversion: async () => { await wait; throw new Error('cancelada'); }, cancelConversion: () => { stopped++; release(); } });
  await f.q.add({ kind: 'convert', file: f.iso });
  f.q.start(); await new Promise(r => setTimeout(r, 15)); f.q.cancel(f.q.jobs[0].id); await f.q.done;
  assert.equal(stopped, 1); assert.equal(f.q.jobs[0].status, 'cancelled');
  await f.q.retry(f.q.jobs[0].id); assert.equal(f.q.jobs[0].status, 'retried'); assert.equal(f.q.jobs[1].status, 'pending');
  f.q.cancel(f.q.jobs[1].id); assert.equal(f.q.jobs[1].status, 'cancelled');
});
test('lost install response is uncertain and corrupt history is preserved read-only', async t => {
  const f = fixture(t, { install: async () => { throw new Error('timeout'); } }); await f.q.add(f.send); f.q.start(); await f.q.done;
  assert.equal(f.q.jobs[0].status, 'attention'); assert.equal(f.q.jobs[0].taskId, undefined);
  fs.writeFileSync(f.q.file, 'bad json'); const q = new TaskQueue({ dataDir: f.q.dir });
  assert.equal(q.readOnly, true); assert.throws(() => q.start(), /preservado/); assert.equal(fs.readFileSync(f.q.file, 'utf8'), 'bad json');
});
test('registered task with a start warning preserves its ID and rechecks without reinstalling',async t=>{
  let installs=0;
  const f=fixture(t,{install:async()=>{installs++;return {httpStatus:200,result:{status:'attention',task_id:42,error:'Registrada; início não confirmado.'}};},progress:async()=>({status:'success',length_total:100,transferred_total:100,error:0})});
  await f.q.add(f.send);f.q.start();await f.q.done;
  assert.equal(f.q.jobs[0].status,'attention');assert.equal(f.q.jobs[0].taskId,42);assert.match(f.q.jobs[0].error,/início/);
  await f.q.recheck(f.q.jobs[0].id);await f.q.done;assert.equal(f.q.jobs[0].status,'success');assert.equal(installs,1);
});
