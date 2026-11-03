'use strict';
// Which platforms a release builds: package.json's testingReleaseTargets / mainReleaseTargets
// (all three without the key); a partial release never ships the App package (older updaters on the
// skipped platforms would install it), and the publish workflow is wired to this logic.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),script=path.join(root,'tools/release-targets.cjs');
const {ALL,targets,partial,describe,plan}=require(script);
const meta=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const workflow=fs.readFileSync(path.join(root,'.github/workflows/release.yml'),'utf8').replace(/\r\n/g,'\n');// Windows checkouts may use CRLF
const files=(v,...platforms)=>platforms.flatMap(p=>({steamdeck:[`DeckDriverStation-${v}-SteamDeck.tar.gz`,`DeckDriverStation-${v}-SteamDeck.run`,'DeckDriverStation-SteamDeck.run',`DeckDriverStation-${v}-App-c6eacf3db1ea.tar.gz`],windows:[`DeckDriverStation-${v}-Windows.zip`,`DeckDriverStation-${v}-Windows-Setup.exe`,'DeckDriverStation-Windows-Setup.exe'],'macos-arm64':[`DeckDriverStation-${v}-macOS-arm64.zip`,'DeckDriverStation-macOS-arm64.zip']})[p]).flatMap(f=>[f,f+'.sha256']);

test('each branch builds its own ReleaseTargets, or everything without it',()=>{
  assert.deepEqual(ALL,['steamdeck','windows','macos-arm64']);
  for(const m of [{},{testingReleaseTargets:['windows']}])assert.deepEqual(targets('main',m),ALL);
  assert.deepEqual(targets('main',{mainReleaseTargets:['windows']}),['windows']);
  assert.throws(()=>targets('main',{mainReleaseTargets:[]}),/mainReleaseTargets must list/);
  assert.deepEqual(targets('testing',{testingReleaseTargets:['windows']}),['windows']);
  assert.deepEqual(targets('testing',{testingReleaseTargets:['macos-arm64','steamdeck']}),['steamdeck','macos-arm64']);
  assert.deepEqual(targets('testing',{}),ALL);
  for(const bad of [[],['windows','windows'],['linux'],'windows',null,[1]])assert.throws(()=>targets('testing',{testingReleaseTargets:bad}),/testingReleaseTargets must list/,JSON.stringify(bad));
  assert.throws(()=>targets('feature',meta),/testing or main/);
});
test('package.json\'s release targets are valid, and the command the workflow runs prints them',()=>{
  assert.match(meta.version,/^\d+\.\d+\.\d+$/);assert.ok(['testing','main'].includes(meta.updateChannel));
  for(const b of ['testing','main'])if(meta[b+'ReleaseTargets']!==undefined)assert.deepEqual(targets(b,meta),ALL.filter(t=>meta[b+'ReleaseTargets'].includes(t)));
  // The CLI the workflow calls prints the same list as one line of JSON.
  assert.equal(execFileSync(process.execPath,[script,'targets','testing'],{encoding:'utf8'}),JSON.stringify(targets('testing',meta))+'\n');
  assert.equal(execFileSync(process.execPath,[script,'targets','main'],{encoding:'utf8'}),JSON.stringify(targets('main',meta))+'\n');
});
test('a Windows-only build publishes only the Windows files, and a partial build drops the App package',()=>{
  const win=plan(files('2.4.23','windows'),['windows'],'2.4.23');assert.deepEqual(win.problems,[]);assert.deepEqual(win.drop,[]);assert.equal(win.keep.length,6);assert.ok(win.keep.every(f=>/Windows/.test(f)));
  const two=plan(files('2.4.23','steamdeck','windows'),['steamdeck','windows'],'2.4.23');assert.deepEqual(two.problems,[]);assert.deepEqual(two.drop,['DeckDriverStation-2.4.23-App-c6eacf3db1ea.tar.gz','DeckDriverStation-2.4.23-App-c6eacf3db1ea.tar.gz.sha256']);
  const all=plan(files('2.4.23',...ALL),ALL,'2.4.23');assert.deepEqual(all.problems,[]);assert.deepEqual(all.drop,[]);assert.equal(all.keep.length,18);
  assert.match(plan(files('2.4.23','steamdeck','windows'),['windows'],'2.4.23').problems.join('\n'),/SteamDeck\.tar\.gz is for Steam Deck\/Linux, which this release does not build/);
  assert.deepEqual(plan(files('2.4.23','windows').filter(f=>!f.startsWith('DeckDriverStation-2.4.23-Windows.zip')),['windows'],'2.4.23').problems,['DeckDriverStation-2.4.23-Windows.zip is missing.','DeckDriverStation-2.4.23-Windows.zip.sha256 is missing.']);
  assert.deepEqual(plan([...files('2.4.23','windows'),'notes.txt'],['windows'],'2.4.23').problems,['notes.txt is not a known release file.']);
  assert.equal(partial(['windows']),true);assert.equal(partial(ALL),false);
});
test('partial releases say which devices they are for',()=>{
  assert.deepEqual(describe('v2.4.23',ALL),{title:'Torque v2.4.23',notes:''});
  assert.deepEqual(describe('v2.4.28',ALL,'V2'),{title:'Torque V2 (v2.4.28)',notes:''},'a main release can carry a name');assert.equal(describe('testing-v2.4.28',ALL,'V2').title,'Torque testing-v2.4.28','a testing one keeps its tag');assert.match(describe('v2.4.28',['windows'],'V2').title,/^Torque V2 \(v2\.4\.28\) \(Windows x64 only\)$/);
  assert.deepEqual(describe('testing-v2.4.23',['windows']),{title:'Torque testing-v2.4.23 (Windows x64 only)',notes:'This build is for Windows x64 only. Steam Deck/Linux and Apple Silicon stay on their current version until a later release includes them.'});
});
test('prepare checks dist, removes a partial build\'s App package and prints the title and notes',t=>{
  const dist=fs.mkdtempSync(path.join(os.tmpdir(),'deck-release-'));t.after(()=>fs.rmSync(dist,{recursive:true,force:true}));
  for(const f of files('2.4.23','steamdeck','windows'))fs.writeFileSync(path.join(dist,f),'x');
  const out=JSON.parse(execFileSync(process.execPath,[script,'prepare',dist,'["steamdeck","windows"]','2.4.23','testing-v2.4.23'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.match(out.title,/\(Steam Deck\/Linux and Windows x64 only\)$/);assert.ok(!fs.readdirSync(dist).some(f=>f.includes('-App-')));assert.equal(fs.readdirSync(dist).length,12);
  assert.throws(()=>execFileSync(process.execPath,[script,'prepare',dist,'["windows"]','2.4.23','testing-v2.4.23'],{stdio:'pipe'}),/which this release does not build/);
  assert.equal(fs.readdirSync(dist).length,12,'a failed check removes nothing');
});
test('the publish workflow builds and publishes exactly the chosen targets',()=>{
  const job=name=>workflow.split(/\n  (?=[\w-]+:\n)/).find(s=>s.startsWith(name+':'))||'';
  const validate=job('validate'),desktop=job('desktop'),publish=job('publish');assert.ok(validate&&desktop&&publish);
  assert.match(validate,/\n {6}targets: \$\{\{ steps\.meta\.outputs\.targets \}\}\n/);
  assert.match(validate,/targets=\$\(node tools\/release-targets\.cjs targets "\$branch"\)\n[^]*echo "targets=\$targets" >> "\$GITHUB_OUTPUT"/);
  assert.match(desktop,/\n {8}target: \$\{\{ fromJSON\(needs\.validate\.outputs\.targets\) \}\}\n/);
  assert.doesNotMatch(workflow,/target: \[/,'no hard-coded platform matrix');
  assert.match(publish,/TARGETS: \$\{\{ needs\.validate\.outputs\.targets \}\}/);
  const prepare=publish.indexOf('node tools/release-targets.cjs prepare dist "$TARGETS" "$VERSION" "$TAG"'),create=publish.indexOf('gh release create "$TAG" dist/*');
  assert.ok(prepare>0&&create>prepare,'dist is checked before the release is created');
  // The manifest keeps the new release first, as updaters up to 2.4.22 and the jq check expect.
  assert.match(publish,/releases:\(\[\.\[0\]\|slim\]\+/);assert.match(publish,/\.releases\[0\]\.tag_name==\$tag/);
});
