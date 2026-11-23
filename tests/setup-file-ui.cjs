'use strict';
// Setup → Save file / Open file carries a robot to another computer whole: an imported CAD model (stored GLB, same id,
// its joints on it), a kit chassis the other build does not include (kept in its data folder, still there after a
// restart) and the device calibration kept beside the setup. Computer A saves; computer B starts with an empty data
// folder and, for the kit, a build without that chassis's CAD.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/setup-file');fs.mkdirSync(out,{recursive:true});
const kitGz=path.join(root,'ui/assets/robots/strafer.glb.gz'),kitAside=kitGz+'.setup-file-test';
const stepFile=path.join(root,'.cache/simulation-deps/node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp');
const KEY='deck-simulation-project-v2';
async function launch(data){
  const env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env}),page=await app.firstWindow(),errors=[];
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>typeof state==='object'&&typeof window.deck?.page==='function');
  await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');
  const project=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  const status=()=>page.evaluate(()=>document.querySelector('#start-status')?.textContent||'');
  const saveTo=async file=>{await app.evaluate(({dialog},f)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:f});},file);
    await page.evaluate(()=>document.querySelector('#sim-save').click());await page.waitForFunction(()=>/^Saved /.test(document.querySelector('#start-status').textContent),null,{timeout:120000});return status();};
  const openFrom=async file=>{await app.evaluate(({dialog},f)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[f]});},file);
    await page.evaluate(()=>document.querySelector('#sim-open').click());await page.waitForFunction(n=>document.querySelector('#start-status').textContent===`Opened ${n}.`,path.basename(file),{timeout:120000});};
  const showRobot=async name=>{await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');
    await page.evaluate(()=>{document.querySelector('#setup-view [data-flow=robot]')?.click();document.querySelector('#sim-setup-step-robot')?.click();});await page.waitForTimeout(2500);
    const said=await page.evaluate(()=>document.querySelector('#sim-mesh-size')?.textContent||'');await page.screenshot({path:path.join(out,name+'.png')});return said;};
  return {app,page,errors,project,status,saveTo,openFrom,showRobot};
}
(async()=>{
  if(!fs.existsSync(stepFile))throw Error('Missing the STEP fixture: run node tools/simulation/fetch.cjs');
  const kit=fs.existsSync(kitGz);if(!kit)console.log('SKIP: kit chassis round trip (no Strafer CAD in this build).');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'deck-setup-file-')),dataA=path.join(tmp,'a'),dataB=path.join(tmp,'b');
  const kitFile=path.join(tmp,'kit-robot.json'),cadFile=path.join(tmp,'imported-robot.json');
  const checks=JSON.stringify([['robot.frontLeft',{state:'pass',at:1}]]),camera=JSON.stringify({exposure:12});
  let session;
  try{
    // ---- Computer A: the Starter Mecanum demo (the Strafer kit), then a setup with an imported STEP robot.
    session=await launch(dataA);let {page,app,project,saveTo}=session;
    await page.evaluate(([c,k])=>{localStorage.setItem('torque-debug-checks',c);localStorage.setItem('torque-camera',k);},[checks,camera]);
    if(kit){const p=await project();assert.equal(p.robot.appearance,'strafer','a first run opens the Starter Mecanum demo');
      const said=await saveTo(kitFile);assert.match(said,/with the robot’s CAD \(\d+\.\d MB\)/);
      const saved=JSON.parse(fs.readFileSync(kitFile,'utf8'));assert.equal(saved.kitCad?.id,'strafer');assert.ok(saved.kitCad.data.length>1e6,'the chassis CAD is in the file');
      assert.equal(saved.deviceSettings?.['torque-debug-checks'],checks);assert.equal(saved.deviceSettings?.['torque-camera'],camera);
      console.log(`PASS: a kit robot saves with its chassis CAD (${(fs.statSync(kitFile).size/1048576).toFixed(1)} MB file) and the device calibration.`);}
    await page.evaluate(()=>document.querySelector('#sim-setup-new').click());await page.waitForTimeout(800);
    await app.evaluate(({dialog},f)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[f]});},stepFile);
    await page.evaluate(()=>{document.querySelector('#setup-view [data-flow=robot]')?.click();document.querySelector('#sim-setup-step-robot')?.click();});
    await page.evaluate(()=>document.querySelector('#sim-model-open').click());await page.waitForSelector('#sim-major-confirm[open],#sim-start-confirm[open]');
    if(await page.evaluate(()=>document.querySelector('#sim-major-confirm').open))await page.click('#sim-major-this');
    await page.waitForSelector('#sim-start-confirm[open]');await page.click('#sim-start-yes');
    await page.waitForFunction(()=>/Imported \d+ parts/.test(document.querySelector('#sim-model-status').textContent+document.querySelector('#sim-model-import-status').textContent),null,{timeout:120000});
    const before=await project();assert.ok(before.model?.id,'the imported model is stored');
    // A joint on the model, as a team rigs one, so the round trip shows the rig follows the model.
    await page.evaluate(k=>{const p=JSON.parse(localStorage.getItem(k));const part=(p.model.parts||[]).map(x=>x.key||x.name).find(Boolean)||p.model.name;p.kinematics={...(p.kinematics||{}),model:p.model.id,unit:1,joints:[{id:'arm',name:'Arm',kind:'arm',type:'revolute',parts:[part],origin:[0,0,0],axis:[0,1,0],limits:[0,90]}]};const mine=(p.setups||[]).find(x=>x.id===p.setupId);if(mine?.data)mine.data.kinematics=p.kinematics;localStorage.setItem(k,JSON.stringify(p));
      // The window saves its own copy when it closes: keep the rigged one for the restart.
      const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key!==k)return set.call(this,key,value);};},KEY);
    await app.close();session=await launch(dataA);({page,app,project,saveTo}=session);
    const rigged=await project();assert.equal(rigged.kinematics.model,before.model.id,JSON.stringify(rigged.kinematics).slice(0,400));
    const said=await saveTo(cadFile);assert.match(said,/with the robot’s CAD/);
    const saved=JSON.parse(fs.readFileSync(cadFile,'utf8'));assert.equal(typeof saved.modelData,'string','the imported CAD is in the file');assert.equal(saved.model.id,before.model.id);
    console.log(`PASS: an imported STEP robot saves with its CAD (${(fs.statSync(cadFile).size/1048576).toFixed(1)} MB file), even when its model was not drawn yet.`);
    await page.screenshot({path:path.join(out,'a-imported.png')});await app.close();session=null;

    // ---- Computer B: an empty data folder and, for the kit, a build without the Strafer CAD.
    if(kit)fs.renameSync(kitGz,kitAside);
    session=await launch(dataB);({page,app,project}=session);
    await session.openFrom(cadFile);let p=await project();
    assert.equal(p.model?.id,before.model.id,'the same bytes are stored under the same id');assert.equal(p.kinematics.model,p.model.id,'its joints stay on it');
    assert.deepEqual(p.kinematics.joints.map(j=>j.id),['arm']);assert.ok(fs.existsSync(path.join(dataB,'simulation/models',p.model.id)),'the model is in B’s models folder');
    await page.waitForFunction(()=>/ in tall\./.test(document.querySelector('#sim-mesh-size')?.textContent||''),null,{timeout:120000});
    console.log('  B imported robot:',await session.showRobot('b-imported'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('torque-debug-checks')),checks,'the device checks came along');
    assert.equal(await page.evaluate(()=>localStorage.getItem('torque-camera')),camera,'the camera settings came along');
    console.log('PASS: on another computer the imported robot opens drawn from its CAD, with its rig and device calibration.');
    if(kit){
      assert.deepEqual((await page.evaluate(()=>deck.simFile('assets'))).robots,[],'this build has no Strafer CAD');
      await session.openFrom(kitFile);p=await project();assert.equal(p.robot.appearance,'strafer');
      for(const f of ['strafer.glb','strafer.json'])assert.ok(fs.existsSync(path.join(dataB,'simulation/kit-robots',f)),`kit-robots/${f} is kept`);
      assert.deepEqual((await page.evaluate(()=>deck.simFile('assets'))).robots,['strafer']);
      await page.waitForFunction(()=>/Strafer| in tall\./.test(document.querySelector('#sim-mesh-size')?.textContent||''),null,{timeout:120000});
      console.log('  B kit robot:',await session.showRobot('b-kit'));await app.close();
      session=await launch(dataB);({page}=session);
      assert.deepEqual((await page.evaluate(()=>deck.simFile('assets'))).robots,['strafer'],'still there after a restart');
      const glb=await page.evaluate(async()=>{const m=await deck.simFile('builtin-model','strafer');return {size:m.bytes.length,magic:String.fromCharCode(...m.bytes.slice(0,4))};});
      assert.equal(glb.magic,'glTF');assert.ok(glb.size>1e6);
      console.log('PASS: a kit chassis this build lacks comes from the file, is kept, and is still drawn after a restart.');}
    assert.deepEqual(session.errors,[],'no page errors');
    console.log('Setup file round trip: all passed');
  }catch(e){if(session)await session.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
  finally{await session?.app.close().catch(()=>{});if(fs.existsSync(kitAside))fs.renameSync(kitAside,kitGz);fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
