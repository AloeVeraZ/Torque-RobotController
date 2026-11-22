'use strict';
// Calibrate → Electronics in the real app, on a stubbed drivetrain-only robot (four motors, the hub's IMU, a beam-break
// sensor and a claw servo with nothing on it): the student says everything is at zero, moves one thing at a time and
// links what followed it, sees a swapped encoder cable against the configuration, says a servo moves no sensor, and links
// the beam to a game piece put in by hand. Mechanisms then starts with the chassis. Electronics needs nothing from
// Simulate: with Simulate unfinished, Calibrate and Electronics still open and only Mechanisms waits. Links are kept.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/links-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright'),root=path.join(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms)),SERIAL='24677c4269e7e709';
const soon=async(what,fn,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn().catch(()=>false))return;await wait(60);}throw Error(`Not within ${ms/1000} s: ${what}`);};
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<Robot type="FirstInspires-FTC">
    <!-- Deck wiring: {"rightBack":{"encoder":false}} -->
    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">
        <LynxModule name="Control Hub" port="173">
            <goBILDA5202SeriesMotor name="leftFront" port="0" />
            <goBILDA5202SeriesMotor name="leftBack" port="1" />
            <goBILDA5202SeriesMotor name="rightFront" port="2" />
            <goBILDA5202SeriesMotor name="rightBack" port="3" />
            <Servo name="claw" port="0" />
            <DigitalDevice name="beam" port="0" />
            <ControlHubImuBHI260AP name="imu" port="0" bus="0" />
        </LynxModule>
    </LynxUsbDevice>
</Robot>
`;
const MOTORS=['leftFront','leftBack','rightFront','rightBack'];
const MAN={deck:'debug',version:1,motors:MOTORS,servos:['claw'],crservos:[],digital:['beam'],touch:[],cameras:[],lights:[],analog:[],i2c:[{n:'imu',k:'imu',h:173,b:0,a:40}],hubs:[{n:'Control Hub',address:173,parent:true}]};
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-links-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data,ADB:'C:\\Windows\\System32\\where.exe'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});let run=true;
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
    await app.evaluate(({ipcMain,BrowserWindow},{xml,SERIAL})=>{const g=global;g.__sent=[];ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,d)=>{const ok=value=>({ok:true,value}),usb={serial:SERIAL,devices:[],addresses:[],at:1};
      if(action==='detect')return ok({usb:{found:true,serial:SERIAL},wifi:{robot:false}});if(action==='usb-status')return ok({found:true,serial:SERIAL});if(action==='usb-recover')return ok(null);
      if(action==='usb-watch')return ok({seq:1,at:Date.now(),usb:true,devices:[],hub:{serial:SERIAL,state:'device',model:null,vid:'2207',pid:'0011',usb:true},adb:{running:true,devices:[]},status:{found:true,serial:SERIAL},why:'+',drop:null,hubUsb:usb});
      if(action==='hub-usb')return ok(usb);if(action==='hub-usb-drops')return ok([]);if(action==='limelight')return ok({status:null});if(action==='hub-rc-up')return ok(true);
      if(action==='read-usb')return ok({serial:SERIAL,active:{name:'robot'},configurations:['robot'],files:{robot:xml}});if(action==='check')return ok([{name:'Robot Controller app',ok:true,detail:'FTC SDK 12.0'}]);
      if(action==='scan')return ok({portals:[{serial:'(embedded)',modules:[{address:173,parent:true,imu:'BHI260'}],servoHubs:[]}],others:[]});
      if(action==='send'){g.__files={...(g.__files||{}),...(d.files||{})};return ok({built:true,seconds:9,log:'',errors:[]});}if(action==='onbot-read')return ok(null);
      if(action==='debug-send'){g.__sent.push(d.line);return ok(true);}if(action==='debug-install')return ok({opMode:'TorqueDebug-x'});if(action==='debug-current')return ok({current:true,opMode:'TorqueDebug-x'});
      if(action==='debug-start'){g.__starts=(g.__starts||0)+1;return ok(true);}if(action==='debug-stop'||action==='debug-claim')return ok(true);return {ok:false,error:'not in this test: '+action};});},{xml:XML,SERIAL});
    await page.evaluate(()=>window.deck.page('setup'));await page.waitForFunction(()=>state.page==='setup');await page.waitForFunction(()=>document.querySelectorAll('#rs-configs .rs-config:has([data-cfg=edit])').length===1);await wait(800);
    // Calibrate does not wait for Debug: opened straight away over the cable, it starts Torque Debug by itself, with nothing pressed.
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');await page.click('#calibrate-view [data-flow=electronics]');
    await soon('Calibrate opens',async()=>await page.locator('#cal-gate').isHidden());await soon('Torque Debug started by Calibrate',async()=>(await app.evaluate(()=>global.__starts||0))>0,20000);
    await page.click('#calibrate-view [data-flow=debug]');await soon('the gate opens',()=>page.locator('#cal-gate').isHidden());
    const send=m=>app.evaluate(({BrowserWindow},x)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('robot-link-debug',x);},m);
    await soon('live debug starts by itself over the cable',async()=>/Stop live debug/.test(await page.textContent('[data-debug-start]')));
    await send({manifest:MAN});await page.waitForSelector('#cal-debug [data-port="motor:leftFront"]');
    // The robot: each motor's power turns its wheel and its encoder counts it, but rightFront's and rightBack's encoder
    // cables are swapped. The left side turning turns the robot right. The claw servo moves nothing anyone reads, and the
    // beam reads LOW while a game piece is in it.
    let leftBackWay=1;/* -1 once leftBack is found to be mounted the other way round: its raw power then turns the robot the other way */const pos=[0,0,0,0],pow=[0,0,0,0],resets=[],motorLines=[],servoLines=[],turnLines=[];let t=0,yaw=0,pitch=0,beam=1,turning=null,turnNext=null;
    (async()=>{while(run){const lines=await app.evaluate(()=>global.__sent.splice(0)).catch(()=>[]);for(const l of lines){const [c,n,v]=l.split('\t');if(c==='M')motorLines.push(l);if(c==='S'||c==='E')servoLines.push(l);const i=MOTORS.indexOf(n);if(c==='M'&&i>=0)pow[i]=+v;if(c==='R'&&i>=0){pos[i===2?3:i===3?2:i]=0;resets.push(n);}if(c==='X'){pow.fill(0);if(turning)turning.stopped=true;}if(c==='U'){turnLines.push(l);turning={job:n,id:+v,n:0,...turnNext};}}
      // IMU turning in Torque Debug: where it is for a few frames, each power done so far, then its result.
      let tt;if(turning){const x=turning,k=++x.n;tt={job:x.job,id:x.id,state:x.stopped?'stopped':x.job==='watch'?'Turn it by hand':k<4?'starting':k<8?'50%: round 1 of 3':'done',h:x.job==='watch'?-Math.min(k*3,45):k*3,p:k<8&&x.job!=='watch'?.3:0,fin:x.stopped||(x.job!=='watch'&&k>=10)?1:0,rows:k<6?[]:x.rows||[],result:k>=10&&!x.stopped?x.result:null};if(tt.fin)turning=null;}
      for(let i=0;i<4;i++){const into=i===2?3:i===3?2:i;pos[into]+=Math.round(pow[i]*40);}yaw-=(pow[0]+leftBackWay*pow[1])*1.5;
      await send({frame:{t:t+=40,loop:6,v:13,m:pos.map((p,i)=>[p,0,pow[i],0,0]),s:[[.5,1]],c:[],d:[beam],touch:[],l:[],a:[],i:[{age:10,v:{yaw,pitch,roll:0,wx:0,wy:0,wz:0}}],on:[1],b:[],...(tt?{tt}:{})}}).catch(()=>{});await wait(40);}})();
    await soon('frames drawn',async()=>/robot clock/.test(await page.textContent('[data-debug-stats]')));

    // Electronics, laid out like Simulate's robot: the chassis, then the configuration's devices as tiles, the picked one on the right.
    await page.click('#cal-tab-electronics');await page.waitForSelector('#cal-links .cal-elec2');
    assert.deepEqual(await page.$$eval('#cal-links [data-elec-pick]',l=>l.map(b=>b.dataset.elecPick)),['@setup','leftFront','leftBack','rightFront','rightBack','claw','beam','imu'],'Setup, then the configuration port by port');
    assert.match(await page.textContent('[data-elec-pick="leftFront"]'),/M0/);assert.match(await page.textContent('[data-elec-pick="claw"]'),/S0/);assert.match(await page.textContent('[data-elec-pick="imu"]'),/I2C 0/);
    assert.ok(!/intake|shooter|turret|flywheel|Pinpoint|USB devices/i.test(await page.textContent('#cal-panel-electronics')),'nothing of the simulated robot, and no USB devices');
    assert.equal(await page.locator('#cal-hub-setup').isVisible(),false,'the hub card that fills Simulate is in Mechanisms');assert.equal(await page.locator('#cal-sensors').isVisible(),false,'so are the floor tests');
    // The chassis first: Simulate's drivetrain, each wheel guessed from the names, and Configure's note that rightBack has no encoder.
    assert.equal(await page.getAttribute('[data-elec-pick="@setup"]','aria-pressed'),'true','Setup comes first');assert.match(await page.textContent('[data-elec-device="@setup"]'),/Ctrl\+Z undoes/);assert.equal(await page.locator('.cal-board-meter').count(),0,'no count bar');
    assert.equal(await page.inputValue('[data-elec-drive]'),'mecanum');
    // Camera is listed under Setup, to do until a lens is measured; its tile opens Calibrate's Camera tab, and Electronics is a press back.
    // The camera is set up in its own tab only: Electronics lists no Camera tile.
    assert.equal(await page.locator('[data-elec-camera]').count(),0,'no Camera tile in Electronics');assert.equal(await page.locator('#cal-tab-camera').isVisible(),true,'Camera is in Calibrate’s row');
    await page.click('#cal-tab-camera');assert.equal(await page.getAttribute('#cal-tab-camera','aria-selected'),'true');assert.equal(await page.locator('#cal-panel-camera').isVisible(),true);assert.equal(await page.getAttribute('#cal-tab-electronics','aria-selected'),'false');
    await page.focus('#cal-tab-camera');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');assert.equal(await page.getAttribute('#cal-tab-electronics','aria-selected'),'true','round to Electronics, past TeleOp, Autonomous and Debug');assert.equal(await page.locator('#cal-links').isVisible(),true);
    assert.deepEqual(await page.$$eval('[data-elec-field=motor]',l=>l.map(s=>s.value)),['leftFront','rightFront','leftBack','rightBack']);
    assert.match(await page.textContent('.cal-elec-slots'),/No encoder/);assert.match(await page.textContent('[data-elec-device="@setup"]'),/That makes 3 links/);
    // The guess goes on the board by itself, as planned links to be checked at the end: nothing to press.
    await soon('three planned lines on the board, with nothing pressed',async()=>await page.locator('#cal-links svg .cal-board-line.planned').count()===3);assert.equal(await page.locator('[data-elec-chassis-use]').isDisabled(),true,'already used');assert.match(await page.textContent('[data-elec-device="@setup"]'),/Torque guessed these from the names/);
    await soon('Simulate has the names',async()=>(await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices.backRight?.name))==='rightBack');
    // Simulate's Encoder tick against Configure: where Simulate says a drive motor reads its encoder and Configure says its cable is out, Electronics says so.
    {const sim=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization),want=sim==='encoders'?['rightBack']:['leftFront','rightFront','leftBack'];
      await soon('Simulate and Configure differ on '+want,async()=>JSON.stringify(await page.$$eval('[data-elec-sim-encoder]',l=>l.map(x=>x.dataset.elecSimEncoder).sort()))===JSON.stringify([...want].sort()));}
    await page.click('[data-elec-zero]');await soon('every encoder zeroed',async()=>resets.length===4);
    const pick=name=>page.click(`[data-elec-pick="${name}"]`),moveIt=async()=>{await page.click('[data-elec-go]');await page.waitForSelector('.cal-seen[data-seen]');};
    const seenRow=key=>page.locator(`[data-seen-key="${key}"]`);
    // leftFront positive at the speed the student picks: its own encoder checks itself off; the IMU's heading is linked with a tap.
    await pick('leftFront');assert.match(await page.textContent('.cal-elec-enc'),/Encoder cable: plugged in, as Configure says/);
    await page.selectOption('[data-elec-set=speed]','60');await page.selectOption('[data-elec-set=secs]','0.3');await moveIt();
    assert.ok(motorLines.includes('M\tleftFront\t0.600'),'the burst at the picked speed');
    assert.match(await seenRow('m:leftFront:pos').innerText(),/counts up.*Matches Configure: its own port.*Linked/s,'its own encoder checks itself off');assert.match(await seenRow('i:imu:yaw').innerText(),/turns right/);
    await seenRow('i:imu:yaw').locator('[data-seen-link]').click();assert.match(await seenRow('i:imu:yaw').innerText(),/Linked/);
    assert.match(await page.textContent('[data-elec-pick="leftFront"]'),/✓ leftFront.*leftFront · encoder, imu · heading/s);
    // Its settings are its own, and kept: leftFront still says 60%.
    await pick('rightFront');assert.equal(await page.inputValue('[data-elec-set=speed]'),'50');await pick('leftFront');assert.equal(await page.inputValue('[data-elec-set=speed]'),'60');
    // rightFront negative: another port's encoder counts, which the configuration does not have on it; its planned link stays planned.
    await pick('rightFront');await page.selectOption('[data-elec-set=dir]','-1');await moveIt();assert.ok(motorLines.includes('M\trightFront\t-0.500'));
    assert.match(await seenRow('m:rightBack:pos').innerText(),/counts down.*Configure has this encoder on rightBack’s port/s);assert.match(await page.textContent('[data-seen]'),/may be swapped/);
    assert.match(await page.textContent('[data-elec-device="rightFront"]'),/Planned/);
    await pick('leftBack');await moveIt();assert.match(await seenRow('m:leftBack:pos').innerText(),/Linked/);
    // rightBack: Configure says no encoder, so it only has to turn.
    await pick('rightBack');assert.match(await page.textContent('.cal-elec-enc'),/not plugged in/);await page.click('[data-elec-spins]');assert.match(await page.textContent('[data-elec-pick="rightBack"]'),/✓ rightBack.*turns · no encoder/s);
    // The claw: a servo is enabled first (it goes to From and holds), then moved; it moves nothing, so it has no sensor.
    await pick('claw');assert.equal(await page.locator('[data-elec-go]').isDisabled(),true,'enable it first');
    await page.check('[data-elec-enable]');await soon('enabled at From',async()=>servoLines.includes('S\tclaw\t0.200'));await moveIt();assert.ok(servoLines.includes('S\tclaw\t0.800'),'moved to To');
    assert.match(await page.textContent('[data-seen]'),/Nothing changed when claw moves toward 1/);await page.click('[data-seen-none]');
    // The beam: nothing turns it; a game piece put in by hand.
    await pick('beam');await page.click('[data-elec-piece]');await page.waitForSelector('[data-elec-ready="1"]');
    beam=0;await page.waitForSelector('[data-seen-key="d:beam"]');assert.match(await seenRow('d:beam').innerText(),/goes LOW/);await seenRow('d:beam').locator('[data-seen-link]').click();beam=1;
    assert.match(await page.textContent('[data-elec-pick="claw"]'),/✓ claw.*no sensor on it/s);assert.match(await page.textContent('[data-elec-pick="beam"]'),/✓ beam.*← a game piece/s);assert.match(await page.textContent('[data-elec-pick="rightFront"]'),/to do/);
    assert.match(await page.textContent('#cal-links .cal-elec-listhead'),/6 of 7 done/);
    await page.click('[data-elec-next]');assert.equal(await page.getAttribute('[data-elec-pick="rightFront"]','aria-pressed'),'true','Next to do');
    // A check can be skipped (it counts as done) and taken back.
    await page.click('[data-elec-skip="on"]');assert.match(await page.textContent('#cal-links .cal-elec-listhead'),/7 of 7 done/);assert.match(await page.textContent('[data-elec-pick="rightFront"]'),/skipped/);
    await page.click('[data-elec-skip="off"]');assert.match(await page.textContent('#cal-links .cal-elec-listhead'),/6 of 7 done/);
    // The IMU: nothing turns it by itself, so the student moves it by hand; every reading before and after.
    await pick('imu');await page.click('[data-elec-hand]');await page.waitForSelector('[data-elec-ready="1"]');pitch=20;
    await page.waitForSelector('[data-hand-row="pitch"]',{timeout:15000});pitch=0;
    assert.match(await page.locator('[data-hand-row="pitch"]').innerText(),/Pitch.0.0°.20.0°.20.0°.Moved/);assert.match(await page.locator('[data-hand-row="yaw"]').innerText(),/Still/);
    assert.match(await page.textContent('[data-elec-pick="imu"]'),/Last time you moved it/);await pick('rightFront');
    // The board is in Setup: a line for each link; tap a cause, then what it moves, to add one; tap again to take it away.
    await pick('@setup');
    const lines=()=>page.locator('#cal-links svg .cal-board-line').count();assert.equal(await lines(),5);assert.equal(await page.locator('#cal-links svg .cal-board-line.pass').count(),4);
    await page.click('[data-board-cause="leftBack"]');await page.click('[data-board-effect="i:imu:yaw"]');assert.equal(await lines(),6);
    // Ctrl+Z undoes it, Ctrl+Shift+Z puts it back, and it is saved each time.
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).calibration.links.length);
    await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+z');await soon('undone',async()=>await lines()===5);assert.equal(await saved(),5);
    await page.keyboard.press('Control+Shift+z');await soon('redone',async()=>await lines()===6);assert.equal(await saved(),6);
    await page.click('[data-board-effect="i:imu:yaw"]');assert.equal(await lines(),5,'tapped again: gone');
    // Esc lets go of what is picked on the board.
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-board-effect]:not([disabled])').count(),0,'Esc lets go');
    // rightFront's encoder is in the wrong port: take its planned line away.
    await page.click('[data-board-cause="rightFront"]');await page.click('[data-board-effect="m:rightFront:pos"]');await page.keyboard.press('Escape');assert.equal(await lines(),4);
    // A link checks again from its device: the beam waits for a game piece.
    const linkOf=text=>page.locator('#cal-links .cal-link',{hasText:text});
    await pick('beam');await linkOf('beam · digital').locator('[data-link-check]').click();await page.waitForSelector('[data-elec-ready="1"]');beam=0;await soon('beam checked',async()=>/Works/.test(await linkOf('beam · digital').locator('.cal-link-head').innerText()));beam=1;
    await pick('leftBack');await linkOf('leftBack · encoder').locator('[data-link-check]').click();await soon('leftBack checked',async()=>/Works/.test(await linkOf('leftBack · encoder').locator('.cal-link-head').innerText()));
    await page.screenshot({path:path.join(root,'test-results/links-ui.png'),fullPage:true}).catch(()=>{});

    // Mechanisms starts with the chassis Simulate describes. Simulate's default senses position with a Pinpoint, which
    // this robot's configuration lacks, and one of its drive motors has no encoder (Electronics saw it turn with nothing
    // counting). What Calibrate knows decides how a kit follows its route, not Debug: it steps down to motors only by
    // itself, so the chassis has its wheels to check straight away, and nothing else.
    await page.click('#cal-tab-mechanisms');await page.waitForSelector('#cal-chassis .cal-chassis',{state:'attached'});
    // The list is Electronics' list: the Control Hub, the chassis' steps, then the mechanisms; one shows at a time.
    await page.click('[data-mech-pick=hub]');assert.equal(await page.locator('#cal-hub-setup').isVisible(),true,'the hub card is here');assert.equal(await page.locator('#cal-chassis').isVisible(),false,'one part at a time');
    await page.click('[data-mech-pick="chassis-1"]');assert.equal(await page.locator('#cal-hub-setup').isVisible(),false);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).sensors.localization),'gyro','no Pinpoint in the configuration and a drive motor with no encoder: motors only');assert.doesNotMatch(await page.textContent('#cal-chassis'),/the hub has nothing by that name/);
    // A mecanum on motors only: nothing Electronics already checked is asked again, and plain motors have nothing to
    // calibrate. Its wheels are checked to roll forward, and it is good to use.
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[data-mech-pick^=chassis]')].map(b=>b.querySelector('b').textContent.replace('✓','').trim())),['All wheels together','IMU tuning','Use it in your code','Drive it']);
    await page.click('[data-mech-pick="chassis-1"]');
    // Each motor by itself is Electronics' check: until every wheel's motor has been moved there and said to roll forward or backwards, nothing moves here.
    assert.match(await page.textContent('[data-chassis-step="1"]'),/Not checked yet: Front left \(leftFront\), Front right \(rightFront\), Back left \(leftBack\), Back right \(rightBack\)/);assert.equal(await page.locator('[data-chassis=move-go]').count(),0);
    await page.click('[data-chassis-step="1"] [data-chassis=to-elec]');await page.waitForSelector('#cal-links .cal-elec2',{state:'visible'});
    // Left unset, a left-side drive motor of a mecanum counts as reversed (the SDK default the generated code uses). Electronics moves the motor as it is and takes the answer as seen.
    const way=async(name,answer)=>{await pick(name);await moveIt();await page.waitForSelector('[data-elec-dir-ask]');assert.match(await page.textContent('[data-elec-dir-ask]'),/Did the wheel roll forward\?/);await page.click(`[data-elec-dir=${answer}]`);await page.waitForSelector('[data-elec-dir-kept]');};
    await way('leftFront','yes');await way('rightFront','yes');await way('leftBack','no');leftBackWay=-1;assert.match(await page.textContent('[data-elec-dir-kept]'),/Torque turns it the other way now/);
    // Move it again checks the answer: the reversed motor is turned the other way, and now it goes forward.
    motorLines.length=0;await way('leftBack','yes');assert.ok(motorLines.some(l=>/^M\tleftBack\t-0/.test(l))&&!motorLines.some(l=>/^M\tleftBack\t0\.[1-9]/.test(l)),'moved the reversed way');assert.match(await page.textContent('[data-elec-dir-kept]'),/Reversed/,'still reversed after it is seen going forward');
    assert.ok(await page.evaluate(()=>{const a=document.querySelector('[data-elec-dir-kept]'),b=document.querySelector('#cal-links h4.cal-group-title');return !!a;}));await way('rightBack','yes');
    assert.match(await page.textContent('[data-elec-dir-kept]'),/Forward/);assert.match(await page.textContent('[data-elec-pick="leftBack"]'),/reversed/);assert.match(await page.textContent('[data-elec-pick="leftFront"]'),/forward/);
    {const d=await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('deck-simulation-project-v2'));return {dev:p.robot.devices,pods:p.calibration.chassis.pods};});
      assert.equal(d.dev.backLeft.reversed,true,'rolled backwards on positive power: reversed in Setup');assert.equal(d.dev.frontLeft.reversed,false);assert.deepEqual(Object.keys(d.pods).sort(),['backLeft','backRight','frontLeft','frontRight']);assert.ok(Object.values(d.pods).every(x=>x.drive===true),'Mechanisms takes each wheel as checked');}
    // Mechanisms: the chassis as one. All the wheels are driven four ways and the student says whether each did what is written.
    await page.click('#cal-tab-mechanisms');await page.click('[data-mech-pick="chassis-1"]');await page.waitForSelector('[data-chassis=move-go]');
    assert.deepEqual(await page.$$eval('[data-move-check] > b',l=>l.map(b=>b.textContent.trim())),['Drive forward','Drive backward','Slide left','Slide right']);assert.match(await page.textContent('[data-move-check=forward]'),/Every wheel rolls forward/);assert.match(await page.textContent('[data-move-check=left]'),/Front left leftFront rolls backward/);
    const drive=async(id,answer)=>{motorLines.length=0;await page.click(`[data-chassis=move-go][data-move=${id}]`);await page.waitForSelector(`[data-chassis=move-${answer}][data-move=${id}]`,{timeout:8000});await page.click(`[data-chassis=move-${answer}][data-move=${id}]`);};
    await drive('forward','yes');assert.ok(motorLines.some(l=>/^M\tleftBack\t-0\.30$/.test(l))&&motorLines.some(l=>/^M\tleftFront\t0\.30$/.test(l)),'every wheel at a third of its power, a reversed motor the other way');
    await drive('back','yes');await drive('left','no');assert.match(await page.textContent('[data-chassis-step="1"]'),/check that motor again in Electronics/);assert.equal(await page.locator('[data-chassis-step="1"]').getAttribute('data-state'),'todo','not done until all four are seen');
    await drive('left','yes');assert.ok(motorLines.some(l=>/^M\tleftFront\t-0\.30$/.test(l))&&motorLines.some(l=>/^M\trightBack\t-0\.30$/.test(l)),'sliding left: front left and back right backward');await drive('right','yes');
    await soon('the wheels are checked together',async()=>/✓/.test(await page.textContent('[data-mech-pick="chassis-1"]')));
    // IMU tuning, required, after the wheels: it runs in Torque Debug, the live readings already running, so nothing is sent to the robot. The robot in this
    // test reports what a real one would: 50% and 55% land, 60% swings past; then the aggressive one: 75% and 80% land, 85% and 90% do not.
    assert.doesNotMatch(await page.textContent('#cal-chassis .cal-chassis>.cal-hub-head'),/Good to use|Calibrated/,'not good to use until the IMU is tuned');
    await page.click('[data-mech-pick="chassis-2"]');assert.match(await page.textContent('[data-chassis-step="2"]'),/Required\..*nothing is sent to the robot.*Not tuned yet\./s);assert.equal(await page.locator('[data-chassis=tune-aggressive]').count(),0,'one tuning, 50% to 100%');
    // The heading live, and a short drive to watch it follow: every wheel for about a second, no ask.
    await soon('the heading shows',async()=>/-?\d+\.\d/.test(await page.textContent('[data-chassis-heading]')));
    motorLines.length=0;await page.click('[data-chassis=nudge][data-nudge=left]');await soon('every wheel driven at a quarter power',async()=>MOTORS.every(n=>motorLines.some(l=>l.startsWith(`M\t${n}\t`)&&Math.abs(+l.split('\t')[2])===.25)),5000).catch(e=>{throw Error(e.message+': '+motorLines.join(' | '));});await soon('and stopped',async()=>motorLines.some(l=>/^M\tleftFront\t0\.00$/.test(l)));
    const rnd=(power,seconds,ok,worst=1.1,over=2)=>({power,rate:200,coast:12,slowFrom:80,brake:.0017,worst,over,seconds,ok});
    const tuned=(mode,backwards,rounds)=>{turnNext={rows:rounds.map(r=>`${Math.round(r.power*100)}% ${r.ok?'good':'no'}`),result:JSON.stringify({v:2,mode,backwards,least:.07,tolerance:3,repeats:3,readMs:7.2,problem:'',rounds})};};
    tuned('standard',true,[rnd(.5,2.2,true),rnd(.55,1.9,true),rnd(.6,1.8,false,4.2,14)]);
    await soon('the nudge is over',async()=>!(await page.isDisabled('[data-chassis=tune-tune]')));
    const devsBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices);
    // First the robot is turned left by hand: this IMU counts that as a turn to the right, so it is turned round. Enter starts the tuning.
    await page.selectOption('[data-chassis-turn-want]','3');await page.click('[data-chassis=tune-tune]');
    await soon('it asks for a turn by hand',async()=>/First, turn the robot by hand/.test(await page.textContent('[data-chassis-step="2"]')));
    await soon('the hand line went',async()=>turnLines.length>=1);
    assert.match(turnLines[0],/^U\twatch\t.*\timu:imu\tL:UP:FORWARD\t1\t/,'the heading alone, nothing moves: '+turnLines[0]);
    await soon('it was turned',async()=>+(await page.textContent('[data-chassis-handturn]'))<=-20);await page.keyboard.press('Enter');
    await soon('it says where it is',async()=>/50%: round 1 of 3/.test(await page.textContent('[data-chassis-step="2"]')));
    await soon('the standard tuning finishes and shows what it found',async()=>/Tuning: 55% is the quickest power that landed within ±3° every time/.test(await page.textContent('[data-chassis-step="2"]')),20000);
    assert.equal(turnLines.length,2);assert.match(turnLines[1],/^U\ttune\t\d+\t3\t[^\t]+\t[^\t]+\t[^\t]+\t[^\t]+\t[^\t]+\timu:imu\tL:UP:FORWARD\t-1\tleftFront\t-?1\trightFront\t-?1\tleftBack\t-?1\trightBack\t-?1$/,'one line to Torque Debug, by the heading turned round: '+turnLines[1]);
    assert.equal(await app.evaluate(()=>Object.keys(global.__files||{}).filter(f=>/Imu|Tune/i.test(f)).length),0,'nothing sent to the robot');
    {const p=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2'))),t=p.calibration.chassis.turnTune;assert.equal(t.standard.top,.55);assert.equal(t.standard.done,3);assert.equal(t.standard.rounds.length,3);assert.equal(!!t.backwards,false);assert.equal(p.robot.odometry?.imu?.reversed,true,'the IMU, turned round by the hand turn');
      // It found a turn to the left counted backwards, after the IMU was known right: the motors are on the wrong sides, and are swapped.
      assert.equal(p.robot.devices.frontLeft.name,devsBefore.frontRight.name,'the left and right motors swapped');assert.match(await page.textContent('[data-chassis-step="2"]'),/Asked to turn left, it turned right/);}
    assert.equal(await page.locator('[data-chassis-step="2"] [data-imu-best]').count(),1);
    // Then the check: four quarter turns by what it found, and the student says whether it lands.
    assert.doesNotMatch(await page.textContent('#cal-chassis .cal-chassis>.cal-hub-head'),/Good to use|Calibrated/,'not good to use until it is checked');
    turnNext={rows:['Left 90°: 0.8° off','Back to 0°: 0.5° off','Right 90°: 1.1° off','Back to 0°: 0.4° off'],result:JSON.stringify({v:2,check:true,tolerance:3,readMs:7,turns:[]})};await page.click('[data-chassis=tune-check]');
    await soon('it asks whether it landed',async()=>/Did it turn left first/.test(await page.textContent('[data-chassis-step="2"]')),20000);
    assert.match(turnLines[2],/^U\tcheck\t\d+\t3\t0\.55\t0\.07\t80\t0\.0017\t[^\t]+\timu:imu\tL:UP:FORWARD\t-1\t/,'turned by what was found, the heading the other way round: '+turnLines[2]);
    assert.match(await page.textContent('[data-chassis-step="2"]'),/Right 90°: 1\.1° off/);await page.click('[data-chassis=check-yes]');
    await soon('good to use once the IMU is tuned and checked',async()=>/Calibrated|Good to use/.test(await page.textContent('#cal-chassis .cal-chassis>.cal-hub-head')));
    // It turned right first: the left and right motors were swapped in Setup and the tuning took the heading to count backwards. Torque puts
    // each motor on its own side and turns the heading back round, and asks for the check again.
    turnNext={rows:['Left 90°: 1.2° off'],result:JSON.stringify({v:2,check:true,tolerance:3,turns:[]})};await page.click('[data-chassis=tune-check]');
    await soon('asked again',async()=>/Did it turn left first/.test(await page.textContent('[data-chassis-step="2"]')),20000);
    {const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices);await page.click('[data-chassis=check-mirror]');
      await soon('the motors are swapped',async()=>{const d=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices);return d.frontLeft.name===before.frontRight.name&&d.frontRight.name===before.frontLeft.name&&d.backLeft.name===before.backRight.name&&d.frontLeft.reversed===!!before.frontRight.reversed;}).catch(async e=>{throw Error(e.message+' '+JSON.stringify(before)+' -> '+JSON.stringify(await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.devices))+' | '+await page.textContent('[data-chassis-step="2"]'));});
      assert.equal(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('deck-simulation-project-v2')).robot.odometry?.imu?.reversed),false,'the heading turned back round');
      assert.match(await page.textContent('[data-chassis-step="2"]'),/left and right drive motors were swapped/);}
    turnNext={rows:['Left 90°: 0.9° off'],result:JSON.stringify({v:2,check:true,tolerance:3,turns:[]})};await page.click('[data-chassis=tune-check]');
    await soon('asked once more',async()=>/Did it turn left first/.test(await page.textContent('[data-chassis-step="2"]')),20000);assert.match(turnLines.at(-1),/\timu:imu\tL:UP:FORWARD\t1\t/,'by the heading as it is now');await page.click('[data-chassis=check-yes]');
    await soon('calibrated once the IMU is tuned too',async()=>/Calibrated/.test(await page.textContent('#cal-chassis .cal-chassis>.cal-hub-head')));
    await page.locator('[data-chassis-step="2"]').screenshot({path:path.join(root,'test-results/imu-tuning-ui.png')}).catch(()=>{});
    await page.click('[data-mech-pick="chassis-code"]');assert.match(await page.textContent('[data-chassis-code]'),/LEFT_FRONT_REVERSED = (true|false);\n/);
    assert.equal(await page.locator('[data-cal-mech-row="drive"]').count(),0,'the chassis is not listed again below');
    await page.screenshot({path:path.join(root,'test-results/chassis-ui.png'),fullPage:true}).catch(()=>{});

    // Simulate unfinished (no path planned): Calibrate still opens and Electronics still works; only Mechanisms waits.
    await page.evaluate(()=>document.querySelector('#sim-clear-pins').click());
    await page.evaluate(()=>window.deck.page('simulation'));await page.waitForFunction(()=>state.page==='simulation');await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');
    for(const f of ['electronics','tune'])assert.equal(await page.getAttribute(`#calibrate-view [data-flow=${f}]`,'data-locked'),null,`Calibrate's ${f} step is not locked by Simulate`);
    // Mechanisms waits only for Simulate's Setup to have nothing in red: no path is needed, so this robot gets straight in.
    await page.click('#cal-tab-mechanisms');await page.waitForSelector('#cal-mech-rail [data-mech-pick=hub]',{state:'visible'});assert.equal(await page.locator('#cal-mech-sim').isVisible(),false,'nothing to finish in Simulate');await page.click('[data-mech-pick=hub]');assert.equal(await page.locator('#cal-hub-card').isVisible(),true);
    // Something in red there, and Mechanisms says only that.
    await page.evaluate(()=>{const box=document.querySelector('#cal-mech-sim');box.hidden=false;});assert.match(await page.textContent('#cal-mech-sim'),/^Finish Setup/);
    await page.click('#cal-tab-electronics');assert.equal(await page.locator('#cal-gate').isVisible(),false);await pick('leftBack');await moveIt();assert.match(await seenRow('m:leftBack:pos').innerText(),/Linked/,'Electronics works with Simulate unfinished');

    // Kept with the setup: saved, and back after a reload.
    const cal=await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).calibration);
    assert.equal(cal.links.length,4);assert.ok(cal.links.some(l=>l.causes[0].kind==='piece'&&l.effect.key==='d:beam'&&l.effect.dir===-1));assert.deepEqual(cal.electronics.none,['claw']);assert.ok(cal.electronics.zeroedAt);assert.ok(cal.chassis.pods.frontLeft.drive&&cal.chassis.pods.backLeft.drive);
    run=false;await wait(200);await page.reload();await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).calibration.links)).length,4,'kept across a reload');
    assert.deepEqual(errors,[]);
    console.log('links-ui: ok');
  }finally{run=false;await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exit(1);});
