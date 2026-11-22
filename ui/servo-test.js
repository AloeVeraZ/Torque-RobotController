'use strict';
// Calibrate → Servo Test: one page that sends a servo pulse, live, to one servo port of a hub on the robot, over USB.
// On the left: what it is connected to (the Control Hub on the USB-C cable by default; any Expansion Hub on its RS485 can be
// picked instead), the port (0-5), the pulse range (within the hub's own 500-2500 µs), then the pulse: a big readout, a slider
// across the range and three presets, Low 600, Mid 1500 and High 2400. On the right: what the hub itself reports for the port
// (its pulse, on or off) and its battery. While it sends, the slider and presets move the servo.
// The servo is driven by Torque's Servo Test op mode (src/onbot/TorqueServoTest.java), not by Torque Debug: the main process
// writes the pulse to the robot over USB and the op mode plays it with the hub's own pulse generator, with no robot
// configuration needed for the Control Hub (an Expansion Hub must be in the active configuration for the SDK to reach it).
// If Torque goes quiet for 3 s the op mode turns the port off. USB only.
window.DeckServoTest=(()=>{
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // REV Control Hub and Expansion Hub servo ports: 500 to 2500 µs pulses, every 20 ms.
  const HUB_MIN=500,HUB_MAX=2500,STEP=10,SEND_EVERY=120,OFF_GRACE_MS=1500,HUBS_EVERY=5000,CONTROL_HUB=173;
  const PRESETS=[['low','Low',600],['mid','Mid',1500],['high','High',2400]];
  const FROM=[500,600,700,800,900,1000,1100,1200,1300,1400],TO=[1600,1700,1800,1900,2000,2100,2200,2300,2400,2500];
  let root=null,api=null,ctx=null,shown=false,us=1500,range={from:HUB_MIN,to:HUB_MAX},port=0,hub=0,hubs=[],hubsAt=0,run=null,error='',timer=null,sendTimer=null,sentAt=0;
  const $=id=>root.querySelector('#'+id);
  const live=()=>!!run&&!run.done;
  // The hub counts as plugged in while the test itself has it (its watch can blink while the op mode starts or stops).
  const hubIn=()=>!!ctx?.hub?.()?.onUsb||live();
  // hub 0 is the Control Hub on the cable; a number is an Expansion Hub's address.
  const hubLabel=h=>h.parent?'Control Hub':`Expansion Hub ${h.address}`;
  const target=()=>hubs.find(h=>h.address===hub)||{parent:true,address:CONTROL_HUB};
  const targetName=()=>hub?hubLabel(target()):'Control Hub';
  const setHtml=(id,html)=>{const box=$(id);if(!box||box.dataset.html===html)return;box.dataset.html=html;box.innerHTML=html;};
  const setFill=r=>r.style.setProperty('--fill',`${(+r.value-+r.min)/Math.max(1,+r.max-+r.min)*100}%`);
  const clamp=v=>Math.max(range.from,Math.min(range.to,Math.round(v/STEP)*STEP));
  // What a pulse means, in plain words, for a servo in either mode.
  const meaning=v=>v===1500?'The middle of the range. A continuous servo stops here.':v<1500?'Toward one end. A continuous servo spins one way.':'Toward the other end. A continuous servo spins the other way.';
  // The hub was told to turn the port on and still says off: almost always no battery, which servo ports take their power from.
  const portRefused=()=>live()&&!run.starting&&run.hub?.on===false&&Date.now()-(run.liveAt||Date.now())>OFF_GRACE_MS;

  // ---- the hubs on the robot: asked of the robot while the page shows and nothing is sending.
  async function readHubs(){
    if(!api||!ctx?.hub?.()?.onUsb||live()||Date.now()-hubsAt<HUBS_EVERY)return;hubsAt=Date.now();
    try{const list=await api.robotLink('servo-test-hubs',{host:'usb'});hubs=Array.isArray(list)?list:[];}catch{hubs=[];}
    // A hub picked that is no longer there: back to the Control Hub.
    if(hub&&!hubs.some(h=>h.address===hub&&!h.parent))hub=0;render();
  }

  // ---- drawing: the parts around the slider are redrawn; the slider and presets are only updated, never rebuilt under a finger.
  function render(){
    if(!root)return;
    const others=hubs.filter(h=>!h.parent);
    setHtml('st-hubs',`<span class="servo-test-dot" data-on="${hubIn()}"></span>${hubIn()?`<div class="segmented axon-seg" role="group" aria-label="Connected to" data-count="${1+others.length}"><button type="button" data-st="hub" data-v="0" aria-pressed="${hub===0}"${live()&&hub!==0?' disabled':''}>Control Hub <small>USB-C</small></button>${others.map(h=>`<button type="button" data-st="hub" data-v="${h.address}" aria-pressed="${hub===h.address}"${live()&&hub!==h.address?' disabled':''}>Expansion Hub ${h.address}</button>`).join('')}</div>`:'<span class="servo-test-none">No Control Hub on USB. Connect it with the USB-C cable, with its battery plugged in and switched on.</span>'}`);
    setHtml('st-ports',[0,1,2,3,4,5].map(n=>`<button type="button" data-st="port" data-v="${n}" aria-pressed="${n===port}"${live()&&n!==port?' disabled':''} aria-label="Servo port ${n}">${n}</button>`).join(''));
    setHtml('st-port-note',`Plug the servo into servo port ${port} on the ${targetName()}.`);
    setHtml('st-range',`<label>From <select id="st-from" aria-label="Range from">${FROM.map(v=>`<option value="${v}"${v===range.from?' selected':''}>${v} µs</option>`).join('')}</select></label><label>to <select id="st-to" aria-label="Range to">${TO.map(v=>`<option value="${v}"${v===range.to?' selected':''}>${v} µs</option>`).join('')}</select></label><span>The hub can send ${HUB_MIN}–${HUB_MAX} µs.</span>`);
    paintPulse();paintSide();paintBar();
    setHtml('servo-test-chips',`<span class="axon-chip" data-tone="${hubIn()?'good':'wait'}"><i aria-hidden="true"></i>${esc(hubIn()?`${targetName()}, port ${port}`:'No Control Hub')}</span><span class="axon-chip" data-tone="${live()?(portRefused()?'warn':'good'):'wait'}"><i aria-hidden="true"></i>${esc(live()?`Sending ${us} µs`:'Not sending')}</span>`);
  }
  function paintPulse(){
    const slider=$('st-slider');slider.min=range.from;slider.max=range.to;if(+slider.value!==us)slider.value=us;setFill(slider);
    $('st-min').textContent=range.from;$('st-max').textContent=range.to;$('st-us').textContent=us;$('st-meaning').textContent=meaning(us);
    for(const b of root.querySelectorAll('[data-st=preset]')){const v=+b.dataset.us;b.setAttribute('aria-pressed',String(v===us));b.disabled=v<range.from||v>range.to;}
  }
  function paintSide(){
    const h=live()?run.hub:null,v=live()?run.volts:null;
    setHtml('st-report',`<dl class="axon-rows"><dt>Hub</dt><dd>${esc(targetName())}</dd><dt>Pulse</dt><dd>${h?`${h.us??'?'} µs`:'—'}</dd><dt>Port ${port}</dt><dd data-tone="${h?.on===true?'good':portRefused()?'warn':''}">${h?(h.on===true?'On':h.on===false?'Off':'?'):'—'}</dd><dt>Battery</dt><dd data-tone="${v!==null&&v!==undefined&&v<8?'warn':''}">${v!==null&&v!==undefined?`${v.toFixed(1)} V`:'—'}</dd></dl>`);
  }
  function bar(){
    if(!api)return {tone:'warn',main:'The Servo Test needs the installed app',sub:''};
    if(error)return {tone:'bad',main:error,sub:'',action:hubIn()?['Start sending','run']:null};
    if(!hubIn())return {tone:'wait',main:'Plug in a Control Hub',sub:'Use the USB-C cable, with the robot’s battery plugged in and switched on. The test never goes over Wi-Fi.'};
    if(live()){
      if(run.starting)return {tone:'busy',main:run.starting,sub:'',action:['Stop','stop']};
      if(portRefused())return {tone:'warn',main:`The hub did not turn servo port ${port} on`,sub:`Plug in and switch on the robot's 12 V battery: servo ports get their power from it.${run.volts!==null&&run.volts!==undefined?` The hub reads ${run.volts.toFixed(1)} V.`:''}`,action:['Stop','stop']};
      return {tone:'good',main:`Sending ${us} µs to servo port ${port} on the ${targetName()}`,sub:'Move the slider or pick a preset. Space or Stop ends it.',action:['Stop','stop']};}
    if(run?.done)return {tone:'warn',main:'Stopped',sub:run.message||'',action:['Start sending','run']};
    return {tone:'wait',main:`Plug the servo into port ${port} on the ${targetName()}, then start`,sub:'Take anything off its horn that must not move. Moving the slider or picking a preset starts sending.',action:['Start sending','run']};
  }
  function paintBar(){
    const g=bar(),banner=$('servo-test-banner');banner.dataset.tone=g.tone;setHtml('servo-test-banner',`<strong>${esc(g.main)}</strong>${g.sub?`<span>${esc(g.sub)}</span>`:''}`);
    const go=$('servo-test-go');go.hidden=!g.action;if(g.action){go.textContent=g.action[0];go.dataset.st=g.action[1];go.className=g.action[1]==='stop'?'secondary':'primary';}
  }

  // ---- sending: Torque's Servo Test op mode on the robot. The main process writes the pulse there; its telemetry comes back
  // as robot-link-servo. The slider's moves go out at most every 120 ms, the last one always.
  const STAGES={connecting:'Connecting to the Control Hub…',building:'Putting the Servo Test on the Control Hub and building it (only the first time)…',plan:'Sending the pulse to the Control Hub…',starting:'Starting the Servo Test on the Control Hub…'};
  async function start(){
    if(!api){error='The Servo Test needs the installed app.';render();return;}
    if(!ctx?.hub?.()?.onUsb){error='Plug the Control Hub in with USB first.';render();return;}
    error='';run={starting:STAGES.connecting,hub:null,volts:null};render();
    try{await api.robotLink('servo-test-start',{host:'usb',hub,port,enable:true,live:true,us});}
    catch(e){end(e.message);}
  }
  function setPulse(v){
    us=clamp(v);if(live())run.liveAt=Date.now();render();
    if(!live()||run.starting)return;clearTimeout(sendTimer);const wait=Math.max(0,SEND_EVERY-(Date.now()-sentAt));
    sendTimer=setTimeout(()=>{sentAt=Date.now();void api.robotLink('servo-test-set',{us}).catch(e=>{error=e.message;render();});},wait);
  }
  function onServo(m){
    if(!run||run.done)return;
    if(m.stage){run.starting=STAGES[m.stage]||run.starting;render();}
    if(m.update){const u=m.update;if(/^error/.test(u.state))run.err=u.state.replace(/^error\s*/,'');
      if((u.state==='live'||u.state==='waiting')&&run.starting){run.starting='';run.liveAt=Date.now();}
      if(u.hub)run.hub=u.hub;if(u.volts!==null&&u.volts!==undefined)run.volts=u.volts;
      // A pulse picked while the op mode was starting goes out now.
      if(u.state==='live'&&!run.synced){run.synced=true;if(u.pulse!==us)setPulse(us);}render();}
    if(m.error)end(m.error);
    if(m.ended)end(run.err?`The hub refused it: ${run.err}`:m.ended==='stopped'?'The servo port is off.':m.ended==='lost'?'The Control Hub disconnected.':m.ended==='time'?'It ran for 3 minutes, so it was stopped.':'The Servo Test stopped on the robot.');
  }
  // Moving the slider or picking a preset starts sending by itself when it is not already: the pulse picked is the first one sent.
  function autoStart(){if(!live()&&api&&ctx?.hub?.()?.onUsb)void start();}
  function end(message=''){clearTimeout(sendTimer);if(!run)return;run={...run,done:true,message};render();}
  async function stop(){if(!live())return;await api?.robotLink('servo-test-stop').catch(()=>{});}

  function onClick(e){
    const b=e.target.closest('[data-st]');if(!b||b.disabled)return;const a=b.dataset.st;error='';
    if(a==='hub'){if(!live())hub=+b.dataset.v;}
    else if(a==='port'){if(!live())port=+b.dataset.v;}
    else if(a==='preset'){setPulse(+b.dataset.us);autoStart();return;}
    else if(a==='run'){void start();return;}
    else if(a==='stop'){void stop();return;}
    render();
  }
  function onInput(e){
    const el=e.target;if(el.id==='st-slider'){setPulse(+el.value);autoStart();return;}
    // A new range: the pulse stays inside it.
    if(el.id==='st-from'||el.id==='st-to'){range={...range,[el.id==='st-from'?'from':'to']:+el.value};setPulse(us);}
  }

  const PAGE=`<div class="axon-tab servo-test-tab">
    <div class="axon-top"><h2>Servo Test</h2><div id="servo-test-chips" class="axon-chips"></div></div>
    <div class="servo-test-main">
      <section class="servo-test-card" aria-label="Servo Test">
        <div class="servo-test-setup">
          <span class="servo-test-label">Connected to</span><div id="st-hubs" class="servo-test-hub"></div>
          <span class="servo-test-label">Port</span><div class="servo-test-port"><span id="st-ports" class="servo-test-ports segmented" role="group" aria-label="Servo port"></span><span id="st-port-note"></span></div>
          <span class="servo-test-label">Range</span><div id="st-range" class="servo-test-range"></div>
        </div>
        <div class="servo-test-pulse">
          <div class="servo-test-readout"><output id="st-us" class="reading">${us}</output><span>µs</span><p id="st-meaning"></p></div>
          <div class="servo-test-slider"><span id="st-min"></span><input id="st-slider" class="num-slider axon-slider" type="range" min="${HUB_MIN}" max="${HUB_MAX}" step="${STEP}" value="${us}" aria-label="Pulse in microseconds"><span id="st-max"></span></div>
          <div class="servo-test-presets" role="group" aria-label="Presets">${PRESETS.map(([id,name,v])=>`<button id="st-preset-${id}" type="button" class="axon-card secondary" data-st="preset" data-us="${v}" aria-pressed="false"><strong>${esc(name)}</strong><span>${v} µs</span></button>`).join('')}</div>
        </div>
      </section>
      <aside class="servo-test-side" aria-labelledby="st-side-title"><h3 id="st-side-title" class="axon-side-title">Hub reports</h3><div id="st-report"></div>
        <p class="hint">While Torque sends a pulse, the hub reports the pulse on the servo port, whether the port is on, and the battery voltage the servo ports run on.</p>
        <p class="hint">This works over USB only and never changes the servo’s settings. The port turns off when you press Stop or Space, leave this tab or unplug the hub, or when Torque stops talking to the robot for 3 seconds. To test a servo on an Expansion Hub, the hub must be in the robot’s active configuration.</p></aside>
    </div>
    <div class="axon-bar"><div id="servo-test-banner" class="axon-banner notice" role="status" data-tone="wait"></div><button id="servo-test-go" class="primary" type="button" hidden></button></div>
  </div>`;
  return {
    install(box,deck,context){if(!box)return;root=box;ctx=context||{};api=deck&&typeof deck.robotLink==='function'?deck:null;box.innerHTML=PAGE;box.addEventListener('click',onClick);box.addEventListener('input',onInput);box.addEventListener('change',onInput);
      api?.onRobotServo?.(onServo);
      document.addEventListener('keydown',e=>{if(e.code!=='Space'||!shown||!live()||e.target.closest?.('input[type=text],textarea,select,[contenteditable]'))return;e.preventDefault();void stop();},true);
      render();},
    // Whether the tab is on screen: it follows the Control Hub and its hubs while it shows, and sending stops when it is left.
    shown(on){if(!root||on===shown)return;shown=on;if(on){hubsAt=0;render();void readHubs();timer=setInterval(()=>{render();void readHubs();},700);}else{clearInterval(timer);timer=null;if(live())void stop();}},
    state:()=>({hub,port,range:{...range},us,hubs:hubs.slice(),run:run&&{...run}}),
  };
})();
