const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('./library');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-library-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const games = path.join(root, 'games'); fs.mkdirSync(games);
  const library = new Library({ dataDir:path.join(root,'private'), ...options });
  const file = (name, bytes='BOOT2 = cdrom0:\\SLPM_663.74;1') => {const full=path.join(games,name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes);return full};
  return { root, games, library, file };
}
test('imports selected roots recursively, ignores unrelated files and does not follow symlinks', async t => {
  const {root,games,library,file}=fixture(t);
  file('PS2/a.iso');file('readme.txt');file('.hidden/hidden.iso');
  const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.iso'),'iso');
  fs.symlinkSync(outside,path.join(games,'link'));
  await library.add([games],'folder');await library.done;
  assert.equal(library.state().error,'');assert.equal(library.state().items.length,1);assert.equal(library.state().items[0].platform,'PS2');
  assert.ok(fs.existsSync(path.join(games,'PS2/a.iso')));
  const restored=new Library({dataDir:library.dataDir});assert.equal(restored.state().items[0].id,library.state().items[0].id);
});
test('overlapping sources preserve one entry and full duplicates are only flagged', async t => {
  const {games,library,file}=fixture(t);const a=file('a.iso'),b=file('b.iso');
  await library.add([games],'folder');await library.done;
  await library.add([a],'file');await library.done;
  assert.equal(library.state().items.length,2);assert.equal(library.state().items.find(x=>x.path===a).sourceIds.length,2);
  assert.equal(library.state().items[0].duplicateCount,1);assert.ok(fs.existsSync(a)&&fs.existsSync(b));
});
test('sync preserves metadata and relinks a unique moved file by complete hash', async t => {
  const {games,library,file}=fixture(t);const a=file('a.iso');
  await library.add([games],'folder');await library.done;
  library.data.items[0].title='Custom title';library.data.items[0].profile={emulator:'Rogue v1'};
  const id=library.data.items[0].id;const moved=path.join(games,'renamed.iso');fs.renameSync(a,moved);
  library.sync();await library.done;
  assert.equal(library.state().items.length,1);assert.equal(library.state().items[0].id,id);assert.equal(library.state().items[0].title,'Custom title');
  assert.deepEqual(library.state().items[0].profile,{emulator:'Rogue v1'});
  assert.equal(library.state().items[0].previousPath,a);
});
test('missing files and disconnected sources stay in the catalogue and recover', async t => {
  const {root,games,library,file}=fixture(t);const a=file('a.iso');const bytes=fs.readFileSync(a);
  await library.add([games],'folder');await library.done;
  fs.unlinkSync(a);library.sync();await library.done;assert.equal(library.state().items[0].availability,'missing');
  fs.writeFileSync(a,bytes);library.sync();await library.done;assert.equal(library.state().items[0].availability,'available');
  const disconnected=path.join(root,'unplugged');fs.renameSync(games,disconnected);
  library.sync();await library.done;assert.equal(library.state().items.length,1);assert.equal(library.state().items[0].availability,'unavailable');
  fs.renameSync(disconnected,games);library.sync();await library.done;assert.equal(library.state().items[0].availability,'available');
});
test('does not relink ambiguous copies or infer PS2 from an ISO extension alone', async t => {
  const {games,library,file}=fixture(t);const a=file('a.iso','unidentified');file('b.iso','unidentified');
  await library.add([games],'folder');await library.done;fs.renameSync(a,path.join(games,'c.iso'));
  library.sync();await library.done;
  assert.equal(library.state().items.length,3);assert.equal(library.state().items.find(x=>x.path===a).availability,'missing');
  assert.ok(library.state().items.every(x=>x.platform==='ISO não identificada'));
});
test('source removal changes only the catalogue and invalid PKGs are identified', async t => {
  const {library,file}=fixture(t);const a=file('bad.pkg','invalid');
  await library.add([a],'file');await library.done;assert.equal(library.state().items[0].validPkg,false);
  await library.removeSource(library.state().sources[0].id);
  assert.equal(library.state().items.length,0);assert.ok(fs.existsSync(a));
});
test('read errors never overwrite a damaged catalogue', async t => {
  const {root,games}=fixture(t);const dir=path.join(root,'damaged');fs.mkdirSync(dir);const catalog=path.join(dir,'library.json');fs.writeFileSync(catalog,'bad-json');
  const library=new Library({dataDir:dir});assert.match(library.state().error,/preservado/);
  await assert.rejects(library.add([games],'folder'),/preservado/);assert.equal(fs.readFileSync(catalog,'utf8'),'bad-json');
});
test('cancellation and scan limits preserve previous catalogue instead of saving a partial result', async t => {
  const {games,library,file}=fixture(t);file('a.iso');await library.add([games],'folder');await library.done;
  const before=fs.readFileSync(library.file,'utf8');file('b.iso');
  library.limit=1;library.sync();await library.done;assert.match(library.state().error,/pasta menor/);assert.equal(fs.readFileSync(library.file,'utf8'),before);
  library.limit=50000;const original=library.hash.bind(library);
  library.hash=async(file,signal)=>{library.cancel();return original(file,signal)};
  library.sync();await library.done;assert.match(library.state().error,/cancelada/);assert.equal(fs.readFileSync(library.file,'utf8'),before);
});
test('cached entries skip hashing, and changed files cannot be used until synced', async t => {
  const {games,library,file}=fixture(t);const a=file('a.iso');await library.add([games],'folder');await library.done;
  const original=library.hash.bind(library);let count=0;library.hash=async(...args)=>{count++;return original(...args)};
  library.sync();await library.done;assert.equal(count,0);
  fs.appendFileSync(a,'changed');await assert.rejects(library.item(library.state().items[0].id),/mudou/);
  library.sync();await library.done;assert.equal(count,1);await library.item(library.state().items[0].id);
});
