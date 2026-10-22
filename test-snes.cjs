const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {SnesLibrary}=require('./snes');

function fixture(root){
  const folder=path.join(root,'collection');fs.mkdirSync(path.join(folder,'roms/media/mixrbv2'),{recursive:true});
  const rom=Buffer.from('fictional-rom'),cover=Buffer.from('fictional-cover');
  fs.writeFileSync(path.join(folder,'roms/game.sfc'),rom);fs.writeFileSync(path.join(folder,'roms/media/mixrbv2/cover.png'),cover);
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({version:1,items:[{name:'game.sfc',title:'Game <Test>',sha256:sha(rom),cover:'media/mixrbv2/cover.png',cover_sha256:sha(cover),art_match:'neutral'}]}));
  return folder;
}

test('SNES selection persists, never starts transfer, validates save names and confines cover paths',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const folder=fixture(root),dataDir=path.join(root,'data');
  const snes=new SnesLibrary({dataDir,picker:async()=>folder});
  await snes.choose('folder');assert.equal(snes.running,false);assert.equal(snes.status,'idle');
  assert.equal(snes.state().items[0].title,'Game <Test>');assert.equal(snes.state().items[0].file,undefined);
  assert.equal(new SnesLibrary({dataDir}).folder,fs.realpathSync(folder));
  assert.throws(()=>snes.start('sync',{ps4Ip:'127.0.0.1'}),/Feche/);
  assert.throws(()=>snes.start('sync',{ps4Ip:'999.0.0.1',closed:true}),/IPv4/);
  assert.throws(()=>snes.cover('../secrets'),/indisponível/);
  const cover=snes.cover('0');fs.unlinkSync(cover);fs.symlinkSync('/etc/hosts',cover);
  assert.throws(()=>snes.cover('0'),/fora/);
  const busy=new SnesLibrary({dataDir:path.join(root,'other'),busy:()=>true});
  await assert.rejects(busy.choose('folder'),/Aguarde/);
  fs.writeFileSync(path.join(dataDir,'job.json'),JSON.stringify({running:true}));
  assert.equal(new SnesLibrary({dataDir}).status,'attention');
});

test('SNES API loads collection and cover, rejects cross-origin sends and reports worker preflight failure without contacting console',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snes-api-'));
  const folder=fixture(root),dataDir=path.join(root,'data');fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir,'selection.json'),JSON.stringify({folder}));
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,UI_PORT:'14180',FILE_PORT:'18087',SNES_DATA_DIR:dataDir,LIBRARY_DATA_DIR:path.join(root,'lib'),QUEUE_DATA_DIR:path.join(root,'queue')}});
  t.after(async()=>{const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;fs.rmSync(root,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{let log='';child.stdout.on('data',c=>{log+=c;if(log.includes('Servidor de pacotes'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error('server exited '+code)));});
  const base='http://127.0.0.1:14180';
  const post=async(route,body={},origin)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  const state=async()=>await(await fetch(base+'/api/snes')).json();
  assert.equal((await state()).items.length,1);
  assert.equal(await(await fetch(base+'/api/snes/cover?id=0')).text(),'fictional-cover');
  assert.equal((await fetch(base+'/api/snes/cover?id=../0')).status,400);
  assert.equal((await post('/api/snes/sync',{ps4Ip:'127.0.0.1',closed:true},'https://example.invalid')).status,403);
  assert.equal((await post('/api/snes/sync',{ps4Ip:'127.0.0.1'})).status,400);
  assert.equal((await post('/api/snes/prepare')).status,400);
  fs.appendFileSync(path.join(folder,'roms/game.sfc'),'changed');
  assert.equal((await post('/api/snes/sync',{ps4Ip:'127.0.0.1',closed:true})).status,202);
  let result;
  for(let i=0;i<100;i++){result=await state();if(!result.running)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(result.status,'error');assert.match(result.error,/local mudou/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'job.json'))).running,false);
  assert.equal(fs.readFileSync(path.join(folder,'roms/game.sfc'),'utf8'),'fictional-romchanged');
});
