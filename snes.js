const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

class SnesLibrary {
  constructor({ dataDir, picker, python, busy = () => false } = {}) {
    this.dataDir = dataDir || process.env.SNES_DATA_DIR || path.join(os.homedir(), '.codex', '.chatgpt-projects', 'ps4-package-assistant-local', 'snes-app');
    this.python = python || process.env.SNES_PYTHON || '/usr/bin/python3';
    this.busy = busy;
    this.picker = picker || (async kind => (await run('/usr/bin/osascript', ['-e', kind === 'iso' ? 'POSIX path of (choose file with prompt "Escolha a ISO que contém a pasta ROMS de SNES")' : 'POSIX path of (choose folder with prompt "Escolha a biblioteca SNES preparada (pasta com manifest.json)")'])).stdout.trim());
    this.folder = ''; this.iso = ''; this.items = []; this.log = []; this.status = 'idle'; this.error = ''; this.running = false; this.kind = '';
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'selection.json')));
      if (saved.folder) this.load(saved.folder);
      this.iso = saved.iso || '';
    } catch (e) { if (e.code !== 'ENOENT') this.error = 'A biblioteca salva está indisponível. Reconecte o disco e abra a pasta novamente.'; }
    try {
      const old = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'job.json')));
      if (old.running) { this.status = 'attention'; this.error = 'A tarefa anterior foi interrompida. Confira o pSNES antes de sincronizar novamente; backups ficam na pasta de trabalho.'; }
    } catch {}
  }
  assertIdle() { if (this.running || this.busy()) throw new Error('Aguarde a tarefa em andamento terminar.'); }
  load(folder) {
    const real = fs.realpathSync(folder);
    const text = fs.readFileSync(path.join(real, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(text);
    if (manifest.version !== 1 || !Array.isArray(manifest.items) || !manifest.items.length || manifest.items.length > 10000) throw new Error('Biblioteca inválida: escolha a pasta que contém manifest.json e roms.');
    const names = new Set(), stems = new Set();
    const checked = (relative) => {
      if (typeof relative !== 'string' || /[\r\n\\]/.test(relative)) throw new Error('Caminho inválido na biblioteca.');
      const file = path.resolve(real, 'roms', relative);
      const resolved = fs.realpathSync(file);
      if (!resolved.startsWith(path.join(real, 'roms') + path.sep) || !fs.statSync(resolved).isFile()) throw new Error('Arquivo fora da biblioteca.');
      return resolved;
    };
    const items = manifest.items.map((item, id) => {
      if (typeof item.name !== 'string' || path.basename(item.name) !== item.name || !/\.(sfc|smc|swc|fig|zip)$/.test(item.name) || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('ROM ou hash inválido no manifesto.');
      const name = item.name.toLowerCase(), stem = path.parse(name).name;
      if (names.has(name) || stems.has(stem)) throw new Error('Nomes de jogos compartilham saves. Prepare a biblioteca novamente.');
      names.add(name); stems.add(stem);
      const file = checked(item.name);
      const coverFile = item.cover ? checked(item.cover) : '';
      if (coverFile && (!/^media\/mixrbv2\/[^/]+\.png$/.test(item.cover) || !/^[a-f0-9]{64}$/.test(item.cover_sha256 || ''))) throw new Error('Capa inválida no manifesto.');
      return { id: String(id), name:item.name, title:String(item.title || item.name), size:fs.statSync(file).size, art:item.art_match || 'neutral', file, coverFile };
    });
    this.folder = real; this.items = items;
    this.revision = crypto.createHash('sha256').update(text).digest('hex');
  }
  persist() {
    fs.mkdirSync(this.dataDir, {recursive:true,mode:0o700});
    const file = path.join(this.dataDir, 'selection.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify({folder:this.folder,iso:this.iso}),{mode:0o600}); fs.renameSync(file+'.tmp',file);
  }
  state() {
    return { folder:this.folder, iso:this.iso, status:this.status, kind:this.kind, revision:this.revision, running:this.running, error:this.error, log:this.log,
      items:this.items.map(({file,coverFile,...item})=>({...item,cover: Boolean(coverFile)})) };
  }
  async choose(kind) {
    this.assertIdle(); this.running = true;
    try {
      let selected;
      try { selected = await this.picker(kind); } catch(e) { if (/-128|cancel/i.test(e.message)) return {...this.state(),cancelled:true}; throw e; }
      if (!selected) return {...this.state(),cancelled:true};
      if (kind === 'folder') this.load(selected);
      else { if (path.extname(selected).toLowerCase() !== '.iso' || !fs.statSync(selected).isFile()) throw new Error('Escolha uma ISO de SNES Station.'); this.iso = fs.realpathSync(selected); }
      this.error = ''; this.persist();
    } finally { this.running = false; }
    return this.state();
  }
  start(kind, {ps4Ip, closed} = {}) {
    this.assertIdle();
    if (kind === 'prepare' && !this.iso) throw new Error('Selecione uma ISO com a pasta ROMS.');
    if (kind === 'sync') {
      if (!this.folder) throw new Error('Abra ou prepare uma biblioteca primeiro.');
      if (closed !== true) throw new Error('Feche o pSNES e confirme antes de sincronizar.');
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ps4Ip || '') || ps4Ip.split('.').some(n=>Number(n)>255)) throw new Error('Informe um IPv4 válido do PS4.');
    }
    fs.mkdirSync(this.dataDir,{recursive:true,mode:0o700});
    const id = crypto.randomUUID();
    const cancel = path.join(this.dataDir,'cancel-'+id); this.cancelFile=cancel;
    const spec = {id, kind, iso:this.iso, folder:this.folder, work:this.dataDir, ps4Ip};
    const specFile = path.join(this.dataDir,'request-'+id+'.json'); fs.writeFileSync(specFile,JSON.stringify(spec),{mode:0o600});
    this.running = true; this.kind = kind; this.status = kind === 'sync' ? 'syncing' : 'preparing'; this.error=''; this.log=[];
    fs.writeFileSync(path.join(this.dataDir,'job.json'),JSON.stringify({running:true,kind}),{mode:0o600});
    this.child = spawn(this.python,['-u',path.join(__dirname,'scripts','snes_app.py'),specFile],{stdio:['ignore','pipe','pipe']});
    this.done = new Promise(resolve=>{
      let completed = false;
      const finish = (error) => {
        if (completed) return; completed = true;
        this.running = false; this.child = null;
        if (!error && kind === 'prepare') {
          try { this.load(JSON.parse(fs.readFileSync(path.join(this.dataDir,'result.json'))).folder); this.persist(); } catch(e) { error=e; }
        }
        this.error = error ? error.message : ''; this.status = error ? (fs.existsSync(cancel) ? 'cancelled' : 'error') : 'success';
        fs.writeFileSync(path.join(this.dataDir,'job.json'),JSON.stringify({running:false,kind,status:this.status,error:this.error}),{mode:0o600});
        resolve();
      };
      let buffer='';
      this.child.stdout.on('data',chunk=>{buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(line.trim())this.log.push(line.slice(0,1000));}this.log=this.log.slice(-80);});
      let stderr=''; this.child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
      this.child.once('error',finish);
      this.child.once('exit',code=>finish(code === 0 ? null : new Error(stderr.trim().split('\n').pop() || 'Tarefa interrompida. Consulte o registro e tente novamente.')));
    });
    return this.state();
  }
  cancel() { if(this.running && this.child) { fs.writeFileSync(this.cancelFile,'cancel'); this.status='cancelling'; } return this.state(); }
  cover(id) {
    const item=this.items.find(i=>i.id===id);
    if(!item?.coverFile) throw new Error('Capa indisponível.');
    const file=fs.realpathSync(item.coverFile);
    if(!file.startsWith(path.join(this.folder,'roms')+path.sep))throw new Error('Capa fora da biblioteca.');
    return file;
  }
  async reveal() { if(!this.folder)throw new Error('Abra uma biblioteca primeiro.'); await run('/usr/bin/open',[this.folder]); return this.state(); }
}
module.exports = { SnesLibrary };
