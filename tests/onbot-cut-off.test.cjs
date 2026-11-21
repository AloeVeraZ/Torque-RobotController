'use strict';
// A reply from the robot's OnBot Java that is cut off part way (Wi-Fi dropped, the cable came out under the ADB forward):
// it must be an error, at once. It used to never end, and everything asked of the robot afterwards waited behind it; and a
// file read that came back short must never be kept as the team's backup and then written over on the robot.
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('../src/robot-link.cjs');
const full='class Team { /* '+'x'.repeat(5000)+' */ }\n';
function robot(mode){const saved=[];let reads=0;const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/java/build/status'))return res.end(JSON.stringify({running:false,completed:true,successful:true,startTimestamp:5}));
    if(req.url.startsWith('/java/build/start'))return res.end('1');if(req.url.startsWith('/java/build/log'))return res.end('');
    if(req.url.startsWith('/java/file/get')){reads++;
      if(mode==='length'){res.writeHead(200,{'Content-Length':Buffer.byteLength(full)});res.write(full.slice(0,100));setTimeout(()=>res.socket.destroy(),30);}
      else if(mode==='chunked'){res.writeHead(200);res.write(full.slice(0,100));setTimeout(()=>res.socket.destroy(),30);}
      // No length given and the connection simply closed: it looks like a whole reply. The second read differs from the first.
      else if(mode==='close'){res.socket.write('HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\n'+full.slice(0,reads===1?100:5000));setTimeout(()=>res.socket.end(),30);}
      else res.end(full);
      return;}
    if(req.url.startsWith('/java/file/save')){let b='';req.on('data',d=>b+=d);req.on('end',()=>{saved.push(b.length);res.end('ok');});return;}
    res.statusCode=404;res.end();});
  return new Promise(ok=>server.listen(0,'127.0.0.1',()=>ok({server,saved,port:server.address().port})));}
for(const mode of ['length','chunked','close'])test(`a robot file read cut off part way (${mode}) is an error, and the robot's file is not written over`,async()=>{
  const r=await robot(mode),dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-cut-'));
  try{const client=new L.OnBotJava('127.0.0.1',{port:r.port,timeout:3000});
    const out=await Promise.race([L.send('127.0.0.1',{'Team.java':'class Team {}\n'},{client,backupDir:dir}).then(()=>'sent',e=>e.message),new Promise(ok=>setTimeout(()=>ok('still waiting'),6000))]);
    assert.match(out,mode==='close'?/two different copies/:/stopped answering part way/);assert.deepEqual(r.saved,[],'nothing was saved over the robot’s file');
    assert.deepEqual(fs.readdirSync(dir).flatMap(d=>fs.readdirSync(path.join(dir,d))),[],'and no cut-off copy was kept as a backup');
  }finally{r.server.closeAllConnections?.();r.server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a whole reply still sends: the robot’s different file is kept as a backup, then written over',async()=>{
  const r=await robot('whole'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'torque-cut-'));
  try{const client=new L.OnBotJava('127.0.0.1',{port:r.port,timeout:3000}),out=await L.send('127.0.0.1',{'Team.java':'class Team {}\n'},{client,backupDir:dir});
    assert.equal(out.backups.length,1);assert.equal(fs.readFileSync(out.backups[0],'utf8'),full);assert.equal(r.saved.length,1);
  }finally{r.server.closeAllConnections?.();r.server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
