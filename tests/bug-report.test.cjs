'use strict';
// Bug reports: what the app accepts and sends (src/bug-report.cjs), the relay that turns them into GitHub issues
// (tools/bug-report-relay/worker.mjs, against a stand-in for GitHub) and the download counts (tools/download-stats.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const B=require('../src/bug-report.cjs'),S=require('../tools/download-stats.cjs');
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32)]).toString('base64');
const good={title:'It stops',body:'Press Run and it stops @someone #12',images:[{name:'a.png',data:PNG}]};
const worker=()=>import(require('node:url').pathToFileURL(path.join(__dirname,'../tools/bug-report-relay/worker.mjs')).href+`?${Math.random()}`).then(m=>m.default);
const post=(report,ip='1.1.1.1')=>new Request('https://relay.test/',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':ip},body:JSON.stringify(report)});
const env={REPO:'me/reports',GITHUB_TOKEN:'token'};

function fakeGitHub(status=200){const calls=[],real=globalThis.fetch;
  globalThis.fetch=async(url,o)=>{calls.push({url:String(url),method:o.method,auth:o.headers.Authorization,body:JSON.parse(o.body)});
    return new Response(JSON.stringify(String(url).includes('/contents/')?{content:{html_url:'https://github.com/me/reports/blob/main/x.png'}}:{number:7}),{status});};
  return {calls,restore:()=>{globalThis.fetch=real;}};}

test('the app turns away a report it cannot send, in words the person can act on',()=>{
  assert.throws(()=>B.clean({title:'',body:'x'}),/title/);assert.throws(()=>B.clean({title:'x',body:' '}),/what happened/);
  assert.throws(()=>B.clean({...good,images:Array(4).fill(good.images[0])}),/up to 3/);
  assert.throws(()=>B.clean({...good,images:[{name:'a.exe',data:Buffer.from('MZ not a picture at all').toString('base64')}]}),/a\.exe is not a PNG/);
  const big=Buffer.concat([Buffer.from(PNG,'base64'),Buffer.alloc(B.MAX_IMAGE_BYTES)]).toString('base64');assert.throws(()=>B.clean({...good,images:[{name:'big.png',data:big}]}),/over 3 MB/);
  assert.equal(B.clean(good).images[0].type,'png');
});

test('with no relay, or a relay that fails, the report is not lost: the app says so and can open it on GitHub',async()=>{
  assert.deepEqual(await B.send(good,{url:'',about:'x'}),{sent:false,reason:'Automatic sending is not set up in this version.'});
  const down=await B.send(good,{url:'https://relay.test',about:'x',fetcher:async()=>{throw Error('offline');}});assert.equal(down.sent,false);assert.match(down.reason,/internet/);
  const sent=await B.send(good,{url:'https://relay.test',about:'x',fetcher:async()=>new Response('{"ok":true,"number":7}')});assert.deepEqual(sent,{sent:true,number:7});
  const u=new URL(B.issueUrl(good,{repo:'git+https://github.com/me/app.git',about:'Torque 1 (testing)'}));assert.equal(u.origin+u.pathname,'https://github.com/me/app/issues/new');
  assert.equal(u.searchParams.get('title'),'It stops');assert.match(u.searchParams.get('body'),/Press Run[\s\S]*Torque 1 \(testing\)[\s\S]*Drag the picture/);
});

test('the relay saves the pictures, opens one issue and never lets a report ping anyone',async()=>{
  const gh=fakeGitHub(),w=await worker();try{const res=await w.fetch(post({...good,about:'Torque 2'}),env),out=await res.json();assert.deepEqual([res.status,out],[200,{ok:true,number:7}]);
    assert.equal(gh.calls.length,2);const [pic,issue]=gh.calls;assert.match(pic.url,/\/repos\/me\/reports\/contents\/reports\/.*\/1\.png$/);assert.equal(pic.method,'PUT');assert.equal(pic.auth,'Bearer token');
    assert.match(issue.url,/\/repos\/me\/reports\/issues$/);assert.equal(issue.body.title,'[Bug report] It stops');assert.match(issue.body.body,/!\[Picture 1\]\(.*\?raw=true\)/);assert.match(issue.body.body,/Torque 2/);
    assert.doesNotMatch(issue.body.body,/@someone|#12/);}finally{gh.restore();}
});

test('the relay refuses bad reports before calling GitHub, and holds its limits',async()=>{
  const gh=fakeGitHub(),w=await worker();try{
    for(const bad of [{title:'',body:'x'},{title:'x',body:''},{...good,images:[{name:'a',data:Buffer.from('<svg></svg> and more text').toString('base64')}]},{...good,images:Array(4).fill(good.images[0])}])assert.equal((await w.fetch(post(bad,'9.9.9.9'),env)).status,400);
    assert.equal((await w.fetch(new Request('https://relay.test/'),env)).status,405);assert.equal(gh.calls.length,0);
    const statuses=[];for(let i=0;i<6;i++)statuses.push((await w.fetch(post({title:'t',body:'b'},'2.2.2.2'),env)).status);assert.deepEqual(statuses,[200,200,200,200,200,429]);
  }finally{gh.restore();}
});

test('a GitHub failure comes back as a plain error and shows no token',async()=>{
  const gh=fakeGitHub(401),w=await worker();try{const res=await w.fetch(post({title:'t',body:'b'},'3.3.3.3'),env),text=await res.text();assert.equal(res.status,502);assert.doesNotMatch(text,/token/i);}finally{gh.restore();}
});

test('download counts add up installers and zips by release, not checksums',()=>{
  const {rows,total}=S.summarize([{tag_name:'v2',published_at:'2026-02-01T00:00:00Z',assets:[{name:'a-Setup.exe',download_count:5},{name:'a-Setup.exe.sha256',download_count:50},{name:'a.zip',download_count:2}]},{tag_name:'v1',published_at:'2026-01-01T00:00:00Z',prerelease:true,assets:[{name:'a-Setup.exe',download_count:3}]}]);
  assert.deepEqual(rows.map(r=>[r.tag,r.downloads,r.prerelease]),[['v2',7,false],['v1',3,true]]);assert.equal(total,10);
});
