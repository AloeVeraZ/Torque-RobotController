'use strict';
const $=s=>document.querySelector(s),api=window.deck;let state={page:'drive',robots:[],loading:false},hardware={},wifi={ssid:''},pendingWifi=null,pendingAuth=null,listKey='',nearbyNetworks=[],selectedNetwork=null,scanPromise=null;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function task(fn){try{return await fn();}catch(e){toast(e.message);}}
function setBusy(b){for(const id of ['open-robot','save-robot'])$('#'+id).disabled=b;}
function formRobot(){const ftc=$('#robot-ftc').checked;return {id:$('#robot-id').value||undefined,url:$('#robot-url').value.trim()||(ftc?'192.168.43.1':''),name:$('#robot-name').value,kind:ftc?'ftc':'auto',controllerCount:Number($('#robot-controllers').value)};}
async function openRobot(robot){setBusy(true);try{const result=await api.open(robot);if(result?.needsWifi){
    // Try the OS's saved network credentials first for one-click reopen.
    try{const info=await api.join(result.needsWifi.ssid,'');if(info.needsPassword){promptWifi(result.needsWifi.ssid,robot);return;}await openRobot(robot);}catch{promptWifi(result.needsWifi.ssid,robot);}
  }}finally{setBusy(false);}}
function setMenu(open){$('#menu').hidden=!open;$('#more').setAttribute('aria-expanded',String(open));syncOverlay();}
function showPage(page){if(page===state.page)window.scrollTo({top:0,behavior:'instant'});void task(()=>api.page(page));setMenu(false);closeWifiPicker();}
// Drive's robot list and connection: the Drive page itself with no robot open, or over a robot that stays connected.
function showConnect(){showPage(state.url?'connect':'drive');}
function network(info){wifi=info||{};robotDiscovery.network(wifi);$('#network-chip span').textContent=wifi.ssid||'Connect Wi-Fi';$('#network-chip').title=wifi.ssid||'Connect Wi-Fi';$('#network-chip').setAttribute('aria-label',wifi.connected?'Wi-Fi connected to '+wifi.ssid:'Wi-Fi disconnected. Open network settings');$('#network-chip .dot').className=`dot${wifi.connected?' live':''}`;$('#wifi-summary').textContent=wifi.ssid?`Connected to ${wifi.ssid}`:wifi.message||'Connect to a robot hotspot or your home network.';$('#robot-network').textContent=wifi.ssid||'No Wi-Fi connected';
  $('#connect-status').textContent=wifi.ssid?`On ${wifi.ssid}. Pick a robot, or add one by its address.`:'Not on Wi-Fi. Join your robot\u2019s network with the Wi-Fi button, or plug a Control Hub in by USB-C.';renderLibrary(true);}
// FTC: Open on Wi-Fi or USB, the address only when it is not the Control Hub's. Other: the address, Wi-Fi and finding.
function setKind(ftc,showAddress){$('#robot-ftc').checked=ftc;for(const b of document.querySelectorAll('[data-robot-kind]'))b.setAttribute('aria-pressed',String((b.dataset.robotKind==='ftc')===ftc));const url=$('#robot-url').value.trim(),address=!ftc||showAddress||!!url&&url!=='192.168.43.1';$('#robot-address-fields').hidden=!address;$('#robot-address-toggle').hidden=address;$('#robot-url').placeholder=ftc?'192.168.43.1':'192.168.4.1';$('#open-robot').textContent=ftc?'Open on Wi-Fi':'Open robot';$('#open-usb').hidden=!ftc;$('#robot-usb-hint').hidden=!ftc;$('#robot-discovery').hidden=ftc;$('#save-robot').textContent=ftc?'Save robot':'Save address';$('#robot-kind-hint').textContent=ftc?'Join the robot’s Wi-Fi (like 1234-RC) and open it on Wi-Fi, or plug its USB-C into this computer and open it on USB.':'A robot with its own web page. Enter its address, or find it on its hotspot. FTC robots are still detected.';}
function edit(robot){$('#robot-id').value=robot?.id||'';$('#robot-url').value=robot?.url||'';$('#robot-name').value=robot?.autoName?'':robot?.name||'';setKind(robot?.kind==='ftc');$('#robot-controllers').value=String(robot?.controllerCount||1);showConnect();setTimeout(()=>$('#robot-url').focus(),60);}
const hostOf=url=>{try{const u=new URL(url);return u.hostname==='usb.control-hub'?'USB-C':u.host;}catch{return url;}};
function since(t){const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;}
function renderLibrary(force=false){
  const key=JSON.stringify([state.robots,wifi.ssid,state.robot?.id,state.recovering,$('#library-search').value]);if(key===listKey&&!force)return;listKey=key;
  // One list: robots saved for the current Wi-Fi come first.
  const query=$('#library-search').value.toLowerCase(),all=state.robots||[],here=r=>!!r.ssid&&r.ssid===wifi.ssid,robots=all.filter(r=>`${r.name} ${r.url} ${r.ssid}`.toLowerCase().includes(query)).sort((a,b)=>here(b)-here(a));
  $('#robot-list').replaceChildren(...robots.map((r,i)=>{const row=el('article','saved-row'+(here(r)?' here':'')+(state.robot?.id===r.id&&state.url?' open':'')),kind=el('span','robot-kind-mark'+(r.kind==='ftc'?' ftc':''),r.kind==='ftc'?'FTC':'Web'),name=el('div','saved-name'),meta=el('small','',[hostOf(r.url),here(r)?'on this Wi-Fi':r.ssid?`on ${r.ssid}`:'any Wi-Fi',r.lastOpened?`driven ${since(r.lastOpened)}`:''].filter(Boolean).join(' · '));
    row.style.setProperty('--i',String(Math.min(i,8)));kind.setAttribute('aria-hidden','true');name.append(el('strong','',r.name),meta);name.querySelector('strong').title=r.name;meta.title=r.url;
    const actions=el('div','saved-actions'),open=el('button',i===0&&!state.url?'primary':'secondary',state.robot?.id===r.id&&state.url?'Back to it':'Connect'),change=el('button','edit text-button','Edit'),remove=el('button','delete text-button','Delete');
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
for(const b of document.querySelectorAll('[data-robot-kind]'))b.onclick=()=>setKind(b.dataset.robotKind==='ftc');$('#robot-address-toggle').onclick=()=>{setKind(true,true);$('#robot-url').focus();};setKind(false);
document.addEventListener('robot-fullscreen-error',event=>toast(event.detail));
function render(next){if(next.page!==state.page||next.loading)touchscreen.hide();state=next;robotFullscreen.render(state);if(next.network)network(next.network);const robotUp=!!state.url||!!state.loading||!!state.error,connect=state.page==='connect'||state.page==='drive'&&!robotUp;$('#connect-view').hidden=!connect;$('#drive-view').hidden=!(state.page==='drive'&&robotUp);$('#settings-view').hidden=state.page!=='settings';
  $('#robots-page').hidden=!state.url;$('#connect-back').hidden=!(state.page==='connect'&&state.url&&!state.error);$('#connect-back-text').textContent=`${state.title||'Your robot'} is still connected.`;$('#simulation-view').hidden=state.page!=='simulation';$('#calibrate-view').hidden=state.page!=='calibrate';$('#setup-view').hidden=state.page!=='setup';simulation.activate(state.page==='simulation');simulation.calibrate(state.page==='calibrate');simulation.setup(state.page==='setup');$('#drive-tab').classList.toggle('active',state.page==='drive'||state.page==='connect');$('#simulate-tab').classList.toggle('active',state.page==='simulation');$('#robot-setup-tab').classList.toggle('active',state.page==='setup');$('#robot-setup-tab').setAttribute('aria-current',state.page==='setup'?'page':'false');$('#calibrate-tab').classList.toggle('active',state.page==='calibrate');$('#calibrate-tab').setAttribute('aria-current',state.page==='calibrate'?'page':'false');$('#menu-settings').setAttribute('aria-current',state.page==='settings'?'page':'false');const displayUrl=state.url||'No robot open';if($('#current-url').textContent!==displayUrl)$('#current-url').textContent=displayUrl;$('#drive-tab').setAttribute('aria-current',state.page==='drive'||state.page==='connect'?'page':'false');$('#simulate-tab').setAttribute('aria-current',state.page==='simulation'?'page':'false');$('#page-status').dataset.kind=state.error?'error':'loading';$('#robot-title').textContent=state.title||'Ready to connect';$('#page-dot').className=`dot${state.error?' error':state.robot&&!state.loading?' live':''}`;$('#close-page').hidden=!state.url;$('#manager-close').hidden=!state.manager;$('#view-kind').textContent=state.kind==='ftc'?(state.manager?'Program & Manage · on the robot':'FTC Driver Station'):'Robot web UI';$('#drive-view').classList.toggle('station-view',state.kind==='ftc'&&!state.manager&&!!state.url&&!state.loading&&!state.error);$('#back').disabled=!state.url;$('#reload').disabled=!state.url;$('#page-status').hidden=!state.loading&&!state.error;$('#page-status-title').textContent=state.error?(state.recovering?'Robot connection paused':'Robot page unavailable'):'Opening robot…';$('#page-status-message').textContent=state.error||state.url;$('#retry').hidden=!state.error;$('#error-settings').hidden=!state.error;$('.loader').hidden=!!state.error;renderLibrary();renderExtras();sendStationLook();if(state.page==='settings')renderThemes();void bounds();}
function bounds(){if(state.page!=='drive'||state.robotFullscreen)return Promise.resolve();const r=$('#robot-mount').getBoundingClientRect();return api.bounds({x:r.x,y:r.y,width:r.width,height:r.height}).catch(()=>{});}
$('#drive-tab').onclick=()=>showPage('drive');$('#robot-setup-tab').onclick=()=>showPage('setup');$('#calibrate-tab').onclick=()=>showPage('calibrate');$('#simulate-tab').onclick=()=>showPage('simulation');for(const b of document.querySelectorAll('[data-flow]'))b.onclick=()=>{simulation.flow(b.dataset.flow);showPage(simulation.pageOf(b.dataset.flow));};$('#network-chip').onclick=()=>$('#wifi-popover').hidden?openWifiPicker():closeWifiPicker();$('#robots-page').onclick=()=>showPage('connect');$('#connect-back-button').onclick=()=>showPage('drive');
$('#more').onclick=()=>setMenu($('#menu').hidden);$('#menu-settings').onclick=()=>showPage('settings');$('#menu-updates').onclick=()=>void task(showUpdates);$('#menu-library').onclick=()=>{showConnect();setTimeout(()=>$('#library-panel').scrollIntoView({behavior:'smooth'}),50);};$('#menu-shortcuts').onclick=()=>openInfo('#shortcuts-dialog');$('#menu-credits').onclick=()=>openInfo('#credits-dialog');$('#menu-fullscreen').onclick=()=>void task(async()=>{await api.fullscreen();setMenu(false);});$('#menu-quit').onclick=()=>void api.quit();
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#menu')&&!e.target.closest('#more'))setMenu(false);});
// Keyboard shortcuts and the credits: from the menu and from Settings, each in a dialog of its own.
function openInfo(sel){setMenu(false);$(sel).showModal();syncOverlay();}
for(const d of document.querySelectorAll('.info-dialog')){d.querySelector('[data-close]').onclick=()=>{d.close();syncOverlay();};d.addEventListener('close',()=>syncOverlay());}
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog[open]'))return;if(!$('#menu').hidden){setMenu(false);$('#more').focus();}if(!$('#wifi-popover').hidden){closeWifiPicker();$('#network-chip').focus();}});
$('#robot-form').onsubmit=e=>{e.preventDefault();void task(()=>openRobot(formRobot()));};
// A Control Hub on the USB cable is saved at usb.control-hub; Drive reaches it through the cable.
$('#open-usb').onclick=()=>void task(()=>openRobot({url:'usb.control-hub',name:'Control Hub (USB)',kind:'ftc',controllerCount:Number($('#robot-controllers').value)}));$('#save-robot').onclick=()=>void task(async()=>{const p=await api.save(formRobot());$('#robot-id').value=p.id;toast('Robot address saved on this device.');});$('#library-search').oninput=()=>renderLibrary();$('#close-page').onclick=()=>void task(()=>api.close());$('#manager-close').onclick=()=>void task(()=>api.managerClose());api.onNotice?.(toast);$('#reload').onclick=()=>void task(()=>api.reload());$('#back').onclick=()=>void task(()=>api.back());$('#retry').onclick=()=>void task(()=>openRobot(state.robot?.id?{id:state.robot.id}:{...state.robot,url:state.url}));$('#error-settings').onclick=()=>showPage('connect');
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
void task(async()=>{const data=await api.bootstrap();hardware=data.hardware;$('.version').textContent=data.app?data.app.version+' · '+data.app.channel:'';$('#menu-version').textContent=menuVersion(data.app);$('#device').textContent=hardware.model;render(data.state);$('#about-version').textContent=data.app?`Torque ${data.app.version}, ${data.app.channel==='testing'?'Testing (pre-release)':'Main (stable)'}`:'';void controllers();setInterval(controllers,1000);void loadThemes();});

function syncOverlay(){void api.overlay(!$('#menu').hidden||!$('#wifi-popover').hidden||[...document.querySelectorAll('dialog')].some(d=>d.open)).catch(()=>{});}
let updateBusy=false;
function updateButtons(busy){updateBusy=busy;for(const id of ['update-check','update-download','update-close','update-main','update-testing','testing-confirm','testing-cancel'])$('#'+id).disabled=busy;}
function resetUpdateResult(){$('#update-download').hidden=true;$('#update-dismiss').hidden=true;$('#update-changelog').hidden=true;$('#update-progress').hidden=true;}
async function showUpdates(){setMenu(false);$('#update-dialog').showModal();syncOverlay();resetUpdateResult();$('#testing-warning').hidden=true;$('#update-status').textContent='Loading update settings…';updateButtons(true);try{renderUpdateInfo(await api.updateInfo());$('#update-status').textContent='Check for a published update.';}catch(e){$('#update-status').textContent=e.message;}finally{updateButtons(false);}}
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
const prefs={get:(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set:(key,value)=>{try{localStorage.setItem(key,value);}catch{}}};
function applyTheme(theme){if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;else delete document.documentElement.dataset.theme;const cycle=$('#theme-cycle'),mode=theme==='light'||theme==='dark'?theme:'system',label=`Colour theme: ${mode==='system'?'match the device':mode}`;cycle.dataset.mode=mode;cycle.title=label;cycle.setAttribute('aria-label',label);api.setTheme?.(mode);}
$('#theme-cycle').onclick=()=>{const next={system:'light',light:'dark',dark:'system'}[$('#theme-cycle').dataset.mode];prefs.set('deck-theme',next);applyTheme(next);};
applyTheme(prefs.get('deck-theme','system'));
const sendKeepAwake=()=>void api.keepAwake?.($('#keep-awake').checked).catch(()=>{});
$('#keep-awake').checked=prefs.get('deck-keep-awake','on')!=='off';$('#keep-awake').onchange=()=>{prefs.set('deck-keep-awake',$('#keep-awake').checked?'on':'off');sendKeepAwake();};sendKeepAwake();
const syncKeyboardMenu=()=>{const on=$('#touch-keyboard-auto').checked;$('#menu-keyboard').setAttribute('aria-checked',String(on));$('#menu-keyboard-check').textContent=on?'☑':'☐';};
$('#menu-keyboard').onclick=()=>{$('#touch-keyboard-auto').checked=!$('#touch-keyboard-auto').checked;$('#touch-keyboard-auto').onchange();};
const sendTouchKeyboard=()=>void api.touchKeyboard?.($('#touch-keyboard-auto').checked).catch(()=>{});
$('#touch-keyboard-auto').checked=prefs.get('deck-virtual-keyboard','off')==='on';$('#touch-keyboard-auto').onchange=()=>{prefs.set('deck-virtual-keyboard',$('#touch-keyboard-auto').checked?'on':'off');syncKeyboardMenu();if(!$('#touch-keyboard-auto').checked)touchscreen.hide();sendTouchKeyboard();};syncKeyboardMenu();sendTouchKeyboard();
if(/Mac/i.test(navigator.platform)){for(const key of document.querySelectorAll('kbd.mod'))key.textContent='⌘';for(const k of document.querySelectorAll('.back-key'))k.replaceChildren(el('kbd','','⌘'),' ',el('kbd','','['));}
$('#zoom-reset').onclick=()=>void task(()=>api.zoom(0));

// Themes (docs/THEMES.md): one for Torque's own screens, one for the FTC Driver Station screen, which a saved robot can
// override. Built-in themes come with the app; imported ones are folders the user picks, copied into the app's data folder.
const Themes=window.DeckThemes;let imported=[],lastLook='';
const robotThemes=()=>{try{return JSON.parse(prefs.get('torque-robot-themes','{}'))||{};}catch{return {};}};
const themeList=kind=>[...Themes.BUILT_IN,...imported.filter(t=>t.for===kind)];
const appTheme=()=>Themes.find(themeList('app'),prefs.get('torque-app-theme','torque'))||Themes.BUILT_IN[0];
const stationThemeId=robot=>(robot&&robotThemes()[robot])||prefs.get('torque-station-theme','same');
const stationTheme=robot=>{const id=stationThemeId(robot);return id==='same'?appTheme():Themes.find(themeList('station'),id)||appTheme();};
const font=()=>prefs.get('torque-font','inter');
// The Driver Station follows the robot that is open: its own theme, or the default.
function sendStationLook(force=false){const robot=state.robot?.id||null,theme=stationTheme(robot),key=JSON.stringify([robot,theme.id,font(),imported.length]);if(key===lastLook&&!force)return;lastLook=key;
  api.stationLook?.({theme,font:font(),current:stationThemeId(robot),own:(robot&&robotThemes()[robot])||'default',robot:robot?state.robot.name:null,themes:[{id:'same',name:'Same as the app',swatch:Themes.swatch(appTheme())},...themeList('station').map(t=>({id:t.id,name:t.name,swatch:Themes.swatch(t)}))]});}
function applyLooks(){Themes.apply(document,appTheme(),{font:font()});sendStationLook(true);renderThemes();}
function themeCard(t,{checked,pick,label}){const b=el('button','theme-card'),view=el('span','theme-preview'),name=el('span','theme-name',label||t.name);b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(checked));
  const [bg,accent,lbg,laccent]=Themes.swatch(t);view.style.setProperty('--p-bg',bg);view.style.setProperty('--p-surface',t.dark.surface);view.style.setProperty('--p-text',t.dark.text);view.style.setProperty('--p-accent',accent);view.style.setProperty('--p-lbg',lbg);view.style.setProperty('--p-laccent',laccent);
  if(t.background?.image)view.style.setProperty('--p-image',`url("${t.background.image}")`);view.append(el('i','p-bar'),el('i','p-line'),el('i','p-line short'),el('i','p-button'));
  b.append(view,name);if(t.for)b.append(el('small','theme-from',t.author?`Imported, by ${t.author}`:'Imported'));b.onclick=pick;return b;}
function renderThemes(){
  const app=appTheme().id,station=prefs.get('torque-station-theme','same');
  $('#themes-app').replaceChildren(...themeList('app').map(t=>themeCard(t,{checked:t.id===app,pick:()=>{prefs.set('torque-app-theme',t.id);applyLooks();}})));
  $('#themes-station').replaceChildren(themeCard({...appTheme(),id:'same'},{label:'Same as the app',checked:station==='same',pick:()=>{prefs.set('torque-station-theme','same');applyLooks();}}),...themeList('station').map(t=>themeCard(t,{checked:t.id===station,pick:()=>{prefs.set('torque-station-theme',t.id);applyLooks();}})));
  // A saved FTC robot can keep a theme of its own on this computer.
  const map=robotThemes(),robots=(state.robots||[]).filter(r=>r.kind==='ftc');
  $('#robot-themes').replaceChildren(...(robots.length?[el('h3','','For one robot')]:[]),...robots.map(r=>{const row=el('label','robot-theme-row'),name=el('span'),pick=el('select');name.append(el('b','',r.name),el('small','',[hostOf(r.url),r.ssid?`on ${r.ssid}`:''].filter(Boolean).join(' · ')));
    pick.append(new Option('The default above','default'),new Option('Same as the app','same'),...themeList('station').map(t=>new Option(t.name,t.id)));pick.value=map[r.id]||'default';
    pick.onchange=()=>{const m=robotThemes();if(pick.value==='default')delete m[r.id];else m[r.id]=pick.value;prefs.set('torque-robot-themes',JSON.stringify(m));applyLooks();};row.append(name,pick);return row;}));
  $('#themes-imported').replaceChildren(...imported.map(t=>{const row=el('div','imported-row'),name=el('div');name.append(el('b','',t.name),el('small','',[t.for==='app'?'App theme':'Driver Station theme',t.author?`by ${t.author}`:'',t.background?.image?'with a background picture':'',t.logo?'with a logo':''].filter(Boolean).join(' · ')));
    const remove=el('button','text-button danger','Remove');remove.onclick=()=>void task(async()=>{await api.themes('remove',t.id);imported=imported.filter(x=>x.id!==t.id);if(prefs.get('torque-app-theme','')===t.id)prefs.set('torque-app-theme','torque');if(prefs.get('torque-station-theme','')===t.id)prefs.set('torque-station-theme','same');const m=robotThemes();for(const k of Object.keys(m))if(m[k]===t.id)delete m[k];prefs.set('torque-robot-themes',JSON.stringify(m));applyLooks();toast(`Removed ${t.name}.`);});
    row.append(name,remove);return row;}));
  for(const b of document.querySelectorAll('[data-font-choice]'))b.setAttribute('aria-pressed',String(b.dataset.fontChoice===font()));}
async function loadThemes(){try{imported=(await api.themes('list')).filter(Themes.valid);}catch{imported=[];}applyLooks();}
// Importing: the user picks the theme's folder; theme.json names its pictures, which are read from beside it.
$('#theme-import').onclick=()=>{$('#theme-import-input').value='';$('#theme-import-input').click();};
$('#theme-import-input').onchange=()=>void(async()=>{const files=[...$('#theme-import-input').files],status=$('#theme-import-status');if(!files.length)return;
  const json=files.filter(f=>f.name==='theme.json').sort((a,b)=>a.webkitRelativePath.split('/').length-b.webkitRelativePath.split('/').length)[0];
  if(!json){status.textContent='That folder has no theme.json. Pick the theme’s own folder.';return;}
  const base=json.webkitRelativePath.slice(0,-'theme.json'.length),read=name=>{const f=files.find(x=>x.webkitRelativePath===base+name);return f?new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>fail(Error(`${name} could not be read.`));r.readAsDataURL(f);}):Promise.resolve(null);};
  status.textContent='Reading the theme…';
  try{const theme=await Themes.fromPackage(await json.text(),read);await api.themes('save',theme);imported=[...imported,theme];
    if(theme.for==='app')prefs.set('torque-app-theme',theme.id);else prefs.set('torque-station-theme',theme.id);applyLooks();
    status.textContent=`Imported ${theme.name}, a ${theme.for==='app'?'theme for Torque’s screens':'Driver Station theme'}, and put it on. It is kept on this computer only.`;}
  catch(e){status.textContent=`Not imported: ${e.message}`;}})();
$('#theme-folder').onclick=()=>void task(()=>api.themes('folder'));
$('#theme-make-app').onclick=()=>void task(()=>api.themeGuide('app'));$('#theme-make-station').onclick=()=>void task(()=>api.themeGuide('station'));
for(const b of document.querySelectorAll('[data-font-choice]'))b.onclick=()=>{prefs.set('torque-font',b.dataset.fontChoice);applyLooks();};
$('#about-updates').onclick=()=>void task(showUpdates);$('#about-shortcuts').onclick=()=>openInfo('#shortcuts-dialog');$('#about-credits').onclick=()=>openInfo('#credits-dialog');
// The Driver Station's own Settings can pick a theme for the robot it is on.
api.onStationTheme?.(({robot,id})=>{if(robot){const m=robotThemes();if(id==='default')delete m[robot];else m[robot]=id;prefs.set('torque-robot-themes',JSON.stringify(m));}else prefs.set('torque-station-theme',id);applyLooks();});
Themes.apply(document,appTheme(),{font:font()});

// Drive's controller tiles draw each controller's sticks as they move, while the connect page shows.
let padLoop=0;
function drawSticks(info){for(let i=0;i<2;i++){const a=info?.readings?.[i]?.axes||[];for(const [side,x,y] of [['left',a[0],a[1]],['right',a[2],a[3]]]){const dot=$(`#pad-${i+1}-${side} b`);if(dot)dot.style.transform=`translate(${(Number(x)||0)*7}px,${(Number(y)||0)*7}px)`;}}}
async function padTick(){padLoop=0;if($('#connect-view').hidden||document.hidden)return;try{if(api.controllerInfo)drawSticks(await api.controllerInfo());}catch{}padLoop=setTimeout(padTick,80);}
new MutationObserver(()=>{if(!$('#connect-view').hidden&&!padLoop)void padTick();}).observe($('#connect-view'),{attributes:true,attributeFilter:['hidden']});

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
