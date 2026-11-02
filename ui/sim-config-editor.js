(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckConfigEditor=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Configure: one of the robot's configurations, as Configure Robot's Edit shows it on a Driver Hub, on one screen. The hubs stay
  // on the right; the hub picked there shows on the left, its families and then their ports. It works on the configuration's own
  // XML and takes nothing from the simulator. load() and xmlOf() only decide; create() draws it.
  const C=()=>globalThis.DeckRobotConfig||require('./ftc/robot-config.js'),A=()=>globalThis.DeckDeviceArt||require('./ftc/device-art.js');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const FAMILIES=[['motor','Motors'],['servo','Servos'],['digital','Digital Devices'],['analog','Analog Input Devices']];
  const SINGULAR={motor:'motor',servo:'servo',digital:'digital device',analog:'analog input',i2c:'I2C device'};
  const sameHub=(d,h)=>d.module&&d.module.portal===h.portal&&d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub');
  const familyOf=tag=>{const T=C().DEVICE_TYPES;for(const f of Object.keys(T))if(T[f].some(([t])=>t===tag))return f;return C().familyOfTag(tag);};
  const hubKind=h=>h.tag==='ServoHub'?'Servo Hub':h.parent?'Control Hub':'Expansion Hub';
  const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
  // A configuration ready to edit. portals: the last Scan, whose hubs are added when it lacks them, and which says what is connected.
  function load(name,xml,portals){const R=C(),{devices,hubs}=R.parse(xml),own=devices.filter(d=>d.module),notes=R.notesOf(xml),match=R.matchHubs(hubs.filter(h=>Number.isFinite(h.address)&&(h.tag==='LynxModule'||h.tag==='ServoHub')),portals,own);
    return {name,xml,portals,hubs:[...match.hubs].sort((a,b)=>Number(b.parent)-Number(a.parent)||(a.tag==='ServoHub')-(b.tag==='ServoHub')||a.address-b.address),connected:portals?match.connected:null,webcams:R.webcamsOf(xml),limelights:R.limelightsOf(xml),outside:devices.filter(d=>!d.module&&d.kind!=='webcam'&&d.kind!=='limelight'),devices:own.map(d=>({...d,...(notes[d.name]||{}),family:familyOf(d.tag)})),dirty:match.added.length+match.fixed.length>0,hub:0,family:null,bus:0};}
  function setType(e,hub,family,port,tag){const d=e.devices.find(x=>sameHub(x,hub)&&x.family===family&&x.port===port);
    if(!tag){if(d)e.devices.splice(e.devices.indexOf(d),1);}else if(d)d.tag=tag;else e.devices.push({name:'',tag,port,family,module:{portal:hub.portal,address:hub.address,...(hub.tag==='ServoHub'?{servoHub:true}:{})}});e.dirty=true;}
  function addI2c(e,hub,bus){const list=e.devices.filter(d=>sameHub(d,hub)&&d.family==='i2c'&&d.bus===bus);e.devices.push({name:'',tag:'RevColorSensorV3',port:list.length?Math.max(...list.map(x=>x.port))+1:0,bus,family:'i2c',module:{portal:hub.portal,address:hub.address}});e.dirty=true;}
  // Webcams live under <Robot> and share one list of names with every other device. These change only what is on screen: nothing reaches the robot until Save.
  const nameTaken=(e,name,skip)=>[...e.devices,...e.webcams,...(e.limelights||[]),...(e.outside||[])].some(d=>d!==skip&&String(d.name).toLowerCase()===name.toLowerCase());
  function addWebcam(e,serial){if(e.webcams.some(c=>c.serial===serial)||!C().canSend(serial))return null;let n=1;while(nameTaken(e,`Webcam ${n}`))n++;const c={name:`Webcam ${n}`,serial};e.webcams.push(c);e.dirty=true;return c;}
  // Null when it took the name, else what is wrong with it.
  function renameWebcam(e,i,name){const c=e.webcams[i],v=String(name).trim();if(!c)return null;if(!C().validName(v))return 'Use letters, digits, spaces, - and _ in a webcam’s name.';if(nameTaken(e,v,c))return `Another device is already named “${v}”.`;if(c.name!==v){c.name=v;e.dirty=true;}return null;}
  function removeWebcam(e,i){if(e.webcams[i]){e.webcams.splice(i,1);e.dirty=true;}}
  // A Limelight the same way. serial: its Scan key. address: its own address. It goes by "limelight", as FTC's sample code calls it. A hub can only have one.
  function addLimelight(e,{serial,address}){if(!serial||!address||e.limelights.length)return null;let name='limelight',n=2;while(nameTaken(e,name))name=`limelight ${n++}`;const c={name,serial,port:-1,ipAddress:address};e.limelights.push(c);e.dirty=true;return c;}
  // Its Scan key changes when its address does, and the entry then has to follow.
  function fixLimelight(e,i,{serial,address}){const c=e.limelights[i];if(!c||!serial||!address)return null;c.serial=serial;c.ipAddress=address;e.dirty=true;return c;}
  function removeLimelight(e,i){if(e.limelights[i]){e.limelights.splice(i,1);e.dirty=true;}}
  const withUsb=e=>C().withLimelights(C().withWebcams(e.xml,e.webcams),e.limelights);
  const notesFrom=devices=>Object.fromEntries(devices.filter(d=>d.family==='motor'&&d.name&&(d.gear||d.encoder===false)).map(d=>[d.name,{...(A().gearOf(d.tag,d.gear)?{gear:d.gear}:{}),...(d.encoder===false?{encoder:false}:{})}]));
  // The XML to save, or throws saying what is left to do. An I2C device's port is its place on its bus.
  // What the pinout draws: the configuration on screen, unsaved changes included.
  const pinoutConfig=e=>{const R=C();return {hubs:e.hubs,devices:e.devices.map(d=>({...d,name:d.name||'(no name)'})),other:R.parse(withUsb(e)).devices.filter(d=>!d.module),notes:notesFrom(e.devices)};};
  function xmlOf(e){const R=C(),blank=e.devices.find(d=>!String(d.name).trim());
    if(blank){const h=e.hubs.find(x=>sameHub(blank,x));throw Error(`Name every device: ${h?.name||'a hub'} ${blank.family==='i2c'?`I2C bus ${blank.bus}`:`${SINGULAR[blank.family]} port ${blank.port}`} has no name.`);}
    for(const c of [...(e.webcams||[]),...(e.limelights||[])])if(nameTaken(e,c.name,c))throw Error(`Two devices are named “${c.name}”.`);
    const out=[];for(const h of e.hubs)for(let bus=0;bus<4;bus++)e.devices.filter(d=>sameHub(d,h)&&d.family==='i2c'&&d.bus===bus).sort((a,b)=>a.port-b.port).forEach((d,i)=>out.push({...d,port:i}));
    return R.withNotes(R.rebuild(withUsb(e),[...e.devices.filter(d=>d.family!=='i2c'),...out].map(({name,tag,port,bus,module})=>({name:String(name).trim(),tag,port,...(bus!==undefined?{bus}:{}),module})),e.hubs),notesFrom(e.devices));}
  // What a port offers: the legal list, grouped by maker, and what it already has.
  const menuTypes=(family,tag)=>{const list=[...C().DEVICE_TYPES[family]];if(tag&&!list.some(([t])=>t===tag))list.push([tag,tag]);return list;};
  const nameOf=(family,tag)=>(C().DEVICE_TYPES[family]?.find(([t])=>t===tag)||[tag,A().info(tag).name])[1];
  const figure=(tag,cls='')=>tag?`<span class="ce-fig ${cls}" data-fig="${esc(tag)}">${A().svg(tag,{title:false})}</span>`:`<span class="ce-fig empty ${cls}"></span>`;
  const entry=(attr,title,detail,on)=>`<button type="button" class="ce-entry" ${attr}${on?' aria-current="true"':''}><span class="ce-entry-text"><b>${esc(title)}</b><small>${esc(detail)}</small></span><i aria-hidden="true">›</i></button>`;
  // The right side: every hub in the portal.
  function hubsHtml(e){const key=h=>C().hubKey(h.portal,h.address);
    return `<h3 class="ce-heading">Hubs in Control Hub Portal</h3>${e.hubs.map((h,i)=>{const n=e.devices.filter(d=>sameHub(d,h)).length;return entry(`data-ce-hub="${i}"`,h.name,`${hubKind(h)} · address ${h.address} · ${n?plural(n,'device'):'nothing set up yet'}${e.connected?(e.connected.has(key(h))?' · connected':' · not found'):''}`,e.hub===i);}).join('')||'<p class="hint">This configuration has no hubs. Delete it and make a new one, which scans the robot.</p>'}`;}
  // What is on the Control Hub's USB and in this configuration, one row each. others: the last Scan's other USB devices, null when no hub has said. others.devices, once
  // Torque has read the hub's ports itself (DeckUsbKinds.classifyAll), says what each one really is: Scan offers any USB video device as a webcam and any USB network device as a Limelight.
  const NOT_A_LIMELIGHT='Scan offers this as if it were a Limelight, but it did not answer as one. Do not add it to the robot configuration.',CHECKING='plugged in, Torque is checking whether it is a Limelight',NO_ADD='Torque cannot add this camera: its serial number has a symbol, such as & or an apostrophe, that the robot will not take in a configuration.';
  function usbRows(e,others){const R=C(),K=globalThis.DeckUsbKinds||require('./ftc/usb-kinds.js'),list=others||[],seen=others?.devices,mine=e.webcams||[],limes=e.limelights||[],kept=e.outside||[],lime=seen?.find(d=>d.config==='limelight'),checking=!!seen?.some(d=>d.pending&&d.id==='G1');
    // Two alike with no serial differ only by the port in their keys. Once Torque has read the ports, they say what is plugged in now.
    const same=K.sameCamera,keyOf=r=>r.config==='limelight'?r.scanKey:K.scanKey(r.device);
    const absent=s=>!others?false:seen?!seen.some(r=>same(keyOf(r),s)):!list.some(d=>same(d.serial,s)),state=s=>!others?'':absent(s)?'in this configuration, not plugged in':'plugged in',limeHere=s=>lime?lime.scanKey===s:!absent(s);
    // serial: what to call it. key: the robot's name for it, under Technical facts when it is not the same.
    const label=s=>K.cameraLabel(s,seen),offer=s=>R.canSend(s)?{add:s,word:'Webcam',serial:label(s),key:s,state:'plugged in, not in this configuration'}:{word:'Webcam',serial:label(s),key:s,state:'plugged in',warn:NO_ADD};
    // Each camera in this configuration accounts for one thing plugged in: with two alike and one set up with no port, the other can still be added.
    const taken=new Set();for(const c of mine){const d=list.find(x=>x.type==='WEBCAM'&&!taken.has(x)&&same(c.serial,x.serial));if(d)taken.add(d);}
    // A network device still in the last Scan's list, and no longer on the ports, is no reason to warn about anything.
    const netGone=d=>{const iface=String(d.serial).split(':')[1];return !seen.some(r=>['G1','G2','G3'].includes(r.id)||[...(r.device?.net||[]),...(r.device?.interfaces||[]).flatMap(i=>i.net||[])].includes(iface));};
    const scanned=d=>{if(d.type==='WEBCAM'){const row=seen?.find(r=>same(K.scanKey(r.device),d.serial));return row?.legal?.ok===false?{word:row.name,serial:label(d.serial),key:d.serial,state:'plugged in',warn:row.warnings?.find(w=>w.code==='SCAN')?.text||'Scan offers this as a webcam, but it is not allowed on the robot. Do not add it to the robot configuration.'}:offer(d.serial);}
      if(d.type!=='ETHERNET_DEVICE')return {word:R.usbLabel(d.type),serial:d.serial,state:'plugged in, add it in the Driver Hub’s Configure Robot'};
      if(lime?.scanKey===d.serial)return {addLime:lime,word:'Limelight',serial:d.serial,state:'plugged in, not in this configuration'};
      if(!seen||checking)return {word:'USB network device',serial:d.serial,state:CHECKING};
      const not=seen.find(r=>r.id==='G2');return {word:not?not.name:'USB network device',serial:d.serial,state:'plugged in',warn:not?not.legal.text:NOT_A_LIMELIGHT};};
    const inScan=r=>list.some(d=>d.type==='ETHERNET_DEVICE'&&[...(r.device?.net||[]),...(r.device?.interfaces||[]).flatMap(i=>i.net||[])].includes(String(d.serial).split(':')[1]));
    // What Torque's own read found and the robot's Scan has not said yet, or has no word for. Two alike wait for Scan to give each its port.
    const unsaid=(seen||[]).filter(r=>r.config==='webcam'&&!mine.some(c=>same(c.serial,r.scanKey))&&!list.some(d=>same(d.serial,r.scanKey))),twins=r=>unsaid.filter(x=>x.scanKey===r.scanKey).length>1;
    return [...mine.map((c,i)=>({at:i,word:'Webcam',name:c.name,serial:label(c.serial),key:c.serial,state:state(c.serial),absent:absent(c.serial)})),
      ...limes.map((c,i)=>{const old=!!lime&&lime.scanKey!==c.serial,here=limeHere(c.serial);return {lime:i,word:'Limelight',name:c.name,serial:c.serial,fix:old,state:!others?'':old?'in this configuration with an old address':here?'plugged in':'in this configuration, not plugged in',absent:!!others&&!here&&!old};}),
      ...kept.map(d=>({word:R.usbLabel(d.tag),name:d.name,serial:d.serial,state:state(d.serial),absent:absent(d.serial)})),
      ...list.filter(d=>!taken.has(d)&&!limes.some(c=>c.serial===d.serial)&&!kept.some(k=>k.serial===d.serial)&&!(limes.length&&lime?.scanKey===d.serial)&&(d.type!=='WEBCAM'||!seen||seen.some(r=>same(K.scanKey(r.device),d.serial)))&&(d.type!=='ETHERNET_DEVICE'||!seen||!netGone(d))).map(scanned),
      ...unsaid.filter((r,i)=>unsaid.findIndex(x=>x.scanKey===r.scanKey)===i).map(r=>twins(r)?{word:'Webcam',serial:label(r.scanKey),key:r.scanKey,state:'two of these are plugged in, and Torque is waiting for Scan to tell them apart'}:offer(r.scanKey)),
      ...(lime&&!limes.length&&!list.some(d=>d.serial===lime.scanKey)?[{addLime:lime,word:'Limelight',serial:lime.scanKey,state:'plugged in, not in this configuration'}]:[]),
      ...(seen||[]).filter(r=>r.id==='G3'&&!inScan(r)).map(r=>({word:'USB network device',serial:r.device?.product||'',state:'plugged in',warn:NOT_A_LIMELIGHT})),
      ...(seen||[]).filter(r=>r.pending&&r.id==='G1'&&!inScan(r)).map(r=>({word:'USB network device',serial:r.device?.product||'',state:CHECKING}))];}
  const usbLine=r=>[r.word,r.serial,r.state].filter(Boolean).map(esc).join(' · ');
  // The robot's long name for a camera with no serial, for anyone comparing it with the Driver Hub. Closed, and drawn afresh with the row.
  const usbFacts=r=>r.key&&r.key!==r.serial?`<details class="usb-facts"><summary>Technical facts</summary>${esc(r.key)}</details>`:'';
  // On the left above a hub's families, where a team works. They are on the robot, not on a hub, so every hub shows them.
  function usbHtml(e,others){const rows=usbRows(e,others);if(!rows.length)return '';
    return `<section class="ce-usb-list" aria-label="USB devices"><h3 class="ce-heading">USB devices</h3>${rows.map(r=>r.at!==undefined?`<div class="ce-usb"${r.absent?' data-absent':''}><label class="sr-only" for="ce-usb-${r.at}">Webcam name</label><input id="ce-usb-${r.at}" class="ce-name" data-ce-usb-name="${r.at}" value="${esc(r.name)}" maxlength="40" spellcheck="false"><small>${usbLine(r)}</small><button type="button" class="icon-button" data-ce-usb-remove="${r.at}" aria-label="Remove ${esc(r.name)}" title="Remove from the configuration">×</button>${usbFacts(r)}</div>`:
      r.add?`<div class="ce-usb"><b>${esc(r.word)} · ${esc(r.serial)}</b><small>${esc(r.state)}</small><button type="button" class="primary" id="ce-usb-add-${esc(r.add)}" data-ce-usb-add="${esc(r.add)}" aria-label="Add ${esc(r.word)} ${esc(r.serial)} to this configuration">Add</button>${usbFacts(r)}</div>`:
      r.addLime?`<div class="ce-usb"><b>${esc(r.word)} · ${esc(r.serial)}</b><small>${esc(r.state)}</small><button type="button" class="primary" id="ce-usb-add-${esc(r.serial)}" data-ce-usb-add-lime="${esc(r.serial)}" aria-label="Add this Limelight to this configuration">Add</button></div>`:
      r.lime!==undefined?`<div class="ce-usb"${r.absent?' data-absent':''}><b>${esc(r.name)}</b><small>${usbLine(r)}</small>${r.fix?`<button type="button" class="primary" data-ce-usb-lime-fix="${r.lime}" aria-label="Update ${esc(r.name)} to the address it has now">Update</button>`:''}<button type="button" class="icon-button" data-ce-usb-lime-remove="${r.lime}" aria-label="Remove ${esc(r.name)}" title="Remove from the configuration">×</button></div>`:
      r.warn?`<div class="ce-usb" data-warn><b>${esc(r.word)}</b><small>${[r.serial,r.state].filter(Boolean).map(esc).join(' · ')}</small><p class="cal-debug-warn">${esc(r.warn)}</p>${usbFacts(r)}</div>`:
      `<div class="ce-usb"${r.absent?' data-absent':''}><b>${esc(r.name||r.word)}</b><small>${usbLine(r)}</small>${usbFacts(r)}</div>`).join('')}</section>`;}
  // Under the hubs on the right, on every screen: what is there, and the way back to it.
  function usbNavHtml(e,others){const rows=usbRows(e,others),spare=rows.filter(r=>r.add).length,limes=rows.filter(r=>r.addLime).length,left=[spare?plural(spare,'camera'):'',limes?'a Limelight':''].filter(Boolean).join(' and ');
    return `<h3 class="ce-heading">USB devices</h3>${rows.length?entry('data-ce-usb-show',plural(rows.length,'device'),left?`${left} plugged in, not in this configuration`:rows.map(r=>r.name||r.word).join(', ')):`<p class="hint">${others?.devices?'Nothing else is on the Control Hub’s USB ports. Plug in a webcam or a Limelight and it shows here by itself.':others?'Nothing else is on the Control Hub’s USB ports that Scan can see. Over Wi-Fi, press Scan in Setup to look again.':'Connect to the robot to see what is on its USB ports.'}</p>`}`;}
  // The left side, before a family is open: what the hub picked has.
  function familiesHtml(e){const R=C(),h=e.hubs[e.hub];if(!h)return '';const count=(f,bus)=>e.devices.filter(d=>sameHub(d,h)&&d.family===f&&(bus===undefined||d.bus===bus));
    return `${(h.tag==='ServoHub'?FAMILIES.filter(([f])=>f==='servo'):FAMILIES).map(([f,t])=>entry(`data-ce-family="${f}"`,t,`Ports 0–${R.PORT_COUNT[f]-1} · ${count(f).length} configured`)).join('')}${h.tag==='ServoHub'?'':[0,1,2,3].map(b=>{const list=count('i2c',b);return entry(`data-ce-family="i2c" data-ce-bus="${b}"`,`I2C Bus ${b}`,list.length?list.map(d=>d.name||'(no name)').join(', '):'No devices');}).join('')}`;}
  const pick=(attr,family,tag,label)=>`<button type="button" class="ce-pick" ${attr} data-tip-tag="${esc(tag||'')}" aria-haspopup="dialog" aria-label="${esc(label)}: ${esc(tag?nameOf(family,tag):'Nothing')}">${figure(tag,'small')}<span class="ce-pick-name">${esc(tag?nameOf(family,tag):'Nothing')}</span><i aria-hidden="true">▾</i></button>`;
  const nameBox=(d,id,label)=>`<label class="sr-only" for="${id}">${esc(label)} name</label><input id="${id}" class="ce-name" data-ce-name="${d.family}|${d.port}|${d.bus??''}" value="${esc(d.name)}" placeholder="Device name" maxlength="40" spellcheck="false">`;
  function details(d,port){const gears=A().GEARING[d.tag];return `<div class="ce-details">${gears?`<label>Gearbox<select data-ce-gear="${port}"><option value="">Gear ratio: not set</option>${gears.map(g=>`<option value="${esc(g.id)}"${g.id===d.gear?' selected':''}>${esc(g.label)}</option>`).join('')}</select></label>`:''}<label class="ce-switch">Encoder cable plugged in<input type="checkbox" data-ce-encoder="${port}"${d.encoder!==false?' checked':''}></label></div>`;}
  // The left side, with a family open: its ports.
  function portsHtml(e){const R=C(),h=e.hubs[e.hub];if(!h)return '';const f=e.family;if(!f)return familiesHtml(e);
    if(f==='i2c'){const list=e.devices.filter(d=>sameHub(d,h)&&d.family==='i2c'&&d.bus===e.bus).sort((a,b)=>a.port-b.port);
      return `<div class="ce-ports">${list.map((d,i)=>`<div class="ce-port used"><span class="ce-no">Port ${i}</span>${pick(`data-ce-i2c="${d.port}"`,'i2c',d.tag,`${h.name} I2C bus ${e.bus} device ${i}`)}${nameBox(d,`ce-name-i2c-${d.port}`,`I2C bus ${e.bus} device ${i}`)}<button type="button" class="secondary ce-del" data-ce-remove="${d.port}">Delete</button></div>`).join('')||'<p class="hint">No devices on this bus. Press Add for each sensor plugged into it.</p>'}</div><button type="button" class="secondary ce-add" data-ce-add>Add</button>`;}
    return `${f==='digital'?'<p class="hint">A REV Touch Sensor reads on the odd channel of each digital connector (1, 3, 5, 7).</p>':''}<div class="ce-ports">${Array.from({length:R.PORT_COUNT[f]},(_,port)=>{const d=e.devices.find(x=>sameHub(x,h)&&x.family===f&&x.port===port);
      return `<div class="ce-port${d?' used':''}"><span class="ce-no">Port ${port}</span>${pick(`data-ce-type="${port}"`,f,d?.tag,`${h.name} ${SINGULAR[f]} port ${port}`)}${d?nameBox(d,`ce-name-${port}`,`${SINGULAR[f]} port ${port}`):'<span class="ce-empty">No device attached</span>'}${d&&f==='motor'?details(d,port):''}</div>`;}).join('')}</div>`;}
  function trail(e){const h=e.hubs[e.hub],f=e.family;return [e.name,'Control Hub Portal',h?.name,f?(f==='i2c'?`I2C Bus ${e.bus}`:FAMILIES.find(([k])=>k===f)[1]):null].filter(Boolean);}
  // api: save(name, xml), photo(tag) (a product photo's URL, or null), extra(): more under the hubs, names(): the robot's
  // configurations, pick(name): open another one.
  function create({box,api}){let edit=null,note='',busy=false,menu=null;const photos=new Map(),photo=tag=>{if(!api.photo||!tag||!A().photoOf(tag))return Promise.resolve(null);if(!photos.has(tag))photos.set(tag,Promise.resolve(api.photo(tag)).catch(()=>null).then(u=>{if(!u)photos.delete(tag);return u;}));return photos.get(tag);};
    const dress=root=>{for(const f of root.querySelectorAll('[data-fig]')){void photo(f.dataset.fig).then(url=>{if(!url||!f.isConnected)return;const img=document.createElement('img');img.alt='';img.src=url;f.replaceChildren(img);f.classList.add('photo');});}};
    // Drawn again whenever anything changes, a new scan included, so a name still being typed comes through: it goes back in its box, and is taken when the box is left.
    function render(){const main=box.querySelector('.ce-main'),top=main?.scrollTop||0,active=document.activeElement,focus=active?.id,typing=active?.matches?.('input.ce-name')&&box.contains(active)&&active.value!==active.defaultValue?{id:active.id,value:active.value,from:active.selectionStart,to:active.selectionEnd}:null;
      if(typing)active.value=active.defaultValue;
      if(!edit){box.innerHTML='<p class="hint ce-none">Connect to the robot, then press Edit on one of the configurations in Setup.</p>';return;}
      const crumbs=trail(edit),usb=api.usb?.();box.innerHTML=`<div class="ce-bar">${edit.family?'<button type="button" class="ce-back" data-ce-back aria-label="Back to this hub">‹</button>':''}<h3>${esc(crumbs.at(-1))}</h3><label class="ce-config"><span>Active configuration</span><select data-ce-config${busy?' disabled':''}>${[...new Set([edit.name,...(api.names?.()||[])])].sort((a,b)=>a.localeCompare(b)).map(n=>`<option value="${esc(n)}"${n===edit.name?' selected':''}>${esc(n)}</option>`).join('')}</select></label>${api.pinout?`<button type="button" class="secondary" data-ce-pinout${busy?' disabled':''}>Get pinout</button>`:''}<p class="ce-note" role="status">${esc(note)}</p><button type="button" class="secondary" data-ce-cancel${edit.dirty&&!busy?'':' disabled'}>Cancel</button><button type="button" class="primary" data-ce-save${edit.dirty&&!busy?'':' disabled'}>Save</button></div><p class="ce-trail">${crumbs.map(esc).join('  ›  ')}</p><div class="ce-grid"><section class="ce-main">${edit.family?'':usbHtml(edit,usb)}${portsHtml(edit)}</section><nav class="ce-hubs" aria-label="Hubs">${hubsHtml(edit)}${usbNavHtml(edit,usb)}${api.extra?.()||''}</nav></div>`;
      dress(box);const next=box.querySelector('.ce-main');if(next)next.scrollTop=top;if(focus)document.getElementById(focus)?.focus();
      const back=typing&&document.getElementById(typing.id);if(back){back.value=typing.value;back.setSelectionRange(typing.from,typing.to);back.dataset.ceTyped='1';}}
    // The list a port's type is picked from. The picture of what is under the pointer shows beside it.
    function closeMenu(){if(!menu)return;const m=menu;menu=null;m.backdrop.remove();m.remove();hideTip();m.anchor?.isConnected&&m.anchor.focus();}
    function openMenu(anchor,family,tag,nothing,onPick){closeMenu();const m=document.createElement('div'),backdrop=document.createElement('div');m.className='ce-menu driver-menu';backdrop.className='ce-backdrop';m.setAttribute('role','listbox');
      const groups=new Map();for(const [t,l] of menuTypes(family,tag)){const g=A().info(t).maker||'Other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push([t,l]);}
      const option=(t,l,sub)=>`<button type="button" role="option" class="ce-option${t===(tag||'')?' chosen':''}" data-pick="${esc(t)}" data-tip-tag="${esc(t)}" aria-selected="${t===(tag||'')}">${figure(t,'small')}<span><b>${esc(l)}</b><small>${esc(sub)}</small></span></button>`;
      m.innerHTML=`${nothing?option('','Nothing','Port left empty'):''}${[...groups].map(([g,items])=>`<h4>${esc(g)}</h4>${items.map(([t,l])=>option(t,l,A().info(t).maker||'')).join('')}`).join('')}`;
      m.onclick=ev=>{const o=ev.target.closest('[data-pick]');if(!o)return;const t=o.dataset.pick;closeMenu();if(t!==(tag||''))onPick(t);};
      m.onkeydown=ev=>{const all=[...m.querySelectorAll('[data-pick]')],i=all.indexOf(document.activeElement);if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();closeMenu();}else if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();all[Math.max(0,Math.min(all.length-1,(i<0?0:i)+(ev.key==='ArrowDown'?1:-1)))].focus();}};
      backdrop.onpointerdown=()=>closeMenu();document.body.append(backdrop,m);menu=m;m.anchor=anchor;m.backdrop=backdrop;dress(m);
      const r=anchor.getBoundingClientRect(),w=Math.max(r.width,320),below=innerHeight-r.bottom-12,above=r.top-12;m.style.width=w+'px';m.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';m.style.maxHeight=Math.max(below,above)+'px';if(below>=above)m.style.top=r.bottom+6+'px';else m.style.bottom=innerHeight-r.top+6+'px';
      (m.querySelector('.chosen')||m.querySelector('[data-pick]'))?.focus();}
    let tip=null;function hideTip(){tip?.remove();tip=null;}
    function showTip(tag,x,y){if(!tag)return hideTip();if(tip?.dataset.tag!==tag){hideTip();tip=document.createElement('div');tip.className='ce-tip';tip.dataset.tag=tag;tip.innerHTML=figure(tag,'big');document.body.append(tip);dress(tip);}
      const w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=(x+18+w>innerWidth-8?x-18-w:x+18)+'px';tip.style.top=Math.max(8,Math.min(y-h/2,innerHeight-h-8))+'px';}
    document.addEventListener('pointermove',ev=>{const t=ev.target?.closest?.('[data-tip-tag]');if(t&&(box.contains(t)||menu?.contains(t)))showTip(t.dataset.tipTag,ev.clientX,ev.clientY);else if(tip)hideTip();});
    box.addEventListener('click',async ev=>{if(!edit)return;const t=ev.target.closest('button');if(!t)return;const d=t.dataset,h=edit.hubs[edit.hub];
      if(d.ceUsbAdd!==undefined){const c=addWebcam(edit,d.ceUsbAdd);note=c?`“${c.name}” is added here. Press Save to put it on the robot.`:'';render();if(c)document.getElementById(`ce-usb-${edit.webcams.indexOf(c)}`)?.focus();return;}
      if(d.ceUsbRemove!==undefined){removeWebcam(edit,+d.ceUsbRemove);note='';render();return;}
      if(d.ceUsbAddLime!==undefined||d.ceUsbLimeFix!==undefined){const l=api.usb?.()?.devices?.find(x=>x.config==='limelight'),to=l&&{serial:l.scanKey,address:l.limelight?.address},c=!to?null:d.ceUsbLimeFix!==undefined?fixLimelight(edit,+d.ceUsbLimeFix,to):addLimelight(edit,to);note=c?`“${c.name}” is ${d.ceUsbLimeFix!==undefined?'updated':'added'} here. Press Save to put it on the robot.`:'';render();return;}
      if(d.ceUsbLimeRemove!==undefined){removeLimelight(edit,+d.ceUsbLimeRemove);note='';render();return;}
      if(d.ceUsbShow!==undefined){showUsb();return;}
      if(d.ceHub!==undefined){edit.hub=+d.ceHub;edit.family=null;note='';render();return;}
      if(d.ceFamily){edit.family=d.ceFamily;edit.bus=+(d.ceBus||0);note='';render();box.querySelector('.ce-main').scrollTop=0;return;}
      if(d.ceBack!==undefined){edit.family=null;note='';render();return;}
      if(d.ceType!==undefined){const port=+d.ceType,f=edit.family,cur=edit.devices.find(x=>sameHub(x,h)&&x.family===f&&x.port===port);openMenu(t,f,cur?.tag,true,tag=>{setType(edit,h,f,port,tag);render();if(tag)document.getElementById(`ce-name-${port}`)?.focus();});return;}
      if(d.ceI2c!==undefined){const x=edit.devices.find(v=>sameHub(v,h)&&v.family==='i2c'&&v.bus===edit.bus&&v.port===+d.ceI2c);if(x)openMenu(t,'i2c',x.tag,false,tag=>{x.tag=tag;edit.dirty=true;render();});return;}
      if(d.ceAdd!==undefined){addI2c(edit,h,edit.bus);render();[...box.querySelectorAll('.ce-name')].at(-1)?.focus();return;}
      if(d.ceRemove!==undefined){const x=edit.devices.find(v=>sameHub(v,h)&&v.family==='i2c'&&v.bus===edit.bus&&v.port===+d.ceRemove);if(x)edit.devices.splice(edit.devices.indexOf(x),1);edit.dirty=true;render();return;}
      if(d.cePinout!==undefined){note='Drawing the pinout…';render();try{await api.pinout({name:edit.name,config:pinoutConfig(edit),unsaved:edit.dirty,back:()=>box.querySelector('[data-ce-pinout]')?.focus()});note='';}catch(e){note=e.message;}render();return;}
      if(d.ceCancel!==undefined){const {hub,family,bus}=edit;edit={...load(edit.name,edit.xml,edit.portals),dirty:false,hub,family,bus};note='';render();return;}
      if(d.ceSave!==undefined){let xml;try{xml=xmlOf(edit);}catch(e){note=e.message;render();return;}busy=true;note=`Saving “${edit.name}”. The robot restarts to use it…`;render();
        try{await api.save(edit.name,xml);const {hub,family,bus,portals}=edit;edit={...load(edit.name,xml,portals),hub,family,bus};note='Saved to the robot.';}catch(e){note=e.message;}finally{busy=false;render();}}});
    // A name put back after a redraw counts as not typed to the browser, so leaving its box is what takes it.
    box.addEventListener('focusout',ev=>{const el=ev.target;if(!el.dataset?.ceTyped)return;delete el.dataset.ceTyped;if(el.value!==el.defaultValue)el.dispatchEvent(new Event('change',{bubbles:true}));});
    // Back to what is on USB, from any screen. serial: the camera to land on.
    function showUsb(serial){if(!edit)return false;edit.family=null;note='';render();const main=box.querySelector('.ce-main');if(main)main.scrollTop=0;(serial&&document.getElementById(`ce-usb-add-${serial}`)||box.querySelector('.ce-usb-list button,.ce-usb-list input'))?.focus();return true;}
    box.addEventListener('change',ev=>{if(!edit)return;const el=ev.target,d=el.dataset,h=edit.hubs[edit.hub],motor=p=>edit.devices.find(v=>sameHub(v,h)&&v.family==='motor'&&v.port===+p);if(el.matches('input.ce-name'))el.defaultValue=el.value;
      if(d.ceConfig!==undefined){const name=el.value;el.value=edit.name;api.pick?.(name);return;}
      if(d.ceUsbName!==undefined){note=renameWebcam(edit,+d.ceUsbName,el.value)||'';render();return;}
      if(d.ceGear!==undefined){const x=motor(d.ceGear);if(x){x.gear=el.value||undefined;edit.dirty=true;render();}return;}
      if(d.ceEncoder!==undefined){const x=motor(d.ceEncoder);if(x){x.encoder=el.checked;edit.dirty=true;render();}return;}
      if(d.ceName!==undefined){const [f,p,b]=d.ceName.split('|'),x=edit.devices.find(v=>sameHub(v,h)&&v.family===f&&v.port===+p&&(b===''||v.bus===+b));if(x){x.name=el.value.trim();edit.dirty=true;note='';render();}}});
    return {render,open(name,xml,portals){edit=load(name,xml,portals);note='';render();},
      // The same configuration read again: its new contents, on the screen the team was on.
      refresh(name,xml,portals){const was=edit?.name===name?edit:null;edit=load(name,xml,portals??was?.portals);if(was){edit.hub=Math.min(was.hub,Math.max(0,edit.hubs.length-1));edit.family=was.family;edit.bus=was.bus;}render();},close(){edit=null;note='';render();},showUsb,current:()=>edit?.name||null,dirty:()=>!!edit?.dirty};}
  return {create,load,setType,addI2c,addWebcam,renameWebcam,removeWebcam,addLimelight,fixLimelight,removeLimelight,usbRows,usbHtml,usbNavHtml,xmlOf,pinoutConfig,hubsHtml,familiesHtml,portsHtml,menuTypes,trail};
});
