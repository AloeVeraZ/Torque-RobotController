'use strict';
window.DeckControllerMonitor={create({api,hardware,robot,syncOverlay,toast}){
  const $=selector=>document.querySelector(selector),dialog=$('#controller-dialog');
  const names=['A / Cross','B / Circle','X / Square','Y / Triangle','LB / L1','RB / R1','LT / L2','RT / R2','Back / View','Start / Menu','Left stick click','Right stick click','D-pad up','D-pad down','D-pad left','D-pad right','Guide / Home',...Array.from({length:7},(_,i)=>'Extra button '+(17+i))];
  const number=v=>Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0;
  let info={count:1,slots:[null,null],readings:[]},slot=1,lastCapture=null,lastAssignment=0,captureMessage='',lastKeyboardInput='';
  // Keyboard as Controller 1: keys are read by physical position; the layout map names the keyboard and its keycaps.
  const K=window.DeckKeyboard;let layoutMap=null,layout=K.detect(null,navigator.language);
  const keyName=code=>K.label(code,layoutMap),isKeyboard=pad=>K.isKeyboard(pad);
  const identify=pad=>isKeyboard(pad)?{name:layout.name,art:'generic',known:layout.known,note:'Keys are read by position, so WASD stays in place on every country layout.'}:window.DeckControllers.identity(pad,hardware());
  if(navigator.keyboard?.getLayoutMap){const load=()=>navigator.keyboard.getLayoutMap().then(map=>{layoutMap=map;layout=K.detect(map,navigator.language);render(info);}).catch(()=>{});load();navigator.keyboard.addEventListener?.('layoutchange',load);}
  const bindingRows=()=>[['Left stick',K.axes[1][0],K.axes[0][0],K.axes[1][1],K.axes[0][1]],['Right stick',K.axes[3][0],K.axes[2][0],K.axes[3][1],K.axes[2][1]],['D-pad',...K.buttons.slice(12,16).flat()],['A · B · X · Y',...K.buttons.slice(0,4).flat()],['LB · RB',...K.buttons.slice(4,6).flat()],['LT · RT',...K.buttons.slice(6,8).flat()],['Back · Start',...K.buttons.slice(8,10).flat()],['Stick clicks',...K.buttons.slice(10,12).flat()]];
  function renderBindings(){const list=$('#keyboard-bindings');list.replaceChildren(...bindingRows().map(([name,...codes])=>{const row=document.createElement('div'),keys=document.createElement('dt'),what=document.createElement('dd');for(const code of codes){const key=document.createElement('kbd');key.textContent=keyName(code);keys.append(key);}what.textContent=name;row.append(keys,what);return row;}));}
  const calibration=window.DeckCalibrationUI.create({api,selection:()=>({slot,pad:info.slots?.[slot-1],reading:info.readings?.[slot-1],zone:info.deadzones?.[slot-1]||0}),toast});
  $('#controller-visual').innerHTML=window.DeckControllerArt.render();
  const buttonNodes=names.map((name,index)=>{const item=document.createElement('div');item.className='input-button';item.dataset.button=String(index);const title=document.createElement('span');title.textContent=name;const value=document.createElement('output');value.textContent='0.00';value.setAttribute('aria-label',name+' value');const small=document.createElement('small');small.textContent='Button '+index;item.append(title,value,small);$('#controller-buttons').append(item);return item;});
  const axisNodes=['Left X','Left Y','Right X','Right Y'].map((name,index)=>{const item=document.createElement('div');item.className='axis-reading';const label=document.createElement('span'),value=document.createElement('output'),detail=document.createElement('small');label.textContent=name;value.textContent='0.00';value.id='controller-axis-'+index;detail.textContent='Axis '+index;item.append(label,value,detail);$('#controller-axes').append(item);return value;});
  function renderMonitor(){
    if(!dialog.open)return;
    const pad=info.slots?.[slot-1],reading=info.readings?.[slot-1],capturing=info.capture?.slot===slot,optional=slot===2&&info.count===1,h=hardware(),keyboard=slot===1&&info.source1==='keyboard';
    $('#input-source').hidden=slot!==1||!api.controllerSource;for(const b of document.querySelectorAll('#input-source [data-source]'))b.setAttribute('aria-pressed',String(b.dataset.source===(keyboard?'keyboard':'controller')));
    $('#keyboard-bindings').hidden=!keyboard;if(keyboard)renderBindings();
    document.querySelector('.controller-tabs').hidden=keyboard;if(keyboard&&!$('#controller-calibration-view').hidden)$('#controller-input-tab').click();
    $('#controller-dialog-title').textContent='Controller '+slot;
    const identity=identify(pad);
    $('#controller-monitor-name').textContent=pad?identity.name:(slot===1&&h.builtInController?h.model+' controls · waiting for gamepad input':'No controller assigned');
    $('#controller-driver-name').textContent=pad?.id||'No driver reported';$('#controller-identity-note').textContent=identity.note;$('#controller-driver-details').hidden=!pad||keyboard;
    $('#controller-monitor-dot').className='dot'+(pad?(pad.mapping==='standard'?' live':' error'):'');
    $('#controller-role').textContent=keyboard?'Keyboard':optional?'Standby':slot===1?'Default':'Second operator';
    const raw=pad&&pad.mapping!=='standard',labels=window.DeckControllers.buttonLabels(pad).map((name,i)=>isKeyboard(pad)&&K.buttons[i]?.length?`${name.split(' · ')[0]} · ${K.buttons[i].map(keyName).join(' / ')}`:name);
    $('.controller-buttons-panel>.hint').textContent=keyboard?'Hold keys to test raw gamepad values. Background robot and simulation controls stay neutral.':raw?'Unmapped layout: raw values are shown for diagnosis. Robot inputs are held neutral. Select XInput or a Steam Input Gamepad layout, then reconnect.':'Standard positions and button indices. Labels follow the reported controller family; the robot defines their actions.';
    if(keyboard&&reading){const keys=[];K.axes.forEach(([negative,positive],i)=>{if(reading.axes?.[i]<-.08)keys.push(keyName(negative));if(reading.axes?.[i]>.08)keys.push(keyName(positive));});K.buttons.forEach((codes,i)=>{const b=reading.buttons?.[i];if((typeof b==='object'?b.value:b)>.2)keys.push(...codes.map(keyName));});if(keys.length)lastKeyboardInput=keys.join(' + ');}
    $('#controller-monitor-state').textContent=keyboard?(reading?.pressed||reading?.axesActive?'Receiving key input · '+lastKeyboardInput:lastKeyboardInput?'Last input: '+lastKeyboardInput+' · press keys to test':'Keyboard ready · press keys to test'):raw?'Layout not mapped · robot inputs held neutral':pad?(reading?.pressed||reading?.axesActive?'Receiving stick or button input':captureMessage||'Connected · move the sticks and press buttons'):'Connect a controller, then press a button. Built-in controls must be in Gamepad Mode.';
    $('#controller-capture-status').hidden=!capturing;
    $('#controller-capture-status').textContent='Release buttons and center sticks, then press any button on the controller to assign it.';
    const axes=Array.from({length:4},(_,i)=>number(reading?.axes?.[i]));
    axisNodes.forEach((node,i)=>{node.textContent=axes[i].toFixed(2);node.parentElement.querySelector('span').textContent=raw?'Raw axis '+i:['Left X','Left Y','Right X','Right Y'][i];});
    const visual=$('#controller-visual svg'),travel=Number(visual.dataset.stickTravel);
    $('#stick-left-dot').setAttribute('transform',`translate(${axes[0]*travel} ${axes[1]*travel})`);
    $('#stick-right-dot').setAttribute('transform',`translate(${axes[2]*travel} ${axes[3]*travel})`);
    $('#plot-left-dot').setAttribute('transform',`translate(${axes[0]*44} ${axes[1]*44})`);
    $('#plot-right-dot').setAttribute('transform',`translate(${axes[2]*44} ${axes[3]*44})`);
    const buttons=names.map((_,i)=>{const b=reading?.buttons?.[i];return Math.max(0,number(typeof b==='object'?b.value:b));});
    buttonNodes.forEach((node,i)=>{node.hidden=i>=17&&i>=(reading?.buttons?.length||0);node.querySelector('span').textContent=labels[i]||names[i];node.classList.toggle('pressed',buttons[i]>0.2);node.querySelector('output').textContent=buttons[i].toFixed(2);node.querySelector('output').setAttribute('aria-label',(labels[i]||names[i])+' value');});
    for(const index of [0,1,2,3,4,5,6,7]){const text=visual.querySelector(`[data-pad-button="${index}"] text`);if(text)text.textContent=raw?String(index):({Cross:'×',Circle:'○',Square:'□',Triangle:'△'}[labels[index].split(' · ')[0]]||labels[index].split(' · ')[0]);}
    for(const node of document.querySelectorAll('[data-pad-button]'))node.classList.toggle('pressed',buttons[Number(node.dataset.padButton)]>0.2);
    const triggerHeight=Number(visual.dataset.triggerHeight),triggerBottom=Number(visual.dataset.triggerBottom);
    for(const [side,index] of [['left',6],['right',7]]){const fill=$('#trigger-'+side+'-fill');fill.setAttribute('height',String(buttons[index]*triggerHeight));fill.setAttribute('y',String(triggerBottom-buttons[index]*triggerHeight));}
    $('#controller-assign').hidden=keyboard;$('#controller-assign').textContent=capturing?'Cancel assignment':pad?'Reassign controller '+slot:'Assign controller '+slot;
    $('#controller-auto').hidden=slot!==1||!api.controllerAutomatic||keyboard;
    $('#controller-robot-note').textContent=(optional?'This robot uses one controller. Controller 2 is available on standby; select Two controllers in the robot’s Settings when it needs a second operator. ':'')+'The robot defines each control’s action. Gamepad outputs to the robot stay neutral while this test is open.';
    const deck=h.controllerFamily==='steamdeck';
    $('#steamdeck-controls').hidden=!deck||keyboard;$('#controller-mode-help').hidden=keyboard;calibration.render();
    $('#controller-mode-title').textContent=deck&&!h.launchedThroughSteam?'Steam Deck · Desktop shortcut':'Gamepad input · built-in or external';
    $('#controller-mode-copy').textContent=deck&&!h.launchedThroughSteam?'Keep Steam running. Hold ☰ Menu until Gamepad Mode appears, then press A. The left stick should move Left X / Y here; the right stick should move Right X / Y. For Gaming Mode, add this app to Steam and choose the Gamepad template. Use the touchscreen for the pointer, or configure a mouse trackpad while keeping both sticks as joysticks.':'Pair external controllers in your operating system, or connect a USB data cable. If sticks move the mouse or scroll, switch your handheld utility or this app’s Steam Input layout to Gamepad. Move both sticks here to verify gamepad input before returning to Drive.';
  }
  function render(next){
    info=next;
    for(let i=0;i<2;i++){
      const pad=info.slots?.[i],identity=identify(pad),row=$('#controller-'+(i+1)),standby=i===1&&info.count===1;
      row.hidden=false;row.classList.toggle('standby',standby);row.querySelector('small').textContent=pad?(pad.mapping!=='standard'?'Unmapped · ':standby?'Standby · ':'')+identity.name:standby?'Optional':'Set up gamepad';
      row.querySelector('.dot').className='dot'+(pad?(pad.mapping==='standard'?' live':' error'):'');row.title='Test or assign controller '+(i+1)+(standby?' · optional for this robot':'');
      $('#setup-controller-'+(i+1)+'-name').textContent=(pad?identity.name:null)||(i===0?(hardware().builtInController?hardware().model+' · automatic default':'First standard gamepad · automatic default'):'Connect a USB or Bluetooth controller');
    }
    const unmapped=info.devices?.some(p=>p.mapping!=='standard');
    $('#input-notice').hidden=!((hardware().builtInController||unmapped)&&!info.slots?.[0]);
    $('#input-notice>span').textContent=unmapped&&!info.slots?.[0]?'Controller layout not mapped. Select XInput or Steam Input Gamepad mode.':'Controller 1 is waiting for gamepad input.';
    if(unmapped&&!info.slots?.[0])$('#controller-1 small').textContent='Unmapped device · set up gamepad mode';
    if(dialog.open&&lastCapture&&!info.capture){const assigned=(info.assignment?.serial||0)>lastAssignment;captureMessage=assigned?'Assigned. Release buttons and center sticks, then test below.':'Assignment ended. Your previous selection is kept.';}
    lastCapture=info.capture;lastAssignment=info.assignment?.serial||0;renderMonitor();
  }
  function show(selected=slot){if(!dialog.open||selected!==slot){captureMessage='';lastKeyboardInput='';calibration.reset();$('#controller-mode-help').open=!info.slots?.[selected-1];$('#steamdeck-controls').open=false;}slot=selected;if(!dialog.open)dialog.showModal();renderMonitor();syncOverlay();}
  async function start(){if(!api.controllerCapture){toast('Use the installed app to assign controllers.');return;}if(info.capture){render(await api.controllerCancel());return;}render(await api.controllerCapture(slot));}
  async function close(){if(info.capture&&api.controllerCancel)render(await api.controllerCancel());dialog.close();syncOverlay();}
  const task=fn=>void Promise.resolve().then(fn).catch(error=>toast(error.message));
  for(const selected of [1,2]){const open=()=>task(async()=>{show(selected);if(!info.slots?.[selected-1])await start();});$('#controller-'+selected).onclick=open;$('#setup-controller-'+selected).onclick=open;}
  for(const b of document.querySelectorAll('#input-source [data-source]'))b.onclick=()=>task(async()=>{if(info.capture&&api.controllerCancel)render(await api.controllerCancel());lastKeyboardInput='';render(await api.controllerSource(b.dataset.source));captureMessage='';renderMonitor();});
  $('#controller-assign').onclick=()=>task(start);$('#controller-auto').onclick=()=>task(async()=>{render(await api.controllerAutomatic());captureMessage='Automatic assignment selected. Built-in controls are preferred; center sticks and release buttons before driving.';renderMonitor();});
  $('#controller-cancel').onclick=()=>task(close);$('#controller-done').onclick=()=>task(close);dialog.addEventListener('cancel',event=>{event.preventDefault();task(close);});
  $('#input-notice-test').onclick=()=>show(1);
  api.onControllerState?.(render);api.onControllerCapture?.(next=>{slot=next.capture?.slot||slot;show(slot);render(next);});
  // Calibrate's Gamepads card opens the Calibration view of a controller.
  return {render,calibrate:selected=>{show(selected);$('#controller-calibration-tab').click();}};
}};
