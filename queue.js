const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const statuses = ['pending', 'running', 'success', 'error', 'cancelled', 'interrupted', 'attention', 'retried'];
const validIPv4 = value => typeof value === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && value.split('.').every(n => Number(n) <= 255);
async function fingerprint(file, kind) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== (kind === 'convert' ? '.iso' : '.pkg')) throw new Error('Selecione uma ISO de PS2 ou um PKG válido.');
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error('Arquivo indisponível.');
  if (kind === 'send') {
    const handle = await fs.promises.open(file, 'r');
    try { const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, 0); if (magic.toString('hex') !== '7f434e54') throw new Error('Cabeçalho PKG inválido.'); } finally { await handle.close(); }
  }
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
class TaskQueue {
  constructor({ dataDir, runConversion, cancelConversion, install, progress, busy = () => false, pollMs = 2500 } = {}) {
    this.dir = dataDir || path.join(os.homedir(), 'Library', 'Application Support', 'PS4 Package Assistant', 'queue');
    this.file = path.join(this.dir, 'queue.json');
    Object.assign(this, { runConversion, cancelConversion, install, progress, busy, pollMs });
    this.jobs = []; this.enabled = false; this.active = null; this.error = ''; this.readOnly = false;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.some(j => !j || typeof j.id !== 'string' || !['send', 'convert'].includes(j.kind) || typeof j.file !== 'string' || !path.isAbsolute(j.file) || !statuses.includes(j.status) || !j.options || !j.original || !['size', 'mtimeMs', 'ctimeMs'].every(k => Number.isFinite(j.original[k])) || !Array.isArray(j.log)) || new Set(data.jobs.map(j => j.id)).size !== data.jobs.length) throw new Error('Formato inválido');
      this.jobs = data.jobs;
      for (const j of this.jobs) if (j.status === 'running') {
        j.status = j.kind === 'send' ? 'attention' : 'interrupted';
        j.error = 'App encerrado durante a tarefa. Confira o resultado antes de repetir.'; j.finishedAt = now();
      }
      this.save();
    } catch (e) { if (e.code !== 'ENOENT') { this.readOnly = true; this.error = 'Não foi possível ler o histórico. O arquivo original foi preservado: ' + e.message; } }
  }
  writable() { if (this.readOnly) throw new Error(this.error); }
  save() {
    this.writable();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: this.jobs }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  state() { return { enabled: this.enabled, active: this.active?.id || null, error: this.error, readOnly: this.readOnly, jobs: this.jobs.map(({ token, ...job }) => structuredClone(job)) }; }
  async add(spec) {
    this.writable();
    const { kind, file } = spec;
    if (!['convert', 'send'].includes(kind)) throw new Error('Tipo de tarefa inválido.');
    const options = kind === 'convert' ? { title: spec.options?.title || '', emulator: spec.options?.emulator || 'Jak v2', resolution: spec.options?.resolution || '2x2', cover: spec.options?.cover || '' } : { ps4Ip: spec.options?.ps4Ip, macIp: spec.options?.macIp };
    if (kind === 'send' && (!validIPv4(options.ps4Ip) || !validIPv4(options.macIp))) throw new Error('Confira os IPv4 do PS4 e do Mac.');
    if (kind === 'convert' && (!['Jak v2', 'Rogue v1'].includes(options.emulator) || !['1x1', '2x2'].includes(options.resolution) || typeof options.title !== 'string' || options.title.length > 100 || /[\x00-\x1f]/.test(options.title))) throw new Error('Opções de conversão inválidas.');
    const original = await fingerprint(file, kind);
    if (this.jobs.filter(j => j.status === 'pending').length >= 100) throw new Error('Limite de 100 tarefas pendentes.');
    if (this.jobs.some(j => ['pending', 'running', 'attention'].includes(j.status) && j.kind === kind && j.file === file)) throw new Error('Este arquivo já tem uma tarefa pendente ou que precisa de conferência.');
    const job = { id: crypto.randomUUID(), kind, file, title: options.title || path.basename(file), options, original, ...(spec.retryOf ? { retryOf: spec.retryOf } : {}), status: 'pending', createdAt: now(), log: [], error: '' };
    this.jobs.push(job); this.save();
    // Adding never starts work. Start is an explicit action, even when the worker is idle.
    return this.state();
  }
  start() {
    this.writable();
    if (this.active) throw new Error('Uma tarefa já está em andamento.');
    if (this.busy()) throw new Error('Aguarde a conversão ou o envio manual terminar.');
    if (this.jobs.some(j => j.status === 'attention')) throw new Error('Confira o envio pendente antes de iniciar outras tarefas.');
    this.error = ''; this.enabled = true; this.done = this.work(); return this.state();
  }
  pause() { this.enabled = false; return this.state(); }
  async work() {
    try {
      while (this.enabled) {
        const job = this.jobs.find(j => j.status === 'pending');
        if (!job) break;
        this.active = job; this.controller = new AbortController();
        job.status = 'running'; job.startedAt = now(); this.save();
        try {
          const current = await fingerprint(job.file, job.kind);
          this.controller.signal.throwIfAborted();
          if (JSON.stringify(current) !== JSON.stringify(job.original)) throw new Error('Arquivo alterado desde a inclusão. Adicione-o novamente.');
          if (job.kind === 'convert') {
            job.output = await this.runConversion(job, state => { job.log = state.log || []; job.phase = state.status; }, this.controller.signal);
          } else {
            // Persist before the request: a lost response must never cause an automatic resend.
            job.requestedAt = now(); this.save();
            let accepted;
            try { accepted = await this.install(job.file, job.options, token => { job.token = token; this.save(); }); }
            catch (e) { e.uncertain = true; throw e; }
            if (accepted.result?.status === 'fail' || accepted.httpStatus >= 400) throw new Error(accepted.result?.error || 'O PS4 recusou a solicitação.');
            if (Number.isInteger(accepted.result?.task_id) && accepted.result.task_id >= 0) { job.taskId = accepted.result.task_id; this.save(); }
            if (accepted.result?.status !== 'success' || job.taskId == null) { const e = new Error(accepted.result?.error || 'Resposta sem identificação de tarefa. Confira Downloads no PS4.'); e.uncertain = true; throw e; }
            await this.monitor(job);
          }
          job.status = 'success'; job.error = '';
        } catch (e) {
          job.status = job.kind === 'send' && (job.taskId != null || e.uncertain) ? 'attention' : (this.controller.signal.aborted ? 'cancelled' : 'error');
          job.error = e.message; this.enabled = false;
        } finally { job.finishedAt = now(); this.save(); this.active = null; }
      }
    } catch (e) { this.error = 'Fila pausada: ' + e.message; }
    finally { this.enabled = false; this.active = null; }
  }
  async monitor(job) {
    while (true) {
      this.controller.signal.throwIfAborted();
      const data = await this.progress(job.options.ps4Ip, job.taskId, this.controller.signal);
      this.controller.signal.throwIfAborted();
      if (data.status !== 'success') throw new Error('Não foi possível consultar a tarefa. Abra o Remote Package Installer e confira o download.');
      const num = v => Number(v);
      if (data.error == null || !Number.isFinite(num(data.error))) throw new Error('O PS4 não informou o estado de erro da tarefa. Confira Downloads.');
      job.progress = { total: num(data.length_total), transferred: num(data.transferred_total), error: data.error, seconds: num(data.rest_sec) };
      this.save();
      if (num(data.error) !== 0) throw new Error('O PS4 informou erro na tarefa: ' + data.error + '. Confira Downloads antes de repetir.');
      // Only confirms transfer; launching/installation compatibility is checked on the console.
      if (Number.isFinite(job.progress.total) && job.progress.total > 0 && job.progress.transferred >= job.progress.total) return;
      await new Promise(resolve => { const done = () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, this.pollMs); this.controller.signal.addEventListener('abort', done, { once: true }); });
    }
  }
  cancel(id) {
    this.writable(); const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('Tarefa não encontrada.');
    if (job === this.active) { this.enabled = false; this.controller.abort(new Error('Acompanhamento interrompido. Confira o PS4 antes de repetir.')); if (job.kind === 'convert') this.cancelConversion(); }
    else if (job.status === 'pending') { job.status = 'cancelled'; job.finishedAt = now(); this.save(); }
    return this.state();
  }
  async retry(id, confirm) {
    this.writable(); const job = this.jobs.find(j => j.id === id);
    if (!job || !['error', 'cancelled', 'interrupted', 'attention'].includes(job.status)) throw new Error('Esta tarefa não pode ser repetida.');
    if (job.status === 'attention' && confirm !== true) throw new Error('Confira Downloads no PS4 e confirme antes de criar outro envio.');
    const old = job.status; job.status = 'retried';
    try { return await this.add({ ...job, retryOf: job.id }); }
    catch (e) { job.status = old; throw e; }
  }
  async recheck(id) {
    this.writable(); const job = this.jobs.find(j => j.id === id);
    if (this.busy() || this.active || !job || job.status !== 'attention' || job.taskId == null) throw new Error('Não há envio disponível para consultar.');
    this.active = job; this.controller = new AbortController(); job.status = 'running'; this.save();
    this.done = this.monitor(job).then(() => { job.status = 'success'; job.error = ''; }).catch(e => { job.status = 'attention'; job.error = e.message; }).finally(() => { job.finishedAt = now(); this.active = null; this.save(); });
    return this.state();
  }
  shutdown() { this.enabled = false; if (this.active) this.cancel(this.active.id); return this.done; }
}
module.exports = { TaskQueue, fingerprint };
