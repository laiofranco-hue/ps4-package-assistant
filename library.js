const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const formats = { '.iso':'ISO', '.pkg':'PKG', '.cue':'CUE', '.bin':'BIN', '.chd':'CHD', '.cso':'CSO', '.sfc':'SNES', '.smc':'SNES', '.nes':'NES', '.gb':'Game Boy', '.gbc':'Game Boy Color', '.gba':'Game Boy Advance', '.md':'Mega Drive', '.gen':'Mega Drive', '.smd':'Mega Drive' };
const within = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

class Library {
  constructor({ dataDir, picker, limit = 50000 } = {}) {
    this.dataDir = dataDir || path.join(os.homedir(), 'Library', 'Application Support', 'PS4 Package Assistant', 'library');
    this.file = path.join(this.dataDir, 'library.json');
    this.limit = limit;
    this.picker = picker || (async kind => {
      const command = kind === 'folder' ? 'choose folder with prompt "Escolha as pastas da biblioteca" with multiple selections allowed' : 'choose file with prompt "Escolha os jogos ou pacotes" with multiple selections allowed';
      const script = `set chosen to ${command}\nset resultText to ""\nrepeat with chosenItem in chosen\nset resultText to resultText & POSIX path of chosenItem & linefeed\nend repeat\nreturn resultText`;
      try { return (await run('/usr/bin/osascript', ['-e', script])).stdout.split('\n').filter(Boolean); }
      catch (e) { if (String(e.stderr || '').includes('(-128)')) return []; throw e; }
    });
    this.data = { version: 1, sources: [], items: [], lastSync: null };
    this.syncing = false;
    this.progress = { files: 0, hashed: 0, current: '' };
    this.error = '';
    this.warnings = [];
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.sources) || !Array.isArray(saved.items) || !saved.sources.every(s => s && typeof s.id === 'string' && typeof s.path === 'string' && path.isAbsolute(s.path) && ['file', 'folder'].includes(s.kind)) || !saved.items.every(i => i && typeof i.id === 'string' && typeof i.path === 'string' && path.isAbsolute(i.path) && typeof i.title === 'string' && typeof i.platform === 'string' && Array.isArray(i.sourceIds) && i.sourceIds.every(id => typeof id === 'string'))) throw new Error('Versão ou estrutura desconhecida.');
      this.data = saved;
    } catch (e) { if (e.code !== 'ENOENT') this.loadError = this.error = 'Não foi possível ler o catálogo. O arquivo existente foi preservado: ' + e.message; }
  }
  assertEditable() {
    if (this.loadError) throw new Error(this.loadError);
    if (this.syncing) throw new Error('Aguarde ou cancele a sincronização atual.');
  }
  async save(data) {
    await fs.promises.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = this.file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); await fs.promises.rename(tmp, this.file); }
    finally { await fs.promises.rm(tmp, { force: true }).catch(() => {}); }
    this.data = data;
  }
  state() {
    const groups = new Map();
    for (const item of this.data.items) if (item.availability === 'available' && item.sha256) {
      const group = groups.get(item.sha256) || []; group.push(item.id); groups.set(item.sha256, group);
    }
    return { ...this.data, items: this.data.items.map(item => ({ ...item, duplicateCount: item.availability === 'available' ? (groups.get(item.sha256)?.length || 1) - 1 : 0 })), readOnly: Boolean(this.loadError), syncing: this.syncing, progress: { ...this.progress }, error: this.error, warnings: [...this.warnings] };
  }
  async choose(kind) {
    this.assertEditable();
    const paths = await this.picker(kind);
    if (!paths.length) return { cancelled: true };
    return this.add(paths, kind);
  }
  async add(paths, kind) {
    this.assertEditable();
    if (!['file','folder'].includes(kind) || !Array.isArray(paths) || !paths.length) throw new Error('Escolha arquivos ou pastas para importar.');
    const sources = this.data.sources.map(source => ({ ...source }));
    for (const input of paths) {
      const absolute = path.resolve(input);
      const stat = await fs.promises.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('Selecione o arquivo ou pasta original, em vez de um link simbólico.');
      if (kind === 'folder' ? !stat.isDirectory() : !stat.isFile()) throw new Error('O tipo da origem selecionada não confere.');
      if (kind === 'file' && !formats[path.extname(absolute).toLowerCase()]) throw new Error('Formato não reconhecido: ' + path.basename(absolute));
      if (!sources.some(source => source.path === absolute && source.kind === kind)) sources.push({ id: crypto.randomUUID(), path: absolute, kind, status: 'pending' });
    }
    this.assertEditable();
    // Reserve the mutation while writing, so concurrent imports cannot lose sources.
    this.syncing = true;
    try { await this.save({ ...this.data, sources }); } finally { this.syncing = false; }
    return this.sync();
  }
  async removeSource(id) {
    this.assertEditable();
    if (!this.data.sources.some(source => source.id === id)) throw new Error('Origem não encontrada.');
    const sources = this.data.sources.filter(source => source.id !== id);
    const items = this.data.items.map(item => ({ ...item, sourceIds: item.sourceIds.filter(value => value !== id) })).filter(item => item.sourceIds.length);
    this.syncing = true;
    try { await this.save({ ...this.data, sources, items }); } finally { this.syncing = false; }
    return this.state();
  }
  sync() {
    this.assertEditable();
    this.syncing = true; this.error = ''; this.warnings = [];
    this.progress = { files: 0, hashed: 0, current: '' };
    this.controller = new AbortController();
    this.done = this.scan().catch(e => { this.error = this.controller.signal.aborted ? 'Sincronização cancelada. O catálogo anterior foi preservado.' : e.message; }).finally(() => { this.syncing = false; this.progress.current = ''; });
    return this.state();
  }
  cancel() { if (this.controller && this.syncing) this.controller.abort(); return this.state(); }
  async scan() {
    const signal = this.controller.signal;
    const sources = this.data.sources.map(source => ({ ...source }));
    const found = new Map();
    const inaccessible = [];
    const warn = (file, e) => { inaccessible.push(file); if (this.warnings.length < 20) this.warnings.push('Não foi possível ler ' + file + ': ' + e.message); };
    let visited = 0;
    const visit = async (file, source, isRoot = false) => {
      signal.throwIfAborted();
      if (++visited > this.limit) throw new Error('A origem tem muitos arquivos. Escolha uma pasta menor para sincronizar. O catálogo anterior foi preservado.');
      let stat;
      try { stat = await fs.promises.lstat(file); } catch (e) { warn(file, e); return; }
      if (stat.isSymbolicLink()) return; // Do not escape roots or enter cycles.
      if (stat.isDirectory()) {
        if (!isRoot && (path.basename(file).startsWith('.') || ['node_modules', 'Library'].includes(path.basename(file)))) return;
        let names;
        try { names = await fs.promises.readdir(file); } catch (e) { warn(file, e); return; }
        for (const name of names) await visit(path.join(file, name), source);
      } else if (stat.isFile() && formats[path.extname(file).toLowerCase()]) {
        const existing = found.get(file);
        if (existing) existing.sourceIds.push(source.id);
        else found.set(file, { path: file, stat, sourceIds: [source.id] });
        this.progress.files = found.size;
      }
    };
    for (const source of sources) {
      signal.throwIfAborted();
      try {
        const stat = await fs.promises.lstat(source.path);
        if (stat.isSymbolicLink() || (source.kind === 'folder' ? !stat.isDirectory() : !stat.isFile())) throw new Error('A origem mudou de tipo.');
        await fs.promises.access(source.path, fs.constants.R_OK);
        source.status = 'available'; source.error = '';
        await visit(source.path, source, true);
      } catch (e) {
        signal.throwIfAborted();
        // Limit errors must abort the complete scan, not mark a source as offline.
        if (visited > this.limit) throw e;
        source.status = 'unavailable'; source.error = e.message;
      }
    }
    const byPath = new Map(this.data.items.map(item => [item.path, item]));
    const items = [];
    const newItems = [];
    for (const entry of found.values()) {
      signal.throwIfAborted();
      this.progress.current = entry.path;
      const prior = byPath.get(entry.path);
      const unchanged = prior && prior.size === entry.stat.size && prior.mtimeMs === entry.stat.mtimeMs && prior.ctimeMs === entry.stat.ctimeMs;
      let sha256;
      try {
        sha256 = unchanged && prior.sha256 ? prior.sha256 : await this.hash(entry.path, signal);
        const check = await fs.promises.stat(entry.path);
        if (check.size !== entry.stat.size || check.mtimeMs !== entry.stat.mtimeMs) throw new Error('Arquivo mudou durante a leitura; sincronize novamente.');
      } catch (e) { signal.throwIfAborted(); warn(entry.path, e); continue; }
      let formatInfo;
      try { formatInfo = unchanged ? { platform: prior.platform, validPkg: prior.validPkg } : await this.identify(entry.path); }
      catch (e) { signal.throwIfAborted(); warn(entry.path, e); continue; }
      const item = { ...prior, id: prior?.id || crypto.randomUUID(), path: entry.path, title: prior?.title || path.basename(entry.path, path.extname(entry.path)), format: path.extname(entry.path).slice(1).toUpperCase(), platform: formatInfo.platform, validPkg: formatInfo.validPkg, size: entry.stat.size, mtimeMs: entry.stat.mtimeMs, ctimeMs: entry.stat.ctimeMs, sha256, sourceIds: [...new Set(entry.sourceIds)], availability: 'available' };
      items.push(item); if (!prior) newItems.push(item);
      this.progress.hashed++;
    }
    const activeIds = new Set(items.map(item => item.id));
    const sourceMap = new Map(sources.map(source => [source.id, source]));
    const absent = this.data.items.filter(item => !activeIds.has(item.id)).map(item => ({ ...item, availability: item.sourceIds.some(id => sourceMap.get(id)?.status === 'available') && !inaccessible.some(prefix => within(prefix, item.path)) ? 'missing' : 'unavailable' }));
    // Relocate only a unique missing item with a full-file SHA-256 match. Offline
    // roots and ambiguous duplicate sets never trigger automatic reassignment.
    const relocated = new Set();
    for (const item of newItems) {
      const matches = absent.filter(old => old.availability === 'missing' && old.sha256 === item.sha256 && !relocated.has(old.id));
      const currentMatches = items.filter(current => current.sha256 === item.sha256);
      if (matches.length === 1 && currentMatches.length === 1) {
        const old = matches[0]; relocated.add(old.id);
        Object.assign(item, { ...old, ...item, id: old.id, title: old.title, previousPath: old.path });
      }
    }
    signal.throwIfAborted();
    await this.save({ version: 1, sources, items: items.concat(absent.filter(item => !relocated.has(item.id))), lastSync: new Date().toISOString() });
  }
  async hash(file, signal) {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024, signal });
    for await (const chunk of stream) { signal.throwIfAborted(); digest.update(chunk); }
    return digest.digest('hex');
  }
  async identify(file) {
    const extension = path.extname(file).toLowerCase();
    if (!['.iso','.pkg'].includes(extension)) return { platform: ['CUE','BIN','CHD','CSO'].includes(formats[extension]) ? 'Disco não identificado' : formats[extension] };
    const handle = await fs.promises.open(file, 'r');
    try {
      const bytes = Buffer.alloc(extension === '.pkg' ? 4 : 4 * 1024 * 1024);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (extension === '.pkg') return { platform: 'Pacote PS4', validPkg: bytes.subarray(0, bytesRead).toString('hex') === '7f434e54' };
      const text = bytes.subarray(0, bytesRead).toString('latin1');
      return { platform: /BOOT2\s*=\s*cdrom/i.test(text) ? 'PS2' : text.includes('PSP_GAME') ? 'PSP' : /BOOT\s*=\s*cdrom/i.test(text) ? 'PS1' : 'ISO não identificada' };
    } finally { await handle.close(); }
  }
  async item(id) {
    const item = this.data.items.find(item => item.id === id);
    if (!item) throw new Error('Jogo não encontrado na biblioteca.');
    let stat;
    try { stat = await fs.promises.stat(item.path); } catch { throw new Error('Arquivo indisponível. Conecte o HD ou sincronize a biblioteca.'); }
    if (!stat.isFile() || stat.size !== item.size || stat.mtimeMs !== item.mtimeMs || stat.ctimeMs !== item.ctimeMs) throw new Error('O arquivo mudou. Sincronize a biblioteca antes de usá-lo.');
    return item;
  }
}
module.exports = { Library };
