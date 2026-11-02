'use strict';
// Calibrate → USB devices, the checks and lens measurement in Calibrate → Camera, a Limelight, and Configure's Add for it, in the real app.
// The hub is stubbed: hubUsb's devices are fed to instances of the tabs made here, on the real page with its real styles, and the app's own instances are used where no hub is needed.
//  A. no hub: the USB tab says so, and the simulated webcam's lens is measured and kept with the project;
//  B. the USB tab: the real camera's rows, a device on each port, a splitter, what is not allowed, drops, and a redraw that keeps what is open;
//  C. Camera: the real camera's checks, its gain control gone, the wording for known, wrong-shape and unknown lenses, and reads that fail or have not answered;
//  D. the lens measured on a live camera: the numbers go to Torque Debug, and the sanity checks store nothing;
//  E. a Limelight: its status in place of the picture, its calibration, its steps, and Add writing its XML; a network device that is not one gets no Add.
// DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/usb-devices-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.DECK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/usb-devices');fs.mkdirSync(out,{recursive:true});
const HEX=fs.readFileSync(path.join(__dirname,'fixtures/uvc-a108-2240.hex'),'utf8');
const {parseUsb}=require('../src/hub-usb.cjs');
// The real answer of FTC-zWL4, with a generic webcam in the blue port.
const REAL=parseUsb(`1-1|a108|2240|ef|0090|480|1|2|HHYL|UVC Camera|Ucamera001|200mA|c0|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,03/00/00/usbhid,01/01/00/snd-usb-audio,01/02/00/snd-usb-audio,
3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,
3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,
usb1|1d6b|0002|09|0310|480|1|1|Linux 3.10.245 xhci-hcd|xHCI Host Controller|xhci-hcd.0.auto|0mA|e0|1|`);
const line=(p,id,more='')=>`${p}|${id.replace(':','|')}|${more||'00|0100|480|1|5|Maker|Product||100mA|80|0|'}`;
const XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<Robot type="FirstInspires-FTC">\n    <LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">\n        <LynxModule name="Control Hub" port="173">\n            <goBILDA5202SeriesMotor name="left" port="0" />\n        </LynxModule>\n    </LynxUsbDevice>\n</Robot>\n`;
const NET=parseUsb(`1-1|1d6b|0104|00|0100|480|1|5|Some|Gadget||100mA|80|0|02/06/00/cdc_ether/eth0,0a/00/00/cdc_ether,`);
const LIME={iface:'eth0',hubAddress:'172.29.0.23',address:'172.29.0.1',scanKey:'EthernetOverUsb:eth0:172.29.0.23',status:{name:'limelight-front',temp:48.5,cpu:31,ram:40,fps:90,pipelineIndex:2,hwType:'unknown-model'}};

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'deck-usb-devices-')),env={...process.env,DECK_HEADLESS:'1',DECK_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:process.env.DECK_ELECTRON,args:[root],env});
  try{
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof state==='object'&&!!hardware.model);await page.setViewportSize({width:1280,height:800});
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
    await app.evaluate(({ipcMain},{hex,lime})=>{const g=global;g.__s={hex,lime,on:true,calls:[]};ipcMain.removeHandler('robot-link');ipcMain.handle('robot-link',async(e,action,data)=>{const s=g.__s,ok=value=>({ok:true,value});s.calls.push([action,data]);
      if(action==='detect')return ok({usb:{found:false},wifi:{robot:false}});if(action==='usb-status')return ok({found:false});if(action==='usb-recover')return ok(null);
      if(['hub-usb-camera','hub-usb-drops','limelight'].includes(action)&&!s.on)return {ok:false,error:'not in this test: '+action};
      if(action==='hub-usb-camera')return ok({hex:s.hex});if(action==='hub-usb-drops')return ok(s.drops||[]);
      if(action==='limelight'){if(!data?.path)return ok(s.lime);if(data.path==='/cal-file')return ok({ok:true,status:200,json:{fx:800}});if(data.path==='/cal-default')return ok({ok:true,status:200,json:{fx:500}});if(data.path==='/cal-stats')return ok({ok:true,status:200,json:{reprojectionError:.52}});return ok({ok:false,status:404,json:null});}
      return {ok:false,error:'not in this test: '+action};});},{hex:HEX,lime:LIME});
    const calls=name=>app.evaluate(({},name)=>global.__s.calls.filter(c=>c[0]===name).length,name);
    const text=s=>page.locator(s).first().innerText(),gone=async s=>assert.equal(await page.locator(s).count(),0,s),fits=async what=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${what} fits 1280 wide`);
    await page.evaluate(()=>window.deck.page('calibrate'));await page.waitForFunction(()=>state.page==='calibrate');

    // A. No hub. The app's own instances.
    await page.click('#cal-tab-usb');assert.equal(await page.locator('#cal-usb h2').innerText(),'USB devices');assert.match(await text('#cal-usb'),/No Control Hub connected/);await gone('#cal-usb button');
    await page.click('#cal-tab-camera');assert.doesNotMatch(await text('#cal-camera'),/next scan/,'no scan to wait for');assert.equal(await page.locator('#cam-gain').isVisible(),true,'the simulated webcam keeps its gain');assert.match(await text('[data-cam-checks]'),/no USB port to check/);
    const distance=page.locator('#cam-lens-distance'),saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('deck-simulation-project-v2')).calibration?.lens?.sim?.['640x480']||null);
    assert.equal(await distance.getAttribute('data-slider'),'off','typed, not a slider');assert.equal(await page.locator('#cam-lens-distance + .num-slider,#cam-lens-distance ~ input[type=range]').count(),0);assert.match(await text('[data-cam-lens]'),/single-point estimate.*centre of the lens.*3DF Zephyr or OpenCV/s);
    assert.match(await text('[data-cam-lens-note]'),/48 inches away/);
    await page.click('[data-cam-lens-go]');assert.match(await text('[data-cam-lens-result]'),/Type the distance/);assert.equal(await saved(),null);
    await distance.fill('500');await page.click('[data-cam-lens-go]');assert.match(await text('[data-cam-lens-note]'),/Hold the tag still/);await page.waitForSelector('[data-cam-lens-result] [role=alert]');assert.match(await text('[data-cam-lens-result]'),/too far apart.*Nothing was stored/s);assert.equal(await saved(),null,'a wild ratio stores nothing');
    await distance.fill('48');await page.click('[data-cam-lens-go]');await page.waitForSelector('[data-cam-lens-line]');
    const first=await saved();assert.ok(Math.abs(first.fx-822)<2,`the simulated lens is 822: ${first.fx}`);assert.equal(first.fy,first.fx);assert.equal(first.cx,320);assert.equal(first.cy,240);assert.equal(first.measured,48);assert.match(await text('[data-cam-lens-line]'),new RegExp(`^\\.setLensIntrinsics\\(${first.fx}, ${first.fx}, 320, 240\\)$`));assert.match(await text('[data-cam-lens-result]'),/simulated webcam uses these numbers now/);
    // Measured again through the new numbers, it reads the true distance.
    await page.click('[data-cam-lens-go]');await page.waitForFunction(()=>/the camera said 4[78]\.\d in/.test(document.querySelector('[data-cam-lens-result]').textContent));assert.ok(Math.abs((await saved()).fx-822)<4);
    await page.click('[data-cam-lens-copy]');await page.waitForFunction(()=>/Copied/.test(document.querySelector('[data-cam-lens-copy]').textContent));
    await page.click('[data-cam-lens-forget]');await page.waitForFunction(()=>!document.querySelector('[data-cam-lens-line]'));assert.equal(await saved(),null);assert.equal(await page.locator('[data-cam-lens-forget]').isVisible(),false);

    // The tabs again, with a hub to read. The app's own go off the page, so only these run.
    await page.evaluate(({xml})=>{const K=window.DeckUsbKinds;
      window.__t={hub:null,lens:{},debugSent:[],toCamera:[],toConfigure:[],saved:[],limes:[],set(devices,context,others=[]){this.hub=Object.assign([...others],{devices:K.classifyAll(devices,context)});}};
      const L=new Set();let running=false,manifest=null;const t=window.__t;
      t.debug={running:()=>running,latest:()=>({manifest,frame:null}),state:()=>({running,starting:false,text:running?'Live':'Not connected',kind:''}),send:l=>{t.debugSent.push(l);return true;},listen:f=>{L.add(f);return ()=>L.delete(f);},onCamera(){},start(){running=true;manifest={cameras:['Webcam 1']};},stop(){running=false;},offerInstall(){},emit:cam=>{for(const f of [...L])f({cam},{});}};
      const usb=document.querySelector('#cal-usb'),usbBox=usb.cloneNode(false),cam=document.querySelector('#cal-camera'),camBox=cam.cloneNode(false);usb.replaceWith(usbBox);cam.replaceWith(camBox);
      t.usb=window.DeckUsbDevices.create({host:usbBox,api:window.deck,native:true,usb:()=>t.hub,toCamera:s=>t.toCamera.push(s)});
      t.camera=window.DeckCamera.create({host:camBox,api:window.deck,native:true,debug:t.debug,configured:()=>t.configured||[],plugged:()=>t.hub,active:()=>'robot',toConfigure:s=>t.toConfigure.push(s),limelights:()=>t.limes,lens:{all:()=>t.lens,save:l=>{t.lens=l;}}});
    },{xml:XML});
    const setHub=(devices,context,others)=>page.evaluate(([d,c,o])=>{window.__t.set(d,c||{},o||[]);window.__t.camera.refresh();window.__t.usb.refresh();},[devices,context||null,others||null]);

    // B. The USB tab.
    await page.click('#cal-tab-usb');await page.waitForFunction(()=>/No Control Hub/.test(document.querySelector('#cal-usb').textContent));
    await page.evaluate(()=>{window.__t.hub=[];window.__t.usb.refresh();});await page.waitForFunction(()=>/has not read the Control Hub/.test(document.querySelector('#cal-usb').textContent));
    await setHub(REAL);await page.waitForSelector('[data-usb-elsewhere="Ucamera001"]');
    const blue=page.locator('[data-usb-port=usb3]'),two=page.locator('[data-usb-port=usb2]');assert.equal(await blue.locator('h3').textContent(),'Blue USB 3.0 port');assert.match(await blue.innerText(),/UVC Camera is in the Camera tab/);await gone('.usb-card');assert.match(await two.innerText(),/Nothing plugged in/);assert.doesNotMatch(await text('#cal-usb'),/802\.11ac|USB2\.0 Hub|xHCI/);
    await page.screenshot({path:path.join(out,'usb-real.png')});
    await page.click('[data-usb-to-camera="Ucamera001"]');assert.deepEqual(await page.evaluate(()=>window.__t.toCamera),['Ucamera001'],'the button goes to that camera');
    const mixed=parseUsb([`1-1|1a40|0101|09|0100|480|1|2||USB 2.0 Hub||100mA|e0|4|09/00/00/hub,`,`1-1.1|2341|0043|02|0100|12|1|3|Arduino|Uno||100mA|80|0|02/02/01/cdc_acm,`,`1-1.2|046d|0825|ef|0010|480|1|4||C270||500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`,`3-1.4|10c4|ea60|00|0100|12|3|5|Silicon Labs|CP2102||100mA|80|0|ff/00/00/,`,`3-1|05e3|0608|09|8538|480|3|2||USB2.0 Hub||100mA|e0|4|09/00/00/hub,`,`3-1.1|0bda|c820|ef|0200|480|3|3|Realtek|802.11ac NIC|123456|500mA|a0|0|e0/01/01/rtk_btusb,ff/ff/ff/rtl8821cu,`].join('\n'));
    await app.evaluate(()=>{global.__s.drops=[{at:1,path:'1-1.1',kind:'disconnect',wifi:false},{at:2,path:'1-1.1',kind:'disconnect',wifi:false},{at:3,path:'3-1.1',kind:'disconnect',wifi:true}];});
    await setHub(mixed);await page.waitForSelector('[data-usb-device="1-1.1"]');await page.waitForFunction(()=>/Came unplugged 2 times since the hub started/.test(document.querySelector('[data-usb-device="1-1.1"]').textContent),null,{timeout:40000});
    assert.match(await text('[data-usb-wifi]'),/dropped off USB 1 time since the hub started\. That may mean a static shock\./);
    const splitter=page.locator('[data-usb-device="1-1"]');assert.match(await splitter.locator('.rs-pill').first().innerText(),/^Allowed: R707B, R611$/);assert.match(await splitter.locator('.usb-behind').innerText(),/Arduino[\s\S]*C270 is in the Camera tab/);assert.match(await splitter.innerText(),/2 of its 4 ports in use/);
    const arduino=page.locator('[data-usb-device="1-1.1"]');assert.equal(await arduino.locator('.rs-pill').innerText(),'Not on the manual’s USB list: R707');assert.match(await arduino.innerText(),/The manual’s R707 list of what may connect by USB does not include it/);assert.doesNotMatch(await arduino.innerText(),/before inspection/);
    const serial=page.locator('[data-usb-device="3-1.4"]');assert.equal(await two.locator('[data-usb-device="3-1.4"]').count(),1);assert.match(await serial.innerText(),/Move this to the blue USB 3\.0 port\. A static shock on the USB 2\.0 port can knock out the robot's Wi-Fi\./);assert.match(await serial.locator('.rs-pill').innerText(),/^Not on the manual’s USB list: R707, R702 Example 5$/);assert.match(await serial.innerText(),/connect it by I2C/);
    assert.equal(await serial.locator('details').first().getAttribute('open'),null,'the technical facts start closed');assert.equal(await serial.locator('details dd').first().isVisible(),false);assert.doesNotMatch(await serial.innerText(),/10c4:ea60/);await serial.locator('summary').first().click();assert.match(await serial.locator('details').first().innerText(),/10c4:ea60/);
    // A redraw keeps what was opened, and the page fits.
    await setHub([...mixed,...parseUsb(`1-1.3|2341|0043|02|0100|12|1|6|Arduino|Uno||100mA|80|0|`)]);await page.waitForSelector('[data-usb-device="1-1.3"]');assert.equal(await page.locator('[data-usb-facts="3-1.4"]').getAttribute('open'),'','still open');await setHub(mixed);
    await fits('USB devices');await page.screenshot({path:path.join(out,'usb-mixed.png'),fullPage:true});

    // C. Camera, with the actions not wired yet: a check says not available, and nothing breaks.
    await page.click('#cal-tab-camera');await app.evaluate(()=>{global.__s.on=false;});await setHub(REAL);
    await page.waitForFunction(()=>/Ucamera001/.test(document.querySelector('#cam-source').textContent));assert.match(await page.locator('#cam-source').innerText(),/Webcam · Ucamera001 \(not in this configuration\)/);await page.waitForSelector('[data-cam-checks] [data-check=PORT]');
    await page.waitForFunction(()=>/could not read/.test(document.querySelector('[data-check=MODES]').textContent));assert.match(await text('[data-check=PORT]'),/On the blue USB 3\.0 port/);assert.match(await text('[data-check=CTRL]'),/could not read/);assert.equal(await page.locator('#cam-gain').count(),1,'with nothing read, nothing is hidden on its word');
    // The real camera's descriptors, from a fresh start.
    await app.evaluate(()=>{global.__s.on=true;});await page.evaluate(()=>{window.__t.camera.stop();});
    await page.evaluate(()=>{const t=window.__t,old=document.querySelector('#cal-camera'),box=old.cloneNode(false);old.replaceWith(box);t.camera=window.DeckCamera.create({host:box,api:window.deck,native:true,debug:t.debug,configured:()=>t.configured||[],plugged:()=>t.hub,active:()=>'robot',toConfigure:s=>t.toConfigure.push(s),limelights:()=>t.limes,lens:{all:()=>t.lens,save:l=>{t.lens=l;}}});});
    await page.waitForFunction(()=>/This camera has no gain control/.test(document.querySelector('#cal-camera').textContent));
    await gone('#cam-gain');assert.equal(await page.locator('#cam-exposure').count(),1,'it does list exposure');const camText=await text('#cal-camera');assert.equal((camText.match(/This camera has no gain control/g)||[]).length,1,'said once');assert.equal((camText.match(/Only the video stream may be used \(R708\)/g)||[]).length,1,'the rule, once');
    assert.match(camText,/no white balance control/);assert.match(camText,/Listing a control does not prove it works/);assert.match(await text('[data-check=MODES]'),/1920x1080, 1280x720 and 800x600 in MJPEG only/);assert.match(camText,/\.setStreamFormat\(VisionPortal\.StreamFormat\.MJPEG\)/);assert.match(await text('[data-check=SERIAL]'),/Serial number Ucamera001/);assert.match(await text('[data-check=SPEED]'),/480 Mb\/s/);assert.match(await text('[data-check=LENS]'),/Distance will be wrong until the lens is measured\..*fx=578\.272/);assert.match(await page.locator('[data-cam-checks] .rs-pill').innerText(),/^Allowed if it has one lens: R707A, R708A$/);
    assert.equal(await page.locator('[data-cam-lens]').isVisible(),true,'a lens with no data can be measured');assert.match(await text('[data-cam-lens-note]'),/Add this camera in Configure first/);assert.equal(await page.locator('[data-cam-lens-go]').isDisabled(),true);
    await fits('Camera');await page.locator('#cal-camera').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'camera-real.png'),fullPage:true});
    // A size picked is what the lens line talks about.
    await page.selectOption('#cam-check-size','1280x720');assert.match(await text('[data-check=LENS]'),/Distance will be wrong until the lens is measured/);
    // A camera FTC knows, at another shape (the size stays picked) and at its own size.
    const c270=parseUsb(`1-1|046d|0825|ef|0010|480|1|4|Logitech|C270|ABC|500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`);await setHub(c270);await page.waitForFunction(()=>/ABC/.test(document.querySelector('#cam-source').textContent)&&/pick one of these sizes: 640x480/.test(document.querySelector('[data-check=LENS]')?.textContent||''));
    await page.selectOption('#cam-check-size','640x480');await page.waitForFunction(()=>/FTC has lens data for this model at 640x480 \(Logitech C270\)/.test(document.querySelector('[data-check=LENS]').textContent));assert.match(await text('[data-check=LENS]'),/USB ID names its USB chip, not your exact lens/);assert.equal(await page.locator('[data-cam-lens]').isVisible(),false,'FTC has its lens: nothing to measure');
    await page.selectOption('#cam-check-size','1280x720');assert.match(await text('[data-check=LENS]'),/pick one of these sizes: 640x480/);await page.selectOption('#cam-check-size','640x480');
    // A depth camera Scan offers is not a camera to pick.
    const depth=parseUsb(`1-1|8086|0b07|ef|0010|5000|2|4|Intel|D435|RS1|500mA|80|0|0e/01/00/uvcvideo,0e/02/00/uvcvideo,`);await setHub(depth,{},[{serial:'RS1',type:'WEBCAM'}]);await page.waitForFunction(()=>!/RS1/.test(document.querySelector('#cam-source').textContent));assert.equal(await page.locator('#cam-source').innerText(),'Simulated webcam');

    // D. On a live camera. Torque Debug has the real camera open.
    await page.evaluate(()=>{window.__t.configured=[{name:'Webcam 1',serial:'Ucamera001'}];window.__t.debugSent.length=0;});await setHub(REAL);await page.waitForFunction(()=>/Webcam 1/.test(document.querySelector('#cam-source').textContent));
    assert.match(await text('[data-cam-lens-note]'),/Start live debug first/);await gone('#cam-gain');
    await page.evaluate(()=>{window.__t.debug.start();window.__t.camera.refresh();});await page.waitForFunction(()=>/Waiting for the camera to stream/.test(document.querySelector('[data-cam-lens-note]').textContent));
    const feed=async(cam,ms=3700)=>{for(const end=Date.now()+ms;Date.now()<end;){await page.evaluate(c=>window.__t.debug.emit(c),typeof cam==='function'?cam():cam);await page.waitForTimeout(90);}};
    const live=(tags,more={})=>({state:'STREAMING',fps:30,range:[1,100,0,0],exp:null,gain:null,dec:3,lens:null,tags,...more});let n=0;const tag=(r=21,more={})=>({id:584,m:50,r:r+(n++%2?.04:-.04),b:1,y:2,p:1,...more});
    await page.evaluate(c=>window.__t.debug.emit(c),live([]));await page.waitForFunction(()=>!document.querySelector('[data-cam-lens-go]').disabled);
    // A camera with no gain tunes with no gain line.
    await page.click('[data-cam-tune]');await feed(()=>live([tag()]),3000);await page.waitForFunction(()=>/Best: exposure 1 ms, decimation 3/.test(document.querySelector('[data-cam-result]').textContent));assert.doesNotMatch(await text('[data-cam-result]'),/gain|GainControl/i);assert.ok((await page.evaluate(()=>window.__t.debugSent)).includes('V\t1\t0'));
    await page.fill('#cam-lens-distance','30');await page.click('[data-cam-lens-go]');await feed(()=>live([tag(21,{y:40})]));await page.waitForFunction(()=>/about 40° off square/.test(document.querySelector('[data-cam-lens-result]').textContent));assert.deepEqual(await page.evaluate(()=>window.__t.lens),{},'not square-on: nothing stored');
    await page.click('[data-cam-lens-go]');await feed(()=>live([tag(),tag()]));await page.waitForFunction(()=>/More than one tag/.test(document.querySelector('[data-cam-lens-result]').textContent));
    await page.click('[data-cam-lens-go]');await feed(()=>live([tag()]));await page.waitForSelector('[data-cam-lens-line]');
    const kept=await page.evaluate(()=>window.__t.lens.Ucamera001['640x480']),want=578.272*30/21;assert.ok(Math.abs(kept.fx-want)<1,`fx ${kept.fx} against ${want}`);assert.equal(kept.cx,320);assert.equal(kept.cy,240);
    assert.match(await text('[data-cam-lens-result]'),/Sending these numbers to Torque Debug/);await page.evaluate(c=>window.__t.debug.emit(c),live([tag()]));const line=`K\t${kept.fx}\t${kept.fy}\t320\t240`;assert.ok((await page.evaluate(()=>window.__t.debugSent)).includes(line),'Torque Debug gets them');assert.equal((await page.evaluate(()=>window.__t.debugSent)).filter(l=>l.startsWith('K\t')).length,1,'once');
    // It opens again with them, and says so; the next reading is worked out from them.
    await page.evaluate(c=>window.__t.debug.emit(c),live([],{state:'OPENING',lens:null}));await page.evaluate(c=>window.__t.debug.emit(c),live([],{lens:[kept.fx,kept.fy,320,240]}));await page.waitForFunction(()=>/Live debug is using these numbers now/.test(document.querySelector('[data-cam-lens-result]').textContent));
    await page.fill('#cam-lens-distance','31');await page.click('[data-cam-lens-go]');await feed(()=>live([tag(30)],{lens:[kept.fx,kept.fy,320,240]}));await page.waitForFunction(()=>/the tape said 31 in/.test(document.querySelector('[data-cam-lens-result]').textContent));assert.ok(Math.abs((await page.evaluate(()=>window.__t.lens.Ucamera001['640x480'].fx))-kept.fx*31/30)<1,'from the numbers in use, not the SDK’s guess');
    await page.click('[data-cam-lens-forget]');await page.waitForFunction(()=>window.__t.debugSent.includes('K\toff'));
    // A Torque Debug from before this has no lens field, and has to go on the robot again. Torque does not do that by itself.
    await page.evaluate(()=>{window.__t.lens={Ucamera001:{'640x480':{fx:800,fy:800,cx:320,cy:240,measured:30,reported:21}}};window.__t.debugSent.length=0;});await page.evaluate(({lens,...c})=>{window.__t.debug.emit(c);window.__t.camera.refresh();},live([]));await page.waitForFunction(()=>/too old to take these numbers/.test(document.querySelector('[data-cam-lens-result]').textContent));assert.deepEqual((await page.evaluate(()=>window.__t.debugSent)).filter(l=>l.startsWith('K\t')),[],'it would not understand');assert.equal(await calls('debug-install'),0,'nothing goes on the robot by itself');
    await page.evaluate(()=>{window.__t.debug.stop();window.__t.configured=[];window.__t.lens={};});

    // E. A Limelight.
    const limeCtx={scan:{portals:[],others:[{serial:LIME.scanKey,type:'ETHERNET_DEVICE'}]},limelight:LIME};await setHub(NET,limeCtx,limeCtx.scan.others);await page.waitForFunction(()=>/Limelight · 172\.29\.0\.1/.test(document.querySelector('#cam-source').textContent));
    assert.equal(await page.locator('#cam-source').innerText(),'Limelight · 172.29.0.1','in the list on its own');await page.selectOption('#cam-source',{label:'Limelight · 172.29.0.1'});
    await page.waitForSelector('[data-lime-status]');assert.equal(await page.locator('[data-cam-view]').isVisible(),false,'no picture');const lime=await text('[data-cam-lime]');for(const re of [/limelight-front/,/48\.5 °C/,/31%/,/40%/,/90 frames a second/,/Pipeline\s*2/,/ChArUco/,/at least 25 snapshots, then go on to 50/,/http:\/\/limelight\.local:5801/,/A hub can have one Limelight, on the blue port/,/Limelight 3G is prohibited \(R702\)/])assert.match(lime,re);
    await page.waitForFunction(()=>/custom calibration is active.*0\.52 pixels, which is good/.test(document.querySelector('[data-lime-cal]').textContent));assert.doesNotMatch(lime,/is a Limelight 3A\.|This is a 3G/,'it never says which model it is');assert.equal(await page.locator('[data-cam-lime] .rs-pill').innerText().then(t=>/Allowed if it is a Limelight 3A/.test(t)),true);
    assert.equal(await page.locator('[data-cam-tuning]').isVisible(),false);assert.equal(await page.locator('[data-cam-lens]').isVisible(),false);await gone('#cam-rotate');assert.match(await text('[data-cam-note]'),/not in the active configuration, “robot”/);
    await page.click('[data-cam-add]');assert.deepEqual(await page.evaluate(()=>window.__t.toConfigure.at(-1)),LIME.scanKey);await fits('Limelight');await page.screenshot({path:path.join(out,'limelight.png'),fullPage:true});
    await page.evaluate(()=>{window.__t.limes=[{name:'limelight',serial:'EthernetOverUsb:eth0:172.29.0.23'}];window.__t.camera.refresh();});assert.match(await text('[data-cam-note]'),/in the active configuration as “limelight”/);assert.equal(await page.locator('[data-cam-add]').isVisible(),false);
    await page.evaluate(()=>window.__t.camera.select('nobody'));

    // Configure: Add for a Limelight that answers, Save sends its XML, and one that does not answer gets no Add.
    await page.evaluate(({xml})=>{const t=window.__t,box=document.createElement('div');box.className='rs-configure';box.id='t-configure';document.querySelector('#cal-camera').after(box);t.editor=window.DeckConfigEditor.create({box,api:{save:async(name,x)=>{t.saved.push(x);},usb:()=>t.hub,names:()=>['robot']}});t.editor.open('robot',xml,null);},{xml:XML});
    const add=page.locator('#t-configure [data-ce-usb-add-lime]');await add.waitFor();assert.match(await text('#t-configure .ce-usb'),/Limelight · EthernetOverUsb:eth0:172\.29\.0\.23/);await add.click();assert.match(await text('#t-configure .ce-note'),/“limelight” is added here\. Press Save/);assert.deepEqual(await page.evaluate(()=>window.__t.saved),[],'Add writes nothing');await gone('#t-configure [data-ce-usb-add-lime]');
    await page.click('#t-configure [data-ce-save]');await page.waitForFunction(()=>window.__t.saved.length===1);const xml=(await page.evaluate(()=>window.__t.saved))[0];assert.ok(xml.includes('<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172.29.0.23" port="-1" ipAddress="172.29.0.1" />'),xml);assert.match(xml,/<Robot[^>]*>\s*<EthernetDevice/,'directly under Robot');assert.ok(xml.includes('name="left"'),'the rest stays');
    await page.evaluate(({xml})=>window.__t.editor.open('robot',xml,null),{xml:XML});const notLime={scan:{portals:[],others:limeCtx.scan.others},limelight:{status:null}};await setHub(NET,notLime,notLime.scan.others);await page.evaluate(()=>window.__t.editor.render());await gone('#t-configure [data-ce-usb-add-lime]');assert.match(await text('#t-configure [data-warn]'),/Scan offers this as if it were a Limelight/);
    // The USB tab has it as a card, with the same warning, and it is not in Camera's list.
    assert.equal(await page.locator('#cam-source').innerText(),'Simulated webcam');await page.evaluate(()=>document.querySelector('#t-configure').remove());await page.click('#cal-tab-usb');await page.waitForSelector('[data-usb-device="1-1"][data-row=G3]');assert.match(await text('[data-row=G3]'),/Scan offers this as if it were a Limelight/);assert.match(await text('[data-row=G3] .rs-pill'),/Not on the manual’s USB list: R707, R702/);

    await page.evaluate(()=>{window.__t.camera.stop();window.__t.usb.stop();});
    assert.deepEqual(errors,[]);console.log('USB devices: all passed');
  }finally{await app.close().catch(()=>{});fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(String(e.stack||e).slice(0,2400));process.exit(1);});
