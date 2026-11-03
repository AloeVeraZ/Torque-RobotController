'use strict';
// The Driver Hub's full-screen menu pages: Settings, Configure Robot and Self Inspect. Each talks to the robot over the
// Driver Station's own Robocol session (FtcEventLoopBase, FTC SDK 12.0):
//  - Configure Robot: CMD_REQUEST_CONFIGURATIONS lists the saved configurations and CMD_REQUEST_PARTICULAR_CONFIGURATION
//    reads one; New scans the hubs (CMD_SCAN, then CMD_DISCOVER_LYNX_MODULES per portal); CMD_SAVE_CONFIGURATION writes
//    one and makes it active; CMD_ACTIVATE_CONFIGURATION and CMD_DELETE_CONFIGURATION do the rest. Leaving after a change
//    restarts the robot, as the Driver Hub does, so the hardware map is built from the active configuration.
//  - Self Inspect: CMD_REQUEST_INSPECTION_REPORT, beside this Driver Station's own report.
(()=>{
const $=s=>document.querySelector(s),C=window.DeckRobotConfig,A=window.DeckDeviceArt,P=window.DeckPinout;
let ctx=null,onBack=null;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function button(text,cls,fn){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
const configFile=name=>({name,resourceId:0,location:'LOCAL_STORAGE',isDirty:false});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const connected=()=>ctx.session.state.connection==='connected';
// Sends a command and waits for the robot's <command>_RESP.
function ask(name,extra='',ms=8000){const s=ctx.session;return new Promise((done,fail)=>{
  const off=s.on('command',c=>{if(c.name===name+'_RESP'){clearTimeout(t);off();done(c.extra);}}),t=setTimeout(()=>{off();fail(Error(`The robot did not answer ${name}.`));},ms);s.command(name,extra);});}
function until(test,ms,message){const s=ctx.session;return new Promise((done,fail)=>{if(test(s.state))return done();const off=s.on('state',v=>{if(test(v)){clearTimeout(t);off();done();}}),t=setTimeout(()=>{off();fail(Error(message));},ms);});}

// ---- the page shell: a title bar with Back, actions on the right, a status line and the body ----------------------------
function open(title,back){$('#page-title').textContent=title;$('#page-actions').replaceChildren();$('#page-body').replaceChildren();status('');onBack=back;$('#ds-page').hidden=false;$('#page-back').focus();}
function close(){$('#ds-page').hidden=true;onBack=null;}
function status(text,kind=''){const s=$('#page-status');s.textContent=text;s.className='page-status'+(kind?' '+kind:'');s.hidden=!text;}
function actions(...items){$('#page-actions').replaceChildren(...items);}
$('#page-back').onclick=()=>{if(onBack)onBack();else close();};
// A question in the page's own dialog: {title, text, input?: default value, ok}. Resolves with the value (or true), or
// null on Cancel. check(value) returns an error to show, or ''.
function ask2({title,text='',input=null,ok='OK',check=()=>''}){
  const d=$('#page-ask'),field=$('#page-ask-input'),error=$('#page-ask-error');$('#page-ask-title').textContent=title;$('#page-ask-text').textContent=text;$('#page-ask-ok').textContent=ok;
  field.hidden=input===null;field.value=input??'';error.textContent='';d.showModal();(input===null?$('#page-ask-ok'):field).focus();if(input!==null)field.select();
  return new Promise(done=>{const finish=v=>{d.close();$('#page-ask-ok').onclick=$('#page-ask-cancel').onclick=field.onkeydown=d.oncancel=null;done(v);};
    const accept=()=>{const v=input===null?true:field.value.trim(),e=input===null?'':check(v);if(e){error.textContent=e;field.focus();return;}finish(v);};
    $('#page-ask-ok').onclick=accept;$('#page-ask-cancel').onclick=()=>finish(null);d.oncancel=e=>{e.preventDefault();finish(null);};
    field.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();accept();}};});}

// ---- Configure Robot ----------------------------------------------------------------------------------------------------
let files=[],changed=false,edit=null,working=false;
async function configure(){changed=false;edit=null;open('Configure Robot',leaveConfigure);void Promise.resolve(ctx.host.devicePhotos?.()).catch(()=>{});await loadList();}
function leaveConfigure(){close();if(changed&&connected()){ctx.session.restartRobot();ctx.toast('Restarting Robot');}changed=false;}
// Runs one robot action with the page's buttons held, showing what it is doing and any error.
async function run(doing,task){if(working)return;working=true;status(doing);for(const b of document.querySelectorAll('#ds-page button:not(#page-back)'))b.disabled=true;
  try{await task();status('');}catch(e){status(e.message,'error');}finally{working=false;for(const b of document.querySelectorAll('#ds-page button'))b.disabled=false;refreshButtons();}}
function refreshButtons(){if(edit)return;for(const b of document.querySelectorAll('#page-body [data-needs-robot], #page-actions [data-needs-robot]'))b.disabled=!connected();
  for(const b of document.querySelectorAll('#page-body [data-active]'))b.disabled=b.disabled||b.dataset.active==='1';}
async function readList(){const list=JSON.parse(await ask('CMD_REQUEST_CONFIGURATIONS'));files=(Array.isArray(list)?list:[]).filter(c=>c&&typeof c.name==='string'&&c.name).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));}
async function loadList(){edit=null;renderList();
  // Opened as the link comes up, it waits a moment for the robot.
  if(!connected()){status('Connecting to the robot…');try{await until(s=>s.connection==='connected',10000,'not connected');}catch{status('Connect to the robot to configure it. Its configurations are kept on the Robot Controller.','warning');return;}renderList();}
  await run('Reading the robot’s configurations…',readList);renderList();}
function renderList(){
  $('#page-title').textContent='Configure Robot';const active=ctx.session.state.activeConfig?.name||'';
  const add=button('New','ok',()=>void newConfiguration());add.dataset.needsRobot='';actions(add);
  const head=el('div','cfg-active');head.append(el('span','','Active configuration'),el('b','',files.some(f=>f.name===active)?active:'<No Config Set>'));
  const list=el('div','cfg-list');list.setAttribute('role','list');
  if(!files.length)list.append(el('p','cfg-empty',connected()?'This robot has no saved configurations. Press New to scan the robot’s hubs and make one.':'Not connected to the robot.'));
  for(const f of files){const row=el('div','cfg-row'+(f.name===active?' active':''));row.setAttribute('role','listitem');const name=el('div','cfg-name');name.append(el('b','',f.name));if(f.name===active)name.append(el('small','','Active'));
    const fixed=f.location&&f.location!=='LOCAL_STORAGE';if(fixed)name.append(el('small','muted','Built into the robot app'));
    const buttons=el('div','cfg-buttons'),e=button('Edit','cfg-btn',()=>void openEditor(f)),a=button('Activate','cfg-btn',()=>void activate(f)),d=button('Delete','cfg-btn danger',()=>void remove(f)),g=button('Get pinout','cfg-btn pinout',()=>void pinoutOf(f)),u=button('Use in Setup','cfg-btn',()=>void useInSetup(f));
    for(const b of [e,a,d,g,u])b.dataset.needsRobot='';a.dataset.active=f.name===active?'1':'0';if(fixed){e.disabled=d.disabled=true;delete e.dataset.needsRobot;delete d.dataset.needsRobot;}
    buttons.append(u,e,a,d,g);row.append(name,buttons);list.append(row);}
  $('#page-body').replaceChildren(head,list);refreshButtons();
}
// Setup, Simulate and Calibrate take this configuration's hubs, motors, servos and sensors.
async function useInSetup(f){let xml='';await run(`Reading “${f.name}”…`,async()=>{xml=await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(f));C.parse(xml);});if(!xml)return;
  ctx.host.useConfiguration?.({name:f.name,xml});ctx.toast(`Setup, Simulate and Calibrate now use “${f.name}”.`,4000);}
const nameCheck=v=>!C.validName(v)?'Use letters, digits, spaces, - and _ (up to 40), starting with a letter or digit.':files.some(f=>f.name.toLowerCase()===v.toLowerCase())?`The robot already has a configuration named “${v}”.`:'';
// New, as the Driver Hub's New then Scan: the hubs the robot finds, the Control Hub's IMU on its I2C bus 0 as "imu".
async function newConfiguration(){
  const name=await ask2({title:'New configuration',text:'Name the configuration. Deck scans the robot for its Control Hub, Expansion Hubs and Servo Hubs; then press Edit to add hubs that are not plugged in yet and say what is on each port.',input:C.configurationName('robot',files.map(f=>f.name)),ok:'Create',check:nameCheck});if(!name)return;
  await run(`Scanning the robot for hubs…`,async()=>{
    // The robot has its Control Hub open, so the scan leaves that IMU UNKNOWN; its web server says which one it is.
    const portals=await scanPortals();
    if(!portals.length)throw Error('The scan found no hubs. Check the hubs are powered and connected, then try again.');
    const imus=[];for(const p of portals){const parent=p.modules.find(m=>m.parent),tag=parent&&C.IMU_TAGS[parent.imu];if(tag&&p.serial==='(embedded)')imus.push({name:'imu',tag,device:'imu',port:0,bus:0,module:{portal:p.serial,address:parent.address,name:'Control Hub'}});}
    status(`Saving “${name}”…`);await save(name,C.newConfiguration(portals,imus));await readList();changed=true;
    ctx.toast(`“${name}” is saved with ${portals.reduce((n,p)=>n+p.modules.length,0)} hub${portals.reduce((n,p)=>n+p.modules.length,0)===1?'':'s'}. Press Edit to set its ports.`,4500);});
  renderList();
}
// Writes xml under name (the robot makes it active), then reads it back to be sure the robot has it.
async function save(name,xml){
  if(xml.includes(';'))throw Error('A name has ; & < > " or \' in it, which the robot cannot take.');if(new TextEncoder().encode(xml).length>60000)throw Error('This configuration is too large to send.');
  const want=C.parse(xml).devices;ctx.session.command('CMD_SAVE_CONFIGURATION',`${JSON.stringify(configFile(name))};${xml}`);
  await until(s=>s.activeConfig?.name===name,15000,`The robot did not save “${name}”. Check the Robot Controller app, then try again.`);
  for(let i=0;i<5;i++){let got=null;try{got=C.parse(await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(configFile(name)))).devices;}catch{}
    if(got&&got.length===want.length&&want.every(d=>got.some(g=>g.name===d.name&&g.tag===d.tag&&g.port===d.port&&g.bus===d.bus)))return;await delay(300);}
  throw Error(`The robot saved “${name}” differently from what was sent. Open it again to check.`);
}
async function activate(f){await run(`Activating “${f.name}”…`,async()=>{ctx.session.command('CMD_ACTIVATE_CONFIGURATION',JSON.stringify(f));
  await until(s=>s.activeConfig?.name===f.name,10000,`The robot did not make “${f.name}” active.`);changed=true;ctx.toast(`“${f.name}” is active. The robot restarts when you leave Configure Robot.`,4000);});renderList();}
async function remove(f){
  const active=ctx.session.state.activeConfig?.name===f.name;
  if(!await ask2({title:`Delete “${f.name}”?`,text:`The robot deletes this configuration file. This cannot be undone.${active?' It is the active configuration, so the robot will have none until you activate another.':''}`,ok:'Delete'}))return;
  await run(`Deleting “${f.name}”…`,async()=>{ctx.session.command('CMD_DELETE_CONFIGURATION',JSON.stringify(f));
    for(let i=0;i<10;i++){await delay(250);await readList();if(!files.some(x=>x.name===f.name))break;}
    if(files.some(x=>x.name===f.name))throw Error(`The robot did not delete “${f.name}”.`);if(active)changed=true;ctx.toast(`Deleted “${f.name}”.`);});renderList();}

// ---- Edit: the Driver Hub's drill-down. The configuration lists its USB devices (a Control Hub's own board is the
// Control Hub Portal; an Expansion Hub on USB is its own portal); a portal lists its hubs (an Expansion Hub on the
// Control Hub's RS485 wire sits in the Control Hub Portal); a hub lists Motors, Servos, Digital Devices, Analog Input
// Devices and I2C Bus 0 to 3, the same on a Control Hub and an Expansion Hub; each lists its ports.
// Device types and their names as the Driver Hub's lists show them (FTC SDK 12.0 @MotorType/@ServoType/@DeviceProperties).
const TYPES=C.DEVICE_TYPES;
const familyOf=tag=>{for(const [f,list] of Object.entries(TYPES))if(list.some(([t])=>t===tag))return f;return C.familyOfTag(tag);};
const TITLES={motor:'Motors',servo:'Servos',digital:'Digital Devices',analog:'Analog Input Devices'},SINGULAR={motor:'motor',servo:'servo',digital:'digital device',analog:'analog input'};
const sameHub=(d,h)=>d.module&&d.module.portal===h.portal&&d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub');
const portalName=serial=>serial==='(embedded)'?'Control Hub Portal':`Expansion Hub Portal (${serial})`;
// Wiring notes for a configuration: the ones in its file when the robot sends them, else the ones this computer keeps
// for this robot (the Robot Controller sends configurations without comments).
let robotId=null;const robotKey=async()=>robotId||=await robotName()||null;
async function notesFor(name,xml){const own=C.notesOf(xml);if(Object.keys(own).length||!ctx.host.wiringNotes)return own;try{const robot=await robotKey();return robot?C.cleanNotes(await ctx.host.wiringNotes({robot,name})):{};}catch{return {};}}
async function keepNotes(name,notes){try{const robot=await robotKey();if(robot)await ctx.host.wiringNotes?.({robot,name,notes});}catch{}}
// Every hub the robot finds right now: its scan, corrected by the hubs its web server has open. Never starts anything.
async function scanPortals(){
  const serials=C.lynxSerials(await ask('CMD_SCAN','',20000)),found=[];
  for(const serial of serials)found.push(await C.discover(()=>ask('CMD_DISCOVER_LYNX_MODULES',serial,20000)));
  let live=[];if(ctx.host.rcHubs){try{live=await ctx.host.rcHubs();}catch{}}
  const portals=C.withLiveHubs(found,live).filter(p=>p.modules.length);
  return C.unknownImus(portals)?C.withImus(portals,live):portals;}
// The hubs the Robot Controller has open, from its web server: nothing on the RS485 wire is touched. A scan asks every hub
// again, and a real Servo Hub has failed to answer during one ("Failed to determine the REV product number"), so opening a
// configuration never scans; Scan for new hubs does, when asked.
async function openHubs(){if(!ctx.host.rcHubs)return [];const live=await ctx.host.rcHubs(),serials=[...new Set(live.map(h=>h?.parentSerial).filter(s=>typeof s==='string'))];
  return C.withLiveHubs(serials.map(serial=>({serial,modules:[]})),live).filter(p=>p.modules.length);}
async function openEditor(f){
  let xml='',notes={},scan=null;await run(`Reading “${f.name}” and checking what is plugged in…`,async()=>{xml=await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(f));C.parse(xml);notes=await notesFor(f.name,xml);try{const found=await openHubs();if(found.length)scan=found;}catch{}});if(!xml)return;
  const {devices,hubs}=C.parse(xml),lynx=hubs.filter(h=>Number.isFinite(h.address)&&(h.tag==='LynxModule'||h.tag==='ServoHub'));
  // connected: the hubs found plugged in, null when the robot could not be asked.
  const onHubs=devices.filter(d=>d.module),match=C.matchHubs(lynx,scan,onHubs);
  edit={file:f,xml,hubs:match.hubs,portals:[...new Set(match.hubs.map(h=>h.portal))],view:[],dirty:match.added.length+match.fixed.length>0,connected:scan?match.connected:null,devices:onHubs.map(d=>({...d,...(notes[d.name]||{}),family:familyOf(d.tag)})),other:devices.filter(d=>!d.module)};
  const said=[...(match.added.length?[`Found ${match.added.join(', ')} plugged in and added it.`]:[]),...(match.fixed.length?[`Corrected ${match.fixed.join(', ')} to what the robot reports.`]:[]),...match.wrong.map(w=>`${w.name} is really a ${w.is}. Move the devices on it, then open this again.`)];
  if(said.length)ctx.toast(`${said.join(' ')}${edit.dirty?' Press Save to keep this.':''}`,6000);
  $('#page-back').onclick=()=>editBack();renderEditor();
}
function editBack(){if(edit.view.length){edit.view.pop();status('');renderEditor();}else void leaveEditor();}
function go(step){edit.view.push(step);status('');renderEditor();$('#page-body').scrollTop=0;}
async function leaveEditor(){if(edit?.dirty&&!await ask2({title:'Discard changes?',text:`Your changes to “${edit.file.name}” are not saved.`,ok:'Discard'}))return;
  edit=null;$('#page-back').onclick=()=>{if(onBack)onBack();else close();};status('');renderList();}
// ---- device pictures: the product photo from the maker's listing (fetched by the app while online and kept on this
// computer), with Deck's drawing until it arrives or when there is none --------------------------------------------------
const photoCache=new Map();
function photo(tag){if(!tag||!A.photoOf(tag)||!ctx.host.devicePhoto)return Promise.resolve(null);
  if(!photoCache.has(tag))photoCache.set(tag,Promise.resolve(ctx.host.devicePhoto(tag)).then(url=>url?P.shrink(url,A.photoOf(tag).mask):null).catch(()=>null).then(v=>{if(!v)photoCache.delete(tag);return v;}));
  return photoCache.get(tag);}
// A device's picture: its drawing at once, its product photo when that arrives.
function figure(tag,cls=''){const f=el('span',`dev-fig ${cls}`);if(!tag){f.classList.add('empty');return f;}f.innerHTML=A.svg(tag,{title:false});
  void photo(tag).then(url=>{if(!url)return;const img=el('img');img.alt='';img.src=url;f.replaceChildren(img);f.classList.add('photo');});return f;}
// ---- the device picker: a list of every type a port takes, grouped by maker, with a large picture and what the type is
// for the one under the pointer or focus. Replaces a plain <select> so a team can see what it is choosing. -------------
const PLUGS={motor:'A motor port (JST-VH 2-pin) for power, and the encoder port beside it (JST-PH 4-pin) for its encoder cable.',servo:'A servo port: 3-pin 0.1″ header (ground, +5 V, signal).',
  digital:'A digital port: JST-PH 4-pin, two channels per connector.',analog:'An analog port: JST-PH 4-pin, two channels per connector.',i2c:'An I2C port: JST-PH 4-pin. Each port is its own bus.'};
const nameOf=(family,tag)=>(TYPES[family]?.find(([t])=>t===tag)||[tag,A.info(tag).name])[1];
let menu=null;
function closeMenu(){if(!menu)return false;const m=menu;menu=null;m.backdrop.remove();m.remove();m.anchor?.isConnected&&m.anchor.focus();return true;}
function typeSelect(family,tag,label,onPick,{nothing=true}={}){
  const b=button('','dev-pick',()=>openMenu(b,family,tag,onPick,nothing));b.setAttribute('aria-label',`${label}: ${tag?nameOf(family,tag):'Nothing'}`);b.setAttribute('aria-haspopup','dialog');
  b.append(figure(tag,'small'),el('span','dev-pick-name',tag?nameOf(family,tag):'Nothing'),el('i','dev-caret','▾'));return b;}
function openMenu(anchor,family,tag,onPick,nothing){
  closeMenu();const m=el('div','dev-menu'),backdrop=el('div','dev-backdrop'),list=el('div','dev-list'),view=el('div','dev-view');
  m.setAttribute('role','dialog');m.setAttribute('aria-label',`Choose what is on this ${SINGULAR[family]||'I2C'} port`);list.setAttribute('role','listbox');
  const show=t=>{const i=A.info(t),p=A.photoOf(t),facts=el('dl','dev-facts');
    if(!t){view.replaceChildren(figure('','big'),el('h3','','Nothing'),el('p','','Leave this port empty.'));return;}
    const fact=(k,v)=>{if(v)facts.append(el('dt','',k),el('dd','',v));};
    fact('Plugs into',i.builtIn?'Nothing: it is built into the hub, on I2C bus 0.':PLUGS[family]);if(i.addr!==undefined)fact('I2C address',A.hex(i.addr));
    if(A.GEARING[t])fact('Gearing','Choose its gear ratio on the port after picking it.');fact('Picture',p?`${p.caption} · ${p.site}`:'Drawing (no store listing)');
    view.replaceChildren(figure(t,'big'),el('h3','',nameOf(family,t)),el('small','dev-maker',i.maker),el('p','',i.what),facts);};
  const options=[],add=(t,l)=>{const o=button('','dev-option'+(t===(tag||'')?' chosen':''),()=>{closeMenu();if(t!==(tag||''))onPick(t);});o.setAttribute('role','option');o.setAttribute('aria-selected',String(t===(tag||'')));
    const words=el('span','dev-option-text');words.append(el('b','',l),el('small','',t?A.info(t).maker:'Port left empty'));o.append(figure(t,'small'),words);o.onpointerenter=()=>show(t);o.onfocus=()=>show(t);options.push(o);return o;};
  if(nothing)list.append(add('','Nothing'));
  const types=[...TYPES[family]];if(tag&&!types.some(([t])=>t===tag))types.push([tag,tag]);const groups=new Map();
  for(const [t,l] of types){const g=A.info(t).maker||'Other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push([t,l]);}
  for(const [g,items] of groups){list.append(el('h4','dev-group',g));for(const [t,l] of items)list.append(add(t,l));}
  const head=el('div','dev-head');head.append(el('b','',family==='i2c'?'Choose an I2C device':`Choose a ${SINGULAR[family]}`),button('Close','cfg-btn dev-close',()=>closeMenu()));
  const panes=el('div','dev-panes');panes.append(list,view);m.append(head,panes);
  m.onkeydown=e=>{const i=options.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();options[Math.max(0,Math.min(options.length-1,(i<0?0:i)+(e.key==='ArrowDown'?1:-1)))].focus();}
    else if(e.key==='Home'||e.key==='End'){e.preventDefault();options[e.key==='Home'?0:options.length-1].focus();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenu();}};
  backdrop.onpointerdown=()=>closeMenu();document.body.append(backdrop,m);menu=m;m.anchor=anchor;m.backdrop=backdrop;
  // Below the button when it fits, else above; never off screen.
  const r=anchor.getBoundingClientRect(),vw=innerWidth,vh=innerHeight,w=Math.min(780,vw-24),below=vh-r.bottom-12,above=r.top-12,h=Math.min(560,Math.max(below,above));
  m.style.width=w+'px';m.style.maxHeight=h+'px';m.style.left=Math.max(12,Math.min(r.left,vw-w-12))+'px';if(below>=Math.min(420,h)||below>=above)m.style.top=(r.bottom+6)+'px';else m.style.bottom=(vh-r.top+6)+'px';
  show(tag||'');(options.find(o=>o.classList.contains('chosen'))||options[0])?.focus();options.find(o=>o.classList.contains('chosen'))?.scrollIntoView({block:'nearest'});
}
// A motor's gear ratio and whether its encoder cable is plugged in, as Deck's wiring notes in the configuration.
function motorDetails(d){
  const box=el('div','cfg-motor-details'),gears=A.GEARING[d.tag];
  if(gears){const s=el('select','cfg-type');s.setAttribute('aria-label',`${d.name||'Motor'} gear ratio`);s.append(new Option('Gear ratio: not set',''));for(const g of gears)s.append(new Option(g.label,g.id));
    s.value=gears.some(g=>g.id===d.gear)?d.gear:'';s.onchange=()=>{d.gear=s.value||undefined;edit.dirty=true;};const l=el('label','cfg-detail');l.append(el('span','','Gearbox'),s);box.append(l);}
  const sw=el('label','switch'),i=el('input');i.type='checkbox';i.checked=d.encoder!==false;i.setAttribute('aria-label',`${d.name||'Motor'} encoder cable plugged in`);i.onchange=()=>{d.encoder=i.checked;edit.dirty=true;};sw.append(i,el('i'));
  const enc=el('label','cfg-detail');enc.append(el('span','','Encoder cable plugged in'),sw);box.append(enc);return box;}
function nameInput(d,label){const i=el('input','cfg-device-name');i.value=d.name||'';i.placeholder='Device name';i.maxLength=40;i.spellcheck=false;i.setAttribute('aria-label',label);
  i.oninput=()=>{d.name=i.value.trim();edit.dirty=true;i.classList.remove('bad');};return i;}
// A row that opens the next level: its title and what is in it.
function entry(title,detail,fn){const b=button('','cfg-entry',fn);const t=el('span','cfg-entry-text');t.append(el('b','',title),el('small','',detail));b.append(t,el('i','cfg-chevron','›'));return b;}
const count=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
function renderEditor(){
  const e=edit,v=e.view.at(-1)||{},hub=v.hub!==undefined?e.hubs[v.hub]:null,on=d=>hub&&sameHub(d,hub);
  const saveBtn=button('Save','ok',()=>void saveEdit());saveBtn.dataset.needsRobot='';actions(button('Pinout','cfg-btn',()=>void showPinout(e.file.name,editedConfig(),{unsaved:e.dirty})),button('Cancel','cfg-btn',()=>void leaveEditor()),saveBtn);if(!connected())saveBtn.disabled=true;
  const crumbs=[e.file.name,...e.view.map(s=>s.family?(s.family==='i2c'?`I2C Bus ${s.bus}`:TITLES[s.family]):s.hub!==undefined?e.hubs[s.hub].name:portalName(s.portal))];
  $('#page-title').textContent=crumbs.at(-1);const body=[el('p','cfg-trail',crumbs.join('  ›  '))];
  if(!e.view.length){body.push(el('h3','cfg-heading','USB Devices in configuration'));
    for(const p of e.portals){const hubs=e.hubs.filter(h=>h.portal===p);body.push(entry(portalName(p),hubs.map(h=>h.name).join(', '),()=>go({portal:p})));}
    if(!e.portals.length)body.push(el('p','cfg-empty','This configuration has no hubs. Delete it and press New to scan the robot again.'));
    if(e.other.length)body.push(el('h3','cfg-heading','Other devices'),el('p','cfg-none',`${e.other.map(d=>`${d.name} (${d.tag})`).join(', ')}: kept as they are.`));}
  else if(!hub){body.push(el('h3','cfg-heading',`Hubs in ${portalName(v.portal)}`));
    // The Control Hub first, then the hubs on its RS485 wire by address.
    e.hubs.map((h,i)=>[h,i]).sort(([a],[b])=>Number(b.parent)-Number(a.parent)||(a.tag==='ServoHub')-(b.tag==='ServoHub')||a.address-b.address).forEach(([h,i])=>{if(h.portal!==v.portal)return;const n=e.devices.filter(d=>sameHub(d,h)).length;body.push(entry(h.name,`${h.tag==='ServoHub'?'Servo Hub':h.parent?'Control Hub':'Expansion Hub'} · address ${h.address} · ${n?count(n,'device'):'nothing set up on it yet'}${e.connected?(e.connected.has(C.hubKey(h.portal,h.address))?' · connected':' · not found on the robot'):''}`,()=>go({portal:v.portal,hub:i})));});
    // A hub on the RS485 chain can be written in before it is plugged in; the robot warns it is missing until it is.
    const addHub=(word,tag)=>button(`Add ${word}`,'cfg-btn cfg-add',()=>{const h=C.newHub(e.hubs,tag,v.portal);if(!h){status('Every RS485 address from 1 to 10 is taken.','error');return;}e.hubs.push(h);e.dirty=true;renderEditor();});
    // A hub that is plugged in stays: only one the robot did not find can be taken out, and if the robot could not be asked, only after saying so.
    for(const h of [...e.hubs])if(h.portal===v.portal&&!h.parent&&!e.devices.some(d=>sameHub(d,h))&&!e.connected?.has(C.hubKey(h.portal,h.address)))body.push(button(`Remove ${h.name}`,'cfg-btn danger',async()=>{if(!e.connected&&!await ask2({title:`Remove ${h.name}?`,text:'Deck could not check what is plugged in. If this hub is connected, keep it here: the robot needs it in its configuration to use it.',ok:'Remove'}))return;e.hubs.splice(e.hubs.indexOf(h),1);e.dirty=true;renderEditor();}));
    body.push(button('Scan for new hubs','cfg-btn cfg-add',()=>void run('Scanning the robot for hubs…',async()=>{const found=await scanPortals();if(!found.length)throw Error('The scan found no hubs. Check the hubs are powered and connected, then try again.');
      const m=C.matchHubs(e.hubs,found,e.devices);e.hubs.splice(0,e.hubs.length,...m.hubs);e.connected=m.connected;e.portals=[...new Set(e.hubs.map(h=>h.portal))];if(m.added.length+m.fixed.length)e.dirty=true;
      ctx.toast(m.added.length?`Found ${m.added.join(', ')}. Press Save to keep it.`:'No new hubs found.',4500);renderEditor();})));
    body.push(addHub('an Expansion Hub','LynxModule'),addHub('a Servo Hub','ServoHub'));
    if(e.hubs.filter(h=>h.portal===v.portal&&!h.parent&&h.tag==='LynxModule').length>1)body.push(el('p','cfg-none','A competition robot may have only one Expansion Hub with its Control Hub (R701).'));}
  else if(!v.family){
    const families=hub.tag==='ServoHub'?['servo']:['motor','servo','digital','analog'];
    for(const f of families){const n=e.devices.filter(d=>on(d)&&d.family===f).length;body.push(entry(TITLES[f],`Ports 0–${C.PORT_COUNT[f]-1} · ${n} configured`,()=>go({...v,family:f})));}
    if(hub.tag!=='ServoHub')for(let bus=0;bus<4;bus++){const list=e.devices.filter(d=>on(d)&&d.family==='i2c'&&d.bus===bus);body.push(entry(`I2C Bus ${bus}`,list.length?list.map(d=>d.name||'(no name)').join(', '):'No devices',()=>go({...v,family:'i2c',bus})));}}
  else if(v.family!=='i2c'){const f=v.family,box=el('div','cfg-ports');
    for(let port=0;port<C.PORT_COUNT[f];port++){const d=e.devices.find(x=>on(x)&&x.family===f&&x.port===port),label=`${hub.name} ${SINGULAR[f]} port ${port}`;
      const row=el('div','cfg-port'+(d?' used':''));row.append(el('span','cfg-port-no',`Port ${port}`),typeSelect(f,d?.tag,`${label} type`,tag=>{
        if(!tag)e.devices.splice(e.devices.indexOf(d),1);else if(d)d.tag=tag;else e.devices.push({name:'',tag,port,family:f,module:{portal:hub.portal,address:hub.address,...(hub.tag==='ServoHub'?{servoHub:true}:{})}});
        e.dirty=true;renderEditor();if(tag&&!d)document.querySelectorAll('.cfg-port')[port]?.querySelector('input')?.focus();}));
      row.append(d?nameInput(d,`${label} name`):el('span','cfg-none','NO DEVICE ATTACHED'));if(d&&f==='motor')row.append(motorDetails(d));box.append(row);}
    if(f==='digital')body.push(el('p','cfg-none','A REV Touch Sensor reads on the odd channel of each digital connector (1, 3, 5, 7).'));
    body.push(box);}
  else{const bus=v.bus,list=e.devices.filter(d=>on(d)&&d.family==='i2c'&&d.bus===bus).sort((a,b)=>a.port-b.port),box=el('div','cfg-ports');
    if(!list.length)box.append(el('p','cfg-none','No devices on this bus. Press Add for each sensor plugged into it.'));
    list.forEach((d,i)=>{const row=el('div','cfg-port used'),label=`${hub.name} I2C bus ${bus} device ${i}`;row.append(el('span','cfg-port-no',`Port ${i}`),typeSelect('i2c',d.tag,`${label} type`,tag=>{d.tag=tag;e.dirty=true;renderEditor();},{nothing:false}),nameInput(d,`${label} name`));
      const x=button('Delete','cfg-btn danger',()=>{e.devices.splice(e.devices.indexOf(d),1);e.dirty=true;renderEditor();});x.setAttribute('aria-label',`Delete ${d.name||'device'} from I2C bus ${bus}`);row.append(x);box.append(row);});
    body.push(box,button('Add','cfg-btn cfg-add',()=>{e.devices.push({name:'',tag:'RevColorSensorV3',port:list.length?Math.max(...list.map(x=>x.port))+1:0,bus,family:'i2c',module:{portal:hub.portal,address:hub.address}});e.dirty=true;renderEditor();[...document.querySelectorAll('.cfg-device-name')].at(-1)?.focus();}));}
  $('#page-body').replaceChildren(...body);
}
// The wiring notes of the motors being edited, by name.
const notesFrom=devices=>Object.fromEntries(devices.filter(d=>d.family==='motor'&&d.name&&(d.gear||d.encoder===false)).map(d=>[d.name,{...(A.gearOf(d.tag,d.gear)?{gear:d.gear}:{}),...(d.encoder===false?{encoder:false}:{})}]));
// The configuration as edited so far, for the pinout.
function editedConfig(){const e=edit;return {hubs:e.hubs,devices:e.devices.map(d=>({...d,name:d.name||'(no name)'})),other:e.other,notes:notesFrom(e.devices)};}
async function saveEdit(){
  const e=edit,blank=e.devices.find(d=>!d.name);
  if(blank){const hub=e.hubs.findIndex(h=>sameHub(blank,h)),portal=blank.module.portal,where=blank.family==='i2c'?`I2C Bus ${blank.bus}`:`${TITLES[blank.family]} port ${blank.port}`;
    e.view=[{portal},{portal,hub},{portal,hub,family:blank.family,bus:blank.bus}];renderEditor();
    status(`Name every device: ${e.hubs[hub]?.name||'a hub'} › ${where} has no name.`,'error');for(const i of document.querySelectorAll('.cfg-device-name'))if(!i.value.trim())i.classList.add('bad');document.querySelector('.cfg-device-name.bad')?.focus();return;}
  let xml;try{
    // An I2C device's port is its place on its bus.
    const out=[];for(const h of e.hubs)for(let bus=0;bus<4;bus++)e.devices.filter(d=>sameHub(d,h)&&d.family==='i2c'&&d.bus===bus).sort((a,b)=>a.port-b.port).forEach((d,i)=>out.push({...d,port:i}));
    xml=C.withNotes(C.rebuild(e.xml,[...e.devices.filter(d=>d.family!=='i2c'),...out].map(({name,tag,port,bus,module})=>({name,tag,port,...(bus!==undefined?{bus}:{}),module})),e.hubs),notesFrom(e.devices));
  }catch(err){status(err.message,'error');return;}
  let ok=false;await run(`Saving “${e.file.name}”…`,async()=>{await save(e.file.name,xml);await keepNotes(e.file.name,notesFrom(e.devices));ok=true;});
  if(ok){ctx.host.useConfiguration?.({name:e.file.name,xml});changed=true;e.dirty=false;ctx.toast(`Saved “${e.file.name}”. It is the active configuration; the robot restarts when you leave Configure Robot.`,4500);edit=null;$('#page-back').onclick=()=>{if(onBack)onBack();else close();};await loadList();}
}

// ---- Pinout: a configuration as a wiring diagram (pinout.js), with the product photos of what is in it, to read here
// or save as a PNG or SVG to print or share --------------------------------------------------------------------------
// The robot's name: from its inspection report when it says (a Control Hub's does not), else the name Deck has it saved
// under, else ####-RC for a Driver Station named ####-DS.
async function robotName(){try{const r=JSON.parse(await ask('CMD_REQUEST_INSPECTION_REPORT','',4000));if(r?.deviceName)return String(r.deviceName);}catch{}
  try{const i=await ctx.host.info?.();if(i?.name)return String(i.name);}catch{}const n=ctx.dsName();return /-DS$/.test(n)?n.replace(/-DS$/,'-RC'):'';}
async function pinoutOf(f){
  let xml='',notes={};await run(`Reading “${f.name}”…`,async()=>{xml=await ask('CMD_REQUEST_PARTICULAR_CONFIGURATION',JSON.stringify(f));C.parse(xml);notes=await notesFor(f.name,xml);});if(!xml)return;
  const {devices,hubs}=C.parse(xml);await showPinout(f.name,{hubs,devices:devices.filter(d=>d.module).map(d=>({...d,family:familyOf(d.tag)})),other:devices.filter(d=>!d.module),notes});}
let pin=null,pinBusy=false;
async function showPinout(name,config,{unsaved=false}={}){
  if(pinBusy)return;pinBusy=true;
  try{
    const tags=[...new Set([...config.devices,...(config.other||[])].map(d=>d.tag))],photos={};status('Drawing the pinout…');
    const hubs=(config.hubs||[]).map(h=>h.tag==='ServoHub'?'#ServoHub':h.parent?'#ControlHub':'#ExpansionHub');
    await Promise.all([...tags,...new Set(hubs)].map(async t=>{const u=await photo(t);if(u)photos[t]=u;}));
    const sheet=P.build({...config,name,robot:connected()?await robotName():'',photos,java:d=>C.javaFor({...d,kind:C.kindOf(d.tag)}).type});
    if(pin?.url)URL.revokeObjectURL(pin.url);
    pin={name,sheet,url:URL.createObjectURL(new Blob([sheet.svg],{type:'image/svg+xml'})),zoom:0,from:edit?'editor':'list',missing:tags.filter(t=>!photos[t])};
    status('');renderPinout(unsaved);
  }catch(e){status(e.message,'error');}finally{pinBusy=false;}
}
function leavePinout(){if(!pin)return;if(pin.url)URL.revokeObjectURL(pin.url);const from=pin.from;pin=null;$('#ds-page').classList.remove('wide');status('');
  if(from==='editor'&&edit){$('#page-back').onclick=()=>editBack();renderEditor();}else{$('#page-back').onclick=()=>{if(onBack)onBack();else close();};renderList();}}
function renderPinout(unsaved){
  const p=pin,s=p.sheet;$('#ds-page').classList.add('wide');$('#page-title').textContent=`Pinout · ${p.name}`;$('#page-back').onclick=()=>leavePinout();
  actions(button('Save PNG','ok',()=>void savePinout('png')),button('Save SVG','cfg-btn',()=>void savePinout('svg')));
  const notes=[];if(unsaved)notes.push(el('p','pin-note','This shows your changes before they are saved to the robot.'));
  for(const w of s.warnings)notes.push(el('p','pin-note bad','⚠ '+w));
  if(p.missing.length&&ctx.host.devicePhoto){const n=p.missing.filter(t=>A.photoOf(t)).length;if(n)notes.push(el('p','pin-note',`${n} product photo${n===1?' is':'s are'} not on this computer yet, so ${n===1?'its':'their'} drawing${n===1?' is':'s are'} shown. Deck saves them the next time this computer is online.`));}
  const img=el('img','pin-sheet');img.src=p.url;img.alt=`Wiring diagram of ${p.name}: ${s.rows.length} connections`;
  const view=el('div','pin-view');view.tabIndex=0;view.setAttribute('aria-label','Wiring diagram. Scroll to move around.');view.append(img);
  const label=el('span','pin-zoom-label');
  const zoom=z=>{const fitZ=Math.max(.1,(view.clientWidth-20)/s.width);p.zoom=z===0?0:Math.max(.1,Math.min(3,z));const now=p.zoom||fitZ;img.style.width=Math.round(s.width*now)+'px';label.textContent=p.zoom?`${Math.round(now*100)}%`:`Fit · ${Math.round(now*100)}%`;};
  const tools=el('div','pin-tools');tools.append(button('Fit','cfg-btn',()=>zoom(0)),button('−','cfg-btn',()=>zoom((p.zoom||view.clientWidth/s.width)/1.25)),button('+','cfg-btn',()=>zoom((p.zoom||view.clientWidth/s.width)*1.25)),button('100%','cfg-btn',()=>zoom(1)),label);
  for(const b of tools.querySelectorAll('button'))b.setAttribute('aria-label',{'−':'Zoom out','+':'Zoom in'}[b.textContent]||b.textContent);
  $('#page-body').replaceChildren(...notes,tools,view);requestAnimationFrame(()=>zoom(p.zoom));
}
async function savePinout(kind){
  const p=pin;if(!p)return;const file=`${p.name} pinout`;
  try{let blob;
    if(kind==='svg')blob=new Blob([p.sheet.svg],{type:'image/svg+xml'});
    else blob=await P.png(p.url,p.sheet);
    if(ctx.host.saveFile){const where=await ctx.host.saveFile({name:file,kind,data:kind==='svg'?p.sheet.svg:await P.base64(blob)});if(where)ctx.toast(`Saved ${where}`,4500);return;}
    const a=el('a');a.href=URL.createObjectURL(blob);a.download=`${file}.${kind}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }catch(e){ctx.toast(e.message,4500);}
}

// ---- Settings -----------------------------------------------------------------------------------------------------------
function settings(){
  open('Settings',close);const p=ctx.prefs,rows=[];
  const row=(title,detail,control)=>{const r=el('div','set-row'),text=el('div','set-text');text.append(el('b','',title));if(detail)text.append(el('small','',detail));r.append(text);if(control)r.append(control);rows.push(r);return r;};
  const toggle=(key,label)=>{const l=el('label','switch'),i=el('input');i.type='checkbox';i.checked=!!p[key];i.setAttribute('aria-label',label);i.onchange=()=>{p[key]=i.checked;ctx.savePrefs();};l.append(i,el('i'));return l;};
  rows.push(el('h3','set-group','Driver Station'));
  row('Driver Station name',`${ctx.dsName()} · taken from the robot’s network name, as a Driver Hub pairs ####-RC with ####-DS.`);
  row('Pair with Robot Controller','Choose the robot, its address and its Wi-Fi in Deck’s Settings. The robot stays connected while you are there.',button('Open','cfg-btn',()=>Promise.resolve(ctx.host.openSettings?.()).catch(e=>ctx.toast(e.message))));
  const pad=el('select','cfg-type');pad.setAttribute('aria-label','Gamepad type');for(const [v,l] of [['auto','Detect from the controller'],['XBOX_360','Xbox 360 / Xbox'],['SONY_PS4','Sony PS4 / PS5'],['LOGITECH_F310','Logitech F310']])pad.append(new Option(l,v));
  pad.value=p.gamepadType||'auto';pad.onchange=()=>{p.gamepadType=pad.value;ctx.savePrefs();};
  row('Gamepad type','What the robot is told each controller is. Code that reads gamepad1.type or uses PS button names sees this.',pad);
  row('Gamepad assignment','Click User 1 in the header, then press a button on that controller. Choose Two controllers in Deck’s Settings for User 2.');
  row('Show Robot Controller battery','The Control Hub or phone battery next to the robot voltage.',toggle('showRcBattery','Show Robot Controller battery'));
  row('Sounds','The practice timer’s match sounds.',toggle('sounds','Sounds'));
  row('Autonomous timer on by default','Stop an Autonomous op mode after 30 seconds unless you turn the timer off.',toggle('autoTimer','Autonomous timer on by default'));
  rows.push(el('h3','set-group','Robot Controller'));
  row('Robot Controller settings','The robot’s name, Wi-Fi password and channel are in Program & Manage → Manage, served by the robot.',button('Program & Manage','cfg-btn',()=>Promise.resolve(ctx.host.programAndManage?.()).catch(e=>ctx.toast(e.message))));
  row('Restart Robot','Restart the robot’s software, as the menu’s Restart Robot does.',button('Restart','cfg-btn',()=>{ctx.restart();}));
  const list=el('div','set-list');list.append(...rows);$('#page-body').replaceChildren(list);
}

// ---- Self Inspect -------------------------------------------------------------------------------------------------------
const NAME=/^(\d{1,5})(-[A-Za-z])?-(RC|DS)$/;
function inspect(){
  open('Self Inspect',close);actions(button('Refresh','cfg-btn',()=>void readInspection()));
  const grid=el('div','inspect');grid.append(column('Robot Controller','inspect-rc'),column('Driver Station','inspect-ds'));$('#page-body').replaceChildren(grid);
  void driverStation();void readInspection();
}
function column(title,id){const c=el('section','cfg-section');c.id=id;c.append(el('h3','',title),el('p','cfg-none','Reading…'));return c;}
// rows: [label, value, ok?] — ok true passes, false fails, undefined only informs.
function fill(id,rows){const c=$('#'+id);if(!c)return;const t=el('dl','inspect-list');
  for(const [label,value,ok] of rows){const v=el('dd',ok===false?'bad':ok===true?'good':'');v.textContent=value;if(ok!==undefined)v.prepend(el('i','',ok?'✓ ':'✗ '));t.append(el('dt','',label),v);}
  c.replaceChildren(c.firstChild,t);}
const yes=v=>v?'On':'Off',percent=f=>Number.isFinite(f)?`${Math.round(f*100)}%`:'—';
async function readInspection(){
  if(!connected()){fill('inspect-rc',[['Robot','Not connected',false]]);return;}
  let r;try{r=JSON.parse(await ask('CMD_REQUEST_INSPECTION_REPORT','',6000));}catch(e){fill('inspect-rc',[['Report',e.message,false]]);return;}
  const rows=[],has=k=>r[k]!==undefined&&r[k]!==null;
  if(has('deviceName'))rows.push(['Name',String(r.deviceName),NAME.test(r.deviceName)]);
  if(has('manufacturer')||has('model'))rows.push(['Device',[r.manufacturer,r.model].filter(Boolean).join(' ')]);
  if(has('osVersion'))rows.push(['Android',`${r.osVersion}${has('sdkInt')?` (API ${r.sdkInt})`:''}`]);
  if(has('controlHubOsVersion')&&r.controlHubOsVersion)rows.push(['Control Hub OS',String(r.controlHubOsVersion)]);
  if(has('firmwareVersion')&&r.firmwareVersion)rows.push(['Hub firmware',String(r.firmwareVersion)]);
  if(has('robotControllerVersion'))rows.push(['Robot Controller app',String(r.robotControllerVersion||'Not installed'),!!r.robotControllerVersion]);
  if(has('batteryFraction'))rows.push(['Battery',percent(r.batteryFraction),r.batteryFraction>=.3]);
  if(has('wifiEnabled'))rows.push(['Wi-Fi',yes(r.wifiEnabled),!!r.wifiEnabled]);
  if(has('wifiDirectEnabled'))rows.push(['Wi-Fi Direct',yes(r.wifiDirectEnabled)]);
  if(has('bluetoothOn'))rows.push(['Bluetooth',yes(r.bluetoothOn),!r.bluetoothOn]);
  if(has('airplaneModeOn'))rows.push(['Airplane mode',yes(r.airplaneModeOn)]);
  if(has('isDefaultPassword'))rows.push(['Wi-Fi password',r.isDefaultPassword?'Still the default':'Changed',!r.isDefaultPassword]);
  if(has('activeConfig')||ctx.session.state.activeConfig)rows.push(['Active configuration',ctx.session.state.activeConfig?.name||'None',!!ctx.session.state.activeConfig?.name]);
  fill('inspect-rc',rows.length?rows:[['Report','The robot sent no inspection details.']]);
}
async function driverStation(){
  const s=ctx.session,name=ctx.dsName(),rows=[['Name',name,NAME.test(name)],['App',`Torque`],['Operating system',navigator.userAgentData?.platform||navigator.platform||'—'],['Robocol',String(s.identity.version)]];
  try{const b=await navigator.getBattery?.();if(b)rows.push(['Battery',percent(b.level),b.level>=.3||b.charging]);}catch{}
  const pads=Array.from(navigator.getGamepads?.()||[]).filter(Boolean);rows.push(['Controllers',pads.length?pads.map(p=>p.id.replace(/\s*\(.*$/,'')).join(', '):'None found',pads.length>0]);
  rows.push(['Robot connection',s.state.connection==='connected'?`Connected · ${s.state.ping??'—'} ms`:'Not connected',s.state.connection==='connected']);
  fill('inspect-ds',rows);
}

window.DeckDsPages={init(c){ctx=c;ctx.session.on('state',()=>{if(!$('#ds-page').hidden&&!edit&&!working)refreshButtons();});},configure:()=>void configure(),settings,inspect,
  open:()=>!$('#ds-page').hidden,back:()=>{if(closeMenu()||$('#page-ask').open)return;$('#page-back').click();}};
})();
