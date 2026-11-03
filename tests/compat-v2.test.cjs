'use strict';
// From V2 (2.4.28) on, every version updates to every later one, and V2 and newer versions read each other's saved data, so going back to
// V2 loses nothing. V2 has shipped and cannot change, so these tests hold newer code to what V2's own code expects. tests/fixtures/v2.4.28
// holds V2's updater and saved-robots code exactly as released. docs/COMPATIBILITY.md has the rules.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..'),V2=path.join(__dirname,'fixtures','v2.4.28');
const Old=require(path.join(V2,'updater.cjs')),{Library:OldLibrary}=require(path.join(V2,'library.cjs'));
const Now=require('../src/updater.cjs'),{Library}=require('../src/library.cjs'),RT=require('../tools/release-targets.cjs');
const meta=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const workflow=fs.readFileSync(path.join(root,'.github/workflows/release.yml'),'utf8').replace(/\r\n/g,'\n');
const BASE='e80727de2994',OTHER_BASE='0123456789ab',REPO='AloeVeraZ/Torque-RobotController';
const SYSTEMS=[['linux','x64','SteamDeck.tar.gz'],['win32','x64','Windows.zip'],['darwin','arm64','macOS-arm64.zip']];
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'torque-compat-'));

// Every file a full release publishes, under the names tools/release-targets.cjs requires.
const files=v=>[`DeckDriverStation-${v}-SteamDeck.tar.gz`,`DeckDriverStation-${v}-SteamDeck.run`,'DeckDriverStation-SteamDeck.run',`DeckDriverStation-${v}-App-${BASE}.tar.gz`,
  `DeckDriverStation-${v}-Windows.zip`,`DeckDriverStation-${v}-Windows-Setup.exe`,'DeckDriverStation-Windows-Setup.exe',`DeckDriverStation-${v}-macOS-arm64.zip`,'DeckDriverStation-macOS-arm64.zip'].flatMap(f=>[f,f+'.sha256']);
const release=(v,channel)=>({tag_name:`${channel==='testing'?'testing-':''}v${v}`,draft:false,prerelease:channel==='testing',body:'',
  assets:files(v).map(name=>({name,size:1000,state:'uploaded',digest:'sha256:0',browser_download_url:`https://github.com/${REPO}/releases/download/v${v}/${name}`}))});
const FUTURE=['2.4.29','2.5.0','2.10.3','3.0.0'];

test('today\'s publishing writes every file V2 looks for, under the same names',()=>{
  for(const v of [meta.version,...FUTURE]){const p=RT.plan(files(v),RT.ALL,v);assert.deepEqual(p.problems,[],v);assert.deepEqual(p.drop,[],v);}
  for(const [platform,arch,suffix] of SYSTEMS)assert.equal(Old.assetName('9.9.9',platform,arch),`DeckDriverStation-9.9.9-${suffix}`,'V2 asks for this exact name');
});

test('V2 finds and takes every later release, on all three systems and both channels',()=>{
  for(const channel of ['main','testing'])for(const v of FUTURE)for(const [platform,arch,suffix] of SYSTEMS){
    const list=[release(v,channel),release('2.4.28',channel)];
    const small=Old.selectRelease(list,{version:'2.4.28',channel,platform,arch,base:BASE});assert.equal(small.status,'available',`${channel} ${v} ${platform}`);assert.equal(small.latest,v);assert.equal(small.kind,'app');assert.equal(small.asset.name,`DeckDriverStation-${v}-App-${BASE}.tar.gz`,'same runtime: the small App package');
    const full=Old.selectRelease(list,{version:'2.4.28',channel,platform,arch,base:OTHER_BASE});assert.equal(full.kind,'full');assert.equal(full.asset.name,`DeckDriverStation-${v}-${suffix}`,'a new runtime: the full download');}
  // A Main install never takes a testing build, and the other way round.
  assert.equal(Old.selectRelease([release('3.0.0','testing')],{version:'2.4.28',channel:'main',platform:'win32',arch:'x64',base:BASE}).status,'unpublished');
});

test('this version is one V2 understands and counts as newer',()=>{
  assert.match(meta.version,/^\d+\.\d+\.\d+$/,'plain X.Y.Z: V2 ignores any other tag');assert.ok(Old.compare(meta.version,'2.4.28')>=0,`${meta.version} is not older than V2`);
  for(const v of FUTURE)assert.ok(Old.compare(v,'2.4.28')>0&&Now.compare(v,'2.4.28')>0,v);assert.ok(Old.compare('2.10.0','2.9.0')>0,'numbers compare as numbers');
});

test('the publish job keeps the tags, flags and channel manifest V2 reads',()=>{
  assert.match(workflow,/tags: \['v\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*', 'testing-v\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*'\]/,'tags v1.2.3 and testing-v1.2.3 publish');
  assert.match(workflow,/if \[\[ "\$BRANCH" == testing \]\]; then args\+=\(--prerelease\); fi/,'testing releases are pre-releases, main ones are not');
  assert.match(workflow,/\{schema:1,channel:\$channel,releases:/,'manifest schema 1');assert.match(workflow,/gh release upload "\$channel-channel" channel\.json --clobber/,'at <channel>-channel/channel.json');
  assert.doesNotMatch(workflow,/git push[^\n]*--delete|git tag -d|gh release delete|cleanup-tag/,'publishing never deletes a tag or a release: a deleted tag leaves its release hidden but still counted');
});

test('V2 reads the channel manifest today\'s publishing writes, and falls back to GitHub when it is missing',async()=>{
  const slim=r=>({tag_name:r.tag_name,prerelease:r.prerelease,draft:r.draft,body:r.body,assets:r.assets.map(({name,size,digest,state,browser_download_url})=>({name,size,digest,state,browser_download_url}))});
  const manifest={schema:1,channel:'main',releases:[slim(release('2.5.0','main')),slim(release('2.4.28','main'))]};
  const reply=(status,body)=>({ok:status===200,status,headers:{get:()=>''},json:async()=>body,text:async()=>JSON.stringify(body)});
  for(const missing of [false,true]){const seen=[];const u=new Old.Updater({directory:temp(),version:'2.4.28',repo:REPO,channel:'main',platform:'win32',arch:'x64',base:BASE,
      fetcher:async url=>{seen.push(url);if(url.endsWith('/main-channel/channel.json'))return missing?reply(404,{}):reply(200,manifest);if(url.includes('api.github.com'))return reply(200,manifest.releases);return reply(404,{});}});
    const {releases}=await u.releases();assert.equal(releases[0].tag_name,'v2.5.0',missing?'from the API':'from the manifest');assert.equal(seen[0],`https://github.com/${REPO}/releases/download/main-channel/channel.json`);
    assert.equal(Old.selectRelease(releases,{version:'2.4.28',channel:'main',platform:'win32',arch:'x64',base:BASE}).latest,'2.5.0');}
});

test('the update channel setting carries both ways',()=>{
  for(const channel of ['main','testing']){const dir=temp();new Now.Updater({directory:dir,version:meta.version,repo:REPO,channel:'testing'}).setChannel(channel,true);
    assert.equal(new Old.Updater({directory:dir,version:'2.4.28',repo:REPO,channel:'testing'}).channel,channel,'V2 reads what this version saved');
    const back=temp();new Old.Updater({directory:back,version:'2.4.28',repo:REPO,channel:'testing'}).setChannel(channel,true);assert.equal(new Now.Updater({directory:back,version:meta.version,repo:REPO,channel:'testing'}).channel,channel,'and the other way');}
});

test('saved robots survive going back to V2 and forward again, fields V2 never knew included',()=>{
  const dir=temp(),file=path.join(dir,'robots.json'),now=new Library(file);
  const a=now.upsert({name:'Practice Bot',url:'192.168.43.1:8080',ssid:'FTC-NjK6',kind:'ftc',controllerCount:2},{opened:true}),b=now.upsert({name:'Arm',url:'http://10.0.0.5',ssid:'Shop'});
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.version,2,'robots.json stays version 2: V2 starts empty on any other version and then overwrites the file');
  // A later version adds a field V2 does not know: V2 still loads every robot.
  saved.robots[0].future={camera:'front'};saved.future=true;fs.writeFileSync(file,JSON.stringify(saved));
  const old=new OldLibrary(file);assert.deepEqual(old.list().map(r=>r.name).sort(),['Arm','Practice Bot']);assert.equal(old.get(a.id).controllerCount,2);assert.equal(old.data.lastId,a.id);
  old.upsert({id:b.id,name:'Arm 2',url:'http://10.0.0.5',ssid:'Shop'});
  const again=new Library(file);assert.deepEqual(again.list().map(r=>r.name).sort(),['Arm 2','Practice Bot'],'back on the newer version, nothing is lost');assert.deepEqual(again.get(a.id).future,{camera:'front'},'a robot V2 did not edit keeps the newer field');assert.equal(again.get(a.id).kind,'ftc');
});

test('every file and setting V2 saves is still read by this version',()=>{
  // V2's saved names, from V2's own source. Renaming one would lose that data for everyone coming from V2.
  const V2_NAMES=['robots.json','update-settings.json','release-cache.json','controller-settings.json','input-source.json','controller-calibration.json','robot-zoom.json','wiring-notes.json','configuration-notes.json','axon-keys.json','Torque Axon keys.json','axon-firmware','robot-backups',
    'deck-simulation-project-v2','deck-simulation-project-v1','deck-simulation-start-v1','deck-ds-settings','deck-theme','deck-keep-awake','deck-virtual-keyboard','torque-competition','torque-camera','torque-debug-devices'];
  const sources=[...['src','ui','ui/ftc'].flatMap(d=>fs.readdirSync(path.join(root,d)).filter(f=>/\.(c?js|html)$/.test(f)).map(f=>path.join(root,d,f)))].map(f=>fs.readFileSync(f,'utf8')).join('\n');
  for(const name of V2_NAMES)assert.ok(sources.includes(name),`${name} is still read`);
});
