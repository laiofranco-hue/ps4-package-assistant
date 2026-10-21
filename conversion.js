const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const VERSION = 'v1.2.0';
const DIGEST = '2c82143df56710ef8c09d046e3965a2d52f8bb2a83cb2e4729e5b962d7e2847f';

class Conversion {
  constructor({ onComplete = () => {}, executable, outputRoot, pickFile } = {}) {
    this.onComplete = onComplete;
    this.executable = executable;
    this.outputRoot = outputRoot || path.join(os.homedir(), '.codex', '.chatgpt-projects', 'ps4-package-assistant-local', 'outputs', 'PS2-PKG');
    this.pickFile = pickFile || (async () => (await run('/usr/bin/osascript', ['-e', 'POSIX path of (choose file with prompt "Selecione a ISO de PS2")'])).stdout.trim());
    this.iso = process.env.ISO_FILE || '';
    this.job = { status: 'idle', log: [], error: '', output: '' };
    this.running = false;
  }
  state() { return { ...this.job, iso: this.iso, log: [...this.job.log], outputRoot: this.outputRoot }; }
  async select() {
    if (this.running) throw new Error('Aguarde ou cancele a conversão atual.');
    let file;
    try { file = await this.pickFile(); } catch (e) {
      if (String(e.stderr || '').includes('(-128)')) return { cancelled: true };
      throw new Error('Não foi possível abrir o seletor de ISO. ' + e.message);
    }
    if (this.running) throw new Error('Já existe uma conversão em andamento.');
    if (path.extname(file).toLowerCase() !== '.iso' || !(await fs.promises.stat(file)).isFile()) throw new Error('Selecione um arquivo .iso de PS2.');
    this.iso = file;
    return this.state();
  }
  append(text) {
    const lines = String(text).replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]+/).filter(Boolean);
    this.job.log = this.job.log.concat(lines).slice(-120);
  }
  async tool(signal) {
    if (this.executable) return this.executable;
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('A conversão integrada requer Mac com Apple Silicon. O envio de PKG continua disponível.');
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'PS4 Package Assistant', 'converter');
    const binary = path.join(dir, 'ps2fpkg-osx-arm64');
    await fs.promises.mkdir(dir, { recursive: true });
    const marker = path.join(dir, 'verified.json');
    try {
      const expected = JSON.parse(await fs.promises.readFile(marker, 'utf8'));
      const actual = crypto.createHash('sha256').update(await fs.promises.readFile(binary)).digest('hex');
      if (expected.releaseDigest === DIGEST && expected.signedDigest === actual) return binary;
    } catch {}
    this.append('Preparando o conversor de PS2 (download único)…');
    const response = await fetch(`https://github.com/spiral009/easy-ps2-fpkg/releases/download/${VERSION}/ps2fpkg-osx-arm64`, { signal });
    if (!response.ok) throw new Error(`Falha no download do conversor (HTTP ${response.status}). Tente novamente com internet.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    signal.throwIfAborted();
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== DIGEST) throw new Error('O SHA-256 do conversor não confere. O arquivo não será executado.');
    const temp = binary + '.download';
    await fs.promises.writeFile(temp, bytes, { mode: 0o700 });
    await run('/usr/bin/codesign', ['--force', '--sign', '-', temp]);
    const signedDigest = crypto.createHash('sha256').update(await fs.promises.readFile(temp)).digest('hex');
    await fs.promises.rename(temp, binary);
    await fs.promises.writeFile(marker, JSON.stringify({ releaseDigest: DIGEST, signedDigest, version: VERSION }));
    return binary;
  }
  async start(options = {}) {
    if (this.running) throw new Error('Já existe uma conversão em andamento.');
    if (!this.iso || path.extname(this.iso).toLowerCase() !== '.iso') throw new Error('Selecione a ISO de PS2 primeiro.');
    if (!(await fs.promises.stat(this.iso)).isFile()) throw new Error('A ISO selecionada não está disponível.');
    // Recheck after stat: two requests may have been waiting on the same I/O.
    if (this.running) throw new Error('Já existe uma conversão em andamento.');
    const emulator = options.emulator || 'Jak v2';
    const resolution = options.resolution || '2x2';
    if (!['Jak v2', 'Rogue v1'].includes(emulator) || !['1x1', '2x2'].includes(resolution)) throw new Error('Opção de emulador ou resolução inválida.');
    if (options.title != null && (typeof options.title !== 'string' || options.title.length > 100 || /[\x00-\x1f]/.test(options.title))) throw new Error('Use um título com até 100 caracteres.');
    this.running = true;
    this.controller = new AbortController();
    this.job = { status: 'running', log: [], error: '', output: '', emulator, resolution };
    this.done = this.execute({ emulator, resolution, title: options.title || '' });
    return this.state();
  }
  async execute(options) {
    let output;
    try {
      const tool = await this.tool(this.controller.signal);
      this.controller.signal.throwIfAborted();
      await fs.promises.mkdir(this.outputRoot, { recursive: true });
      output = await fs.promises.mkdtemp(path.join(this.outputRoot, 'conversao-'));
      const args = [this.iso, '--out', output, '--emu', options.emulator, '--uprender', options.resolution];
      if (options.title.trim()) args.push('--title', options.title.trim());
      this.append('Convertendo a ISO. Mantenha o app aberto até concluir.');
      await new Promise((resolve, reject) => {
        this.child = spawn(tool, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.child.stdout.on('data', c => this.append(c));
        this.child.stderr.on('data', c => this.append(c));
        this.child.once('error', reject);
        this.child.once('close', code => code === 0 ? resolve() : reject(new Error(`Conversor terminou com código ${code}. Consulte o registro abaixo.`)));
      });
      this.child = null;
      this.controller.signal.throwIfAborted();
      const names = (await fs.promises.readdir(output)).filter(n => n.endsWith('.pkg'));
      if (names.length !== 1) throw new Error('O conversor não gerou um pacote único.');
      const pkg = path.join(output, names[0]);
      const handle = await fs.promises.open(pkg, 'r');
      try {
        const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, 0);
        if (magic.toString('hex') !== '7f434e54') throw new Error('O arquivo gerado não tem cabeçalho PKG válido.');
      } finally { await handle.close(); }
      this.controller.signal.throwIfAborted();
      this.job.output = pkg;
      this.job.status = 'success';
      this.onComplete(pkg);
    } catch (e) {
      const cancelled = this.controller.signal.aborted;
      this.job.status = cancelled ? 'cancelled' : 'error';
      this.job.error = cancelled ? '' : e.message;
      this.append(cancelled ? 'Conversão cancelada. A ISO original foi preservada.' : e.message);
      // Only remove this job's generated directory, never source files or earlier jobs.
      if (output) await fs.promises.rm(output, { recursive: true, force: true }).catch(() => {});
    } finally {
      clearTimeout(this.killTimer);
      this.child = null;
      this.running = false;
    }
  }
  cancel() {
    if (!this.running) return this.state();
    this.controller.abort();
    this.job.status = 'cancelling';
    if (this.child?.pid) {
      const pid = this.child.pid;
      try { process.kill(-pid, 'SIGTERM'); } catch {}
      this.killTimer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 3000);
    }
    return this.state();
  }
}
module.exports = { Conversion };
