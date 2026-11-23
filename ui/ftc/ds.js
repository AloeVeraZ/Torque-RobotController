'use strict';
// FTC Driver Station screen. Talks Robocol through `ftcHost`, a datagram bridge to the one robot
// chosen in Settings (Electron preload, or the browser preview).
(()=>{
const $=s=>document.querySelector(s),R=window.Robocol,STOP=R.STOP_OP_MODE,AUTO_SECONDS=30;
const host=window.ftcHost;
let session=null,info={name:'FTC Robot',host:'',ssid:''},robotNetwork='',linkNote='',aboutQuiet=false,game=null,shown=true,selected=null,timerOn=false,timerEnd=0,countdown=null,inputsOn=true,cameraUrl=null,renderQueued=false,lastTelemetry=-1,lastState={},rumbleToken=0,minVolts=null,dsBattery=null;
const users={1:null,2:null},padKeys={1:'',2:''},padStamps={1:0,2:0};
// Driver Station settings (the menu's Settings), kept on this computer.
const prefs={gamepadType:'auto',showRcBattery:true,autoTimer:true};
try{Object.assign(prefs,JSON.parse(localStorage.getItem('deck-ds-settings')||'{}'));}catch{}
function savePrefs(){try{localStorage.setItem('deck-ds-settings',JSON.stringify(prefs));}catch{}queueRender();}

function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(message,ms=3500){const t=$('#ds-toast');t.textContent=message;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{t.hidden=true;},Math.max(1500,ms));}
function showDialog(title,text){const d=$('#ds-dialog');$('#dialog-title').textContent=title;$('#dialog-text').textContent=text;if(!d.open)d.showModal();}
function opMode(name){return session?.state.opModes.find(m=>m.name===name)||null;}
function flavorOf(m){return m?.flavor==='AUTONOMOUS'?'auto':m?.flavor==='TELEOP'?'teleop':'';}
// The Driver Station takes its name from the robot's network: 9999-C-RC pairs with 9999-C-DS.
function dsName(){const m=/^(.*?)[-_ ]?RC$/i.exec(robotNetwork||info.ssid||'');return m&&m[1]?`${m[1]}-DS`:'Driver Station';}
const overUsb=()=>info.host==='usb';

// ---- Rendering ---------------------------------------------------------------------------
function queueRender(){if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},0);}
function render(){
  const s=session.state,connected=s.connection==='connected',busy=s.opModeState!=='stopped';
  if(s.activeOpMode!==STOP&&selected?.name!==s.activeOpMode){selected=opMode(s.activeOpMode)||{name:s.activeOpMode};}
  if(selected&&s.opModes.length&&!busy&&!opMode(selected.name))selected=null;
  const bad=['rejected','incompatible'].includes(s.connection);
  // Presentation only: distinguish stopped, initialized, running and lost-link states.
  document.body.dataset.robotState=s.robotState==='EMERGENCY_STOP'?'emergency':connected?s.opModeState:'disconnected';
  $('#link-banner').className='banner '+(connected?'connected':bad?'bad':'searching');
  $('#link-text').textContent=connected?'Robot Connected':s.connection==='rejected'?'Another DS Connected':s.connection==='incompatible'?'Robot Not Supported':'Searching for Robot';
  $('#network').textContent=(overUsb()?robotNetwork||'USB':info.ssid||robotNetwork||info.host)||'—';$('#network').title=overUsb()?'Connected over the USB cable':'';
  $('#ping').textContent=connected&&s.ping!==null?`${s.ping} ms`:'No Heartbeat';
  const sig=$('#signal');sig.classList.toggle('on',connected);sig.classList.toggle('fair',connected&&s.ping>=40&&s.ping<100);sig.classList.toggle('poor',connected&&s.ping>=100);
  const v=s.battery?.volts,tile=$('#volts-tile'),known=Number.isFinite(v);
  if(known)minVolts=minVolts===null?v:Math.min(minVolts,v);
  tile.className='tile volts'+(known?v>=12?'':v>=11?' caution':' danger':' none');tile.title=known&&v<11?'Charge or swap the robot battery':'';
  $('#volts').textContent=known?`${v.toFixed(2)} V`:connected&&s.battery?'No sensor':'—';$('#volts-min').textContent=minVolts!==null?`Low ${minVolts.toFixed(2)} V`:'';
  const rc=s.rcBattery,rcKnown=!!rc&&Number.isFinite(rc.percent);$('.rc-batt').hidden=!prefs.showRcBattery;$('.rc-batt').classList.toggle('none',!rcKnown);$('#rc-battery').textContent=rcKnown?`${Math.round(rc.percent)}%`:'—';
  const m=selected?opMode(selected.name)||selected:null;
  // The robot has none of the kind that was asked for: said here, in place, until it has one (a list that opens empty says nothing).
  if(noneOf&&(m||s.opModes.some(x=>x.flavor===noneOf)))noneOf='';
  const kindWord=noneOf==='AUTONOMOUS'?'autonomous':'TeleOp';
  $('#opmode-label').textContent=m?m.name:noneOf?`No ${kindWord} on this robot`:'Select Op Mode';$('#opmode-hint').textContent=noneOf?(noneOf==='AUTONOMOUS'?'Send one from Calibrate → Autonomous':'Send one from Calibrate → TeleOp'):'From Auto or TeleOp';$('#opmode-hint').hidden=!!m;$('#opmode-name').classList.toggle('chosen',!!m);$('#opmode-name').classList.toggle('none',!m&&!!noneOf);
  for(const id of ['#auto-list','#teleop-list','#opmode-name'])$(id).disabled=!connected||busy;
  const go=$('#main-action'),state=s.opModeState,kind=state==='running'?'stop':state==='init'?'start':'init';
  go.className=`go ${kind}${s.pendingAction?' waiting':''}`;$('#main-label').textContent='INIT';go.setAttribute('aria-label',kind.toUpperCase());
  go.disabled=!connected||(kind==='init'&&!m);$('#abort').hidden=state!=='init'||!connected;
  const counting=countdown!==null,timer=$('#timer');timer.className='stopwatch'+(counting?' counting':timerOn?'':' off');
  $('#timer-text').textContent=counting?String(Math.max(0,Math.ceil((timerEnd-Date.now())/1000))):'';
  $('#timer-switch').checked=timerOn;$('#timer-switch').disabled=state==='running';
  $('#config').textContent=s.activeConfig?.name?`${s.activeConfig.name}${s.activeConfig.dirty?' *':''}`:'<No Config Set>';
  const name=s.activeOpMode===STOP?'':s.activeOpMode;
  const statusText=!connected?(s.connection==='rejected'?'Another Driver Station is connected to this robot':(overUsb()?linkNote||'Waiting for the Control Hub on the USB cable':`Looking for robot at ${info.host||'its address'}`))
    :s.robotState==='EMERGENCY_STOP'?'EMERGENCY STOP':state==='running'?`Running ${name}`:state==='init'?`Initialized ${name}`:'Robot is stopped';
  // Live regions announce changes, not every heartbeat/telemetry packet.
  if($('#status-line').textContent!==statusText)$('#status-line').textContent=statusText;
  const sys=$('#system-message'),message=s.systemError||s.systemWarning||'';sys.hidden=!message;if($('#system-text').textContent!==message)$('#system-text').textContent=message;sys.className='system notice '+(s.systemError?'error bad':'warning warn');
  // An out-of-date Robot Controller is fixed from here: one button installs the current app over the cable.
  const act=$('#system-action'),rcOld=/Robot Controller (app )?is obsolete|apps are obsolete|update the Robot Controller/i.test(message)&&!!host.updateRobotController;act.hidden=!rcOld;if(rcOld&&!act.disabled)act.textContent='Update Robot Controller';
  renderGame(connected);
  if(s.telemetry.updated!==lastTelemetry)renderTelemetry(s.telemetry);
  renderPractice();watchTransitions(s);fitLooksLabel();
}
// "Wi-Fi Direct: 9999-C-RC", "Access point: FTC-zWL4" and the like: the name a team knows its robot by.
function networkName(a){const t=String(a?.networkConnectionInfo||'');const m=/\b(\d{1,5}(?:-[A-Za-z])?-RC|FTC-[A-Za-z0-9]{2,})\b/.exec(t);return m?m[1]:'';}
// While no robot answers, the telemetry area holds a game; it is gone the moment the robot is back, and it stops whenever
// this screen is not the one in front, so it never costs Setup, Simulate or the robot link anything.
function renderGame(connected){
  const box=$('#waiting-game'),want=!connected&&shown&&!!window.DeckTripRun&&$('#camera').hidden&&!window.DeckDsPages?.open();
  if(want){if(!game)game=window.DeckTripRun.create(box,{maxHeight:320});box.hidden=false;game.show();}
  else if(game){if(connected){game.destroy();game=null;}else game.hide();box.hidden=true;}
}
// One button, as the REV Hardware Client's: FIRST's current Robot Controller, installed over the cable. A hub whose app cannot be
// updated in place (built in Android Studio) is asked about first, since replacing it removes the code built into it.
let updating=false;
async function updateRobotController(){
  if(!host.updateRobotController||updating)return;updating=true;const act=$('#system-action'),bar=$('#progress');act.disabled=true;act.textContent='Updating…';
  const show=text=>{bar.hidden=false;$('#progress-text').textContent=text;const p=/(\d+)%/.exec(text);if(p){$('#progress-bar').max=100;$('#progress-bar').value=Number(p[1]);}else $('#progress-bar').removeAttribute('value');};
  try{show('Checking the Robot Controller app…');let r=await host.updateRobotController({},show);
    if(r?.needsReplace){bar.hidden=true;if(!await confirmDialog(`Update to Robot Controller ${r.to}?`,r.message,'Remove and update'))return;show('Starting the update…');r=await host.updateRobotController({replace:true,serial:r.serial},show);}
    if(r?.upToDate)toast(`The Robot Controller app is up to date (${r.versionName}).`,4000);
    else if(r?.installed)toast(`Robot Controller ${r.versionName} is installed. The robot reconnects by itself.`,6000);}
  catch(e){showDialog('Update Robot Controller',e.message);}
  finally{updating=false;bar.hidden=true;act.disabled=false;queueRender();}
}
function confirmDialog(title,text,ok){const d=$('#ds-dialog'),cancel=$('#dialog-cancel'),okb=$('#dialog-ok');$('#dialog-title').textContent=title;$('#dialog-text').textContent=text;okb.textContent=ok;cancel.hidden=false;
  return new Promise(done=>{const end=v=>{cancel.hidden=true;okb.textContent='OK';okb.onclick=()=>d.close();cancel.onclick=null;d.onclose=null;if(d.open)d.close();done(v);};okb.onclick=()=>end(true);cancel.onclick=()=>end(false);d.onclose=()=>end(false);d.showModal();});}
function renderBattery(){
  const text=$('#ds-battery-text'),fill=$('#ds-battery-fill');
  if(!dsBattery){text.textContent='—';fill.style.width='0';return;}
  text.textContent=`${Math.round(dsBattery.level*100)}%`;fill.style.width=`${Math.round(dsBattery.level*100)}%`;
}
function renderTelemetry(t){
  lastTelemetry=t.updated;const box=$('#telemetry');box.className='lines'+(t.format==='MONOSPACE'?' monospace':'');
  if(!t.lines.length){box.replaceChildren();return;}
  box.replaceChildren(...t.lines.map(line=>{const row=el('div');if(t.format==='HTML')row.append(...safeHtml(line));else row.textContent=line;return row;}));
}
// HTML telemetry: rebuild an allow-listed subset as DOM nodes; no attributes but a validated color.
const TAGS=new Set(['B','I','U','EM','STRONG','BR','BIG','SMALL','TT','SUP','SUB','S','STRIKE','DEL','P','DIV','SPAN','FONT','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE']);
function safeHtml(html){
  const doc=new DOMParser().parseFromString(`<body>${html}</body>`,'text/html');
  const copy=node=>{
    if(node.nodeType===Node.TEXT_NODE)return [document.createTextNode(node.nodeValue)];
    if(node.nodeType!==Node.ELEMENT_NODE)return [];const kids=[...node.childNodes].flatMap(copy);
    if(!TAGS.has(node.tagName))return kids;const out=document.createElement(node.tagName==='FONT'?'span':node.tagName.toLowerCase());
    const color=node.getAttribute('color')||'';if(/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(color))out.style.color=color;out.append(...kids);return [out];
  };
  return [...doc.body.childNodes].flatMap(copy);
}
function watchTransitions(s){
  if(s.opModeState==='running'&&lastState.opModeState!=='running'&&timerOn&&flavorOf(opMode(s.activeOpMode))==='auto')startCountdown();
  if(s.opModeState!=='running')stopCountdown();
  if(s.connection!==lastState.connection&&s.connection==='connected')toast(`Connected to ${info.name}`,2000);
  lastState={opModeState:s.opModeState,connection:s.connection};
}
function startCountdown(){stopCountdown();timerEnd=Date.now()+AUTO_SECONDS*1000;countdown=setInterval(()=>{if(Date.now()>=timerEnd){stopCountdown();session.stopOpMode();toast('Autonomous period ended');}queueRender();},200);}
function stopCountdown(){if(countdown!==null){clearInterval(countdown);countdown=null;}}

// ---- Practice timer: a match clock independent of op modes (30 s Auto, 8 s transition, 2:00 TeleOp) ----
let practice=null;
const fmt=sec=>{sec=Math.max(0,Math.ceil(sec));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
const PRACTICE_STARTS=[['auto','Autonomous','A 3-second countdown, then the whole match'],['transition','Transition to TeleOp','8 seconds to pick up the controllers, then TeleOp'],['teleop','TeleOp','The 2-minute driver-controlled period'],['endgame','Endgame','The last 30 seconds of TeleOp']];
function startPractice(from){
  stopPractice(false);const [phase,seconds]={auto:['lead',3],transition:['transition',8],teleop:['teleop',120],endgame:['teleop',30]}[from];
  practice={phase,end:Date.now()+seconds*1000};
  practice.ticker=setInterval(tickPractice,100);tickPractice();
}
function tickPractice(){
  const p=practice;if(!p)return;const left=(p.end-Date.now())/1000;
  if(left<=0){
    const next={lead:['auto',30],auto:['transition',8],transition:['teleop',120]}[p.phase];
    if(next)Object.assign(p,{phase:next[0],end:Date.now()+next[1]*1000});else{stopPractice(false);toast('Practice match over');}
  }
  renderPractice();
}
function stopPractice(show=true){if(practice)clearInterval(practice.ticker);practice=null;if(show)renderPractice();}
function renderPractice(){
  const p=practice;let time=150,label='30 s Auto, 8 s, 2:00 TeleOp';
  if(p){const left=Math.max(0,(p.end-Date.now())/1000);
    if(p.phase==='lead')label=`Starting in ${Math.ceil(left)}`;else if(p.phase==='auto'){time=left+120;label='Autonomous';}
    else if(p.phase==='transition'){time=120;label=`Pick up controllers: ${Math.ceil(left)}`;}else{time=left;label=left<=30?'Endgame':'TeleOp';}}
  $('#practice-time').textContent=fmt(time);$('#practice-phase').textContent=label;$('#practice-icon').className=p?'stop':'play';
  $('.practice').classList.toggle('running',!!p);$('#practice-play').setAttribute('aria-label',p?'Stop practice timer':'Start practice timer');
}
function choosePractice(){
  const items=PRACTICE_STARTS.map(([id,title,detail])=>{const b=el('button');b.append(el('span','',title),el('small','',detail));b.onclick=()=>{closePicker();startPractice(id);};return b;});
  $('#picker-title').textContent='Start practice timer at';$('#picker-list').replaceChildren(...items);$('#picker').hidden=false;menusChanged();$('#picker-list button')?.focus();
}

// ---- Op mode selection and control ---------------------------------------------------------
let noneOf='';
function openPicker(flavor){
  const s=session.state,list=s.opModes.filter(m=>m.flavor===flavor),groups=new Map();
  // None of this kind: no list to open. It says so where the op mode's name goes, and asks the robot again, since one just sent to it shows up as soon as the robot lists it.
  if(!list.length){closePicker();noneOf=flavor;try{session.command('CMD_REQUEST_OP_MODE_LIST');}catch{}toast(`This robot has no ${flavor==='AUTONOMOUS'?'autonomous':'TeleOp'} op modes yet. Send one from Calibrate → ${flavor==='AUTONOMOUS'?'Autonomous':'TeleOp'}, then pick it here.`,6000);return queueRender();}
  noneOf='';
  for(const m of [...list].sort((a,b)=>a.name.localeCompare(b.name))){const g=!m.group||m.group==='$$$$$$$'?'':m.group;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(m);}
  // What Torque sent comes first (its group, "Torque"), so a TeleOp just sent is at the top of a long list; then the ungrouped ones, then each group.
  const rank=g=>g==='Torque'?0:g===''?1:2,names=[...groups.keys()].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b)),items=[];
  for(const g of names){if(g)items.push(el('h3','',g));for(const m of groups.get(g)){const b=el('button',selected?.name===m.name?'selected':'');b.setAttribute('role','option');b.append(el('span','',m.name));if(m.source==='BLOCKLY'||m.source==='ONBOTJAVA')b.append(el('small','',m.source==='BLOCKLY'?'Blocks':'OnBot Java'));b.onclick=()=>{selected=m;timerOn=m.flavor==='AUTONOMOUS'&&prefs.autoTimer;closePicker();queueRender();};items.push(b);}}
  if(!items.length)items.push(el('p','none',`No ${flavor==='AUTONOMOUS'?'autonomous':'TeleOp'} op modes are registered on this robot.`));
  $('#picker-title').textContent=flavor==='AUTONOMOUS'?'Autonomous':'TeleOp';$('#picker-list').replaceChildren(...items);$('#picker').hidden=false;menusChanged();$('#picker-list button')?.focus();
}
function closePicker(){$('#picker').hidden=true;menusChanged();}
function mainAction(){
  const s=session.state;
  if(s.opModeState==='running')stop();else if(s.opModeState==='init')session.startOpMode(s.activeOpMode);else if(selected)session.initOpMode(selected.name);
  queueRender();
}
function stop(){stopCountdown();session.stopOpMode();queueRender();}

// ---- Gamepads: shared driver-station controller slots ---------------------------------
const dead=v=>{v=Math.max(-1,Math.min(1,Number(v)||0));return Math.abs(v)<0.05?0:v;};
function gamepadType(id){if(R.GamepadType[prefs.gamepadType]!==undefined)return R.GamepadType[prefs.gamepadType];return /054c|sony|dualshock|dualsense|\bps4\b/i.test(id)?R.GamepadType.SONY_PS4:/046d|logitech|f310/i.test(id)?R.GamepadType.LOGITECH_F310:R.GamepadType.XBOX_360;}
function ftcPad(p,rest){
  const base={id:p.index+1,gamepadType:gamepadType(p.id)};if(rest||p.mapping!=='standard')return base;
  const on=i=>!!p.buttons[i]?.pressed,val=i=>Math.max(0,Math.min(1,p.buttons[i]?.value||0));
  return {...base,left_stick_x:dead(p.axes[0]),left_stick_y:dead(p.axes[1]),right_stick_x:dead(p.axes[2]),right_stick_y:dead(p.axes[3]),left_trigger:val(6),right_trigger:val(7),
    a:on(0),b:on(1),x:on(2),y:on(3),left_bumper:on(4),right_bumper:on(5),back:on(8),start:on(9),left_stick_button:on(10),right_stick_button:on(11),dpad_up:on(12),dpad_down:on(13),dpad_left:on(14),dpad_right:on(15),guide:on(16),touchpad:on(17)};
}
function inputsLive(){return inputsOn&&!document.hidden&&document.hasFocus();}
function pollGamepads(){
  if(!session)return;const pads=Array.from(navigator.getGamepads?.()||[]),count=window.__deckControllerInput?.state().count||info.controllerCount||1;
  $('#pad-2').hidden=false;$('#pad-2').classList.toggle('standby',count<2);
  for(const u of [1,2]){
    const p=u<=count?pads[u-1]:null,button=$('#pad-'+u),previous=users[u];users[u]=p?.connected?u-1:null;
    button.classList.toggle('assigned',users[u]!==null);
    if(users[u]===null){if(previous!==null)session.setGamepad(u,null);button.classList.remove('active');continue;}
    const pad=ftcPad(p,!inputsLive()),key=JSON.stringify(pad);if(key!==padKeys[u]){padKeys[u]=key;padStamps[u]=Date.now();}
    session.setGamepad(u,{...pad,timestamp:padStamps[u]});button.classList.toggle('active',!R.atRest(pad));button.title='Assign controller '+u+' · '+p.id;
  }
  $('#assign-hint').hidden=!(session.state.connection==='connected'&&users[1]===null);
}

async function rumble(effect){
  const token=++rumbleToken,index=users[effect.user===2?2:1],actuator=index===null?null:navigator.getGamepads?.()[index]?.vibrationActuator;if(!actuator?.playEffect)return;
  for(const step of effect.steps){if(token!==rumbleToken)return;const duration=step.duration<0?10000:Math.min(step.duration,10000);
    if(duration>0)await actuator.playEffect('dual-rumble',{startDelay:0,duration,strongMagnitude:(step.large||0)/255,weakMagnitude:(step.small||0)/255}).catch(()=>{});}
}

// ---- Robot messages, menu, and camera -----------------------------------------------------------
function showFrame(bytes){const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));$('#camera-image').src=url;if(cameraUrl)URL.revokeObjectURL(cameraUrl);cameraUrl=url;}
function openCamera(){if(!session.state.streamAvailable){toast('No camera stream is available. Initialize an op mode that streams a camera, then try again.',4500);return;}$('#camera').hidden=false;$('#telemetry').hidden=true;$('#camera-close').hidden=false;session.requestFrame();}
function closeCamera(){$('#camera').hidden=true;$('#telemetry').hidden=false;$('#camera-close').hidden=true;}
function setMenu(open){if(open)setLooks(false,false);$('#ds-menu').hidden=!open;$('#ds-more').setAttribute('aria-expanded',String(open));menusChanged();}
function menu(action){setMenu(false);action();}
$('#ds-more').onclick=()=>setMenu($('#ds-menu').hidden);
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#ds-menu')&&!e.target.closest('#ds-more'))setMenu(false);});
// The looks menu, beside Network: the Driver Station's theme and colour, the same choice as Torque's Settings keeps.
// It shows when Torque sends the lists (look.themes, look.colours, look.current: the built-in ones first, then the
// user's own), Theme and Colour side by side, each list scrolling on its own; where two columns do not fit, Theme
// stands above Colour. A pick goes back to Torque, and the new look arrives through onLook.
let look=null;
const LOOKS_TWO_COLUMNS=528;// below this width Theme stands above Colour
const LOOKS_MIN_ROOM=160,LOOKS_EDGE=4;// the least room below the bar worth opening into; the menu's margin from the window's edge
function lookLists(){const l=look,list=v=>Array.isArray(v)?v.filter(x=>x&&typeof x.id==='string'&&x.id):[];return {themes:list(l?.themes),colours:list(l?.colours),current:l?.current||{}};}
function lightMode(){const t=document.documentElement.dataset.theme;return t?t==='light':matchMedia('(prefers-color-scheme: light)').matches;}
function lookItem(kind,item,picked){
  const b=el('button','looks-item'),name=String(item.name||item.id);b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(picked));b.dataset.kind=kind;b.dataset.id=item.id;b.title=name;b.tabIndex=-1;
  // A colour's dot is its primary, the colour picked on the wheel in Settings; without one, its accent in this mode.
  if(kind==='colour'){const dot=el('i','colour-dot'),hex=v=>typeof v==='string'&&/^#[0-9a-f]{3,8}$/i.test(v)?v:null,sw=Array.isArray(item.swatch)?item.swatch:[],fill=hex(item.primary)||hex(lightMode()?sw[3]:sw[1]);dot.setAttribute('aria-hidden','true');if(fill)dot.style.setProperty('--dot',fill);b.append(dot);}
  b.append(el('span','looks-name',name));
  const mark=document.createElementNS('http://www.w3.org/2000/svg','svg');mark.setAttribute('viewBox','0 0 24 24');mark.setAttribute('class','ui-icon looks-mark');mark.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m5 12.5 4.5 4.5L19 7.5');mark.append(path);b.append(mark);
  b.onclick=()=>pickLook(kind,item.id);return b;
}
// One row in each list takes Tab (the picked one to begin with, then the last one reached), so Tab goes from Theme to Colour.
function rove(item){for(const b of item.closest('.looks-list').querySelectorAll('.looks-item'))b.tabIndex=b===item?0:-1;}
function renderLooks(){
  const {themes,colours,current}=lookLists(),usable=!!host?.pickTheme&&(themes.length>0||colours.length>0),menu=$('#looks-menu');
  $('#ds-looks').hidden=!usable;if(!usable){setLooks(false,false);return;}fitLooksLabel(true);
  const focused=document.activeElement?.closest?.('#looks-menu')?{kind:document.activeElement.dataset.kind,id:document.activeElement.dataset.id}:null;
  const groups=[];
  for(const [kind,title,items] of [['theme','Theme',themes],['colour','Colour',colours]]){if(!items.length)continue;
    const g=el('div','looks-group'),h=el('h3','looks-title',title),list=el('div','looks-list');h.id=`looks-${kind}-title`;g.dataset.kind=kind;list.setAttribute('role','group');list.setAttribute('aria-labelledby',h.id);
    const now=current[kind]||'same',rows=items.map(i=>lookItem(kind,i,i.id===now));list.append(...rows);(rows.find(r=>r.getAttribute('aria-checked')==='true')||rows[0]).tabIndex=0;
    g.append(h,list);groups.push(g);}
  menu.replaceChildren(...groups);
  if(focused){const again=menu.querySelector(`.looks-item[data-kind="${focused.kind}"][data-id="${CSS.escape(focused.id)}"]`);if(again){rove(again);again.focus();}}
  if(looksOpen())placeLooks();
}
const looksOpen=()=>!$('#looks-menu').hidden;
// The button says Theme and colour where the bar has room for the words, and shows the palette alone where it has not, so
// the link's numbers beside it are never cut short (a narrow window always shows the palette alone, ds.css). It comes back
// only when there is room to spare, so a ping that grows and shrinks does not make it come and go.
const narrowBar=matchMedia('(max-width: 1100px)');let labelRoom=0,labelKey='';
function fitLooksLabel(force=false){
  const looks=$('#ds-looks'),button=$('#looks-button'),key=[innerWidth,$('#network').textContent,$('#ping').textContent,$('#link-text').textContent,$('#ds-name').textContent,document.documentElement.dataset.font,document.documentElement.dataset.look,'themeLogo' in document.documentElement.dataset].join('\n');
  if(looks.hidden||narrowBar.matches||!force&&key===labelKey)return;labelKey=key;
  // The room to spare is the space the button's own margin takes up, between the station's name and the button; none left
  // means the link's numbers are being squeezed.
  const short=button.classList.contains('short'),gap=parseFloat(getComputedStyle($('.bar')).columnGap)||0,spare=looks.getBoundingClientRect().left-$('.brand').getBoundingClientRect().right-gap;
  if(!short){labelRoom=button.offsetWidth-parseFloat(getComputedStyle(button).minWidth||0);if(spare<1)button.classList.add('short');}
  else if(spare>=labelRoom+16)button.classList.remove('short');
}
addEventListener('resize',()=>fitLooksLabel());document.fonts?.addEventListener?.('loadingdone',()=>fitLooksLabel(true));
// Under the button, below the bar, inside the window; two columns where they fit, and no taller than the room below the bar.
// A window too short for that has the menu come up over the bar, only as far as it needs, so every row can be reached.
function placeLooks(){
  const menu=$('#looks-menu'),bar=$('.bar').getBoundingClientRect();
  menu.classList.toggle('stacked',innerWidth<LOOKS_TWO_COLUMNS||menu.querySelectorAll('.looks-group').length<2);
  for(const list of menu.querySelectorAll('.looks-list'))list.style.maxHeight='';
  const below=bar.bottom+5,room=Math.floor(innerHeight-below-8),roomy=room>=LOOKS_MIN_ROOM;menu.style.top='';
  menu.style.maxHeight=(roomy?room:Math.max(0,innerHeight-2*LOOKS_EDGE))+'px';peekLooks(menu);
  if(!roomy){const top=Math.max(LOOKS_EDGE,Math.min(below,innerHeight-LOOKS_EDGE-menu.offsetHeight));menu.style.top=Math.round(top-bar.top)+'px';}
  const b=$('#looks-button').getBoundingClientRect();
  menu.style.left=Math.round(Math.max(4,Math.min(b.left-bar.left,bar.width-menu.offsetWidth-4)))+'px';
  looksEdges();
}
// A list longer than its room ends halfway through a row, never neatly at a row's edge, so the cut row says there is more.
// While there is more above or below, that edge fades into the menu (ds.css); the fade goes as the list reaches its end.
const LOOKS_FADE=24;// px of list left to scroll at which an edge's fade is whole
const looksScrollers=menu=>menu.classList.contains('stacked')?[menu]:[...menu.querySelectorAll('.looks-list')];
function peekLooks(menu){
  for(const box of looksScrollers(menu)){
    const view=box.clientHeight;if(box.scrollHeight<=view+1)continue;
    const top=box.getBoundingClientRect().top+box.clientTop-box.scrollTop;let cut=0;
    for(const row of box.querySelectorAll('.looks-item')){const r=row.getBoundingClientRect(),middle=r.top-top+r.height/2;if(middle>view)break;cut=middle;}
    if(cut>0)box.style.maxHeight=Math.floor(cut+box.offsetHeight-view)+'px';
  }
}
function looksEdges(){
  const menu=$('#looks-menu'),scrollers=looksScrollers(menu);
  for(const box of [menu,...menu.querySelectorAll('.looks-list')]){
    const scrolls=scrollers.includes(box),above=scrolls?box.scrollTop:0,below=scrolls?box.scrollHeight-box.clientHeight-box.scrollTop:0;
    box.classList.toggle('more-above',above>1);box.classList.toggle('more-below',below>1);
    for(const [name,left] of [['--looks-above',above],['--looks-below',below]]){const v=String(Math.round(Math.min(1,Math.max(0,left)/LOOKS_FADE)*100)/100);if(box.style.getPropertyValue(name)!==v)box.style.setProperty(name,v);}
  }
}
$('#looks-menu').addEventListener('scroll',looksEdges,{capture:true,passive:true});
function setLooks(open,focusButton=true){
  const menu=$('#looks-menu'),button=$('#looks-button'),was=looksOpen();if(open&&$('#ds-looks').hidden)return;
  if(open){setMenu(false);renderLooks();menu.hidden=false;placeLooks();button.setAttribute('aria-expanded','true');
    // Each list shows its pick; stacked, the menu starts at Theme.
    if(menu.classList.contains('stacked'))menu.scrollTop=0;else for(const r of menu.querySelectorAll('.looks-item[aria-checked=true]'))r.scrollIntoView({block:'nearest'});
    (menu.querySelector('.looks-item[tabindex="0"]'))?.focus();looksEdges();}
  else{menu.hidden=true;button.setAttribute('aria-expanded','false');if(was&&focusButton)button.focus();}
  menusChanged();
}
function pickLook(kind,id){setLooks(false);Promise.resolve(host.pickTheme({kind,id})).catch(e=>toast(e.message));}
$('#looks-button').onclick=()=>setLooks(!looksOpen());
$('#looks-button').onkeydown=e=>{if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!looksOpen()){e.preventDefault();setLooks(true);}};
// Keys: Up and Down move within a list (in the stacked menu, on into the next list), Home and End go to its ends, Left
// and Right or Tab go across to the other list, Escape closes. Shift+Tab from Theme goes back to the button. A list moves
// only as far as the row needs, which leaves it clear of the fade (ds.css), rather than jumping to put it in the middle.
$('#looks-menu').onkeydown=e=>{
  const menu=$('#looks-menu'),item=document.activeElement?.closest?.('.looks-item');
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setLooks(false);return;}
  if(!item)return;
  const lists=[...menu.querySelectorAll('.looks-list')],list=item.closest('.looks-list'),li=lists.indexOf(list),rows=[...list.querySelectorAll('.looks-item')],at=rows.indexOf(item);
  const stacked=menu.classList.contains('stacked'),go=b=>{if(!b)return;e.preventDefault();rove(b);b.focus({preventScroll:true});b.scrollIntoView({block:'nearest'});};
  const rowsOf=i=>[...(lists[i]?.querySelectorAll('.looks-item')||[])];
  const across=dir=>{const other=lists[li+dir];if(!other)return null;const r=rowsOf(li+dir);return r.find(b=>b.tabIndex===0)||r[Math.min(at,r.length-1)];};
  if(e.key==='ArrowDown')go(at<rows.length-1?rows[at+1]:stacked&&lists[li+1]?rowsOf(li+1)[0]:rows[0]);
  else if(e.key==='ArrowUp')go(at>0?rows[at-1]:stacked&&lists[li-1]?rowsOf(li-1).at(-1):rows.at(-1));
  else if(e.key==='Home')go(rows[0]);
  else if(e.key==='End')go(rows.at(-1));
  else if(e.key==='ArrowRight'&&!stacked)go(lists[li+1]?rowsOf(li+1)[Math.min(at,rowsOf(li+1).length-1)]:null);
  else if(e.key==='ArrowLeft'&&!stacked)go(lists[li-1]?rowsOf(li-1)[Math.min(at,rowsOf(li-1).length-1)]:null);
  else if(e.key==='Tab'&&!e.shiftKey&&lists[li+1])go(across(1));
  else if(e.key==='Tab'&&e.shiftKey){if(lists[li-1])go(across(-1));else{e.preventDefault();setLooks(false);}}
};
$('#looks-menu').addEventListener('focusin',e=>{const b=e.target.closest?.('.looks-item');if(b)rove(b);});
// Tabbing out of the menu closes it; a tap or click anywhere else does too.
$('#looks-menu').addEventListener('focusout',e=>{if(looksOpen()&&e.relatedTarget&&!e.relatedTarget.closest('#looks-menu, #looks-button'))setLooks(false,false);});
document.addEventListener('pointerdown',e=>{if(looksOpen()&&!e.target.closest('#looks-menu, #looks-button'))setLooks(false,false);});
addEventListener('resize',()=>{if(looksOpen())placeLooks();});
// While a menu, a dialog or one of the menu's pages is open, Escape only closes it: Torque is told, so the same key does
// not also leave fullscreen. Each is watched, so Torque hears however one opens or closes (the robot closes its own dialogs).
let menusWere=false;
const stationOpen=()=>looksOpen()||!$('#ds-menu').hidden||!$('#picker').hidden||$('#ds-dialog').open||$('#page-ask').open||!$('#ds-page').hidden;
function menusChanged(){const open=stationOpen();if(open!==menusWere){menusWere=open;try{host?.menuOpen?.(open);}catch{}}}
{const watch=new MutationObserver(menusChanged);for(const id of ['#ds-menu','#looks-menu','#picker','#ds-dialog','#page-ask','#ds-page'])watch.observe($(id),{attributes:true,attributeFilter:['hidden','open']});}
// The Driver Hub's menu: Settings, Restart Robot, Configure Robot, Program & Manage, Self Inspect and About.
function restartRobot(){stopCountdown();session.restartRobot();toast('Restarting Robot');}
$('#menu-settings').onclick=()=>menu(()=>window.DeckDsPages.settings());
$('#menu-restart').onclick=()=>menu(restartRobot);
$('#menu-configure').onclick=()=>menu(()=>window.DeckDsPages.configure());
$('#menu-inspect').onclick=()=>menu(()=>window.DeckDsPages.inspect());
$('#menu-manage').onclick=()=>menu(()=>{Promise.resolve(host.programAndManage?.()).catch(e=>toast(e.message));});
$('#menu-camera').onclick=()=>menu(openCamera);
$('#system-action').onclick=()=>void updateRobotController();
$('#menu-update-rc').hidden=!host?.updateRobotController;$('#menu-update-rc').onclick=()=>menu(()=>void updateRobotController());
$('#menu-about').onclick=()=>menu(()=>{aboutQuiet=false;session.requestAbout();const r=session.state.robot;showDialog('About',`Robot: ${info.name}\nAddress: ${info.host}\nRobocol: ${session.identity.version}${r?.sdk?`\nRobot Controller SDK: ${r.sdk}`:''}\n\nWaiting for the Robot Controller’s details…`);});
$('#menu-gamepads').onclick=()=>menu(()=>showDialog('Gamepad assignment','Click User 1 in the bar, then press any button on the gamepad you want to use.\n\nPlug in a second gamepad and it becomes User 2. To pick which one, click User 2 and press a button on it.\n\nOn a handheld such as a Steam Deck, its own controls are User 1 to begin with. Otherwise User 1 is the first gamepad Torque finds.'));
$('#ds-close').hidden=!host?.closeRobot;$('#ds-fullscreen').hidden=!host?.fullscreen;
$('#ds-close').onclick=()=>Promise.resolve(host.closeRobot()).catch(e=>toast(e.message));$('#ds-fullscreen').onclick=()=>Promise.resolve(host.fullscreen()).catch(e=>toast(e.message));
// Fullscreen keeps the bar: the same button, where it was, takes the station out again. A page from the menu covers the
// bar, so its head has the way out too, at the same end.
function showFullscreen(on){document.body.classList.toggle('fullscreen',on);const b=$('#ds-fullscreen'),label=on?'Leave fullscreen':'Fullscreen robot view';b.title=label;b.setAttribute('aria-label',label);
  const out=$('#page-fullscreen'),had=document.activeElement===out;out.hidden=!on||!host?.fullscreen;if(had&&out.hidden)$('#page-back').focus();}
$('#page-fullscreen').onclick=()=>Promise.resolve(host.fullscreen()).catch(e=>toast(e.message));
$('#camera-image').onclick=()=>session.requestFrame();$('#camera-close').onclick=closeCamera;
$('#auto-list').onclick=()=>openPicker('AUTONOMOUS');$('#teleop-list').onclick=()=>openPicker('TELEOP');
$('#opmode-name').onclick=()=>openPicker(selected?.flavor==='AUTONOMOUS'?'AUTONOMOUS':'TELEOP');
$('#picker-close').onclick=closePicker;$('#picker').onclick=e=>{if(e.target.id==='picker')closePicker();};
$('#main-action').onclick=mainAction;$('#abort').onclick=stop;
$('#timer').onclick=()=>{if(countdown===null){timerOn=!timerOn;queueRender();}};
$('#timer-switch').onchange=()=>{timerOn=$('#timer-switch').checked;queueRender();};
$('#practice-play').onclick=()=>practice?stopPractice():choosePractice();
$('#dialog-ok').onclick=()=>$('#ds-dialog').close();
for(const slot of [1,2])$('#pad-'+slot).onclick=()=>Promise.resolve(host.controllerCapture?.(slot)).catch(e=>toast(e.message));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(looksOpen()){setLooks(false);return;}if(window.DeckDsPages?.open()&&$('#ds-menu').hidden&&!$('#ds-dialog').open)(window.DeckDsPages.escape||window.DeckDsPages.back)();closePicker();setMenu(false);}
  // Space stops an initialized or running op mode, like an emergency stop key; not while typing a name.
  if(e.code==='Space'&&session&&session.state.opModeState!=='stopped'&&!$('#ds-dialog').open&&!e.target.closest?.('input,select,textarea')){e.preventDefault();stop();}
});

async function boot(){
  if(!host){$('#link-text').textContent='Driver Station Unavailable';$('#link-banner').className='banner bad';$('#status-line').textContent='Open this robot from Torque’s Drive page.';return;}
  try{info={...info,...await host.info()};}catch{}if(overUsb()&&info.ssid)robotNetwork=info.ssid;
  const applyTheme=t=>{if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;};
  applyTheme(info.theme);host.onTheme?.(t=>{applyTheme(t);if(looksOpen())renderLooks();});
  // The theme Torque picked for this robot (docs/THEMES.md): colours, and a theme's picture and logo if it has them.
  // DEV's moving ground rests while this station cannot be seen: the window minimised or hidden, or its view put away.
  let unseen=!!info.hidden;const rest=()=>{try{window.DeckAscii?.pause?.(document,unseen);}catch{}};host.onWindowState?.(s=>{unseen=!!s?.hidden;rest();});
  const applyLook=l=>{look=l||null;try{window.DeckThemes?.apply(document,l?.theme||null,{font:l?.font});}catch{}rest();renderLooks();};applyLook(info.look);host.onLook?.(applyLook);showFullscreen(!!info.fullscreen);host.onFullscreen?.(showFullscreen);
  window.deckControllerAssignments=()=>Array.from(navigator.getGamepads?.()||[]).slice(0,2).map(p=>p?{id:p.id,index:p.index,mapping:p.mapping,connected:true}:null);
  $('#pad-1').title='Click, then press a button to assign controller 1';
  $('#ds-name').textContent=dsName();document.title=`${info.name||'FTC Robot'} · ${dsName()}`;
  try{const b=await navigator.getBattery?.();if(b){dsBattery=b;for(const e of ['levelchange','chargingchange'])b.addEventListener(e,renderBattery);}}catch{}renderBattery();
  session=new R.DriverStation({send:bytes=>host.send(bytes)});host.onPacket(bytes=>session.receive(bytes));
  host.onRobotName?.(n=>{robotNetwork=String(n||'');$('#ds-name').textContent=dsName();queueRender();});host.onLinkNote?.(n=>{linkNote=String(n||'');queueRender();});
  host.onActive?.(on=>{inputsOn=on;shown=on;pollGamepads();if(!on)game?.pause();renderGame(session.state.connection==='connected');});
  session.on('state',queueRender);
  window.DeckDsPages.init({session,host,toast,prefs,savePrefs,dsName,restart:restartRobot});
  // Setup's Configure Robot button opens the same page as this Driver Hub's three-dot menu.
  host.onOpen?.(page=>{if(page==='configure')window.DeckDsPages.configure();});if(info.open==='configure')window.DeckDsPages.configure();
  // The autonomous the simulator's Send to robot just built is selected once the robot lists it, unless one is chosen first.
  let sent=info.select||null;
  session.on('state',s=>{if(!sent)return;if(selected||s.opModeState!=='stopped'){sent=null;return;}const m=opMode(sent);if(m){selected=m;sent=null;toast(`Torque just sent ${m.name} to the robot, so it is selected.`);queueRender();}});
  session.on('op-mode-ended',m=>{const next=m.autoTransition&&opMode(m.autoTransition);if(next&&next.flavor==='TELEOP'){selected=next;timerOn=false;session.initOpMode(next.name);toast(`Initializing ${next.name}`);}});
  session.on('toast',t=>toast(t.message,(t.duration||3)*1000));
  session.on('dialog',d=>{$('#ds-dialog').dataset.id=d.id;showDialog(d.title||'Robot Controller',d.message);});
  session.on('dismiss-dialog',id=>{const d=$('#ds-dialog');if(d.open&&(id==='*'||d.dataset.id===id))d.close();});
  session.on('stacktrace',text=>{$('#ds-dialog').dataset.id='';showDialog('Op mode stopped by an error',text);});
  session.on('progress',p=>{$('#progress').hidden=!p;if(p){$('#progress-text').textContent=p.message;$('#progress-bar').max=p.max||100;$('#progress-bar').value=p.cur||0;}});
  session.on('rumble',e=>void rumble(e));
  session.on('speech',s=>{try{const u=new SpeechSynthesisUtterance(s.text);if(s.languageCode)u.lang=s.languageCode+(s.countryCode?'-'+s.countryCode:'');speechSynthesis.speak(u);}catch{}});
  session.on('frame',showFrame);
  session.on('about',a=>{const n=networkName(a);if(n&&n!==robotNetwork){robotNetwork=n;$('#ds-name').textContent=dsName();queueRender();}if(aboutQuiet){aboutQuiet=false;return;}showDialog('About',`Robot: ${info.name}\nAddress: ${info.host}\nRobot Controller app: ${a.appVersion||'—'}\nSDK library: ${a.libVersion||'—'}\nRobocol: ${a.networkProtocolVersion||session.identity.version}\nBuilt: ${a.buildTime||'—'}\nOperating system: ${a.osVersion||'—'}\nNetwork: ${a.networkConnectionInfo||'—'}`);});
  session.on('connected',()=>{aboutQuiet=true;session.requestAbout();});
  session.on('disconnected',()=>{stopCountdown();toast('Robot connection lost. Searching…');});
  window.deckShutdown=()=>{session.shutdown();return true;};window.addEventListener('pagehide',()=>session.shutdown());
  window.addEventListener('blur',pollGamepads);window.addEventListener('focus',pollGamepads);
  session.start();render();setInterval(pollGamepads,20);
}
void boot();
})();
