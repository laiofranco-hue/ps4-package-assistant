const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const UI_PORT = Number(process.env.UI_PORT || 4173);
const FILE_PORT = Number(process.env.FILE_PORT || 8081);
let selectedFile = process.env.PKG_FILE || '';
const transfers = [];
const { Conversion } = require('./conversion');
const conversion = new Conversion({ onComplete: file => { selectedFile = file; } });

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
  transfers.splice(transfers.indexOf(transfer), 1);
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

const ui = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname.startsWith('/api/conversion')) {
    if (req.headers.origin && !['http://localhost:' + UI_PORT, 'http://127.0.0.1:' + UI_PORT].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/conversion') return json(res, 200, conversion.state());
      if (req.method === 'POST' && url.pathname === '/api/conversion/select') return json(res, 200, await conversion.select());
      if (req.method === 'POST' && url.pathname === '/api/conversion/start') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Use JSON.' });
        return json(res, 202, await conversion.start(await readBody(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/conversion/cancel') return json(res, 200, conversion.cancel());
    } catch (e) { return json(res, 400, { error: e.message }); }
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
    cancelTransfers();
    return json(res, 200, { cancelled: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/install') {
    try {
      const { ps4Ip, macIp } = await readBody(req);
      if (!selectedFile) return json(res, 400, { error: 'Selecione um arquivo PKG primeiro.' });
      const stat = await fs.promises.stat(selectedFile);
      if (!stat.isFile()) return json(res, 400, { error: 'O caminho selecionado não é um arquivo.' });
      const validIPv4 = value => /^\d{1,3}(\.\d{1,3}){3}$/.test(value || '') && value.split('.').every(octet => Number(octet) <= 255);
      if (!validIPv4(ps4Ip) || !validIPv4(macIp)) return json(res, 400, { error: 'Informe endereços IPv4 válidos para o PS4 e o Mac.' });
      const transfer = { token: newToken(), file: selectedFile, ps4Ip, streams: new Set() };
      transfers.push(transfer);
      const packageUrl = `http://${macIp}:${FILE_PORT}/${transfer.token}/${encodeURIComponent(path.basename(transfer.file))}`;
      const response = await fetch(`http://${ps4Ip}:12800/api/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', packages: [packageUrl] }), signal: AbortSignal.timeout(30000)
      });
      const text = await response.text();
      let result; try { result = JSON.parse(text); } catch { result = { raw: text }; }
      console.log(`${new Date().toISOString()} resposta do PS4 ${ps4Ip}: http=${response.status} status=${result.status ?? '-'} erro=${result.error_code ?? result.error ?? '-'}`);
      if (!response.ok || result.status === 'fail') removeTransfer(transfer, 'PS4 respondeu falha');
      return json(res, response.ok ? 200 : 502, { httpStatus: response.status, result, packageUrl, size: stat.size });
    } catch (e) {
      console.log(`${new Date().toISOString()} falha ao pedir instalação: ${e.message}`);
      return json(res, 502, { error: `Não foi possível obter resposta do PS4: ${e.message}` });
    }
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
  if (requestedPath !== `/${path.basename(transfer.file)}`) { logDenied(peer, 'nome do arquivo não confere'); res.writeHead(404); return res.end('Package not found'); }
  let stat;
  try { stat = await fs.promises.stat(transfer.file); } catch { res.writeHead(404); return res.end('Package unavailable'); }
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

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { conversion.cancel(); Promise.resolve(conversion.done).finally(() => process.exit(0)); });
