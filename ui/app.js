'use strict';
const $=s=>document.querySelector(s),api=window.deck;let state={page:'drive',robots:[],loading:false},hardware={},wifi={ssid:''},pendingWifi=null,pendingAuth=null,listKey='',nearbyNetworks=[],selectedNetwork=null,scanPromise=null;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function task(fn){try{return await fn();}catch(e){toast(e.message);}}
function setBusy(b){for(const id of ['open-robot','save-robot'])$('#'+id).disabled=b;}
function formRobot(){const ftc=$('#robot-ftc').checked;return {id:$('#robot-id').value||undefined,url:$('#robot-url').value.trim()||(ftc?'192.168.43.1':''),name:$('#robot-name').value,kind:ftc?'ftc':'auto'};}
async function openRobot(robot){setBusy(true);try{const result=await api.open(robot);if(result?.needsWifi){
    // Try the OS's saved network credentials first for one-click reopen.
    try{const info=await api.join(result.needsWifi.ssid,'');if(info.needsPassword){promptWifi(result.needsWifi.ssid,robot);return;}await openRobot(robot);}catch{promptWifi(result.needsWifi.ssid,robot);}
  }}finally{setBusy(false);}}
function setMenu(open){$('#menu').hidden=!open;$('#more').setAttribute('aria-expanded',String(open));syncOverlay();}
function showPage(page){if(page===state.page)window.scrollTo({top:0,behavior:'instant'});void task(()=>api.page(page));setMenu(false);closeWifiPicker();}
// Drive's robot list and connection: the Drive page itself with no robot open, or over a robot that stays connected.
function showConnect(){showPage(state.url?'connect':'drive');}
function network(info){wifi=info||{};robotDiscovery.network(wifi);const chipName=wifi.connected?wifi.ssid||'Wi-Fi':'Connect to Wi-Fi',bars=wifi.connected?Math.min(4,Math.max(1,Number(wifi.bars)||4)):0;$('#network-chip span').textContent=chipName;$('#network-chip').title=wifi.connected?`${chipName} · ${bars} of 4 bars`:chipName;$('#network-chip').dataset.bars=String(bars);$('#network-chip').setAttribute('aria-label',wifi.connected?`Wi-Fi connected to ${chipName}, ${bars} of 4 bars. Open the Wi-Fi list`:'Wi-Fi not connected. Open the Wi-Fi list');$('#network-chip .dot').className=`dot${wifi.connected?' live':''}`;$('#wifi-summary').textContent=wifi.connected?`Connected to ${wifi.ssid||'Wi-Fi'}.`:wifi.message||'Connect to a robot hotspot or your home network.';$('#robot-network').textContent=wifi.ssid||'No Wi-Fi connected';
  $('#connect-status').textContent=wifi.ssid?`On ${wifi.ssid}. Pick a robot, or add one by its address.`:'Not on Wi-Fi. Join your robot\u2019s network with the Wi-Fi button, or plug a Control Hub in by USB-C.';renderLibrary();}
// FTC: Open on Wi-Fi or USB, the address only when it is not the Control Hub's. Other: the address, Wi-Fi and finding.
function setKind(ftc,showAddress){$('#robot-ftc').checked=ftc;for(const b of document.querySelectorAll('[data-robot-kind]'))b.setAttribute('aria-pressed',String((b.dataset.robotKind==='ftc')===ftc));const url=$('#robot-url').value.trim(),address=!ftc||showAddress||!!url&&url!=='192.168.43.1';$('#robot-address-fields').hidden=!address;$('#robot-address-toggle').hidden=address;$('#robot-url').placeholder=ftc?'192.168.43.1':'192.168.4.1';$('#open-robot').textContent=ftc?'Open on Wi-Fi':'Open robot';$('#open-usb').hidden=!ftc;$('#robot-usb-hint').hidden=!ftc;$('#robot-discovery').hidden=ftc;$('#save-robot').textContent=ftc?'Save robot':'Save address';$('#robot-kind-hint').textContent=ftc?'Join the robot’s Wi-Fi (like 1234-RC) and open it on Wi-Fi, or plug its USB-C into this computer and open it on USB.':'A robot with its own web page. Enter its address, or find it on its hotspot. FTC robots are still detected.';}
function edit(robot){$('#robot-id').value=robot?.id||'';$('#robot-url').value=robot?.url||'';$('#robot-name').value=robot?.autoName?'':robot?.name||'';setKind(!robot||robot.kind==='ftc');showConnect();setTimeout(()=>$('#robot-url').focus(),60);}
const hostOf=url=>{try{const u=new URL(url);return u.hostname==='usb.control-hub'?'USB-C':u.host;}catch{return url;}};
function since(t){const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;}
function renderLibrary(force=false){
  const key=JSON.stringify([state.robots,wifi.ssid,state.robot?.id,state.recovering,$('#library-search').value]);if(key===listKey&&!force)return;listKey=key;
  // One list: robots saved for the current Wi-Fi come first.
  const query=$('#library-search').value.toLowerCase(),all=state.robots||[],here=r=>!!r.ssid&&r.ssid===wifi.ssid,robots=all.filter(r=>`${r.name} ${r.url} ${r.ssid}`.toLowerCase().includes(query)).sort((a,b)=>here(b)-here(a));
  // A row arrives once: drawn again (a save, a new Wi-Fi), it stays where it is instead of rising in a second time.
  const shown=renderLibrary.shown||new Set();renderLibrary.shown=new Set(robots.map(r=>r.id));
  $('#robot-list').replaceChildren(...robots.map((r,i)=>{const row=el('article','saved-row'+(here(r)?' here':'')+(state.robot?.id===r.id&&state.url?' open':'')+(shown.has(r.id)?' stays':'')),kind=el('span','robot-kind-mark'+(r.kind==='ftc'?' ftc':''),r.kind==='ftc'?'FTC':'Web'),name=el('div','saved-name'),meta=el('small','',[hostOf(r.url),here(r)?'on this Wi-Fi':r.ssid?`on ${r.ssid}`:'any Wi-Fi',r.lastOpened?`driven ${since(r.lastOpened)}`:''].filter(Boolean).join(' · '));
    row.style.setProperty('--i',String(Math.min(i,8)));kind.setAttribute('aria-hidden','true');name.append(el('strong','',r.name),meta);name.querySelector('strong').title=r.name;meta.title=r.url;
    const actions=el('div','saved-actions'),open=el('button',i===0&&!state.url?'primary':'secondary',state.robot?.id===r.id&&state.url?'Back to it':'Connect'),change=el('button','edit text-button quiet','Edit'),remove=el('button','delete text-button quiet removes','Delete');
    open.onclick=()=>void task(()=>state.robot?.id===r.id&&state.url?showPage('drive'):openRobot({id:r.id}));change.onclick=()=>edit(r);remove.onclick=()=>void task(()=>api.remove(r.id));actions.append(open,change,remove);row.append(kind,name,actions);return row;}));
  $('#library-empty').hidden=robots.length>0;$('#library-empty-title').textContent=all.length?'No robots match your search':'No saved robots yet';$('#library-empty-text').textContent=all.length?'Try part of its name or address.':'Add one with its address. Torque keeps it here, with the Wi-Fi it is on.';
  $('#library-search').hidden=all.length<6;
  // One main action a page: the first robot's Connect when there is one, Open robot when there is none.
  $('#open-robot').className=robots.length&&!state.url?'secondary':'primary';
}
const robotFullscreen=window.DeckRobotFullscreen.create(api),touchscreen=window.DeckTouchUI.create({handheld:()=>hardware.builtInController,enabled:()=>$('#touch-keyboard-auto').checked});window.DeckNumberSliders.attach(document.body);
document.addEventListener('click',event=>{if(event.pointerType==='touch'&&state.page==='drive')setTimeout(()=>void api.robotFocus?.().catch(()=>{}),0);});
const simulation=window.DeckSimulation.create($('#simulation-view'),{calibrate:$('#calibrate-view'),setup:$('#setup-view')});
const robotDiscovery=window.DeckRobotDiscovery.create({api,found:robot=>{$('#robot-id').value='';$('#robot-url').value=robot.url;$('#robot-name').value='';setKind(robot.kind==='ftc');}});
for(const b of document.querySelectorAll('[data-robot-kind]'))b.onclick=()=>setKind(b.dataset.robotKind==='ftc');$('#robot-address-toggle').onclick=()=>{setKind(true,true);$('#robot-url').focus();};setKind(true);
document.addEventListener('robot-fullscreen-error',event=>toast(event.detail));
function render(next){if(next.page!==state.page||next.loading)touchscreen.hide();state=next;if(editing&&state.page!=='settings')closeEditor(true,false);robotFullscreen.render(state);if(next.network)network(next.network);const robotUp=!!state.url||!!state.loading||!!state.error,connect=state.page==='connect'||state.page==='drive'&&!robotUp;$('#connect-view').hidden=!connect;$('#drive-view').hidden=!(state.page==='drive'&&robotUp);$('#settings-view').hidden=state.page!=='settings';
  $('#robots-page').hidden=!state.url;$('#connect-back').hidden=!(state.page==='connect'&&state.url&&!state.error);$('#connect-back-text').textContent=`${state.title||'Your robot'} is still connected.`;$('#simulation-view').hidden=state.page!=='simulation';$('#calibrate-view').hidden=state.page!=='calibrate';$('#setup-view').hidden=state.page!=='setup';simulation.activate(state.page==='simulation');simulation.calibrate(state.page==='calibrate');simulation.setup(state.page==='setup');$('#drive-tab').classList.toggle('active',state.page==='drive'||state.page==='connect');$('#simulate-tab').classList.toggle('active',state.page==='simulation');$('#robot-setup-tab').classList.toggle('active',state.page==='setup');$('#robot-setup-tab').setAttribute('aria-current',state.page==='setup'?'page':'false');$('#calibrate-tab').classList.toggle('active',state.page==='calibrate');$('#calibrate-tab').setAttribute('aria-current',state.page==='calibrate'?'page':'false');$('#menu-settings').setAttribute('aria-current',state.page==='settings'?'page':'false');const displayUrl=state.url||'No robot open';if($('#current-url').textContent!==displayUrl)$('#current-url').textContent=displayUrl;$('#drive-tab').setAttribute('aria-current',state.page==='drive'||state.page==='connect'?'page':'false');$('#simulate-tab').setAttribute('aria-current',state.page==='simulation'?'page':'false');$('#page-status').dataset.kind=state.error?'error':'loading';$('#robot-title').textContent=state.title||'Ready to connect';$('#page-dot').className=`dot${state.error?' error':state.robot&&!state.loading?' live':''}`;$('#close-page').hidden=!state.url;$('#manager-close').hidden=!state.manager;$('#view-kind').textContent=state.kind==='ftc'?(state.manager?'Program & Manage · on the robot':'FTC Driver Station'):'Robot web UI';$('#drive-view').classList.toggle('station-view',state.kind==='ftc'&&!state.manager&&!!state.url&&!state.loading&&!state.error);$('#back').disabled=!state.url;$('#reload').disabled=!state.url;$('#page-status').hidden=!state.loading&&!state.error;$('#page-status-title').textContent=state.error?(state.recovering?'Robot connection paused':'Robot page unavailable'):'Opening robot…';$('#page-status-message').textContent=state.error||state.url;$('#retry').hidden=!state.error;$('#error-settings').hidden=!state.error;$('.loader').hidden=!!state.error;renderLibrary();renderExtras();sendStationLook();if(state.page==='settings')renderThemes();void bounds();}
function bounds(){if(state.page!=='drive'||state.robotFullscreen)return Promise.resolve();const r=$('#robot-mount').getBoundingClientRect();return api.bounds({x:r.x,y:r.y,width:r.width,height:r.height}).catch(()=>{});}
$('#drive-tab').onclick=()=>showPage('drive');$('#robot-setup-tab').onclick=()=>showPage('setup');$('#calibrate-tab').onclick=()=>showPage('calibrate');$('#simulate-tab').onclick=()=>showPage('simulation');for(const b of document.querySelectorAll('[data-flow]'))b.onclick=()=>{simulation.flow(b.dataset.flow);showPage(simulation.pageOf(b.dataset.flow));};$('#network-chip').onclick=()=>$('#wifi-popover').hidden?openWifiPicker():closeWifiPicker();$('#robots-page').onclick=()=>showPage('connect');$('#connect-back-button').onclick=()=>showPage('drive');
$('#more').onclick=()=>setMenu($('#menu').hidden);$('#menu-settings').onclick=()=>showPage('settings');$('#menu-updates').onclick=()=>void task(showUpdates);$('#menu-library').onclick=()=>{showConnect();setTimeout(()=>$('#library-panel').scrollIntoView({behavior:scrollMotion()}),50);};$('#menu-shortcuts').onclick=()=>openInfo('#shortcuts-dialog');$('#menu-credits').onclick=()=>openInfo('#credits-dialog');$('#menu-fullscreen').onclick=()=>void task(async()=>{await api.fullscreen();setMenu(false);});$('#menu-quit').onclick=()=>void api.quit();
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#menu')&&!e.target.closest('#more'))setMenu(false);});
// Keyboard shortcuts and the credits: from the menu and from Settings, each in a dialog of its own.
function openInfo(sel){setMenu(false);$(sel).showModal();syncOverlay();}
for(const d of document.querySelectorAll('.info-dialog')){d.querySelector('[data-close]').onclick=()=>{d.close();syncOverlay();};d.addEventListener('close',()=>syncOverlay());}
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog[open]'))return;if(!$('#menu').hidden){setMenu(false);$('#more').focus();}if(!$('#wifi-popover').hidden){closeWifiPicker();$('#network-chip').focus();}});
$('#robot-form').onsubmit=e=>{e.preventDefault();void task(()=>openRobot(formRobot()));};
// A Control Hub on the USB cable is saved at usb.control-hub; Drive reaches it through the cable.
$('#open-usb').onclick=()=>void task(()=>openRobot({url:'usb.control-hub',name:'Control Hub (USB)',kind:'ftc'}));$('#save-robot').onclick=()=>void task(async()=>{const p=await api.save(formRobot());$('#robot-id').value=p.id;toast('Robot address saved on this device.');});$('#library-search').oninput=()=>renderLibrary();$('#close-page').onclick=()=>void task(()=>api.close());$('#manager-close').onclick=()=>void task(()=>api.managerClose());api.onNotice?.(toast);$('#reload').onclick=()=>void task(()=>api.reload());$('#back').onclick=()=>void task(()=>api.back());$('#retry').onclick=()=>void task(()=>openRobot(state.robot?.id?{id:state.robot.id}:{...state.robot,url:state.url}));$('#error-settings').onclick=()=>showPage('connect');
function closeWifiPicker(){if($('#wifi-popover').hidden)return;$('#wifi-popover').hidden=true;$('#network-chip').setAttribute('aria-expanded','false');selectedNetwork=null;$('#wifi-connect-panel').hidden=true;syncOverlay();}
function renderNetworks(){
  $('#wifi-list').replaceChildren(...nearbyNetworks.map(n=>{const connected=n.ssid===wifi.ssid,b=el('button',`wifi-row${selectedNetwork?.ssid===n.ssid?' selected':''}`),name=el('div');b.setAttribute('role','option');b.setAttribute('aria-selected',String(selectedNetwork?.ssid===n.ssid));name.append(el('strong','',n.ssid),el('small','',connected?'Connected':n.security&&n.security!=='--'?'Secured':'Open network'));b.append(name);b.onclick=()=>{selectedNetwork=n;$('#wifi-selection').textContent=n.ssid;$('#join-network').textContent=connected?'Done':'Connect';$('#wifi-connect-panel').hidden=false;renderNetworks();};return b;}));
}
async function scan(){if(scanPromise)return scanPromise;const button=$('#refresh-wifi');button.disabled=true;$('#wifi-scan-message').textContent='Scanning nearby Wi-Fi…';scanPromise=(async()=>{try{nearbyNetworks=await api.scan();if(wifi.ssid&&!nearbyNetworks.some(n=>n.ssid===wifi.ssid))nearbyNetworks.unshift({ssid:wifi.ssid,active:true});nearbyNetworks.sort((a,b)=>Number(b.ssid===wifi.ssid)-Number(a.ssid===wifi.ssid));renderNetworks();$('#wifi-scan-message').textContent=nearbyNetworks.length?'':'No networks found. Check Wi-Fi permissions or use system Wi-Fi settings.';}catch(e){$('#wifi-scan-message').textContent=e.message;}finally{button.disabled=false;scanPromise=null;}})();return scanPromise;}
function openWifiPicker(){setMenu(false);$('#wifi-popover').hidden=false;$('#network-chip').setAttribute('aria-expanded','true');syncOverlay();void scan();}
$('#refresh-wifi').onclick=()=>void scan();$('#system-wifi').onclick=()=>void task(()=>api.systemWifi());
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.wifi-anchor')&&!e.target.closest('#wifi-dialog'))closeWifiPicker();});
function promptWifi(ssid,robot=null){pendingWifi={ssid,robot};$('#wifi-password').value='';$('#wifi-error').textContent='';$('#wifi-dialog-title').textContent=ssid;$('#wifi-dialog-message').textContent=robot?'Connect to this robot’s saved Wi-Fi, then its website will open.':'Enter this network’s Wi-Fi password.';$('#wifi-dialog').showModal();syncOverlay();$('#wifi-password').focus();}
$('#join-network').onclick=()=>void task(async()=>{const selection=selectedNetwork;if(!selection)return;if(selection.ssid===wifi.ssid){closeWifiPicker();return;}$('#join-network').disabled=true;try{const info=await api.join(selection.ssid,'');if(info.needsPassword){promptWifi(selection.ssid);return;}network(info);closeWifiPicker();toast('Connected to '+info.ssid);}catch(e){if(e.code==='NEEDS_PASSWORD')promptWifi(selection.ssid);else throw e;}finally{$('#join-network').disabled=false;}});
function closeWifiDialog(){$('#wifi-dialog').close();$('#wifi-password').value='';pendingWifi=null;syncOverlay();}
$('#wifi-form').onsubmit=e=>{e.preventDefault();void(async()=>{const p=pendingWifi;$('#wifi-submit').disabled=true;$('#wifi-error').textContent='Connecting…';try{const info=await api.join(p.ssid,$('#wifi-password').value);if(info.needsPassword)throw Error(info.message);network(info);closeWifiPicker();closeWifiDialog();if(p.robot)await openRobot(p.robot);}catch(err){$('#wifi-error').textContent=err.message;}finally{$('#wifi-submit').disabled=false;}})();};$('#wifi-cancel').onclick=closeWifiDialog;$('#wifi-dialog').addEventListener('cancel',e=>{e.preventDefault();closeWifiDialog();});
api.onAuth(data=>{pendingAuth=data;$('#auth-host').textContent=data.host+(data.realm?` · ${data.realm}`:'');$('#auth-password').value='';$('#auth-message').textContent=data.retry?'Sign-in failed. Check the username and password.':'Credentials are sent to this robot and are not saved in the address list.';if(!$('#auth-dialog').open)$('#auth-dialog').showModal();$('#auth-username').focus();});
$('#auth-form').onsubmit=e=>{e.preventDefault();const p={id:pendingAuth.id,username:$('#auth-username').value,password:$('#auth-password').value};$('#auth-dialog').close();$('#auth-password').value='';void task(()=>api.auth(p));};
function cancelAuth(){if(pendingAuth)void api.auth({id:pendingAuth.id,cancel:true}).catch(()=>{});pendingAuth=null;$('#auth-dialog').close();$('#auth-password').value='';}$('#auth-cancel').onclick=cancelAuth;$('#auth-dialog').addEventListener('cancel',e=>{e.preventDefault();cancelAuth();});
const controllerMonitor=window.DeckControllerMonitor.create({api,hardware:()=>hardware,robot:()=>state.robot,syncOverlay,toast});
async function controllers(){try{if(api.controllerInfo)controllerMonitor.render(await api.controllerInfo());else{const pads=window.DeckControllers.orderedPads(navigator.getGamepads?.()||[],hardware).slice(0,2);controllerMonitor.render({count:state.robot?.controllerCount||1,slots:pads,readings:pads});}}catch{}}
new ResizeObserver(()=>void bounds()).observe($('#robot-mount'));window.addEventListener('resize',()=>void bounds());api.onState(render);api.onNetwork(network);
void task(async()=>{const data=await api.bootstrap();hardware=data.hardware;$('#menu-version').textContent=menuVersion(data.app);$('#device').textContent=hardware.model;render(data.state);$('#about-version').textContent=data.app?`Torque ${data.app.version}, ${data.app.channel==='testing'?'Testing (pre-release)':'Main (stable)'}`:'';void controllers();setInterval(controllers,1000);void loadThemes();});

function syncOverlay(){void api.overlay(!$('#menu').hidden||!$('#wifi-popover').hidden||[...document.querySelectorAll('dialog')].some(d=>d.open)).catch(()=>{});}
// However a dialog closes (its button, Escape, or a script), the robot view comes back once nothing covers it.
document.addEventListener('close',()=>syncOverlay(),true);
let updateBusy=false;
function updateButtons(busy){updateBusy=busy;for(const id of ['update-check','update-download','update-close','update-main','update-testing','testing-confirm','testing-cancel'])$('#'+id).disabled=busy;}
function resetUpdateResult(){$('#update-download').hidden=true;$('#update-dismiss').hidden=true;$('#update-changelog').hidden=true;$('#update-progress').hidden=true;}
async function showUpdates(){setMenu(false);$('#update-dialog').showModal();syncOverlay();resetUpdateResult();$('#testing-warning').hidden=true;$('#update-status').textContent='Loading update settings…';updateButtons(true);try{renderUpdateInfo(await api.updateInfo());$('#update-status').textContent='';}catch(e){$('#update-status').textContent=e.message;}finally{updateButtons(false);}}
$('#update-close').onclick=()=>{$('#update-dialog').close();syncOverlay();};
$('#update-dialog').addEventListener('cancel',e=>{if(updateBusy){e.preventDefault();return;}setTimeout(syncOverlay,0);});
$('#update-check').onclick=()=>void(async()=>{updateButtons(true);resetUpdateResult();$('#update-status').textContent='Checking GitHub…';try{const result=await api.updateCheck();$('#update-status').textContent=result.message;if(result.status==='available'){const size=result.asset?.size;$('#update-download').textContent=size?`Download update · ${megabytes(size)}`:'Download update';if(size)$('#update-status').textContent=`${result.message} ${result.asset.kind==='app'?'App code only':'Full app and runtime'}: ${megabytes(size)} from GitHub.`;$('#update-download').hidden=false;$('#update-notes').textContent=result.notes||'';$('#update-changelog').hidden=!result.notes;}}catch(e){$('#update-status').textContent='Could not check for updates: '+e.message;}finally{updateButtons(false);}})();
$('#update-download').onclick=()=>void(async()=>{updateButtons(true);$('#update-status').textContent='Downloading and verifying update…';$('#update-progress').hidden=false;$('#update-progress').removeAttribute('value');try{await api.updateDownload();$('#update-download').hidden=true;$('#update-status').textContent='Update ready. Restarting the app…';}catch(e){$('#update-status').textContent='Update could not finish: '+e.message;$('#update-progress').hidden=true;updateButtons(false);}})();
// The update icon beside the bug report (Windows, Mac and Steam Deck alike). Torque checks GitHub when it starts and every
// few hours on the channel this install follows. The icon stays neutral; hovering turns it green (up to date) or yellow
// (an update is published) and says which version is installed. A yellow dot marks a new version until it is dismissed
// (Not now); a later version brings it back. Clicking opens App updates with Main / Testing, checked at once.
let updateOffer=null,updateInfoNow=null;
const DISMISSED='torque-update-dismissed',dismissed=()=>{try{return localStorage.getItem(DISMISSED)||'';}catch{return '';}};
function paintUpdateIcon(state,tip){const b=$('#update-ready');b.dataset.state=state;b.dataset.tip=tip;b.setAttribute('aria-label',tip);
  b.classList.toggle('has-update',state==='available'&&dismissed()!==updateOffer?.latest);}
// Read-only: never api.updateInfo() here, which closes an open robot page (a robot being driven) as the popup opens.
async function offerUpdate(){if(updateBusy)return;try{updateInfoNow=await api.updateState();}catch{}
  const here=updateInfoNow?`Torque ${updateInfoNow.version} · ${updateInfoNow.channel==='testing'?'Testing':'Main'}`:'Torque';
  try{const r=await api.updateCheck();updateOffer=r.status==='available'?r:null;
    if(updateOffer)paintUpdateIcon('available',`${here}. Update ${updateOffer.latest} is available: click to install.`);
    else paintUpdateIcon(r.status==='current'?'current':'unknown',r.status==='current'?`${here}. Up to date.`:`${here}. ${r.message}`);}
  catch(e){paintUpdateIcon('unknown',`${here}. Could not check for updates: ${e.message}`);}}
async function checkInDialog(){updateButtons(true);resetUpdateResult();$('#update-status').textContent='Checking GitHub…';
  try{const result=await api.updateCheck();$('#update-status').textContent=result.message;
    if(result.status==='available'){const size=result.asset?.size;$('#update-download').textContent=size?`Download and install · ${megabytes(size)}`:'Download and install';$('#update-download').hidden=false;$('#update-dismiss').hidden=dismissed()===result.latest;
      if(result.notes){$('#update-notes').textContent=result.notes;$('#update-changelog').hidden=false;}}}
  catch(e){$('#update-status').textContent='Could not check for updates: '+e.message;}finally{updateButtons(false);}}
$('#update-ready').onclick=()=>void(async()=>{await showUpdates();if(!updateBusy)await checkInDialog();})();
$('#update-dismiss').onclick=()=>{if(updateOffer){try{localStorage.setItem(DISMISSED,updateOffer.latest);}catch{}}$('#update-dismiss').hidden=true;paintUpdateIcon($('#update-ready').dataset.state,$('#update-ready').dataset.tip);};
setTimeout(()=>void offerUpdate(),4000);setInterval(()=>void offerUpdate(),4*3600*1000);
api.onUpdateProgress?.(p=>{if(p.phase==='installing'){$('#update-progress').removeAttribute('value');$('#update-status').textContent='Download verified. Installing update and restarting…';return;}if(p.total){$('#update-progress').max=p.total;$('#update-progress').value=p.bytes;}$('#update-status').textContent=p.total?`Downloading ${megabytes(p.bytes)} of ${megabytes(p.total)}…`:`Downloading ${megabytes(p.bytes)}…`;});

// Asset sizes come from the GitHub release; small code-only updates read in kilobytes.
function megabytes(bytes){if(bytes<1048576)return `${Math.max(1,Math.round(bytes/1024))} KB`;const mb=bytes/1048576;return `${mb<10?mb.toFixed(1):Math.round(mb)} MB`;}
let selectedChannel='testing';
// The three-dot menu says which build this is: Testing builds are GitHub pre-releases, Main builds the stable releases.
function menuVersion(app){if(!app)return '';return app.channel==='testing'?`App version ${app.version} · Testing (pre-release, experimental)`:`App version ${app.version} · Main (stable release)`;}
function renderUpdateInfo(info){selectedChannel=info.channel;for(const channel of ['main','testing'])$('#update-'+channel).setAttribute('aria-pressed',String(channel===info.channel));$('#update-version').textContent=`Installed ${info.version} · ${info.installedChannel||info.channel}`;$('#channel-note').textContent=info.channel==='testing'?'Following experimental Testing releases.':'Following stable Main releases.';}
async function switchChannel(channel,confirmed=false){updateButtons(true);resetUpdateResult();try{renderUpdateInfo(await api.updateChannel(channel,confirmed));$('#testing-warning').hidden=true;$('#update-status').textContent='Channel saved.';}catch(e){$('#update-status').textContent=e.message;updateButtons(false);return;}updateButtons(false);
  // The branch just chosen is checked at once, in the dialog and for the icon.
  await checkInDialog();void offerUpdate();}
$('#update-main').onclick=()=>{if(selectedChannel!=='main')void switchChannel('main');else{$('#testing-warning').hidden=true;$('#update-check').disabled=false;}};
$('#update-testing').onclick=()=>{if(selectedChannel==='testing')return;resetUpdateResult();$('#testing-warning').hidden=false;$('#update-check').disabled=true;$('#testing-confirm').focus();};
$('#testing-confirm').onclick=()=>void switchChannel('testing',true);$('#testing-cancel').onclick=()=>{$('#testing-warning').hidden=true;$('#update-check').disabled=false;$('#update-main').focus();};

// Preferences stay on this device: theme, keep-awake, on-screen keyboard and shortcut labels.
const prefs={get:(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set:(key,value)=>{try{localStorage.setItem(key,value);}catch{}},remove:key=>{try{localStorage.removeItem(key);}catch{}}};
// Light or dark: the button in the bar steps through the three, and Settings → App colour picks one (the bar has no room
// for the button in a narrower window). Both show the same choice.
function applyTheme(theme){if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;else delete document.documentElement.dataset.theme;const cycle=$('#theme-cycle'),mode=theme==='light'||theme==='dark'?theme:'system',label=`Light or dark: ${mode==='system'?'match the device':mode}`;cycle.dataset.mode=mode;cycle.title=label;cycle.setAttribute('aria-label',label);
  for(const b of document.querySelectorAll('#mode-pick [data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));api.setTheme?.(mode);}
const setMode=mode=>{prefs.set('deck-theme',mode);applyTheme(mode);};
$('#theme-cycle').onclick=()=>setMode({system:'light',light:'dark',dark:'system'}[$('#theme-cycle').dataset.mode]);
for(const b of document.querySelectorAll('#mode-pick [data-mode]'))b.onclick=()=>setMode(b.dataset.mode);
applyTheme(prefs.get('deck-theme','system'));
const sendKeepAwake=()=>void api.keepAwake?.($('#keep-awake').checked).catch(()=>{});
$('#keep-awake').checked=prefs.get('deck-keep-awake','on')!=='off';$('#keep-awake').onchange=()=>{prefs.set('deck-keep-awake',$('#keep-awake').checked?'on':'off');sendKeepAwake();};sendKeepAwake();
const syncKeyboardMenu=()=>{const on=$('#touch-keyboard-auto').checked;$('#menu-keyboard').setAttribute('aria-checked',String(on));$('#menu-keyboard-check').textContent=on?'☑':'☐';};
$('#menu-keyboard').onclick=()=>{$('#touch-keyboard-auto').checked=!$('#touch-keyboard-auto').checked;$('#touch-keyboard-auto').onchange();};
const sendTouchKeyboard=()=>void api.touchKeyboard?.($('#touch-keyboard-auto').checked).catch(()=>{});
$('#touch-keyboard-auto').checked=prefs.get('deck-virtual-keyboard','off')==='on';$('#touch-keyboard-auto').onchange=()=>{prefs.set('deck-virtual-keyboard',$('#touch-keyboard-auto').checked?'on':'off');syncKeyboardMenu();if(!$('#touch-keyboard-auto').checked)touchscreen.hide();sendTouchKeyboard();};syncKeyboardMenu();sendTouchKeyboard();
if(/Mac/i.test(navigator.platform)){for(const key of document.querySelectorAll('kbd.mod'))key.textContent='⌘';for(const k of document.querySelectorAll('.back-key'))k.replaceChildren(el('kbd','','⌘'),' ',el('kbd','','['));}
$('#zoom-reset').onclick=()=>void task(()=>api.zoom(0));

// Looks (docs/THEMES.md), one set for Torque's own screens ("app") and one for the FTC Driver Station screen ("station"):
// a colour, the palette, and a theme, how the screens are drawn. Any colour goes with any theme. An imported theme also
// has colours of its own ("<Theme>’s own" in the colour list), which go on with it; the colour picked before comes back
// with Torque or DEV. Built-in ones come with the app. A colour the user makes or imports is kept here in prefs; an
// imported theme is a folder copied into the app's data folder. Every robot wears the Driver Station's. Fonts work the
// same way: Inter, OpenDyslexic and the computer's own come with it, and a font file added here is kept too.
const Themes=window.DeckThemes,KINDS=['app','station'];let imported=[],colours=[],fonts=[],lastLook='',draft=null,editing=null,themesReady=false;
// Theme folders being saved, so two quick imports cannot pass a list's room between them.
const importing={app:0,station:0};
// The user's own colours: only what they chose is kept ({id,name,accent,tint,for}); the rest is made again on load.
function loadColours(){let list=[];try{list=JSON.parse(prefs.get('torque-colours','[]'));}catch{}const room={app:Themes.MAX_COLOURS-Themes.COLOURS.length,station:Themes.MAX_COLOURS-Themes.COLOURS.length};
  return (Array.isArray(list)?list:[]).map(s=>{try{const c=Themes.colour(s);return c.id===s.id&&Themes.validColour(c)&&room[c.for]-->0?c:null;}catch{return null;}}).filter(Boolean);}
const saveColours=()=>prefs.set('torque-colours',JSON.stringify(colours.map(c=>({id:c.id,name:c.name,accent:c.accent,tint:c.tint,for:c.for}))));
colours=loadColours();
const themeList=kind=>[...Themes.THEMES,...imported.filter(t=>t.for===kind)];
const colourList=kind=>[...Themes.COLOURS,...colours.filter(c=>c.for===kind)];
const isImported=t=>/^custom-/.test(String(t?.id));
// A colour's main colour as it was picked on the colour wheel: an own colour's own accent, not the one moved to read on a
// ground; a built-in colour's (and a theme's own colours') dark accent. Its dot is drawn in it, here and in the Driver
// Station's Theme and colour menu.
const primary=c=>c.custom?c.accent:c.dark.accent;
// Once, from older Torques. Before colours and themes were apart a theme id was a colour, and a saved robot could have a
// theme of its own. A colour that was a theme is now that colour with the Torque theme, the Driver Station's too: it was
// drawn plain, so it must not pick up a theme the app has on (Same as the app would). Blue and Red are gone: one that was
// picked becomes an own colour of that name, made from the same main colour, and stays on. An imported theme then drew
// only in its own colours, so it goes on doing that.
(function migrateLooks(){const was=prefs.get('torque-looks','');if(was==='3')return;
  if(was!=='2'){const OLD=['torque','blue','orange','purple','red','mono'];
    for(const kind of KINDS){const old=prefs.get(`torque-${kind}-theme`,null);if(!OLD.includes(old))continue;
      prefs.set(`torque-${kind}-theme`,'torque');if(prefs.get(`torque-${kind}-colour`,null)==null)prefs.set(`torque-${kind}-colour`,old);}
    prefs.remove('torque-robot-themes');}
  const GONE={blue:{name:'Blue',accent:'#87bafe'},red:{name:'Red',accent:'#ff958f'}};
  for(const kind of KINDS){const key=`torque-${kind}-colour`,old=GONE[prefs.get(key,null)];if(!old)continue;
    let c=colours.find(x=>x.for===kind&&x.name===old.name&&x.accent===old.accent&&!x.tint);
    if(!c&&colourList(kind).length<Themes.MAX_COLOURS){c=Themes.colour({...old,for:kind});colours=[...colours,c];saveColours();}
    prefs.set(key,c?.id||(kind==='app'?'torque':'same'));}
  for(const kind of KINDS){const key=`torque-${kind}-colour`,picked=prefs.get(key,null);if(!isImported({id:prefs.get(`torque-${kind}-theme`,'')})||picked==='theme')continue;
    if(picked)prefs.set(key+'-last',picked);prefs.set(key,'theme');}
  prefs.set('torque-looks','3');})();
// An imported theme's own colours, as one of its list's colours: "<Theme>’s own", stored as 'theme'.
const ownOf=t=>isImported(t)?{id:'theme',name:`${t.name}’s own`,dark:t.dark,light:t.light,theme:t}:null;
// The colour picked before a theme's own went on, which comes back with Torque or DEV.
function lastColour(kind){const fallback=kind==='app'?'torque':'same',id=prefs.get(`torque-${kind}-colour-last`,fallback);return kind==='station'&&id==='same'||Themes.find(colourList(kind),id)?id:fallback;}
// What is picked in a list (torque-app-theme, torque-station-colour…): a stored id that is still in it, or the default.
function pickOf(kind,what){const fallback=kind==='app'?'torque':'same',id=prefs.get(`torque-${kind}-${what}`,fallback);if(kind==='station'&&id==='same')return id;
  if(what==='colour'&&id==='theme')return ownOf(themeOf(kind))?id:lastColour(kind);
  return Themes.find(what==='theme'?themeList(kind):colourList(kind),id)?id:fallback;}
const appTheme=()=>Themes.find(themeList('app'),pickOf('app','theme'))||Themes.THEMES[0];
const stationTheme=()=>{const id=pickOf('station','theme');return id==='same'?appTheme():Themes.find(themeList('station'),id)||Themes.THEMES[0];};
const themeOf=kind=>kind==='app'?appTheme():stationTheme();
// The colour a list shows: one being made in the editor until it is saved or cancelled, the theme's own, or the app's.
function colourOf(kind){return draft?.kind===kind?draft.colour:colourById(kind,pickOf(kind,'colour'));}
function colourById(kind,id){return id==='theme'?ownOf(themeOf(kind))||Themes.COLOURS[0]:id==='same'?colourOf('app'):Themes.find(colourList(kind),id)||Themes.COLOURS[0];}
// What the built-in themes (Torque, DEV, FIRST, NYC FIRST) are drawn in: the colour shown, or, while a theme's own is on, the one that comes back with them.
const plainColour=kind=>{const c=colourOf(kind);return c.theme?colourById(kind,lastColour(kind)):c;};
// What is drawn: an imported theme exactly as it came (compose takes null for that), or any other colour over a theme.
const lookOf=kind=>{const t=themeOf(kind),c=colourOf(kind);return Themes.compose(t,c.theme&&c.theme.id===t.id?null:c);};
const appLook=()=>lookOf('app'),stationLook=()=>lookOf('station');
const FONTS=[{id:'inter',name:'Inter',family:'Inter'},{id:'dyslexic',name:'OpenDyslexic',family:'OpenDyslexic'},{id:'system',name:'This computer’s',family:'system-ui'}];
const fontList=()=>[...FONTS,...fonts];
const font=()=>fontList().find(f=>f.id===prefs.get('torque-font','inter'))||FONTS[0];
// The Driver Station's look, and its lists for the Theme and colour menu in its bar. Sent again only when something in it changed.
function sendStationLook(force=false){const theme=stationLook(),f=font(),current={theme:pickOf('station','theme'),colour:pickOf('station','colour')},own=ownOf(stationTheme());
  const themes=[{id:'same',name:'Same as the app'},...themeList('station').map(t=>({id:t.id,name:t.name}))];
  const entry=(c,id=c.id,name=c.name)=>({id,name,swatch:Themes.swatch(c),primary:primary(c)});
  const list=[entry(colourOf('app'),'same','Same as the app'),...(own?[entry(own)]:[]),...colourList('station').map(c=>entry(c))];
  const key=JSON.stringify([theme.id,theme.look,theme.motion,Themes.swatch(theme),f.id,themes,list,current]);if(key===lastLook&&!force)return;lastLook=key;
  api.stationLook?.({theme,font:f,themes,colours:list,current});}
// A theme's own colours go with it: once it is off (another theme picked, or it is removed), the colour from before is back.
function settleColours(){for(const kind of KINDS){const key=`torque-${kind}-colour`;if(prefs.get(key,null)==='theme'&&!ownOf(themeOf(kind)))prefs.set(key,lastColour(kind));}}
function applyLooks(){if(themesReady)settleColours();Themes.apply(document,appLook(),{font:font()});sendStationLook(true);renderThemes();}
// While a colour is being made: the same, without sending the Driver Station what has not changed.
function previewLooks(){Themes.apply(document,appLook(),{font:font()});sendStationLook();renderThemes();}
// Putting a choice on. An imported theme put on brings its own colours with it; the colour from before waits for Torque or DEV.
function setColour(kind,id){const key=`torque-${kind}-colour`,was=pickOf(kind,'colour');if(id==='theme'&&was!=='theme')prefs.set(key+'-last',was);prefs.set(key,id);}
function putOn(kind,what,id){if(what==='colour')return setColour(kind,id);const was=pickOf(kind,'theme');prefs.set(`torque-${kind}-theme`,id);if(id!==was&&isImported(Themes.find(themeList(kind),id)))setColour(kind,'theme');}
const clearStatus=kind=>{for(const id of [`colour-${kind}-status`,`theme-${kind}-status`])$('#'+id).textContent='';};
// A pick in Settings or in the Driver Station's Theme and colour menu: a colour half made in the editor is dropped, not saved.
function choose(kind,what,id){if(editing)closeEditor(false,false);clearStatus(kind);putOn(kind,what,id);applyLooks();}
// After a save, an import or a removal: focus on the card it is about, or on the one picked in its list.
function focusIn(list,id){((id&&$(`#${list} [data-id="${CSS.escape(id)}"]:not([data-action])`))||$(`#${list} [role=radio][aria-checked=true]`))?.focus();}
const PLUS='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
// A card in one of Settings' lists. Something the user added carries what can be done with it under it (Remove last, set
// apart from the others: it asks first, and cannot be undone).
function choiceCard(cls,{id,checked,pick,label,actions=[],remove}){const b=el('button',cls);b.type='button';b.dataset.id=id;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(checked));b.onclick=pick;
  if(remove)actions=[...actions,{act:'remove',text:'Remove',cls:'removes choice-remove',run:remove}];if(!actions.length)return b;
  const item=el('div','choice-item'),row=el('div','choice-actions');for(const a of actions){const x=el('button',`text-button quiet choice-action ${a.cls||''}`.trim(),a.text);x.type='button';x.dataset.id=id;x.dataset.action=a.act;x.setAttribute('aria-label',`${a.text} ${label}`);x.onclick=a.run;row.append(x);}
  item.append(b,row);return {item,card:b};}
function addCard(cls,label,onclick){const b=el('button',`${cls} add-card`);b.type='button';b.dataset.id='add';const mark=el('span',cls==='theme-card'?'theme-preview':'font-sample');mark.setAttribute('aria-hidden','true');mark.innerHTML=PLUS;b.append(mark,el('span',cls==='theme-card'?'theme-name':'font-name',label));b.onclick=onclick;return b;}
// A moving theme's preview: a few rows of the characters its background is drawn in; FIRST's and NYC FIRST's also show
// their logo, drawn from the same measurements as their background (DeckAscii.logo), each shape in its own ink (the
// theme's inks for dark and light, chosen by the stylesheet like the rest of the preview).
const ASCII=Array.from({length:7},(_,y)=>Array.from({length:30},(_,x)=>' .:-+%#'[Math.round(3+3*Math.sin(x*.55+y*.9)*Math.cos(x*.21-y*.4))]).join('')).join('\n');
// A look in small, in both modes (the stylesheet shows the one the app is in): its ground, a bar, two lines of words and
// its accent. A picture only, so a screen reader reads the card's name and not DEV's rows of characters.
function preview(look,view=el('span','theme-preview')){view.setAttribute('aria-hidden','true');for(const [mode,k] of [['dark','d'],['light','l']])for(const part of ['bg','surface','text','accent'])view.style.setProperty(`--p${k}-${part}`,look[mode][part]);
  if(look.background?.image)view.style.setProperty('--p-image',`url("${look.background.image}")`);else view.style.removeProperty('--p-image');
  for(const old of view.querySelectorAll('.p-ascii,.p-inks'))old.remove();const parts=[...(look.motion==='ascii'?[el('i','p-ascii',ASCII)]:[])];
  view.classList.toggle('has-inks',!!look.inks);if(look.inks){const row=el('i','p-inks');row.innerHTML=window.DeckAscii?.logo?.(look.scene)||'';look.inks.dark.forEach((_,i)=>{row.style.setProperty(`--pd-ink${i}`,look.inks.dark[i]);row.style.setProperty(`--pl-ink${i}`,look.inks.light[i]);});parts.push(row);}
  if(!view.querySelector('.p-bar'))parts.push(el('i','p-bar'),el('i','p-line'),el('i','p-line short'),el('i','p-button'));view.prepend(...parts);return view;}
function lookCard(look,{id,name,checked,pick,actions,remove,title,dot}){const made=choiceCard('theme-card',{id,checked,pick,label:name,actions,remove}),b=made.card||made,label=el('span','theme-name',name);
  if(dot){const d=el('i','colour-dot');d.setAttribute('aria-hidden','true');d.style.setProperty('--dot',dot);label.prepend(d);}
  b.append(preview(look),label);if(title)b.title=title;return made.item||b;}
function fontCard(f){const made=choiceCard('font-card',{id:f.id,checked:f.id===font().id,pick:()=>{prefs.set('torque-font',f.id);applyLooks();},label:f.name,remove:f.custom?()=>removeFont(f):null}),b=made.card||made,sample=el('span','font-sample','Aa');
  sample.setAttribute('aria-hidden','true');sample.style.setProperty('font-family',f.custom?`"${f.family}", system-ui, sans-serif`:f.family);b.append(sample,el('span','font-name',f.name));return made.item||b;}
function renderThemes(){
  // The lists are drawn again whenever something changes: whatever in them had focus has it again afterwards.
  const at=document.activeElement,grid=at?.closest?.('#settings-view :is(.theme-grid, .font-grid)'),keep=grid&&at.dataset.id?{grid:grid.id,id:at.dataset.id,action:at.dataset.action}:null;
  for(const kind of KINDS){const station=kind==='station',own=ownOf(themeOf(kind)),plain=plainColour(kind),app=colourOf('app');
    // Colours: Same as the app (Driver Station), an imported theme's own while it is on, the built-in ones, the user's own
    // (Edit, Export, Remove), then + while the list has room.
    const picked=pickOf(kind,'colour'),full=colourList(kind).length>=Themes.MAX_COLOURS;
    $(`#colours-${kind}`).replaceChildren(...(station?[lookCard(app,{id:'same',name:'Same as the app',dot:primary(app),checked:picked==='same',pick:()=>choose(kind,'colour','same')})]:[]),
      ...(own?[lookCard(own.theme,{id:'theme',name:own.name,dot:primary(own),checked:picked==='theme',pick:()=>choose(kind,'colour','theme')})]:[]),
      ...colourList(kind).map(c=>lookCard(c,{id:c.id,name:c.name,dot:primary(c),checked:c.id===picked,pick:()=>choose(kind,'colour',c.id),
        actions:c.custom?[{act:'edit',text:'Edit',run:()=>openEditor(kind,c)},{act:'export',text:'Export',run:()=>exportColour(c)}]:[],remove:c.custom?()=>removeColour(c):null})),
      ...(full?[]:[addCard('theme-card','Add a colour',()=>openEditor(kind,null))]));
    $(`#colours-${kind}-full`).textContent=full?`This list is full at ${Themes.MAX_COLOURS} colours. Remove one of yours to add another.`:'';
    // Themes: the built-in ones in this list's colour, imported ones in their own, then + while the list has room.
    const pickedTheme=pickOf(kind,'theme'),fullThemes=themeList(kind).length>=Themes.MAX_THEMES;
    $(`#themes-${kind}`).replaceChildren(...(station?[lookCard(appLook(),{id:'same',name:'Same as the app',checked:pickedTheme==='same',pick:()=>choose(kind,'theme','same')})]:[]),
      ...themeList(kind).map(t=>lookCard(Themes.compose(t,isImported(t)?null:plain),{id:t.id,name:t.name,checked:t.id===pickedTheme,pick:()=>choose(kind,'theme',t.id),title:t.author?`By ${t.author}`:'',remove:t.for?()=>removeTheme(t):null})),
      ...(fullThemes?[]:[addCard('theme-card','Import a theme',()=>importTheme(kind))]));
    $(`#themes-${kind}-full`).textContent=fullThemes?`This list is full at ${Themes.MAX_THEMES} themes. Remove one you imported to import another.`:'';}
  $('#fonts').replaceChildren(...fontList().map(fontCard),addCard('font-card','Add a font',()=>{$('#font-input').value='';$('#font-input').click();}));
  if(keep&&!document.contains(at))$(`#${keep.grid} [data-id="${CSS.escape(keep.id)}"]${keep.action?`[data-action="${keep.action}"]`:':not([data-action])'}`)?.focus({preventScroll:true});}
async function loadThemes(){try{imported=(await api.themes('list')).filter(Themes.valid);}catch{imported=[];}
  try{fonts=(await api.fonts('list')).map(f=>({...f,family:'torque-'+f.id,custom:true}));}catch{fonts=[];}themesReady=true;applyLooks();}
// Removing asks first, as deleting a route does: nothing a person made comes back once it is gone.
function removeTheme(t){if(!confirm(`Remove ${t.name}? To use it again, import its folder again.`))return;void task(async()=>{await api.themes('remove',t.id);imported=imported.filter(x=>x.id!==t.id);
  for(const kind of KINDS)if(prefs.get(`torque-${kind}-theme`,'')===t.id)prefs.set(`torque-${kind}-theme`,kind==='app'?'torque':'same');clearStatus(t.for);applyLooks();focusIn(`themes-${t.for}`);toast(`Removed ${t.name}.`);});}
function removeColour(c){if(!confirm(`Remove ${c.name}? Torque keeps no copy of it. Use Export first if you want one.`))return;if(editing?.id===c.id)closeEditor(false,false);colours=colours.filter(x=>x.id!==c.id);saveColours();
  if(prefs.get(`torque-${c.for}-colour`,'')===c.id)prefs.set(`torque-${c.for}-colour`,c.for==='app'?'torque':'same');clearStatus(c.for);applyLooks();focusIn(`colours-${c.for}`);toast(`Removed ${c.name}.`);}
function exportColour(c){const status=$(`#colour-${c.for}-status`);status.textContent='';void task(async()=>{const where=await api.themes('export-colour',{name:c.name,text:Themes.colourText(c)});if(where)status.textContent=`Exported ${c.name} to ${where}.`;});}
function removeFont(f){if(!confirm(`Remove ${f.name}? To use it again, add its file again.`))return;void task(async()=>{await api.fonts('remove',f.id);fonts=fonts.filter(x=>x.id!==f.id);if(prefs.get('torque-font','')===f.id)prefs.set('torque-font','inter');$('#font-status').textContent='';applyLooks();focusIn('fonts');toast(`Removed ${f.name}.`);});}
// Making a colour: + (or Edit) opens the editor under that list. What it shows goes on that list's screens while it is open;
// Save keeps it, Cancel puts back what was there. The colour wells hold what is shown; a hex code typed beside one goes
// in once it is whole (#rrggbb), and a short one (#e91) or one without # is filled out on leaving the field or Enter.
const HEX6=/^#[0-9a-f]{6}$/,long=h=>h.length===4?'#'+[...h.slice(1)].map(c=>c+c).join(''):h.toLowerCase();
const tidyHex=v=>{let h=String(v).trim().toLowerCase();if(h&&!h.startsWith('#'))h='#'+h;if(/^#[0-9a-f]{3}$/.test(h))h=long(h);return HEX6.test(h)?h:null;};
const scrollMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
function editorSpec(){return {name:$('#colour-name').value.trim(),accent:$('#colour-accent').value,tint:$('#colour-tint-same').checked?null:$('#colour-tint').value,for:editing.kind};}
function openEditor(kind,c){if(editing)closeEditor(false,false);editing={kind,id:c?.id||null};const editor=$('#colour-editor'),start=colourOf(kind);
  $('#colour-editor-title').textContent=c?`Edit ${c.name}`:'New colour';$('#colour-import').hidden=!!c;
  // A new colour starts from the one on, as it was picked.
  $('#colour-name').value=c?.name||'';const accent=long(c?.accent||primary(start));$('#colour-accent').value=accent;$('#colour-accent-hex').value=accent;
  $('#colour-tint-same').checked=!c?.tint;const tint=long(c?.tint||accent);$('#colour-tint').value=tint;$('#colour-tint-hex').value=tint;$('#colour-tint-field').hidden=!c?.tint;
  $('#colour-editor-error').textContent='';$(`#colour-${kind}-status`).textContent='';$(`#colours-${kind}`).after(editor);editor.hidden=false;updateDraft();
  $('#colour-name').focus({preventScroll:true});editor.scrollIntoView({block:'nearest',behavior:scrollMotion()});}
// Closing it: focus goes back to where it was opened from (the colour's Edit, or +).
function closeEditor(apply=true,focus=apply){const was=editing;$('#colour-editor').hidden=true;editing=null;draft=null;if(apply)applyLooks();
  if(was&&focus)((was.id&&$(`#colours-${was.kind} [data-id="${CSS.escape(was.id)}"][data-action=edit]`))||$(`#colours-${was.kind} .add-card`))?.focus({preventScroll:true});}
function updateDraft(){if(!editing)return;const s=editorSpec();try{draft={kind:editing.kind,colour:Themes.colour({...s,id:editing.id||'colour-new',name:s.name||'New colour'})};}catch{return;}preview(draft.colour,$('#colour-preview'));previewLooks();}
for(const which of ['accent','tint']){const well=$(`#colour-${which}`),hex=$(`#colour-${which}-hex`);
  const tidy=()=>{const h=tidyHex(hex.value);if(!h)return;hex.value=h;if(h!==well.value){well.value=h;updateDraft();}};
  well.oninput=()=>{hex.value=well.value;updateDraft();};
  hex.oninput=()=>{const v=hex.value.trim().toLowerCase();if(HEX6.test(v)&&v!==well.value){well.value=v;updateDraft();}};
  // Enter in a hex field puts the code on (and keeps the editor open); Enter in the name saves.
  hex.onchange=tidy;hex.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();tidy();}};}
$('#colour-name').oninput=updateDraft;$('#colour-tint-same').onchange=()=>{$('#colour-tint-field').hidden=$('#colour-tint-same').checked;updateDraft();};
$('#colour-cancel').onclick=()=>closeEditor();$('#colour-editor').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeEditor();}};
$('#colour-editor').onsubmit=e=>{e.preventDefault();const {kind,id}=editing,error=$('#colour-editor-error'),same=$('#colour-tint-same').checked;
  for(const which of ['accent','tint']){const hex=$(`#colour-${which}-hex`),h=tidyHex(hex.value);if(h){hex.value=h;$(`#colour-${which}`).value=h;}}
  if(!$('#colour-name').value.trim()){error.textContent='Give the colour a name.';$('#colour-name').focus();return;}
  if(!HEX6.test($('#colour-accent-hex').value)){error.textContent='Write the main colour as a hex code, like #3a7bd5.';$('#colour-accent-hex').focus();return;}
  if(!same&&!HEX6.test($('#colour-tint-hex').value)){error.textContent='Write the background tint as a hex code, like #3a7bd5.';$('#colour-tint-hex').focus();return;}
  if(!id&&colourList(kind).length>=Themes.MAX_COLOURS){error.textContent=`This list is full at ${Themes.MAX_COLOURS} colours. Remove one of yours to add another.`;return;}
  const c=Themes.colour({...editorSpec(),id:id||undefined});colours=id?colours.map(x=>x.id===id?c:x):[...colours,c];saveColours();if(!id)setColour(kind,c.id);
  // A new colour goes on; an edited one stays as it was, on or not.
  closeEditor(true,false);$(`#colour-${kind}-status`).textContent=id?`Saved ${c.name}.`:`Saved ${c.name} and put it on.`;focusIn(`colours-${kind}`,c.id);};
// A colour file someone exported: read, checked, added to the list the editor is under and put on. One already in the list
// (the same name and colours) is not added twice.
$('#colour-import').onclick=()=>{$('#colour-file-input').value='';$('#colour-file-input').click();};
$('#colour-file-input').onchange=()=>void(async()=>{const file=$('#colour-file-input').files[0],kind=editing?.kind,error=$('#colour-editor-error');if(!file||!kind)return;error.textContent='';
  try{if(file.size>4000)throw Error('A colour file is a few lines; this one is larger than 4 KB.');const c=Themes.colourFile(await file.text(),kind);
    const have=colours.find(x=>x.for===kind&&x.name===c.name&&x.accent===c.accent&&(x.tint||null)===(c.tint||null));if(have){error.textContent=`${have.name} is already in this list.`;return;}
    if(colourList(kind).length>=Themes.MAX_COLOURS)throw Error(`This list is full at ${Themes.MAX_COLOURS} colours. Remove one of yours to add another.`);
    colours=[...colours,c];saveColours();setColour(kind,c.id);closeEditor(true,false);$(`#colour-${kind}-status`).textContent=`Imported ${c.name} and put it on.`;focusIn(`colours-${kind}`,c.id);}
  catch(e){error.textContent=`Couldn’t import it. ${e.message}`;}})();
// Importing: the + at the end of a list picks a theme's folder; theme.json names its pictures, read from beside it. The list's
// room is checked again before it is kept, as another import may have filled it meanwhile.
let importKind='app';
function importTheme(kind){importKind=kind;$(`#theme-${kind}-status`).textContent='';$('#theme-import-input').value='';$('#theme-import-input').click();}
$('#theme-import-input').onchange=()=>void(async()=>{const kind=importKind,files=[...$('#theme-import-input').files],status=$(`#theme-${kind}-status`);if(!files.length)return;
  const full=()=>themeList(kind).length+importing[kind]>=Themes.MAX_THEMES,FULL=`This list is full at ${Themes.MAX_THEMES} themes. Remove one you imported to import another.`;
  const json=files.filter(f=>f.name==='theme.json').sort((a,b)=>a.webkitRelativePath.split('/').length-b.webkitRelativePath.split('/').length)[0];
  if(!json){status.textContent='That folder has no theme.json in it. Pick the folder the theme came in.';return;}
  const base=json.webkitRelativePath.slice(0,-'theme.json'.length),read=name=>{const f=files.find(x=>x.webkitRelativePath===base+name);return f?new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>fail(Error(`${name} could not be read.`));r.readAsDataURL(f);}):Promise.resolve(null);};
  status.textContent='Reading the theme…';
  try{if(full())throw Error(FULL);const theme=await Themes.fromPackage(await json.text(),read,kind);if(full())throw Error(FULL);
    importing[kind]++;try{await api.themes('save',theme);}finally{importing[kind]--;}imported=[...imported,theme];
    putOn(kind,'theme',theme.id);applyLooks();status.textContent=`Imported ${theme.name} and put it on.`;focusIn(`themes-${kind}`,theme.id);}
  catch(e){status.textContent=`Couldn’t import it. ${e.message}`;}})();
// A font file: checked by loading it here first, then kept in the app's data folder.
const fontName=file=>file.replace(/\.(ttf|otf|woff2?)$/i,'').replace(/[-_ ]*(\[[^\]]*\]|VariableFont.*|Variable|Regular|Book|Roman|Normal)$/i,'').replace(/[-_]+/g,' ').trim().slice(0,40)||'My font';
function variableFont(bytes){try{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=String.fromCharCode(...bytes.subarray(0,4)),woff=tag==='wOFF',n=v.getUint16(woff?12:4),start=woff?44:12,size=woff?20:16;
  if(tag==='wOF2')return false;for(let i=0;i<n;i++){const at=start+i*size;if(String.fromCharCode(...bytes.subarray(at,at+4))==='fvar')return true;}}catch{}return false;}
$('#font-input').onchange=()=>void(async()=>{const file=$('#font-input').files[0],status=$('#font-status');if(!file)return;status.textContent='';
  try{if(file.size>10e6)throw Error('A font file can be up to 10 MB.');const bytes=new Uint8Array(await file.arrayBuffer());
    try{await new FontFace('torque-font-check',bytes).load();}catch{throw Error('That file isn’t a font Torque can read. Use a TTF, OTF, WOFF or WOFF2 file.');}
    const entry=await api.fonts('save',{name:fontName(file.name),data:bytes,variable:variableFont(bytes)});fonts=[...fonts,{...entry,data:bytes,family:'torque-'+entry.id,custom:true}];
    prefs.set('torque-font',entry.id);applyLooks();status.textContent=`Added ${entry.name} and switched to it.`;focusIn('fonts',entry.id);}
  catch(e){status.textContent=`Couldn’t add it. ${e.message}`;}})();
$('#theme-make-app').onclick=()=>void task(()=>api.themeGuide('app'));$('#theme-make-station').onclick=()=>void task(()=>api.themeGuide('station'));
$('#about-updates').onclick=()=>void task(showUpdates);$('#about-shortcuts').onclick=()=>openInfo('#shortcuts-dialog');$('#about-credits').onclick=()=>openInfo('#credits-dialog');
// The Theme and colour menu in the Driver Station's bar picks its theme or colour: the same setting, and the same pick, as in Settings.
api.onStationTheme?.(({kind,id}={})=>{if(kind!=='theme'&&kind!=='colour')return;
  const known=id==='same'||(kind==='colour'&&id==='theme'?!!ownOf(stationTheme()):!!Themes.find(kind==='theme'?themeList('station'):colourList('station'),id));if(known)choose('station',kind,id);});
// DEV's ground stops drawing while nobody can see this window: minimised, hidden, or covered by the Driver Station or a robot's page.
api.onWindowState?.(s=>window.DeckAscii?.pause?.(document,!!s?.hidden));
Themes.apply(document,appLook(),{font:FONTS.find(f=>f.id===prefs.get('torque-font','inter'))||FONTS[0]});

// Session clock and zoom badge follow the robot state; reloads keep the clock running.
let sessionStart=0,sessionUrl='',lastPage='';
function clock(ms){const t=Math.floor(ms/1000),h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=String(t%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;}
function renderSession(){$('#session-time').hidden=!sessionStart;if(sessionStart)$('#session-time').textContent='Connected '+clock(Date.now()-sessionStart);}
function renderExtras(){
  // Each view starts at its own heading rather than inheriting another view's scroll.
  if(lastPage!==state.page)window.scrollTo({top:0,behavior:'instant'});
  if(!state.url||state.error)sessionStart=0;else if(!state.loading&&(!sessionStart||sessionUrl!==state.url)){sessionStart=Date.now();sessionUrl=state.url;}renderSession();
  const zoom=state.zoom||1;$('#zoom-reset').hidden=!state.url||Math.abs(zoom-1)<.01;$('#zoom-reset').textContent=Math.round(zoom*100)+'%';
  lastPage=state.page;
}
setInterval(renderSession,1000);
