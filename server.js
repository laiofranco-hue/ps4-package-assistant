const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { packageMetadata } = require('./pkg-metadata');

const UI_PORT = Number(process.env.UI_PORT || 4173);
const FILE_PORT = Number(process.env.FILE_PORT || 8081);
let selectedFile = process.env.PKG_FILE || '';
const transfers = [];
const { Conversion } = require('./conversion');
const conversion = new Conversion({ onComplete: file => { selectedFile = file; } });
const { Library } = require('./library');
const library = new Library({ dataDir: process.env.LIBRARY_DATA_DIR });
const { SnesLibrary } = require('./snes');
const snes = new SnesLibrary({ busy: () => queue.active || conversion.running || conversion.preparingCover || queuedConversion.running || manualInstalling || manualConversionRequests > 0 });

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function findTransfer(suppliedToken) {
  const supplied = Buffer.from(suppliedToken);
  return transfers.find(t => {
    const expected = Buffer.from(t.token);
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  });
}
function cancelTransfers() {
  console.log(`${new Date().toISOString()} cancelamento solicitado (${transfers.length} pacote(s))`);
  selectedFile = '';
  for (const transfer of transfers) for (const stop of transfer.streams) stop();
  transfers.length = 0;
}
function removeTransfer(transfer, reason) {
  const index = transfers.indexOf(transfer);
  if (index !== -1) transfers.splice(index, 1);
  console.log(`${new Date().toISOString()} pacote removido (${reason}) ps4=${transfer.ps4Ip}`);
}
function pipeFile(res, transfer, options) {
  const stream = fs.createReadStream(transfer.file, options);
  const stop = () => { stream.destroy(); res.destroy(); };
  transfer.streams.add(stop);
  stream.on('error', () => res.destroy());
  res.on('close', () => transfer.streams.delete(stop));
  stream.pipe(res);
}
function logFileRequest(req, res, peer) {
  const range = req.headers.range || 'inteiro';
  res.on('close', () => {
    const outcome = res.writableFinished ? 'ok' : 'interrompido';
    console.log(`${new Date().toISOString()} ${peer} ${req.method} ${res.statusCode} ${range} ${outcome}`);
  });
}
function logDenied(peer, reason) {
  console.log(`${new Date().toISOString()} ${peer} negado: ${reason}`);
}

function localIPv4s() {
  return Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; req.setEncoding('utf8'); req.on('data', c => { body += c; if (body.length > 16384) { reject(new Error('Request body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function installFile(file, { ps4Ip, macIp }, remember = () => {}) {
  if (!file) throw new Error('Selecione um arquivo PKG primeiro.');
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');
  const validIPv4 = value => /^\d{1,3}(\.\d{1,3}){3}$/.test(value || '') && value.split('.').every(octet => Number(octet) <= 255);
  if (!validIPv4(ps4Ip) || !validIPv4(macIp)) throw new Error('Informe endereços IPv4 válidos para o PS4 e o Mac.');
  const transfer = { token: newToken(), file: file, ps4Ip, macIp, streams: new Set() };
  remember(transfer.token);
  transfer.original = { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  transfers.push(transfer);
  const packageUrl = `http://${macIp}:${FILE_PORT}/${transfer.token}/${encodeURIComponent(path.basename(transfer.file))}`;
  const metadata = await packageMetadata(file,stat,packageUrl,`http://${macIp}:${FILE_PORT}/${transfer.token}/.assistant/manifest.json`);
  transfer.manifest=metadata?.manifest;
  const response = await fetch(`http://${ps4Ip}:12800/api/install`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'direct', packages: [packageUrl], ...(metadata?{bridge:metadata.bridge}:{}) }), signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let result; try { result = JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|\b0x[0-9a-f]+\b/gi, token => token.startsWith('"') ? token : JSON.stringify(token))); } catch { result = { raw: text }; }
  if (Number.isInteger(result.task_id) && result.task_id >= 0) transfer.taskId = result.task_id;
  if (result.status === 'fail' && result.error_code != null) {
    const code = typeof result.error_code === 'number' ? '0x' + result.error_code.toString(16).toUpperCase() : result.error_code;
    result.error = `O PS4 recusou a instalação (${code}).` + (String(code).toLowerCase() === '0x80990015' ? ' Pode existir uma instalação ou download anterior deste pacote. Confira as notificações de Downloads no PS4 e remova apenas a tentativa falhada correspondente antes de tentar novamente.' : ' Confira as notificações do PS4 para mais detalhes.');
  }
  console.log(`${new Date().toISOString()} resposta do PS4 ${ps4Ip}: http=${response.status} status=${result.status ?? '-'} erro=${result.error_code ?? result.error ?? '-'}`);
  if (!response.ok || result.status === 'fail') removeTransfer(transfer, 'PS4 respondeu falha');
  return { httpStatus: response.status, result, packageUrl, size: stat.size };
}
async function cancelReceiverTask(ip, taskId) {
  const response = await fetch(`http://${ip}:12800/api/cancel_task`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }), signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  const confirmed = response.ok && result.status === 'success' && result.cancelled === true;
  if (confirmed) for (const transfer of [...transfers]) if (transfer.ps4Ip === ip && transfer.taskId === taskId) {
    for (const stop of transfer.streams) stop();
    removeTransfer(transfer, 'cancelamento confirmado pelo receptor');
  }
  return confirmed;
}
const { TaskQueue } = require('./queue');
const queuedConversion = new Conversion({ onComplete: file => { selectedFile = file; conversion.lastOutput = file; } });
const queue = new TaskQueue({
  dataDir: process.env.QUEUE_DATA_DIR,
  busy: () => conversion.running || conversion.preparingCover || manualInstalling || manualConversionRequests > 0 || snes.running,
  install: installFile,
  cancelSend: cancelReceiverTask,
  progress: async (ip, id) => {
    const response = await fetch(`http://${ip}:12800/api/get_task_progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: id }), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    if (!response.ok) throw new Error('Consulta ao PS4 falhou. Mantenha o instalador aberto e consulte novamente.');
    return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|\b0x[0-9a-f]+\b/gi, token => token.startsWith('"') ? token : JSON.stringify(token)));
  },
  runConversion: async (job, update, signal) => {
    await queuedConversion.useIso(job.file);
    const oldCover = queuedConversion.cover;
    queuedConversion.cover = job.options.cover;
    try {
      signal.throwIfAborted();
      await queuedConversion.start(job.options);
      if (signal.aborted) queuedConversion.cancel();
      const timer = setInterval(() => update(queuedConversion.state()), 700);
      try { await queuedConversion.done; } finally { clearInterval(timer); update(queuedConversion.state()); }
      if (queuedConversion.job.status !== 'success') throw new Error(queuedConversion.job.error || 'Conversão cancelada.');
      return queuedConversion.job.output;
    } finally { queuedConversion.cover = oldCover; }
  },
  cancelConversion: () => queuedConversion.cancel()
});
let manualInstalling = false;
let manualConversionRequests = 0;
// Recover only the exact queued file, never publish a changed path after restart.
for (const job of queue.jobs) {
  if (job.kind !== 'send' || !['attention', 'success'].includes(job.status) || !/^[a-f0-9]{64}$/.test(job.token || '')) continue;
  try {
    const stat = fs.statSync(job.file);
    if (stat.isFile() && ['size', 'mtimeMs', 'ctimeMs'].every(k => stat[k] === job.original[k])) transfers.push({ token: job.token, file: job.file, ps4Ip: job.options.ps4Ip, macIp:job.options.macIp, original: job.original, streams: new Set() });
  } catch {}
}

const ui = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
  if (req.method === 'GET' && ['/library-ui.js', '/queue-ui.js', '/snes-ui.js'].includes(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, url.pathname.slice(1))).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname.startsWith('/api/snes')) {
    if (req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/snes') return json(res, 200, snes.state());
      if (req.method === 'GET' && url.pathname === '/api/snes/cover') {
        const file = snes.cover(url.searchParams.get('id'));
        res.writeHead(200, { 'Content-Type':'image/png', 'Cache-Control':'no-store' });
        const stream = fs.createReadStream(file); stream.on('error',()=>res.destroy()); return stream.pipe(res);
      }
      if (req.method !== 'POST') return json(res,405,{error:'Método não permitido.'});
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(res,415,{error:'Use JSON.'});
      const body = await readBody(req);
      if (url.pathname === '/api/snes/folder') return json(res,200,await snes.choose('folder'));
      if (url.pathname === '/api/snes/iso') return json(res,200,await snes.choose('iso'));
      if (url.pathname === '/api/snes/import') return json(res,202,await snes.importIso());
      if (url.pathname === '/api/snes/prepare') return json(res,202,snes.start('prepare'));
      if (url.pathname === '/api/snes/sync') return json(res,202,snes.start('sync',body));
      if (url.pathname === '/api/snes/cancel') return json(res,200,snes.cancel());
      if (url.pathname === '/api/snes/reveal') return json(res,200,await snes.reveal());
      return json(res,404,{error:'Comando não encontrado.'});
    } catch(e) { return json(res,400,{error:e.message}); }
  }
  if (url.pathname.startsWith('/api/queue')) {
    if (req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/queue') return json(res, 200, queue.state());
      if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Use JSON.' });
      const body = await readBody(req);
      if (url.pathname === '/api/queue/add') {
        const kind = body.kind;
        const file = kind === 'convert' ? conversion.iso : selectedFile;
        const options = kind === 'convert' ? { title: body.title, emulator: body.emulator, resolution: body.resolution, cover: conversion.cover } : { ps4Ip: body.ps4Ip, macIp: body.macIp };
        return json(res, 201, await queue.add({ kind, file, options }));
      }
      if (url.pathname === '/api/queue/start') return json(res, 202, queue.start());
      if (url.pathname === '/api/queue/pause') return json(res, 200, queue.pause());
      if (url.pathname === '/api/queue/cancel') return json(res, 200, queue.cancel(body.id));
      if (url.pathname === '/api/queue/retry') return json(res, 200, await queue.retry(body.id, body.confirm));
      if (url.pathname === '/api/queue/recheck') return json(res, 202, await queue.recheck(body.id));
      if (url.pathname === '/api/queue/use-output') {
        const job = queue.jobs.find(j => j.id === body.id && j.kind === 'convert' && j.status === 'success');
        if (!job) throw new Error('Resultado não encontrado.');
        await fs.promises.access(job.output); selectedFile = job.output;
        return json(res, 200, queue.state());
      }
      return json(res, 404, { error: 'Comando não encontrado.' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/library')) {
    if (req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/library') return json(res, 200, library.state());
      if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Use JSON.' });
      if (url.pathname === '/api/library/files') return json(res, 202, await library.choose('file'));
      if (url.pathname === '/api/library/folders') return json(res, 202, await library.choose('folder'));
      if (url.pathname === '/api/library/outputs') {
        await fs.promises.mkdir(conversion.outputRoot, { recursive: true });
        return json(res, 202, await library.add([conversion.outputRoot], 'folder'));
      }
      if (url.pathname === '/api/library/sync') return json(res, 202, library.sync());
      if (url.pathname === '/api/library/cancel') return json(res, 200, library.cancel());
      const body = await readBody(req);
      if (url.pathname === '/api/library/remove-source') return json(res, 200, await library.removeSource(body.id));
      if (url.pathname === '/api/library/use') {
        if (snes.running) throw new Error('Aguarde a tarefa SNES terminar.');
        if (queue.active) throw new Error('Aguarde a tarefa atual da fila terminar.');
        const item = await library.item(body.id);
        if (queue.active) throw new Error('Aguarde a tarefa atual da fila terminar.');
        if (item.format === 'PKG') {
          if (!item.validPkg) throw new Error('O arquivo não tem cabeçalho PKG válido.');
          selectedFile = item.path;
          return json(res, 200, { kind: 'pkg', title: item.title });
        }
        if (item.format === 'ISO' && ['PS2', 'ISO não identificada'].includes(item.platform)) {
          if (item.platform === 'ISO não identificada' && body.confirmPS2 !== true) throw new Error('Confirme que esta ISO é de PS2 antes de converter.');
          const selected = await conversion.useIso(item.path);
          selectedFile = '';
          return json(res, 200, { kind: 'iso', title: item.title, conversion: selected });
        }
        throw new Error('Esta plataforma pode ser catalogada, mas a conversão e o envio ainda não estão integrados.');
      }
      if (url.pathname === '/api/library/reveal') {
        const item = await library.item(body.id);
        await new Promise((resolve, reject) => execFile('/usr/bin/open', ['-R', item.path], error => error ? reject(error) : resolve()));
        return json(res, 200, { revealed: true });
      }
      return json(res, 404, { error: 'Comando não encontrado.' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/conversion')) {
    if (req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
    const mutating = req.method === 'POST';
    if (mutating) manualConversionRequests++;
    try {
      if (snes.running && mutating && !['/api/conversion/reveal','/api/conversion/folder'].includes(url.pathname)) throw new Error('Aguarde a tarefa SNES terminar.');
      if (queue.active && req.method === 'POST' && !['/api/conversion/reveal', '/api/conversion/folder'].includes(url.pathname)) throw new Error('Use os controles da fila para a tarefa atual.');
      if (req.method === 'GET' && url.pathname === '/api/conversion/cover') {
        if (!conversion.cover) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        const stream = fs.createReadStream(conversion.cover); stream.on('error', () => res.destroy()); return stream.pipe(res);
      }
      if (req.method === 'POST' && url.pathname === '/api/conversion/cover/select') return json(res, 200, await conversion.selectCover());
      if (req.method === 'POST' && url.pathname === '/api/conversion/cover/clear') return json(res, 200, conversion.clearCover());
      if (req.method === 'GET' && url.pathname === '/api/conversion') return json(res, 200, conversion.state());
      if (req.method === 'POST' && url.pathname === '/api/conversion/select') return json(res, 200, await conversion.select());
      if (req.method === 'POST' && url.pathname === '/api/conversion/start') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Use JSON.' });
        return json(res, 202, await conversion.start(await readBody(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/conversion/reveal') return json(res, 200, await conversion.reveal());
      if (req.method === 'POST' && url.pathname === '/api/conversion/folder') return json(res, 200, await conversion.reveal(true));
      if (req.method === 'POST' && url.pathname === '/api/conversion/cancel') return json(res, 200, conversion.cancel());
    } catch (e) { return json(res, 400, { error: e.message }); }
    finally { if (mutating) manualConversionRequests--; }
    return json(res, 404, { error: 'Comando não encontrado.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { selectedFile, localIPs: localIPv4s(), filePort: FILE_PORT });
  if (req.method === 'POST' && url.pathname === '/api/select') {
    execFile('/usr/bin/osascript', ['-e', 'POSIX path of (choose file with prompt "Selecione o arquivo PKG")'], (err, stdout) => {
      if (err) return json(res, 200, { cancelled: true });
      selectedFile = stdout.trim();
      if (path.extname(selectedFile).toLowerCase() !== '.pkg') { selectedFile = ''; return json(res, 400, { error: 'Selecione um arquivo com extensão .pkg.' }); }
      return json(res, 200, { selectedFile, name: path.basename(selectedFile) });
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/cancel') {
    try {
      if (queue.active?.kind === 'send') queue.cancel(queue.active.id);
      const activeTask = queue.active?.taskId;
      const outcomes = await Promise.allSettled(transfers.filter(t => t.taskId != null && t.taskId !== activeTask).map(t => cancelReceiverTask(t.ps4Ip, t.taskId)));
      cancelTransfers();
      let changed = false;
      for (const job of queue.jobs) if (job.token) { delete job.token; changed = true; }
      if (changed && !queue.readOnly) queue.save();
      return json(res, 200, { cancelled: true, receiverCancelled: outcomes.length > 0 && outcomes.every(o => o.status === 'fulfilled' && o.value === true) });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/install') {
    if (queue.active || manualInstalling || snes.running) return json(res, 409, { error: 'Aguarde a tarefa atual terminar.' });
    manualInstalling = true;
    try {
      if (queue.active) throw new Error('Pause a fila antes de usar o envio manual.');
      const result = await installFile(selectedFile, await readBody(req));
      return json(res, result.httpStatus < 400 ? 200 : 502, result);
    } catch (e) {
      console.log(`${new Date().toISOString()} falha ao pedir instalação: ${e.message}`);
      return json(res, 502, { error: `Não foi possível obter resposta do PS4: ${e.message}` });
    } finally { manualInstalling = false; }
  }
  res.writeHead(404); res.end('Not found');
});

const files = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  let requestedPath, suppliedToken;
  try { const requestUrl = new URL(req.url, 'http://localhost'); const parts = requestUrl.pathname.split('/'); suppliedToken = parts[1] || ''; requestedPath = '/' + decodeURIComponent(parts.slice(2).join('/')); } catch { res.writeHead(400); return res.end('Bad path'); }
  const transfer = findTransfer(suppliedToken);
  if (!transfer) { logDenied(peer, 'token inválido ou pacote já interrompido'); res.writeHead(403); return res.end('Package access is limited to the selected PS4 request'); }
  if (peer !== transfer.ps4Ip) { logDenied(peer, `IP diferente do PS4 informado (${transfer.ps4Ip})`); res.writeHead(403); return res.end('Package access is limited to the selected PS4 request'); }
  const manifestRequest=requestedPath==='/.assistant/manifest.json';
  if (!manifestRequest && requestedPath !== `/${path.basename(transfer.file)}`) { logDenied(peer, 'nome do arquivo não confere'); res.writeHead(404); return res.end('Package not found'); }
  let stat;
  try { stat = await fs.promises.stat(transfer.file); } catch { res.writeHead(404); return res.end('Package unavailable'); }
  if (transfer.original && !['size', 'mtimeMs', 'ctimeMs'].every(k => stat[k] === transfer.original[k])) { res.writeHead(409); return res.end('Package changed after selection'); }
  if(manifestRequest){
    try {
      if(!transfer.manifest){
        const base=`http://${transfer.macIp}:${FILE_PORT}/${transfer.token}`;
        transfer.manifest=(await packageMetadata(transfer.file,stat,base+'/'+encodeURIComponent(path.basename(transfer.file)),base+'/.assistant/manifest.json'))?.manifest;
      }
      if(!transfer.manifest){res.writeHead(404);return res.end('Manifest unavailable');}
      const data=Buffer.from(JSON.stringify(transfer.manifest));
      res.writeHead(200,{'Content-Type':'application/json','Content-Length':data.length,'Cache-Control':'no-store'});
      return res.end(req.method==='HEAD'?undefined:data);
    } catch {res.writeHead(500);return res.end('Manifest unavailable');}
  }
  logFileRequest(req, res, peer);
  const range = req.headers.range;
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' };
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : stat.size - 1;
    if (!m[1] && m[2]) { const suffix = Number(m[2]); start = Math.max(0, stat.size - suffix); end = stat.size - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
    if (req.method === 'HEAD') return res.end();
    return pipeFile(res, transfer, { start, end });
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  pipeFile(res, transfer, {});
});

ui.on('error', err => { console.error(`Não foi possível iniciar a interface na porta ${UI_PORT}: ${err.message}`); process.exit(1); });
files.on('error', err => { console.error(`Não foi possível iniciar o servidor de pacotes na porta ${FILE_PORT}: ${err.message}`); process.exit(1); });
ui.listen(UI_PORT, '127.0.0.1', () => console.log(`Interface: http://localhost:${UI_PORT}`));
files.listen(FILE_PORT, '0.0.0.0', () => console.log(`Servidor de pacotes na porta ${FILE_PORT}; acesso limitado ao PS4 informado. IPs do Mac: ${localIPv4s().join(', ') || 'não detectado'}`));

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { queue.shutdown(); queuedConversion.cancel(); conversion.cancel(); library.cancel(); snes.cancel(); Promise.allSettled([conversion.done, queuedConversion.done, library.done, queue.done, snes.done]).finally(() => process.exit(0)); });
