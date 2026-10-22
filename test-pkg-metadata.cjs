const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {spawn}=require('node:child_process');
const {packageMetadata}=require('./pkg-metadata');
function fixture(file){const data=Buffer.alloc(8192);data.writeUInt32BE(0x7f434e54);data.write('IV0001-TEST00001_00-0123456789ABCDEF',0x40,'ascii');data.writeUInt32BE(0x1a,0x74);data.writeBigUInt64BE(BigInt(data.length),0x430);data.fill(0x12,0xfe0,0x1000);fs.writeFileSync(file,data);return data;}
test('PKG manifest validates container identity, length and base-game limits without changing source',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pkg-meta-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'Test game.pkg');const bytes=fixture(file);
 const metadata=await packageMetadata(file,fs.statSync(file),'http://host/token/game.pkg','http://host/token/manifest.json');
 assert.equal(metadata.bridge.content_id,'IV0001-TEST00001_00-0123456789ABCDEF');assert.equal(metadata.bridge.title,'Test game');assert.equal(metadata.manifest.pieces[0].fileSize,8192);assert.equal(metadata.manifest.packageDigest,'12'.repeat(32));assert.deepEqual(fs.readFileSync(file),bytes);
 for(const mutate of [b=>b.writeUInt32BE(0x1b,0x74),b=>b.writeUInt32BE(0x00100000,0x78),b=>b.writeBigUInt64BE(123n,0x430),b=>b.write('bad',0x40),b=>b.fill(0,0,4)]){
  const data=Buffer.from(bytes);mutate(data);fs.writeFileSync(file,data);assert.equal(await packageMetadata(file,fs.statSync(file),'url','manifest'),null);
 }
});
test('real sender adds receiver metadata and serves manifest only through selected PS4 token and unchanged file',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pkg-manifest-api-'));const file=path.join(root,'fixture.pkg');fixture(file);let body;
 const consoleServer=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text);res.end('{"status":"success","task_id":77}');});await new Promise(r=>consoleServer.listen(12800,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,UI_PORT:'14184',FILE_PORT:'18091',PKG_FILE:file,LIBRARY_DATA_DIR:path.join(root,'library'),QUEUE_DATA_DIR:path.join(root,'queue'),SNES_DATA_DIR:path.join(root,'snes')}});
 t.after(async()=>{const end=new Promise(r=>child.once('exit',r));child.kill();await end;await new Promise(r=>consoleServer.close(r));fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let log='';child.stdout.on('data',c=>{log+=c;if(log.includes('Servidor de pacotes'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error('server exit '+code)));});
 const response=await fetch('http://127.0.0.1:14184/api/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ps4Ip:'127.0.0.1',macIp:'127.0.0.1'})});assert.equal(response.status,200);
 assert.equal(body.bridge.package_type,'PS4GD');const url=body.bridge.manifest_url;
 const manifest=await(await fetch(url)).json();assert.equal(manifest.pieces[0].url,body.packages[0]);assert.equal(manifest.originalFileSize,8192);
 assert.equal((await fetch(url.replace(/\/[a-f0-9]{64}\//,'/wrong/'))).status,403);
 const other=Object.values(os.networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal)?.address;
 if(other){const denied=await new Promise((resolve,reject)=>http.get(url,{localAddress:other},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(denied,403);}
 fs.appendFileSync(file,'changed');assert.equal((await fetch(url)).status,409);
});
