const fs = require('node:fs');
const path = require('node:path');

// These fields describe the public PS4 PKG container, not encrypted game data.
async function packageMetadata(file, stat, packageUrl, manifestUrl) {
  if (stat.size < 8192) return null;
  const handle=await fs.promises.open(file,'r');
  const header=Buffer.alloc(8192);
  try { if((await handle.read(header,0,header.length,0)).bytesRead!==header.length)return null; }
  finally { await handle.close(); }
  if(header.readUInt32BE(0)!==0x7f434e54)return null;
  const contentId=header.subarray(0x40,0x64).toString('ascii');
  if(!/^[A-Z0-9]{6}-[A-Z0-9]{9}_[0-9]{2}-[A-Z0-9]{16}$/.test(contentId))return null;
  const size=header.readBigUInt64BE(0x430);
  if(size!==BigInt(stat.size))return null;
  const flags=header.readUInt32BE(0x78),type=header.readUInt32BE(0x74);
  // First receiver proof is deliberately limited to complete base applications.
  if(type!==0x1a || (flags&0x60100000)!==0)return null;
  const title=path.basename(file,path.extname(file)).slice(0,100);
  return {
    bridge:{content_id:contentId,title,package_type:'PS4GD',size:stat.size,manifest_url:manifestUrl},
    manifest:{originalFileSize:stat.size,packageDigest:header.subarray(0xfe0,0x1000).toString('hex'),numberOfSplitFiles:1,
      pieces:[{url:packageUrl,fileOffset:0,fileSize:stat.size,hashValue:'0'.repeat(40)}]}
  };
}
module.exports={packageMetadata};
