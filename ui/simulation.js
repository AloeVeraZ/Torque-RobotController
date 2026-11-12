/* Offline path-planning simulator. The physics engine and path follower run in the app's
   simulation process; this view edits the setup, plans routes in a worker and draws everything
   itself. Real robot configuration and localization stay on the robot: nothing here is sent to one. */
window.DeckSimulation={create(root,views){
  'use strict';
  // calibrate: the Calibrate view's element.
  const calRoot=views?.calibrate||null,setupRoot=views?.setup||null;
  const field=window.DeckField,planner=window.DeckPlanner,exporter=window.DeckSimExport,api=window.deck||{},native=typeof api.sim==='function';
  // Bundled chassis CAD present in this build (personal local builds only); see appearanceOptions().
  let builtins=new Set(['strafer','swechanum']);
  // The view's own elements, then Calibrate's (the guided check and, while Calibrate shows, the Send to robot panel).
  const roots=[root,calRoot,setupRoot].filter(Boolean),$=selector=>{for(const r of roots){const n=r.querySelector(selector);if(n)return n;}return null;},$$=selector=>roots.flatMap(r=>[...r.querySelectorAll(selector)]),ns='http://www.w3.org/2000/svg';
  const KEY='deck-simulation-project-v2',OLD_KEY='deck-simulation-project-v1',finite=n=>typeof n==='number'&&Number.isFinite(n);
  const C=window.DeckSimConfig,MECH=window.DeckMechanisms,GAMES={empty:'Empty field',biobuzz:'BIOBUZZ'},STYLES={spline:'Smooth curves',sharp:'Straight lines'};
  const EXAMPLE=`import deck.pathing.DeckFollower;
import deck.sim.DeckAutonomous;
import deck.sim.SimRobot;

// Follows the planned route leg by leg, pausing at pins that have a pause.
// loop() runs every 1/60 s of simulation time.
public class MyAuto implements DeckAutonomous {
    private DeckFollower follower;
    private int leg = 0;
    private double arrived = -1;

    @Override
    public void init(SimRobot robot) {
        follower = robot.follower();
        follower.setPose(robot.startPose());
        follower.follow(robot.routeLegs().get(0));
    }

    @Override
    public void loop(SimRobot robot) {
        follower.update();
        if (follower.isBusy()) return;
        if (arrived < 0) arrived = robot.time();
        if (robot.time() - arrived < robot.stopWait(leg)) return; // your mechanism action runs here
        if (++leg >= robot.routeLegs().size()) { robot.finish(); return; }
        arrived = -1;
        follower.follow(robot.routeLegs().get(leg));
    }
}
`;
  const LEGACY_EXAMPLE=`import com.pedropathing.follower.Follower;
import deck.sim.DeckAutonomous;
import deck.sim.SimRobot;

// Follows the planned route leg by leg, pausing at pins that have a pause.
// loop() runs every 1/60 s of simulation time.
public class MyAuto implements DeckAutonomous {
    private Follower follower;
    private int leg = 0;
    private double arrived = -1;

    @Override
    public void init(SimRobot robot) {
        follower = robot.follower();
        follower.setPose(robot.startPose());
        follower.follow(robot.routeLegs().get(0));
    }

    @Override
    public void loop(SimRobot robot) {
        follower.update();
        if (follower.isBusy()) return;
        if (arrived < 0) arrived = robot.time();
        if (robot.time() - arrived < robot.stopWait(leg)) return; // your mechanism action runs here
        if (++leg >= robot.routeLegs().size()) { robot.finish(); return; }
        arrived = -1;
        follower.follow(robot.routeLegs().get(leg));
    }
}
`;
  // ------------------------------------------------------------------ project
  const ROBOT=C.robot({},'ftc');
  const TIMED_FIELDS=[['#sim-timed-forward','forwardSpeed'],['#sim-timed-strafe','strafeSpeed'],['#sim-timed-startup','startup'],['#sim-timed-stopping','stopping'],['#sim-timed-strafe-stopping','strafeStopping'],['#sim-timed-heading','headingP']];
  const newId=()=>'f'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const layout=(game,name)=>({id:newId(),name,field:game,alliance:'red',width:144,height:144,elements:true,start:null,zones:[],pins:[],clearance:2,style:'spline',rotate:true,route:null,tested:null});
  function defaults(){const layouts=[layout('biobuzz','BIOBUZZ')];
    return {version:2,setupId:newId(),setupName:'Setup 1',setups:[],controller:'ftc',imuSource:'hub',ftcSensors:null,motionSensors:null,timing:window.DeckTimed.settings(),orientations:{},hitboxes:false,setupDone:false,robot:{...ROBOT},sensors:{localization:'encoders'},tuning:{maxPathSpeed:.8},practice:{mode:'autonomous',autoSeconds:30,transitionSeconds:8,teleopSeconds:120},program:{kind:'route',name:'',source:EXAMPLE},model:null,view:'2d',mechanisms:window.DeckMechanisms.sanitize({}),kinematics:window.DeckKinematics.sanitize({}),layouts,active:layouts[0].id,export:{packageName:'org.firstinspires.ftc.teamcode',className:'PlannedRoute',keep:false}};}
  function cleanLayout(raw){
    // Last season's DECODE layouts are no longer offered; their zones and pins stay, on an empty field.
    const l=layout(Object.hasOwn(GAMES,raw?.field)?raw.field:'empty',(String(raw?.name||'Field')+(raw?.field==='decode'?' (was DECODE)':'')).slice(0,40));if(typeof raw?.id==='string'&&/^[\w-]{1,40}$/.test(raw.id))l.id=raw.id;
    const b=C.bounds({...raw,field:l.field});l.width=b.x1;l.height=b.y1;l.elements=raw?.elements!==false;
    if(raw?.start&&[raw.start.x,raw.start.y,raw.start.heading].every(finite))l.start={x:raw.start.x,y:raw.start.y,heading:field.heading(raw.start.heading)};
    // Game fields bring their own structures; your own obstacles are only for the empty field.
    if(Array.isArray(raw?.zones)&&l.field==='empty')l.zones=raw.zones.slice(0,24).map((z,i)=>{try{return planner.validateZone({...z,id:z.id||'zone-'+i});}catch{return null;}}).filter(Boolean);
    if(Array.isArray(raw?.pins))l.pins=raw.pins.slice(0,32).filter(q=>q&&finite(q.x)&&finite(q.y)).map(q=>({x:q.x,y:q.y,...planner.pinEffects(q)}));
    if(finite(raw?.clearance))l.clearance=Math.max(planner.MIN_CLEARANCE,raw.clearance);if(Object.hasOwn(STYLES,raw?.style))l.style=raw.style;else if(raw?.style==='rounded')l.style='sharp';l.rotate=raw?.rotate!==false;l.alliance=raw?.alliance==='blue'?'blue':'red';
    if(raw?.route&&Array.isArray(raw.route.segments)&&Array.isArray(raw.route.samples)&&Array.isArray(raw.route.stops))l.route=raw.route;if(Array.isArray(raw?.tested))l.tested=raw.tested.slice(0,6);
    return l;
  }
  function sanitize(raw){
    const p=defaults();if(!raw||typeof raw!=='object')return p;
    if(raw.version!==2&&raw.field){const old=cleanLayout({...raw,name:raw.field==='empty'?'Empty field 1':GAMES[raw.field],style:raw.smooth===false?'sharp':'spline'});p.layouts=p.layouts.map(l=>l.field===old.field?{...old,id:l.id}:l);}
    else if(Array.isArray(raw.layouts)&&raw.layouts.length)p.layouts=raw.layouts.slice(0,20).map(cleanLayout);
    p.active=p.layouts.some(l=>l.id===raw.active)?raw.active:p.layouts[0].id;if(raw.view==='3d')p.view='3d';
    p.robot=C.robot(raw.robot,raw.controller==='motionmodule'?'motionmodule':'ftc');if(raw.model)p.robot.appearance='custom';else if(p.robot.appearance==='swechanum'&&p.robot.drivetrain==='mecanum')p.robot.drivetrain='swerve';
    const s=raw.sensors||{},legacy={none:'gyro',encodersOnly:'encoders',ideal:'odometry',vision:'odometry'};if(Object.hasOwn(C.sensors,s.localization))p.sensors.localization=legacy[s.localization]||s.localization;
    p.controller=raw.controller==='motionmodule'?'motionmodule':'ftc';p.imuSource=['hub','external','module','device'].includes(raw.imuSource)?raw.imuSource:p.controller==='motionmodule'?'module':'hub';p.timing=window.DeckTimed.settings(raw.timing);p.ftcSensors=raw.ftcSensors&&typeof raw.ftcSensors==='object'?raw.ftcSensors:null;p.motionSensors=raw.motionSensors&&typeof raw.motionSensors==='object'?raw.motionSensors:null;p.sensors.localization=C.localization(p.controller,p.sensors.localization);
    const t=raw.tuning||{};for(const k of ['maxPathSpeed','translationalP','headingP'])if(finite(t[k]))p.tuning[k]=t[k];
    // 0.6 was the stored default path speed before the simulator chose one per robot; let it choose again.
    p.tuning.maxPathSpeed=finite(t.maxPathSpeed)&&(t.maxPathSpeed!==.6||t.powerSet)?Math.max(0,Math.min(1,t.maxPathSpeed)):.8;if(t.powerSet)p.tuning.powerSet=true;
    // Path correction is automatic: retire the old 0–2 strength and raw gain overrides.
    delete p.tuning.correctionScale;delete p.tuning.translationalP;delete p.tuning.headingP;
    const g=raw.program||{};p.program={kind:g.kind==='opmode'?'opmode':g.kind==='source'?'source':'route',name:typeof g.name==='string'?g.name.slice(0,120):'',source:typeof g.source==='string'&&g.source.length<=200000?(g.source===LEGACY_EXAMPLE?EXAMPLE:g.source):EXAMPLE};
    p.model=modelMeta(raw.model);p.mechanisms=window.DeckMechanisms.sanitize(raw.mechanisms);p.kinematics=window.DeckKinematics.sanitize(raw.kinematics);p.calibration=window.DeckTune.sanitize(raw.calibration);p.sensors.driveEncoders=raw.sensors?.driveEncoders===true;p.robotPreset=Object.hasOwn(window.DeckMechanisms.PRESETS,raw.robotPreset)?raw.robotPreset:null;
    // A preset's size, weight, wheels and power are its own: a setup saved with other numbers (the kit once took any) gets them back.
    // Its odometry keeps which way each pod counts, which depends on how a team plugged it in. The kit's CAD is goBILDA's, with its front and sides as drawn.
    {const fix=window.DeckMechanisms.PRESETS[p.robotPreset]?.robot;if(fix&&p.robot){const odo=fix.odometry?{odometry:{...p.robot.odometry,pinpoint:{...p.robot.odometry?.pinpoint,...fix.odometry.pinpoint}}}:{};p.robot=C.robot({...p.robot,...fix,...odo},p.controller);if(p.robotPreset==='startermecanum'&&p.orientations)delete p.orientations.strafer;}}
    const e=raw.export||{};p.export={packageName:typeof e.packageName==='string'?e.packageName.slice(0,120):p.export.packageName,className:typeof e.className==='string'?e.className.slice(0,64):p.export.className,keep:!!e.keep};
    p.setupId=typeof raw.setupId==='string'?raw.setupId:p.setupId;p.setupName=String(raw.setupName||'Setup 1').slice(0,40);
    p.setups=Array.isArray(raw.setups)?raw.setups.slice(0,20).filter(s=>s&&typeof s.id==='string'&&typeof s.name==='string'&&s.data&&typeof s.data==='object').map(s=>({id:s.id,name:s.name.slice(0,40),data:s.data})):[];
    p.hitboxes=!!raw.hitboxes;p.setupDone=raw.setupDone!==false;p.setupStep=['field','robot','mechanisms','controller'].includes(raw.setupStep)?raw.setupStep:'field';p.controllerSet=raw.controllerSet===true||p.controller==='motionmodule'||!!raw.calibration?.hub||Object.keys(raw.robot?.wiring?.devices||{}).length>0;p.garageTile=typeof raw.garageTile==='string'&&raw.garageTile.length<120?raw.garageTile:'';p.railGroups=Object.fromEntries(Object.entries(raw.railGroups&&typeof raw.railGroups==='object'?raw.railGroups:{}).filter(([k,v])=>typeof v==='string'&&k.length<120&&/^(group:intake)?$/.test(v)));p.railNames=Object.fromEntries(Object.entries(raw.railNames&&typeof raw.railNames==='object'?raw.railNames:{}).filter(([k,v])=>typeof v==='string'&&k.length<120&&v.trim()).slice(0,100).map(([k,v])=>[k,v.trim().slice(0,40)]));p.railFolded=Array.isArray(raw.railFolded)?raw.railFolded.filter(k=>typeof k==='string'&&k.length<120).slice(0,50):[];p.needsCad=raw.needsCad===true&&!p.model;p.customRobot=raw.customRobot&&typeof raw.customRobot==='object'&&!Array.isArray(raw.customRobot)?raw.customRobot:null;p.setupFocus=typeof raw.setupFocus==='string'&&/^[\w.:-]{1,80}$/.test(raw.setupFocus)?raw.setupFocus:'';p.orientations={};for(const id of ['strafer','swechanum']){const o=raw.orientations?.[id];if(o&&['+x','-x','+y','-y','+z','-z'].includes(o.front)&&['+x','-x','+y','-y','+z','-z'].includes(o.top)&&o.front[1]!==o.top[1])p.orientations[id]={front:o.front,top:o.top};}
    const practice=raw.practice||{};if(['autonomous','teleop','match'].includes(practice.mode))p.practice.mode=practice.mode;for(const k of ['autoSeconds','transitionSeconds','teleopSeconds'])if(finite(practice[k]))p.practice[k]=Math.max(k==='transitionSeconds'?0:.000001,practice[k]);
    return p;
  }
  // Model metadata is checked here too, before the 3D module has loaded.
  function modelMeta(raw){
    if(!raw||typeof raw.id!=='string'||!/^[0-9a-f]{32}\.glb$/.test(raw.id))return null;
    const axes=['+x','-x','+y','-y','+z','-z'],front=axes.includes(raw.front)?raw.front:'+x',top=axes.includes(raw.top)?raw.top:'+z';
    // Named CAD parts (chassis, intake, shooter...) with their boxes, as the import classified them.
    const pick=(v,list)=>list.includes(v)?v:undefined,parts=Array.isArray(raw.parts)?raw.parts.slice(0,64).filter(p=>p&&Array.isArray(p.box)&&p.box.length===6&&p.box.every(finite))
      .map(p=>JSON.parse(JSON.stringify({name:String(p.name||'').slice(0,80),role:pick(p.role,['chassis','intake','shooter','indexer'])||'other',pieces:pick(p.pieces,['pollen','nectar','both']),type:pick(p.type,['turret','fixed']),kind:pick(p.kind,['sweeper','siderollers','ramp']),key:typeof p.key==='string'?p.key.slice(0,400):undefined,chosen:p.chosen===true||undefined,box:p.box.slice()}))):[];
    return {id:raw.id,name:String(raw.name||'Robot model').slice(0,120),units:['in','mm','cm','m'].includes(raw.units)?raw.units:'in',front,top:front[1]===top[1]?(front[1]==='z'?'+x':'+z'):top,source:raw.source==='step'?'step':'mesh',...(parts.length?{parts}:{}),...(raw.autoSize===true?{autoSize:true}:{}),...(raw.bodyChassis===true?{bodyChassis:true}:{}),...(typeof raw.drivetrain==='string'&&Object.hasOwn(C.drives,raw.drivetrain)?{drivetrain:raw.drivetrain}:{}),...(Array.isArray(raw.entered)?{entered:raw.entered.filter(k=>['mass','wheel','rpm'].includes(k))}:{})};
  }
  // A first run opens the Test setup: a BIOBUZZ red robot built from FTC parts, on a Control Hub, with a long autonomous.
  const storedProject=localStorage.getItem(KEY)||localStorage.getItem(OLD_KEY);
  // Each setup has one field, BIOBUZZ or an empty field; everything else is a setup of its own. A setup saved with more
  // fields keeps the one it had open; each other field with a route becomes a setup of its own ("Setup 2 · Practice room"),
  // and the preset robots' old demo fields go (each preset is a built-in setup now).
  function oneField(raw){if(!raw||typeof raw!=='object')return raw;
    // A built-in setup of a preset robot that no longer exists goes; a project open on it opens on its next setup.
    const gone=id=>String(id||'').startsWith('preset:')&&!Object.hasOwn(window.DeckMechanisms.PRESETS,String(id).slice(7));
    if(Array.isArray(raw.setups)&&raw.setups.some(s=>gone(s?.id))||gone(raw.setupId)){const setups=(Array.isArray(raw.setups)?raw.setups:[]).filter(s=>!gone(s?.id));raw={...raw,setups};
      if(gone(raw.setupId)){const next=setups[0];raw=next?{...raw,...next.data,setups,setupId:next.id,setupName:next.name}:{...raw,setupId:newId()};}}
    const split=(name,d)=>{const ls=Array.isArray(d?.layouts)?d.layouts.filter(l=>l&&typeof l==='object'):[];if(ls.length<2)return [d,[]];
      const demo=l=>String(l.id).startsWith('preset-')&&!d.robotPreset,keep=ls.find(l=>l.id===d.active&&!demo(l))||ls.find(l=>!demo(l)&&l.pins?.length)||ls.find(l=>!demo(l))||ls[0];
      return [{...d,layouts:[keep],active:keep.id},ls.filter(l=>l!==keep&&!String(l.id).startsWith('preset-')&&Array.isArray(l.pins)&&l.pins.length).map(l=>({id:newId(),name:`${name} · ${l.name||'Field'}`.slice(0,40),data:{...d,layouts:[l],active:l.id,export:{...(d.export||{}),keep:false}}}))];};
    if(!Array.isArray(raw.setups)||!raw.setups.length)return split(raw.setupName||'Setup',raw)[0];
    const bank=[];for(const s of raw.setups){if(!s||typeof s!=='object')continue;const [data,more]=split(s.name,s.data);bank.push({...s,data},...more);}
    const mine=bank.find(s=>s.id===raw.setupId);return {...(mine?mine.data:split(raw.setupName,raw)[0]),setups:bank.slice(0,20),setupId:raw.setupId,setupName:raw.setupName};}
  let project;try{project=sanitize(storedProject?oneField(JSON.parse(storedProject)):window.DeckTestRobot?.setup()??null);}catch{project=defaults();}
  let runData=null,liveFrame=null,reportKey='',lastReport=null,estimateTimer=0,estimateSeq=0;const estimates=new Map();
  // Run & review's side views (Results, Export, Diagnostics) and the Results parts shown before and after a run.
  let runViews=null,resultsReady=null,replayBox=null,reportShown=-1;
  // The run report's chosen path ({index, pin}): its breakdown shows under the time bar and Run & review marks it on the field.
  let reviewLeg=null;
  let tab='setup',planningStep='start',setupStep=(s=>s==='controller'&&!MECH.PRESETS[project.robotPreset]?.adjustable?'mechanisms':s)(!project.setupDone&&project.setupStep||'field'),runAttempt=0,loadError='';
  const L=()=>project.layouts.find(l=>l.id===project.active)||project.layouts[0];
  if(!L().start){try{const legacy=field.restore(localStorage.getItem(field.KEY));if(legacy&&L().field==='empty')L().start=legacy;}catch{}}
  let diagnostics=[],analysisPending=false;
  let planError='',blockedPin=-1,sketch=null,cursor=null,info=null,frame=null,selected=null,tool='start',active=false,pointer=null,startGrab={dx:0,dy:0},stroke=null,drag=null,planSeq=0,keys=new Set(),trail=[],loading=null,view3d=null,runState='idle',logLines=[],model=null,modelPreview=null,selectedSide=null,optimizing=false,videoCheck=null,videoRefresh=null,videoReplay=null,studio=null;
  const fallbackFootprint=()=>C.footprint(project.robot);
  // The chassis alone (size settings, no intakes): the red outline in the model preview and what the model is fitted to.
  const chassisFootprint=()=>({front:project.robot.length/2,rear:project.robot.length/2,half:project.robot.width/2});
  const geometry=()=>({footprint:info?.footprint||fallbackFootprint(),bounds:info?.bounds||C.bounds(L())});
  const fieldHeight=()=>L().field==='empty'?L().height:144;
  let start=L().start||field.edgePose(0,geometry()),preview={...start};
  function snapshot(){const {setups,...data}=project;return JSON.parse(JSON.stringify(data));}
  // Everything in a setup (fields with their plans, robot, mechanisms, controller, program and run settings) is saved together.
  function save(){const note=root.querySelector('#sim-saved');recordPlan();if(project.model)project.needsCad=false;
    try{const entry={id:project.setupId,name:project.setupName,data:snapshot()},i=project.setups.findIndex(s=>s.id===entry.id);if(i<0)project.setups.push(entry);else project.setups[i]=entry;localStorage.setItem(KEY,JSON.stringify(project));
      if(note){note.textContent=`Saved automatically · ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;note.classList.remove('failed');}return true;}
    catch{if(note){note.textContent='Could not save: this computer’s storage for setups is full.';note.classList.add('failed');}return false;}}

  // ------------------------------------------------------------------ markup
  const options=(list,value)=>Object.entries(list).map(([k,v])=>`<option value="${k}"${k===value?' selected':''}>${v}</option>`).join('');
  const segmented=(attr,list,label)=>`<div class="segmented sim-seg" role="group" aria-label="${label}">${Object.entries(list).map(([k,v])=>`<button type="button" data-${attr}="${k}" aria-pressed="false">${v}</button>`).join('')}</div>`;
  const ICON=Object.fromEntries(Object.entries({add:'M12 5v14M5 12h14',rename:'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    open:'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',save:'M12 4v11M7 10l5 5 5-5M5 20h14'}).map(([k,d])=>[k,`<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`]));
  root.innerHTML=`<dialog id="sim-start-confirm" aria-labelledby="sim-start-confirm-title"><form method="dialog"><h2 id="sim-start-confirm-title">Is this your robot’s starting position?</h2><p id="sim-start-confirm-file" class="hint"></p><p>The simulation starts your robot exactly as this CAD is posed: slides down, arms and intakes stowed, everything inside the starting size the way it sits on the field before a match. Import it only if this is that starting configuration.</p><div class="button-row"><button type="submit" value="yes" class="primary" id="sim-start-yes">Yes, this is the starting position</button><button type="submit" value="no" class="secondary" id="sim-start-no">No, cancel</button></div></form></dialog>
    <dialog id="sim-setup-delete-confirm" aria-labelledby="sim-setup-delete-title"><form method="dialog"><h2 id="sim-setup-delete-title"></h2><p>This removes the setup with its fields, planned routes, robot, mechanisms and program. It cannot be undone, so save it to a file first if you might want it back.</p><div class="button-row"><button type="submit" value="yes" class="primary danger" id="sim-setup-delete-yes">Yes, delete this setup</button><button type="submit" value="no" class="secondary" id="sim-setup-delete-no">No, keep it</button></div></form></dialog>
    <dialog id="sim-video-run" aria-labelledby="sim-video-run-title"><form method="dialog"><h2 id="sim-video-run-title">Run the autonomous first</h2><p>The Video editor films a run. Run this setup’s autonomous now and the editor opens on it when it finishes.</p><div class="button-row"><button type="submit" value="run" class="primary" id="sim-video-run-yes">Run it</button><button type="submit" value="no" class="secondary">Not now</button></div></form></dialog>
    <dialog id="sim-major-confirm" aria-labelledby="sim-major-title"><form method="dialog"><h2 id="sim-major-title"></h2><p id="sim-major-text"></p><div class="button-row"><button type="submit" value="new" class="primary" id="sim-major-new">Make a new setup</button><button type="submit" value="this" class="secondary" id="sim-major-this">Change this setup</button><button type="submit" value="cancel" class="secondary">Cancel</button></div></form></dialog>
    <nav class="sim-navigation" aria-label="Autonomous setup"><div class="sim-tabs" role="tablist">${Object.entries({setup:'Setup',plan:'Path planning',run:'Run & review'}).map(([k,t],i)=>`<button type="button" role="tab" data-tab="${k}" id="sim-tab-${k}" aria-controls="sim-panel-${k}"><span>${i+1}</span>${t}</button>`).join('')}<button type="button" role="tab" data-tab="video" id="sim-tab-video" aria-controls="sim-panel-video" title="Edit the run into a video"><span>4</span>Video editor</button></div></nav>
    <div class="sim-setup-bar"><span class="sim-setup-label" id="sim-setup-label">Saved setup</span><div class="sim-setup-picker"><button id="sim-setup" type="button" class="sim-setup-current" aria-haspopup="listbox" aria-expanded="false" aria-controls="sim-setup-list" aria-labelledby="sim-setup-label sim-setup"><span class="sim-setup-text"><strong></strong><small></small></span><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
      <div id="sim-setup-list" class="sim-setup-list" role="listbox" aria-labelledby="sim-setup-label" hidden></div></div>
      <div class="sim-setup-actions" role="group" aria-label="Manage setups"><button id="sim-setup-new" type="button" title="Start a new setup with default settings. Right-click a setup to clone, rename or delete it.">${ICON.add}New</button></div>
      <div class="sim-setup-actions" role="group" aria-label="Setup file"><button id="sim-open" type="button" title="Open a setup saved as a file (or a robot file saved by an older version, into this setup)">${ICON.open}Open file…</button><button id="sim-save" type="button" title="Save this whole setup to one file: its field and routes, robot and CAD, mechanisms and robot controller">${ICON.save}Save file…</button></div><span class="hint" id="sim-saved" role="status">Saves automatically on this computer</span>
      <div id="sim-setup-menu" class="sim-setup-menu" role="menu" aria-label="Setup actions" hidden><button type="button" role="menuitem" data-setup-act="open">Open</button><button type="button" role="menuitem" data-setup-act="clone">Clone</button><button type="button" role="menuitem" data-setup-act="rename">Rename</button><button type="button" role="menuitem" data-setup-act="delete" class="danger">Delete</button></div></div>
    <div class="simulation-layout"><section class="field-area" aria-label="Simulation field">
      <div class="sim-toolbar">
        ${segmented('tool',{select:'Select',rect:'Box',circle:'Circle',triangle:'Triangle',shape:'Shape',pin:'Click to add',draw:'Draw path'},'Field tool')}
        <div class="sim-transport"><div class="sim-run-buttons" role="group" aria-label="Run"><button type="button" id="sim-play" class="secondary">Play</button><button type="button" id="sim-stop" class="secondary">Stop</button><button type="button" id="sim-reset" class="secondary">Reset</button></div><div class="sim-view-controls"><button type="button" id="sim-hitboxes" class="secondary" aria-pressed="false" hidden>Hitboxes</button><div class="segmented sim-seg sim-zoom" role="group" aria-label="Field zoom"><button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">−</button><button type="button" data-zoom="fit" aria-label="Fit the whole field" title="Fit the whole field (0)">Fit</button><button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+). Scroll or pinch to zoom where you point; drag empty floor to move around.">+</button></div>${segmented('view',{'2d':'2D','3d':'3D'},'View')}</div></div>
      </div>
      <div class="sim-stage" id="sim-stage">
      <svg id="simulation-field" viewBox="-16 -9 168 172" role="group" tabindex="0" aria-label="Simulation field, inches from the bottom-left corner" aria-describedby="field-help field-coordinates">
        <rect class="field-floor" x="0" y="0" width="144" height="144"/><g class="field-grid"></g><g class="field-labels"></g>
        <g id="sim-overlay" transform="matrix(1 0 0 -1 0 144)"><rect id="sim-walls" class="sim-walls" x="0" y="0" width="144" height="144"/><g id="sim-obstacles"></g><g id="sim-elements"></g><g id="sim-zones"></g><g id="sim-route"></g><g id="sim-preview-ghost"></g><g id="sim-trail"></g><g id="sim-log-path"></g><g id="sim-pins"></g><polygon id="sim-start" class="sim-start" points=""/><polygon id="sim-estimate" class="sim-estimate" points=""/><circle id="sim-target" class="sim-target" r="1.2" cx="-99" cy="-99"/><g id="sim-draft"></g></g>
        <g id="field-robot"><image id="sim-robot-image" href="" x="0" y="0" width="0" height="0" preserveAspectRatio="none"/><rect x="-9" y="-9" width="18" height="18" rx="1.5"/><path d="M-3 0H5M2-3L5 0 2 3"/></g>
      </svg><div id="sim-3d" class="sim-3d" hidden></div><div id="sim-effects" class="sim-popover" role="dialog" aria-label="Pin and path settings" hidden></div><datalist id="sim-action-list"></datalist></div>
      <output id="field-coordinates"></output><p id="field-help" class="hint"></p>
      <dl id="sim-telemetry" class="sim-telemetry"></dl>
    </section>
    <section class="start-controls sim-panel" aria-label="Simulation settings">
      <div data-panel="setup" id="sim-panel-setup" role="tabpanel" aria-labelledby="sim-tab-setup">
        <div class="sim-setup-steps" role="tablist" aria-label="Setup step"><button id="sim-setup-step-field" data-setup-step="field" role="tab" type="button" class="secondary">1 · Field</button><button id="sim-setup-step-robot" data-setup-step="robot" role="tab" type="button" class="secondary">2 · Robot</button><button id="sim-setup-step-mechanisms" data-setup-step="mechanisms" role="tab" type="button" class="secondary">3 · Mechanisms</button><button id="sim-setup-step-controller" data-setup-step="controller" role="tab" type="button" class="secondary">4 · Chassis</button></div><div id="sim-setup-flags" class="sim-setup-flags" role="status" hidden></div>
        <section class="sim-setup-page" data-setup-page="field" aria-labelledby="sim-setup-step-field">
        <h2>Field</h2><p class="hint">Pick the field you will practise on. BIOBUZZ, this season's FTC game, uses the official playing area inside the perimeter wall; an empty field can be any size.</p><div class="sim-setup-cols"><div class="sim-setup-col"><div class="sim-row"><label class="sr-only" for="sim-field">Field</label><select id="sim-field"></select></div>
        <p id="sim-field-note" class="hint"></p>
        <div id="sim-alliance-box"><label>Alliance</label>${segmented('alliance',{red:'Red',blue:'Blue'},'Alliance')}<p class="hint" id="sim-alliance-note">Which hive your shots aim at and score for. Switching moves the starting pose, paths and obstacles to that alliance’s side (turned 180° about the field centre, as the field is).</p></div></div><div class="sim-setup-col"><p id="sim-field-official" class="sim-field-official" hidden></p><div id="sim-field-size"><div class="start-xy"><div><label for="sim-field-width">Field width · in</label><input id="sim-field-width" type="number" min="1" step="any" data-slider-min="24" data-slider-max="288" data-slider-step="1"></div><div><label for="sim-field-height">Field depth · in</label><input id="sim-field-height" type="number" min="1" step="any" data-slider-min="24" data-slider-max="288" data-slider-step="1"></div></div><p class="hint" id="sim-field-size-note"></p></div>
        <label class="check"><input id="sim-game-elements" type="checkbox"> Physical game elements</label><p class="hint">Balls and field pieces use the game engine's physics, so your robot can push them and, with the mechanisms from step 3, pick them up and score. Turn off to drive on a clear field.</p></div></div>
        <section id="sim-start-controls"><h2 id="start-title">Starting pose</h2>
        <form id="start-form"><div class="sim-grid3"><div><label for="start-x">X · in</label><input id="start-x" type="number" step="any" required inputmode="decimal" data-slider-min="0" data-slider-max="144" data-slider-step="0.5" data-slider-submit></div><div><label for="start-y">Y · in</label><input id="start-y" type="number" step="any" required inputmode="decimal" data-slider-min="0" data-slider-max="144" data-slider-step="0.5" data-slider-submit></div><div><label for="start-heading">Heading °</label><input id="start-heading" type="number" step="any" required inputmode="decimal" data-slider-min="-180" data-slider-max="180" data-slider-step="1" data-slider-submit></div></div>
        <button class="primary" type="submit">Set starting pose</button></form>
        <div class="button-row"><button id="start-edge" class="secondary" type="button">Start at edge</button></div><p class="hint">Drag the robot, an existing obstacle or a pin from any planning tab.</p>
        <p id="start-status" role="status"></p></section>
        <div class="sim-setup-nav"><button type="button" class="primary" data-setup-go="robot">Next: CAD →</button></div></section>
        <section class="sim-setup-page" data-setup-page="robot" aria-labelledby="sim-setup-step-robot" hidden>
        <div id="sim-presets" class="sim-choice-cards sim-presets">${Object.entries(MECH.PRESETS).map(([id,p])=>`<button type="button" class="sim-choice" data-preset="${id}" aria-pressed="false"><strong>${p.name}</strong><span>${p.blurb}<br>${p.drive||C.drives[p.robot.drivetrain].name} · ${p.robot.length} × ${p.robot.width} in · ${p.robot.driveRpm} RPM<br>${MECH.summary(MECH.presetMechanisms(id)).replace(/, starts with \d+$/,'')}</span></button>`).join('')}</div>
        <div id="sim-preset-lock" class="sim-mech-preset" hidden><p id="sim-preset-lock-text"></p><dl id="sim-preset-about" class="sim-preset-about" hidden></dl><p id="sim-preset-note" class="hint"></p><div class="sim-preset-actions"><button type="button" class="secondary" data-preset-customize>Customize this robot</button><button type="button" class="primary" data-preset-plan>Go to path planning →</button></div></div>
        <div id="sim-robot-custom">
        <div class="sim-robot-layout"><div class="sim-robot-cad"><div class="sim-cad-head"><div class="button-row"><button id="sim-model-open" class="primary" type="button">Import CAD…</button><button id="sim-model-remove" class="secondary" type="button" hidden>Remove model</button></div></div>
        <div id="sim-model-drop" class="sim-drop"><p>Or drop your robot’s STEP file here (also URDF, SDFormat, MuJoCo, USD, GLB, STL or OBJ). Size, drivetrain, intakes and shooters fill in from it. No CAD? Skip this and type its size.</p><p id="sim-model-import-status" class="sim-import-status" role="status"></p></div>
        <div hidden><label for="sim-appearance">Robot model</label><select id="sim-appearance">${options({strafer:'goBILDA Strafer · mecanum',swechanum:'NYC FIRST A301 Swechanum · swerve',plain:'Simple footprint',custom:'Your imported model'},project.robot.appearance)}</select><p id="sim-model-credit" class="hint"></p></div>
        <div id="sim-model-box" hidden><div id="sim-model-preview" class="sim-model-preview"></div>
          <p id="sim-model-help" class="hint" role="status"></p>
          <div class="sim-side-assignments">${['front','back','left','right','top','bottom'].map(side=>`<button id="sim-model-${side}" data-assign-side="${side}" class="secondary" type="button" disabled>It’s the ${side}</button>`).join('')}</div>
          <div id="sim-units-box"><label for="sim-model-units">File units</label><select id="sim-model-units">${options({mm:'Millimetres',cm:'Centimetres',m:'Metres',in:'Inches'},'mm')}</select></div><p id="sim-orientation-summary" class="hint"></p>
          <p id="sim-model-status" role="status"></p></div></div>
        <aside class="sim-robot-specs" aria-label="Robot settings">
        <h3>Chassis hitbox</h3><p id="sim-mesh-size" hidden></p><div class="start-xy sim-hitbox"><div><label for="sim-length">Length · in</label><input id="sim-length" type="number" min="4" max="48" step="any" data-slider-min="4" data-slider-max="48" data-slider-step="0.25"></div><div><label for="sim-width">Width · in</label><input id="sim-width" type="number" min="4" max="48" step="any" data-slider-min="4" data-slider-max="48" data-slider-step="0.25"></div><div><label for="sim-height">Height · in</label><input id="sim-height" type="number" min="1" max="48" step="any" data-slider-min="1" data-slider-max="36" data-slider-step="0.25"></div><div><label for="sim-mass">Mass · lb</label><input id="sim-mass" type="number" min="1" max="150" step="any" data-slider-min="0.5" data-slider-max="100" data-slider-step="0.1"></div></div><p id="sim-footprint" class="hint"></p>
        <div id="sim-parts" class="sim-parts" hidden><h3>Your robot’s parts</h3><p class="hint">Click a part on the model (again to go inside) or pick one here, then say what it is.</p><div id="sim-part-pick" class="sim-part-pick" hidden><p><b id="sim-part-name"></b> <span id="sim-part-path" class="hint"></span></p><div id="sim-part-roles" class="chips" role="group" aria-label="What this part is"></div><div class="sim-part-nav"><button type="button" class="text-button" id="sim-part-up">↑ Whole assembly</button><button type="button" class="text-button" id="sim-part-clear">Done</button></div></div><ul id="sim-part-list" class="sim-part-list"></ul></div></aside></div>
</div>
        <div class="sim-setup-nav"><button type="button" class="secondary" data-setup-go="field">← Back</button><button type="button" class="primary" data-setup-go="mechanisms">Next: mechanisms →</button></div></section>
        <section class="sim-setup-page" data-setup-page="controller" aria-labelledby="sim-setup-step-controller" hidden><h2>Chassis</h2><div id="ctl-preset" class="sim-mech-preset" hidden><p id="ctl-preset-text"></p><button type="button" class="secondary" data-preset-customize>Customize this robot</button></div><div class="sim-setup-cols" id="sim-ctl-cols"><div class="sim-setup-col">
        <div class="sim-ctl-choice"><h3 class="sim-setup-sub">What runs your robot</h3><p id="sim-controller-now"></p><p id="sim-controller-note" class="hint"></p></div>
        <section id="sim-ctl-sensors" class="sim-ctl-section"><h3>How it knows where it is</h3><label class="check sim-pinpoint-on" for="sim-pinpoint-on" hidden><input id="sim-pinpoint-on" type="checkbox"> goBILDA Pinpoint with 2 odometry pods</label><div id="sim-sensor-cards" class="sim-pick-cards" role="group" aria-label="Position sensors"></div><select id="sim-localization" hidden aria-hidden="true">${options(Object.fromEntries(Object.entries(C.sensors).filter(([,v])=>!v.hidden).map(([k,v])=>[k,v.name])),project.sensors.localization)}</select><p id="sim-sensor-note" class="hint"></p><h3>What measures turning</h3><div id="sim-imu-cards" class="sim-pick-cards" role="group" aria-label="What measures turning"></div><select id="sim-imu-source" hidden aria-hidden="true"></select><p id="sim-imu-note" class="hint"></p><div id="sim-hub-mount" hidden><div class="start-xy"><div><label for="sim-hub-logo">Control Hub logo faces</label><select id="sim-hub-logo"></select></div><div><label for="sim-hub-usb">Its USB ports face</label><select id="sim-hub-usb"></select></div></div></div><details id="sim-odometry" class="sim-mech-code" hidden><summary>Where the odometry sits</summary><p id="sim-odometry-note" class="hint"></p><div id="sim-odometry-list" class="sim-device-list"></div></details></section>
</div><div class="sim-setup-col sim-ctl-ports-col"><section id="sim-ctl-ports" class="sim-ctl-section">
        <details id="sim-device-names" class="sim-mech-code" hidden><summary>Device names and motor directions</summary><p class="hint">Tick a drive motor that turns the wrong way.</p><div id="sim-device-list" class="sim-device-list"></div></details>
                <details id="sim-config-summary" class="sim-mech-code" hidden><summary>Configure Robot on the robot (advanced)</summary><div id="sim-robot-read" class="sim-robot-read"><div class="start-xy"><div><label for="sim-robot-source">Read the robot over</label><select id="sim-robot-source"><option value="usb">USB cable (Control Hub plugged into this computer)</option></select></div><div><label for="sim-robot-configs">Configuration</label><select id="sim-robot-configs" hidden></select></div></div><div class="button-row"><button type="button" class="secondary" id="sim-robot-usb">Read the robot’s configurations</button><button type="button" class="secondary" id="sim-robot-dashboard" title="Program &amp; Manage, OnBot Java and Blocks, served by the robot, through the USB cable">Open the robot’s dashboard (USB)</button></div><p id="sim-robot-status" class="hint" role="status"></p><div id="sim-robot-devices"></div></div></details></section><section id="sim-timed-settings"><h3>Timed driving</h3><p class="hint">With no position sensor, the robot drives each path for a set time, then stops. The times come from the robot’s drivetrain, motors, wheels and weight (steps 2 and 3), so there is nothing to measure.</p>
          <dl id="sim-timed-summary" class="sim-timed-summary"></dl>
          <label class="check" for="sim-timed-measured"><input id="sim-timed-measured" type="checkbox"> Use numbers measured on my real robot instead</label>
          <div id="sim-timed-manual" hidden><p class="hint">Drive the robot at the default autonomous power for 1 s and for 2 s, and measure how far it went each time once it stopped. The difference is the distance per second.</p><h4 class="sim-setup-group">Speed</h4><div class="start-xy"><div><label for="sim-timed-forward">Forward speed at full power · in/s</label><input id="sim-timed-forward" type="number" min="0.000001" data-slider-max="500" step="any" data-slider-step="1" data-slider-min="1"></div><div><label for="sim-timed-strafe">Sideways speed at full power · in/s</label><input id="sim-timed-strafe" type="number" min="0.000001" data-slider-max="500" step="any" data-slider-step="1" data-slider-min="1"></div></div><h4 class="sim-setup-group">Starting and stopping</h4><div class="start-xy"><div><label for="sim-timed-startup">Speed-up time · s</label><input id="sim-timed-startup" type="number" min="0" data-slider-max="3" step="any"></div><div><label for="sim-timed-stopping">Coasting time · s</label><input id="sim-timed-stopping" type="number" min="0" data-slider-max="2" step="any"></div></div><div class="start-xy"><div><label for="sim-timed-strafe-stopping">Sideways coasting time · s</label><input id="sim-timed-strafe-stopping" type="number" min="0" data-slider-max="2" step="any"></div><div><label for="sim-timed-heading">Heading correction strength</label><input id="sim-timed-heading" type="number" min="0" data-slider-max="10" step="any"></div></div></div><p id="sim-timed-status" class="hint" role="status"></p></section><section class="sim-advanced" hidden></section></div></div>
        <div class="sim-setup-nav"><button type="button" class="secondary" data-setup-go="mechanisms">← Back</button><button type="button" class="primary" id="sim-setup-next">Next: path planning →</button></div></section>
        <section class="sim-setup-page" data-setup-page="mechanisms" aria-labelledby="sim-setup-step-mechanisms" hidden><h2>Mechanisms</h2><p class="hint">Everything on your robot that moves.</p>
        <div class="sim-mech-layout"><aside class="sim-garage" aria-label="Your robot"><h3>Your robot</h3><div id="mech-rail" class="sim-garage-rail"></div><div class="sim-mech-toolbar"><button type="button" class="primary" id="mech-add" aria-expanded="false" aria-controls="mech-picker">+ Add mechanism</button><button type="button" class="secondary" id="mech-from-cad">Configure from CAD</button></div><p id="mech-list-status" class="hint sim-mech-status" role="status"></p><p id="mech-count" class="hint sim-mech-count"></p></aside><div class="sim-mech-main"><div id="mech-stats" class="sim-stats" hidden></div>
        <div id="mech-preset" class="sim-mech-preset" hidden><p id="mech-preset-text"></p><label class="check sim-chassis-check" for="mech-chassis-edit" hidden><input id="mech-chassis-edit" type="checkbox"> Edit the chassis motors (names and Control Hub ports)</label><div class="sim-preset-actions"><button type="button" class="secondary" data-preset-customize>Customize this robot</button><button type="button" class="primary" data-preset-plan>Go to path planning →</button></div></div>
        <section id="mech-drive" class="sim-mech-part"><div class="sim-mech-head"><h4>Chassis</h4></div><div class="sim-drive-group"><div class="sim-drive-pick"><div><label for="sim-drive-family">Drivetrain</label><select id="sim-drive-family"></select></div><div id="sim-drive-count-box"><label for="sim-drive-count" id="sim-drive-count-label">Motors</label><select id="sim-drive-count"></select></div><div id="sim-drive-steer-box"><label for="sim-drive-steer">Steering</label><select id="sim-drive-steer"><option value="crservo">Continuous servo</option><option value="servo">Servo (set position)</option><option value="dcmotor">DC motor</option></select></div></div><p id="sim-drive-parts" class="sim-drive-parts"></p><div class="sr-only" aria-hidden="true"><label for="sim-drivetrain">Drive model</label><select id="sim-drivetrain" tabindex="-1">${options(Object.fromEntries(Object.entries(C.drives).map(([k,v])=>[k,v.name])),project.robot.drivetrain)}</select></div><p id="sim-drive-cad" class="hint"></p><p id="sim-drive-note" class="hint"></p></div><div id="sim-drive-settings"><span class="sim-mech-label">Motors &amp; power</span><div class="start-xy"><div><label for="sim-rpm">Wheel RPM</label><input id="sim-rpm" type="number" min="30" max="6000" data-slider-max="6000" step="any" data-slider-step="1" data-slider-min="50"></div><div><label for="sim-wheel">Wheel diameter · mm</label><input id="sim-wheel" type="number" min="20" max="300" step="any" data-slider-min="24" data-slider-max="200"></div></div><label for="sim-maxspeed">Default auto chassis motor power · 0–1</label><input id="sim-maxspeed" type="number" min="0" max="1" data-slider-max="1" data-slider-step="0.05" step="any"><label for="sim-drive-style">Teleop driving style</label><select id="sim-drive-style"><option value="robot">Robot-centric</option><option value="field">Field-centric</option></select></div><div id="mech-drive-ports" class="sim-wire-block"></div></section>
        
        <div id="mech-chassis" class="sim-chassis" hidden></div>
        <section id="mech-controller" class="sim-mech-part sim-mech-controller"><div class="sim-pick-cards sim-controller-cards" role="group" aria-label="What runs your robot"><button type="button" class="sim-pick-card" data-controller="ftc" aria-pressed="false"><b>Control Hub</b><small>REV Control Hub (FTC): motors, servos and sensors plug into its ports. Its IMU is built in.</small></button><button type="button" class="sim-pick-card" data-controller="motionmodule" aria-pressed="false"><b>MotionModule</b><small>Another robot, run by a MotionModule: it drives by time unless you add odometry or an OTOS.</small></button></div><p id="mech-controller-note" class="hint"></p><div id="mech-controller-body"><div id="mech-controller-imu"></div></div></section>
        
        <div id="mech-picker" hidden></div>
        <div id="mech-intakes"></div><section id="mech-feeder" class="sim-mech-part" hidden><div class="sim-mech-head"><h4>Feeder</h4></div><p class="hint">Part of the intake: it moves pieces up to the shooters.</p><div class="sim-wire-block" data-wire-for="feeder"></div><label class="check sim-with-intake" for="mech-with-intake"><input id="mech-with-intake" type="checkbox"> Turns together with the intake rollers</label><div class="start-xy"><div><label for="mech-transfer">Transfer time · s</label><input id="mech-transfer" type="number" min="0" max="10" step="any" data-slider-max="4" data-slider-step="0.05"></div><div><label for="mech-index">Indexing time · s</label><input id="mech-index" type="number" min="0" max="5" step="any" data-slider-max="2" data-slider-step="0.05"></div></div></section>
        <div id="mech-shooters"></div><section id="mech-flywheel" class="sim-mech-part" hidden><span class="sim-mech-label">Flywheel</span><div class="start-xy"><div><label for="mech-rpm">Flywheel speed · RPM</label><input id="mech-rpm" type="number" min="100" max="30000" step="any" data-slider-step="50"></div><div><label for="mech-spinup">Spin-up time · s</label><input id="mech-spinup" type="number" min="0" max="10" step="any" data-slider-max="3" data-slider-step="0.05"></div></div><p id="mech-rpm-note" class="hint"></p><span class="sim-mech-label">Velocity PIDF</span><div class="sim-grid4">${['p','i','d','f'].map(k=>`<div><label for="mech-pidf-${k}">${k.toUpperCase()}</label><input id="mech-pidf-${k}" data-pidf="${k}" type="number" min="0" max="1000" step="any"></div>`).join('')}</div><p class="hint">Leave all four empty for the SDK’s default. The guided check in Calibrate measures them.</p></section>
        <section id="mech-turret" class="sim-mech-part" hidden><div class="sim-mech-head"><h4>Turret</h4></div><div class="start-xy"><div><label for="mech-turret-speed">Turns at · °/s</label><input id="mech-turret-speed" type="number" min="5" max="2000" step="any" data-slider-max="720" data-slider-step="5"></div><div><label for="mech-turret-range">Turns up to · ± °</label><input id="mech-turret-range" type="number" min="5" max="180" step="1"></div></div>
          <div class="sim-wire-block" data-wire-for="turret"></div><span class="sim-mech-label">Gear train</span><div id="mech-gears"></div><button type="button" class="secondary" id="mech-gear-add">+ Add a gear pair</button></section>
        <div id="mech-parts"></div>
        
        <p id="mech-empty" class="hint sim-mech-empty" hidden>No mechanisms yet. Press + Add mechanism and pick what your robot has (an intake, a lift, a claw…), then Configure from CAD finds each one in your robot’s CAD.</p>
        <section id="mech-preloads"><h3>Preloads</h3><p class="hint">BIOBUZZ robots hold up to 4 pieces in total and start with up to 4 pollen.</p>
        <div class="start-xy"><div><label for="mech-cap-pollen">Pollen capacity</label><input id="mech-cap-pollen" type="number" min="0" max="4" step="1"></div><div><label for="mech-cap-nectar">Nectar capacity</label><input id="mech-cap-nectar" type="number" min="0" max="4" step="1"></div></div>
        <p id="mech-nectar-note" class="hint"></p>
        <label for="mech-preload">Pollen it starts with</label><input id="mech-preload" type="number" min="0" max="4" step="1"></section>
        <section id="mech-joints" class="sim-joints" aria-label="Moving parts" hidden></section></div><aside class="sim-mech-aside">
          <div id="mech-model-box" class="sim-mech-model" hidden><div id="mech-model-preview" class="sim-model-preview"></div><ul id="mech-model-key" class="sim-mech-key"></ul><p id="mech-model-help" class="hint"></p></div>
        </aside></div>
        <div class="sim-setup-nav"><button type="button" class="secondary" data-setup-go="robot">← Back</button><button type="button" class="primary" data-setup-go="plan">Next: path planning →</button></div></section></div>
      <div data-panel="plan" id="sim-panel-plan" role="tabpanel" aria-labelledby="sim-tab-plan" hidden><p id="sim-demo-note" class="sim-demo-note" hidden></p>
        <div class="sim-planning-steps" role="tablist" aria-label="Planning step"><button id="sim-step-start" role="tab" type="button" class="secondary">1 · Starting pose</button><button id="sim-step-zones" role="tab" type="button" class="secondary">2 · Field obstacles</button><button id="sim-step-pins" role="tab" type="button" class="secondary">3 · Paths</button></div>
        <div id="sim-start-step"><p class="hint">Grab the robot to move it. It stops at walls and obstacles; the grab cursor stays with it until release. The red rectangle is its collision footprint.</p><button id="start-edge-plan" class="secondary" type="button">Start at edge</button><button id="sim-start-next" class="primary" type="button">Next: field obstacles →</button></div>
        <div id="sim-obstacle-step"><h2>Set up the field</h2><p class="hint">Mark the places your robot must avoid. Game structures are fixed. Your zones are saved with this layout.</p><div id="sim-shape-bar" class="sim-shape-bar" hidden><p id="sim-shape-status" class="hint" role="status"></p><div class="sim-row"><button id="sim-shape-finish" class="primary" type="button">Finish shape</button><button id="sim-shape-undo" class="secondary" type="button">Undo corner</button><button id="sim-shape-cancel" class="text-button" type="button">Cancel</button></div></div><button id="sim-zones-next" class="primary" type="button">Next: paths →</button></div>
        <div id="sim-route-step" hidden><h2>Paths</h2>
        <p class="hint sim-legend"><span class="key-hold">● Hold</span><span class="key-power">● Power</span><span class="key-rotation">● Rotation</span><span class="key-track">● Target</span><span class="key-action">● Action</span><span>Dashed = action · Hover for all modifiers</span></p>
        <p class="hint">Each path drives from the previous point to its end point. Click the field (or + Add path) to add one, drag a point to move it, and click a path or its line to edit it in the list. Points in a red area move to the nearest clear spot. Draw path turns a dragged stroke into paths. Give a path an action to run it while driving, such as intaking or shooting while moving; each action you name gets its own labeled slot in the exported code. Ctrl+Z undoes a change and Ctrl+Shift+Z redoes it.</p>
        <p class="hint sim-shortcuts"><strong>Keys</strong> (click the field first): arrows nudge the selected end point or obstacle 1 in (Shift: 0.1 in) · Delete removes it (or the open path) · Enter edits it · Shift while dragging a curve handle snaps it to 0.5 in · [ ] turn an obstacle · Escape cancels · Ctrl+Z / Ctrl+Shift+Z undo and redo · scroll, pinch, + − and 0 zoom · drag empty floor (or middle-drag, or Space+drag) to move around a zoomed field, or click the small map in its corner.</p>
        <div id="sim-zone-editor" class="sim-editor" hidden></div>
        <div class="sim-path-bar"><button id="sim-add-path" class="primary" type="button" title="Add a path from the last point">+ Add path</button></div>
        <ol id="sim-pin-list" class="sim-list sim-path-list"></ol>
        <div id="sim-preview-row" class="sim-preview-row" hidden><button id="sim-preview-play" class="secondary" type="button"><span aria-hidden="true">▶</span> Preview</button><input id="sim-preview" type="range" min="0" max="1000" step="1" value="0" aria-label="Robot position along the route" title="Moves a robot outline along the planned route. Shape only: Run & review drives it with physics and timing."><output id="sim-preview-note" class="hint" for="sim-preview"></output></div>
        <label>Route shape</label>${segmented('style',STYLES,'Route shape')}
        <label>Turning</label>${segmented('rotate',{auto:'Turn to fit',off:'Keep heading'},'Turning')}<p id="sim-rotate-note" class="hint"></p>
        <div class="start-xy"><div><label for="sim-clearance">Space around obstacles · in</label><input id="sim-clearance" type="number" min="0.05" data-slider-max="6" step="any" data-slider-step="0.05"></div><div><label>&nbsp;</label><button id="sim-optimize" class="secondary" type="button">Optimize</button></div></div>
        <p class="hint">Optimize test-drives straight and smooth shapes for your paths in the simulator and keeps the fastest one that stays clear and ends on target. Shapes you chose yourself are kept.</p><p id="sim-plan-status" role="status"></p><div id="sim-tested" class="sim-tested"></div>
        <div class="button-row"><button id="sim-import-pp" class="text-button" type="button" title="Replace the starting pose and paths with a Pedro Pathing visualizer (or Deck) .pp file. Ctrl+Z undoes it.">Import path file (.pp)…</button><button id="sim-clear-pins" class="text-button" type="button">Clear all paths</button><button id="sim-clear-zones" class="text-button" type="button">Clear zones</button></div>
        <h3 id="sim-export-title">Export the route</h3><div class="sim-format-grid sim-export-buttons"><button id="sim-export-onbot" class="sim-format" data-main type="button"><strong>OnBot Java</strong><small>.java · the autonomous and its check TeleOp</small></button><button id="sim-export-motionmodule" class="sim-format" data-main type="button"><strong>MotionModule</strong><small>autonomous.py</small></button><button id="sim-export-timed" class="sim-format" data-main type="button"><strong>Timed commands</strong><small>.json · powers, seconds and pauses</small></button><button id="sim-export-teamcode" class="sim-format" type="button"><strong>TeamCode folder</strong><small>Android Studio files</small></button><button id="sim-export-pedro" class="sim-format" type="button"><strong>Pedro Pathing 3</strong><small>For a Pedro Quickstart</small></button><button id="sim-export-java" class="sim-format" type="button"><strong>Route Java</strong><small>The route as one class</small></button><button id="sim-export-pp" class="sim-format" type="button"><strong>Path file</strong><small>.pp · Pedro visualizer</small></button><button id="sim-export-config" class="sim-format" type="button" title="The Control Hub configuration as Setup wires it: every device and sensor on its port"><strong>Robot configuration</strong><small>.xml · every device on its port</small></button></div><p id="sim-execution-note" class="hint"></p><details id="sim-export-ready" class="sim-more" open><summary>On-robot checklist</summary><p id="sim-export-names-note" class="hint"></p><ul id="sim-export-checklist" class="sim-checklist"></ul></details>
        <section id="sim-send" class="sim-send" hidden aria-labelledby="sim-send-title"><div class="sim-send-head"><h3 id="sim-send-title">Send to robot</h3><button id="sim-link-look" class="text-button" type="button">Look again</button></div>
        <div class="sim-link" role="radiogroup" aria-label="Connection"><button type="button" role="radio" data-link="usb" aria-checked="false"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v14M8 7l4-4 4 4M7 12v2l5 3M17 10v3l-5 3"/><circle cx="12" cy="19.5" r="1.8"/></svg><span><strong>USB cable</strong><small id="sim-link-usb">Looking…</small></span><i class="sim-link-dot" aria-hidden="true"></i></button><button type="button" role="radio" data-link="wifi" aria-checked="false"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9a13 13 0 0 1 18 0M6 12.5a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/></svg><span><strong>Wi-Fi</strong><small id="sim-link-wifi">Looking…</small></span><i class="sim-link-dot" aria-hidden="true"></i></button></div><select id="sim-send-robot" hidden aria-hidden="true" tabindex="-1"></select>
        <button id="sim-send-go" class="primary sim-send-go" type="button">Send to robot</button>
        <div id="sim-send-confirm" class="sim-send-confirm" hidden><p id="sim-send-summary"></p><ol id="sim-send-steps" class="sim-send-steps"></ol><div class="button-row"><button id="sim-send-yes" class="primary" type="button">Upload and build</button><button id="sim-send-no" class="secondary" type="button">Cancel</button></div></div>
        <p id="sim-send-status" class="hint" role="status"></p>
        <div id="sim-send-plan" class="sim-send-plan" hidden><h4 id="sim-send-plan-title"></h4><p id="sim-send-plan-note" class="hint"></p><ul id="sim-send-ports" class="sim-send-devices"></ul></div>
        <ul id="sim-send-devices" class="sim-send-devices"></ul><button id="sim-send-apply" class="secondary" type="button" hidden>Use these names</button></section>
        <div id="sim-export-options" class="sim-file-options"><label class="check"><input id="sim-export-keep" type="checkbox"> Keep the saved file updated as the route changes</label><div class="start-xy"><div><label for="sim-export-package">Java package</label><input id="sim-export-package" type="text" spellcheck="false"></div><div><label for="sim-export-class">Class name</label><input id="sim-export-class" type="text" spellcheck="false"></div></div></div>
        <p id="sim-export-status" class="hint"></p><button id="sim-plan-next" class="primary" type="button">Next: run & review →</button></div></div>
      <div data-panel="run" id="sim-panel-run" role="tabpanel" aria-labelledby="sim-tab-run" hidden>${segmented('practice',{autonomous:'Autonomous',teleop:'Teleop',match:'Full match'},'Practice mode')}
        <div class="sim-grid3"><div><label for="sim-auto-seconds">Auto</label><input id="sim-auto-seconds" type="number" min="0.1" step="any" data-slider-min="1" data-slider-max="120" data-slider-step="1"></div><div><label for="sim-transition-seconds">Transition</label><input id="sim-transition-seconds" type="number" min="0" step="any" data-slider-max="60" data-slider-step="1"></div><div><label for="sim-teleop-seconds">Teleop</label><input id="sim-teleop-seconds" type="number" min="0.1" step="any" data-slider-min="1" data-slider-max="300" data-slider-step="1"></div></div><div id="sim-practice-clock" class="sim-practice-clock" role="timer" aria-live="off"><span id="sim-practice-phase">Ready</span><strong id="sim-practice-time">0:30</strong></div>
        <p class="hint" id="sim-run-readiness"></p><button id="sim-run-sensors" type="button" class="secondary" hidden>Choose position sensing</button><button id="sim-run-plan" type="button" class="secondary" hidden>Go to Path planning</button><p class="hint" id="sim-practice-help"></p>
        ${segmented('program',{route:'Planned route',opmode:'OnBot Java export',source:'Java program'},'Program')}<p id="sim-program-note" class="hint"></p><pre id="sim-program-preview" class="sim-program-preview"></pre>
        <div class="sim-run-row"><button id="sim-run" class="primary" type="button">Run</button><button id="sim-pause" class="secondary sim-pause" type="button" aria-label="Pause" title="Pause" disabled></button><label class="sr-only" for="sim-speed">Speed</label><select id="sim-speed">${options({'0.25':'0.25×','0.5':'0.5×','1':'1×','2':'2×','4':'4×'},'1')}</select><button id="sim-record" class="secondary sim-record" type="button" aria-pressed="false" title="Film the next run with the camera of the view on screen, 2D or 3D">Record</button></div>
        <p id="sim-run-status" role="status"></p><section id="sim-run-analysis" class="sim-run-analysis" hidden><h3>Run report</h3><div id="sim-run-report" class="sim-run-report"></div></section><div id="sim-error" class="sim-error" role="alert" hidden></div>
        <div id="sim-source-box" hidden><div class="button-row"><button id="sim-java-open" class="secondary" type="button">Open .java…</button><button id="sim-java-example" class="secondary" type="button">Example</button></div>
          <label for="sim-source" id="sim-source-name">Program</label><textarea id="sim-source" spellcheck="false" wrap="off"></textarea></div>
        <section class="sim-log"><pre id="sim-log" role="log" aria-label="Run output">No run yet. Press Run and each step of the run is listed here.</pre></section>
        <p class="hint sim-credit">Route planning and following use the Deck controller. Third-party physics and component licences are in the app’s licenses folder.</p></div>
    </section></div>`;
  // One tab, three steps: Setup says what electronics the robot has, Configure says what is plugged into them and what each
  // is called, and Calibrate debugs and tunes them on the robot. Setup and Configure share an app view; all show these steps.
  const flowArrow='<svg class="ui-icon flow-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h17M14 6l6 6-6 6"/></svg>';
  let gateLive=false,gateTimer=null,sensorCal=null,linksCal=null,chassisCal=null;
  const flowSteps=`<nav class="flow-steps" aria-label="Setup and Calibrate steps"><button type="button" data-flow="setup"><span class="flow-num" aria-hidden="true">1</span>Setup</button>${flowArrow}<button type="button" data-flow="configure"><span class="flow-num" aria-hidden="true">2</span>Configure</button>${flowArrow}<button type="button" data-flow="debug"><span class="flow-num" aria-hidden="true">3</span>Debug</button>${flowArrow}<button type="button" data-flow="calibrate"><span class="flow-num" aria-hidden="true">4</span>Calibrate</button><button type="button" class="flow-axon" data-flow="axon"><span class="flow-new">New</span><span class="flow-num" aria-hidden="true">5</span>Axon Programmer</button></nav>`;
  // Setup (its own app view): the electronics on the robot and what is plugged into them, typed in or read from the Control
  // Hub's configuration. Simulate and Calibrate work from this.
  if(setupRoot)setupRoot.innerHTML=`<div class="cal-page">${flowSteps}<div class="cal-grid" id="rs-step-setup"><div class="cal-flow">
      <section class="cal-card" aria-labelledby="rs-control-title"><h2 id="rs-control-title">Robot control system</h2><div class="sim-big-toggle">${segmented('controller',{ftc:'FTC · Control Hub',motionmodule:'Other robot'},'Robot control system')}</div></section>
      <section class="cal-card" id="rs-robot-card" aria-labelledby="rs-robot-title"><h2 id="rs-robot-title">Your robot</h2><p id="rs-plug" class="rs-plug" role="status"><i class="dot"></i><span>Plug the Control Hub in by USB-C, or join its Wi-Fi, with the robot on.</span></p>
        <ul id="rs-checks" class="rs-checks" hidden></ul><p id="rs-status" class="hint" role="status"></p><p id="rs-scan-stuck" class="hint" role="status" hidden></p><p id="rs-matched" hidden></p>
        <div class="button-row"><button id="rs-read" class="secondary" type="button">Check again</button><button id="rs-scan" class="secondary" type="button">Scan</button></div></section>
      <section class="cal-card" id="rs-configs-card" aria-labelledby="rs-configs-title"><h2 id="rs-configs-title">Available configurations</h2>
        <div class="button-row rs-new-row"><button id="rs-new" class="secondary" type="button">New configuration</button></div>
        <form id="rs-new-form" class="rs-new" hidden><label class="sr-only" for="rs-new-name">New configuration’s name</label><input id="rs-new-name" placeholder="Configuration name" maxlength="40" spellcheck="false"><button class="primary" type="submit">Create</button><button id="rs-new-cancel" class="secondary" type="button">Cancel</button></form>
        <div id="rs-configs" class="rs-configs" role="list"></div></section>
      <section class="cal-card" id="rs-test" aria-labelledby="rs-test-title" hidden><h2 id="rs-test-title">Which hub is which?</h2><div id="rs-test-body"></div></section>
    </div><div class="cal-side" id="rs-electronics">
      <section class="cal-card" aria-labelledby="rs-hubs-title"><h2 id="rs-hubs-title">Electronics</h2><div id="rs-hubs"></div><div id="rs-problems"></div></section>
    </div></div>
    <div id="rs-step-configure" class="rs-configure" hidden></div><div id="rs-step-axon" class="rs-axon" hidden></div></div>
    <dialog id="rs-active-confirm" aria-labelledby="rs-active-title"><form method="dialog"><h2 id="rs-active-title"></h2><p id="rs-active-text"></p><div class="button-row"><button id="rs-active-yes" class="primary" type="button">Yes, make it active</button><button id="rs-active-no" class="secondary" type="button">No</button></div></form></dialog>`;
  // Calibrate (its own app view): send the code with its check TeleOp, run the guided check, and the other things to
  // measure on the real robot. It uses this setup and the same Send to robot panel, moved here while it shows.
  if(calRoot)calRoot.innerHTML=`<div class="cal-page">${flowSteps}<div id="cal-gate" class="cal-gate" role="status" hidden><p class="hint ce-none"></p><button id="cal-gate-sim" class="primary" type="button" hidden>Open in Simulate</button></div><div class="cal-bar"><div class="cal-tabs" role="tablist" aria-label="Debug, and each USB device plugged in" data-cal-top-tabs><button type="button" role="tab" id="cal-tab-debug" data-cal-top="debug" aria-controls="cal-panel-debug">Debug</button><button type="button" role="tab" id="cal-tab-calibrate" data-cal-top="calibrate" aria-controls="cal-panel-calibrate" hidden>Calibrate</button></div><div class="cal-tabs cal-subtabs" id="cal-subtabs" role="tablist" aria-label="What to calibrate" hidden><button type="button" role="tab" id="cal-tab-electronics" data-cal-tab="electronics" aria-controls="cal-panel-electronics">Electronics</button><button type="button" role="tab" id="cal-tab-mechanisms" data-cal-tab="mechanisms" aria-controls="cal-panel-mechanisms">Mechanisms</button><button type="button" role="tab" id="cal-tab-camera" data-cal-top="camera" aria-controls="cal-panel-camera">Camera</button></div><div class="cal-head"><p id="cal-saved" class="hint" role="status"></p><button id="cal-open-sim" class="secondary" type="button">Open in Simulate</button><button id="cal-save" class="primary" type="button">Save</button></div></div>
    <p id="cal-told" class="rs-told" role="status" hidden></p>
    <div id="cal-panel-camera" role="tabpanel" aria-labelledby="cal-tab-camera" data-cal-top-panel="camera" hidden><div class="cal-elec2 cal-cam2"><aside class="sim-garage cal-elec-list" id="cal-cam-rail" aria-label="Cameras, and what to measure"></aside><section class="cal-card" id="cal-camera"></section></div></div>
    <div id="cal-panel-debug" role="tabpanel" aria-labelledby="cal-tab-debug" data-cal-top-panel="debug"><section class="cal-card cal-debug" id="cal-debug" aria-labelledby="cal-debug-title"></section><section class="cal-card" id="cal-usb" aria-labelledby="cal-usb-title"></section></div>
    <div id="cal-panel-calibrate" role="tabpanel" aria-labelledby="cal-tab-calibrate" data-cal-top-panel="calibrate" hidden>
    <div id="cal-panel-electronics" role="tabpanel" aria-labelledby="cal-tab-electronics" data-cal-panel="electronics"><div id="cal-electronics"><div id="cal-links"></div></div></div>
    <div id="cal-panel-mechanisms" role="tabpanel" aria-labelledby="cal-tab-mechanisms" data-cal-panel="mechanisms" hidden><div id="cal-mech-sim" class="cal-card cal-mech-sim" role="status" hidden><h2>Finish Simulate</h2><p class="hint" data-mech-sim></p><div class="button-row"><button type="button" class="primary" data-mech-sim-open>Open in Simulate</button></div></div><div class="cal-elec2 cal-mech2"><aside class="sim-garage cal-elec-list" id="cal-mech-rail" aria-label="What to calibrate, in order"></aside><div class="cal-mech-pane" id="cal-mech-pane"><section class="cal-card" id="cal-hub-card" aria-labelledby="cal-hub-title"><div class="cal-hub-head"><h2 id="cal-hub-title">Control Hub</h2><span id="cal-hub-match" class="rs-pill" role="status"></span></div><p class="hint">Reads the names and ports in the robot’s active configuration and links each part of this setup to them. Plug the Control Hub in by USB-C first.</p><div class="button-row"><button id="cal-hub-setup" class="primary" type="button">Set up from the Control Hub</button></div><p id="cal-hub-status" class="hint" role="status"></p><ul id="cal-hub-result" class="sim-hub-result" hidden></ul></section><div class="cal-mech-body"><div id="cal-chassis" class="cal-sensors"></div><div id="cal-sensors" class="cal-sensors"></div><div id="cal-gates" class="cal-gates"></div><details class="cal-card cal-sim-settings" open><summary>Settings the simulation runs on</summary><div id="cal-mechs" class="cal-mechs"></div></details></div></div></div></div></div></div>`;
  const graph=$('#simulation-field'),robotGlyph=$('#field-robot'),estimateShape=$('#sim-estimate'),targetMark=$('#sim-target'),elementsLayer=$('#sim-elements');
  function svg(tag,attributes,text){const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;}
  let fieldArtKey='';
  // ---------------------------------------------------------------- zoom and pan
  // The viewBox is in SVG units (y down); pointer maths elsewhere goes through getScreenCTM, so editing
  // works the same at any zoom.
  let fitBox={x:-16,y:-9,w:168,h:172},floorSize={w:144,h:144},zoom={z:1,cx:68,cy:77},panning=null,spaceHeld=false,zoomDraw=false;
  // Pins and handles shrink as the field zooms in (by the square root), so they stay easy to grab without hiding what is near them.
  const marker=()=>1/Math.sqrt(zoom.z);
  // While zoomed in, a small copy of the whole field shows the part in view; click or drag it to look somewhere else.
  const minimap=svg('svg',{id:'sim-minimap',class:'sim-minimap',role:'group','aria-label':'Whole field. Click or drag to move the zoomed view.'}),miniFloor=svg('rect',{class:'field-floor',x:0,y:0}),miniUses=['#sim-overlay','#field-robot'].map(ref=>svg('use',{'data-ref':ref})),miniView=svg('rect',{class:'sim-minimap-view'});
  minimap.append(miniFloor,...miniUses,miniView);minimap.setAttribute('hidden','');graph.after(minimap);
  // The map shows while the view zooms or moves and fades 2 s after it stops, so it does not cover the route.
  // It stays while the left button is held on the field or the map, or the pointer is on the map; the 2 s start after.
  const mapWake={timer:0,held:false,over:false,view:''};
  function mapAwake(){minimap.classList.remove('asleep');clearTimeout(mapWake.timer);if(!mapWake.held&&!mapWake.over)mapWake.timer=setTimeout(()=>minimap.classList.add('asleep'),2000);}
  for(const target of [graph,minimap])target.addEventListener('pointerdown',e=>{if(e.button===0){mapWake.held=true;if(!minimap.classList.contains('asleep'))mapAwake();}},true);
  for(const type of ['pointerup','pointercancel'])addEventListener(type,e=>{if(e.button<=0&&mapWake.held){mapWake.held=false;if(!minimap.classList.contains('asleep'))mapAwake();}},true);
  minimap.addEventListener('pointerenter',()=>{mapWake.over=true;mapAwake();});minimap.addEventListener('pointerleave',()=>{mapWake.over=false;mapAwake();});
  function minimapView(w,h){const show=zoom.z>1.001&&project.view!=='3d';minimap.toggleAttribute('hidden',!show);
    // A zoom or pan wakes the map; redrawing the same view does not.
    const at=show?`${zoom.z} ${zoom.cx} ${zoom.cy}`:'';if(at!==mapWake.view){mapWake.view=at;if(show)mapAwake();}
    // The copies follow the field only while shown, so a fitted field does not pay for them.
    for(const u of miniUses){const ref=show?u.dataset.ref:null;if(u.getAttribute('href')!==ref)ref?u.setAttribute('href',ref):u.removeAttribute('href');}if(!show)return;
    const pad=Math.max(floorSize.w,floorSize.h)*.03;minimap.setAttribute('viewBox',`${-pad} ${-pad} ${floorSize.w+pad*2} ${floorSize.h+pad*2}`);miniFloor.setAttribute('width',floorSize.w);miniFloor.setAttribute('height',floorSize.h);
    for(const [k,v] of Object.entries({x:zoom.cx-w/2,y:zoom.cy-h/2,width:w,height:h}))miniView.setAttribute(k,v);}
  minimap.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();minimap.setPointerCapture(e.pointerId);const go=ev=>{const m=minimap.getScreenCTM();if(!m)return;const p=new DOMPoint(ev.clientX,ev.clientY).matrixTransform(m.inverse());zoom.cx=p.x;zoom.cy=p.y;applyZoom();};go(e);
    const move=ev=>{if(ev.pointerId===e.pointerId)go(ev);},end=ev=>{if(ev.pointerId!==e.pointerId)return;minimap.removeEventListener('pointermove',move);minimap.removeEventListener('pointerup',end);minimap.removeEventListener('pointercancel',end);};
    minimap.addEventListener('pointermove',move);minimap.addEventListener('pointerup',end);minimap.addEventListener('pointercancel',end);});
  minimap.addEventListener('wheel',e=>{e.preventDefault();zoomBy(Math.exp(-e.deltaY*(e.deltaMode===1?.05:.0015)));},{passive:false});
  function applyZoom(){const w=fitBox.w/zoom.z,h=fitBox.h/zoom.z;zoom.cx=Math.max(fitBox.x+w/2,Math.min(fitBox.x+fitBox.w-w/2,zoom.cx));zoom.cy=Math.max(fitBox.y+h/2,Math.min(fitBox.y+fitBox.h-h/2,zoom.cy));
    graph.setAttribute('viewBox',`${zoom.cx-w/2} ${zoom.cy-h/2} ${w} ${h}`);graph.dataset.zoomed=String(zoom.z>1.001);graph.style.setProperty('--line-scale',String(marker()));minimapView(w,h);
    for(const t of $$('.field-labels text')){t.dataset.size??=t.getAttribute('font-size');t.setAttribute('font-size',t.dataset.size/zoom.z);}if(!zoomDraw){zoomDraw=true;requestAnimationFrame(()=>{zoomDraw=false;draw();});}for(const b of $$('[data-zoom]'))b.disabled=b.dataset.zoom==='in'?zoom.z>=8:zoom.z<=1.001;}
  // Zoom by a factor, keeping the SVG point under (clientX, clientY) where it is.
  function zoomBy(factor,clientX,clientY){const m=graph.getScreenCTM(),z=Math.max(1,Math.min(8,zoom.z*factor));if(!m||z===zoom.z)return;const r=graph.getBoundingClientRect(),x=clientX??r.left+r.width/2,y=clientY??r.top+r.height/2,p=new DOMPoint(x,y).matrixTransform(m.inverse());
    zoom.cx=p.x+(zoom.cx-p.x)*zoom.z/z;zoom.cy=p.y+(zoom.cy-p.y)*zoom.z/z;zoom.z=z;applyZoom();}
  function fieldDrawing(){const b=geometry().bounds,w=L().field==='empty'?L().width:144,h=fieldHeight(),key=JSON.stringify([b,L().field,!!window.DeckThree?.drawDsimField,info?.fieldZones]);if(key===fieldArtKey)return;fieldArtKey=key;
    const margin=Math.max(w,h)*.075;fitBox={x:-margin*1.5,y:-margin*.5,w:w+margin*2,h:h+margin*2};floorSize={w,h};zoom={z:1,cx:fitBox.x+fitBox.w/2,cy:fitBox.y+fitBox.h/2};applyZoom();$('#sim-overlay').setAttribute('transform',`matrix(1 0 0 -1 0 ${h})`);
    const floor=$('.field-floor');floor.setAttribute('width',w);floor.setAttribute('height',h);$('.field-grid').replaceChildren();$('.field-labels').replaceChildren();
    const step=Math.max(12,Math.ceil(Math.max(w,h)/288)*24),font=Math.max(w,h)/48;
    for(let v=0;v<=w;v+=step){if(v>0&&v<w)$('.field-grid').append(svg('path',{d:`M${v} 0V${h}`}));$('.field-labels').append(svg('text',{x:v,y:h+font*2,'text-anchor':'middle','font-size':font},v));}
    for(let v=0;v<=h;v+=step){if(v>0&&v<h)$('.field-grid').append(svg('path',{d:`M0 ${h-v}H${w}`}));$('.field-labels').append(svg('text',{x:-font*1.5,y:h-v+font/2,'text-anchor':'end','font-size':font},v));}
    $('.field-labels').append(svg('text',{x:w/2,y:h+font*4,'text-anchor':'middle','font-size':font},'X · inches'));
    window.DeckFieldArt?.draw2d($('#sim-obstacles'),L().field,info,svg);
  }
  const pts=list=>list.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  const status=(id,text)=>{$(id).textContent=text;if(id==='#start-status'&&tab==='setup')$('#sim-model-status').textContent=text;};
  const inputValue=(id,value,committed=false)=>{const element=$(id);if(committed||document.activeElement!==element)element.value=value;window.DeckNumberSliders?.sync(element);};
  const pressed=(attr,value)=>{for(const b of $$(`[data-${attr}]`))b.setAttribute('aria-pressed',String(b.dataset[attr]===value));};

  // ------------------------------------------------------------------ engine
  // Nearest clear pose to the left-wall default, scanning inward and along the wall.
  function clearStart(g,heading=start.heading){
    // Nothing to check against while the engine reloads (info is cleared); callers fall back to the wall pose.
    if(!info)return null;
    const edge=field.edgePose(heading,g);let best=null,bestD=Infinity;
    for(let dx=0;dx<=48;dx+=2)for(let dy=-60;dy<=60;dy+=3){const p=field.constrain({x:edge.x+dx,y:edge.y+dy,heading},g),d=Math.hypot(p.x-edge.x,p.y-edge.y);
      if(d<bestD&&planner.safePose(p,info.fieldZones,info.footprint,info.bounds)){best=p;bestD=d;}}
    return best;
  }
  const engineConfig=()=>({mechanisms:L().field==='biobuzz'?project.mechanisms:{...project.mechanisms,enabled:false},kinematics:project.kinematics,alliance:L().alliance,field:L().field,width:L().width,height:L().height,elements:L().elements,start,controller:project.controller,timing:{...project.timing,power:project.tuning.maxPathSpeed??.8},robot:project.robot,zones:L().zones,sensors:{localization:project.sensors.localization},tuning:project.tuning});
  function load(){
    if(!native){info=null;draw();return Promise.resolve();}
    const seq=(load.seq=(load.seq||0)+1);loadError='';
    const operation=(async()=>{try{const next=await api.sim('load',engineConfig());if(seq!==load.seq)return;if(next.field!=='empty'){await three();if(seq!==load.seq)return;}info=next;timedPanel();
      const g=geometry();try{field.validate(start,g);}catch{start=field.constrain(start,g);preview={...start};}
      if(!L().start&&!planner.safePose(start,info.fieldZones,info.footprint,info.bounds)){const clear=clearStart(g);if(clear){start=clear;preview={...start};}}
      if(!planner.safePose(start,info.fieldZones,info.footprint,info.bounds))status('#start-status','The robot overlaps a field part here. Place it somewhere clear.');
      // The robot starts at the clear default spot automatically; dragging it moves it from there.
      if(!L().start){L().start={...start};save();}
      await api.sim('start',start);if(seq!==load.seq)return;fieldArtKey='';inputs(true);robotPanel();layoutPanel();draw();view3d?.setField(info,L());schedulePlan();
    }catch(e){if(seq===load.seq){loadError=e.message;status('#sim-run-status',e.message);}}})();loading=operation;return operation.finally(()=>{if(loading===operation)loading=null;});
  }
  let reloadTimer=null,reloadWaiters=[];
  async function reloadNow(){clearTimeout(reloadTimer);reloadTimer=null;const waiters=reloadWaiters.splice(0);try{await load();await placeModel();}finally{for(const resolve of waiters)resolve();}}
  function reload(){runAttempt++;clearTimeout(reloadTimer);load.seq=(load.seq||0)+1;info=null;loading=new Promise(resolve=>reloadWaiters.push(resolve));reloadTimer=setTimeout(()=>void reloadNow(),150);}
  async function ready(){if(!native)throw Error('Physics runs in the installed driver station app.');let pending;do{pending=loading;if(pending)await pending;}while(loading&&loading!==pending);if(!info)await load();if(!info)throw Error(loadError||'The simulation could not load.');}
  async function call(method,...args){await ready();return api.sim(method,...args);}
  if(native)api.onSim(message=>{
    if(!active)return;
    if(message.type==='frame'){liveFrame=message;runData?.record(message);if(runData&&!runData.live())return;frame=message;trailPoint(message);const key=pictureKey(message);if(key!==pictureKey.last){pictureKey.last=key;pictureKey.same=0;if(!glideAdd(message))paint();}else pictureKey.same=(pictureKey.same||0)+1;telemetry();return;}
    if(message.type==='run')runEvent(message);
    else if(message.type==='practice')practicePanel(message);
    else if(message.type==='optimize'&&optimizing&&optimize.layoutId===L().id)status('#sim-plan-status',`Test-driving route ${message.index+1} of ${message.total}…`);
    else if(message.type==='log'){logLines.push(...message.lines);logLines=logLines.slice(-200);$('#sim-log').textContent=logLines.join('\n');outputSummary();}
    else if(message.type==='cad-progress')importProgress=message;
    else if(message.type==='host-exit'){info=null;frame=null;runState='idle';if(message.error)status('#sim-run-status',message.error);transport();}
  });
  // What a frame shows on the field. Frames keep coming while the practice clock runs after the robot has stopped;
  // one that shows the same picture as the last is not drawn again.
  function pictureKey(f){
    const t=f.truth,m=f.mechanisms,c=m?.command;let k=`${t.x.toFixed(2)} ${t.y.toFixed(2)} ${t.heading.toFixed(1)} ${t.z||0} ${f.estimate?`${f.estimate.x.toFixed(2)} ${f.estimate.y.toFixed(2)}`:''} ${f.follower?.closest?.x} ${f.hit?.join()} ${m?JSON.stringify(m):''}`;
    if(c&&(c.intake||c.feed||c.spin))k+=f.time;for(const b of f.fieldState?.balls||[])k+=`|${b.id} ${b.pos.x.toFixed(1)} ${b.pos.y.toFixed(1)} ${(b.z||0).toFixed(1)} ${b.state?.kind}`;return k;
  }
  // Adds a frame's position to a trail, which starts again after a jump (a reset); returns the trail.
  function trailAdd(list,f){let last=list.at(-1);const t=f.truth;if(last&&Math.hypot(last.x-t.x,last.y-t.y)>12){list=[];last=null;}if(!last||Math.hypot(last.x-t.x,last.y-t.y)>.4||(f.estimate&&!last.e))list.push({x:t.x,y:t.y,e:f.estimate?{x:f.estimate.x,y:f.estimate.y}:null});if(list.length>3000)list.splice(0,1000);return list;}
  function trailPoint(f){trail=trailAdd(trail,f);}
  function appendRunLog(line){logLines.push(line);logLines=logLines.slice(-200);$('#sim-log').textContent=logLines.join('\n');outputSummary();}
  // Diagnostics' Run output card: how much the last run printed.
  function outputSummary(){const value=$('[data-diagview=output] .sim-diag-value');if(!value)return;const text=logLines.length?`${logLines.length} line${logLines.length===1?'':'s'}`:'No run yet';if(value.textContent!==text)value.textContent=text;}
  function runEvent(m){
    if(m.state==='starting'||m.state==='reset')glideStop();
    if(m.state==='starting'){if(videoReplay)videoReplay.cancel=true;runData?.reset();logLines=[];appendRunLog('Starting '+(m.kind||'autonomous')+'…');}
    else if(m.state==='running')appendRunLog('Running. Escape stops the autonomous and practice timer.');
    else if(m.state==='finished')appendRunLog(`Route finished in ${m.result?.time?.toFixed(2)||'?'} s · ${m.result?.violations?.length||0} zone contact(s).`);
    else if(m.state==='stopped')appendRunLog('Stopped by user.');
    else if(m.state==='error')appendRunLog(m.error||'Program error.');
    else if(m.state==='practice-finished')appendRunLog('Practice timer complete.');
    const err=$('#sim-error');
    if(m.state==='starting'){runState='starting';trail=[];lastReport=null;reportKey='';reviewLeg=null;err.hidden=true;status('#sim-run-status',m.kind==='source'?'Compiling and starting your program…':'Starting…');}
    else if(m.state==='running'){runState='running';status('#sim-run-status','Running.');}
    else if(m.state==='finished'){runState=frame?.practice?'running':'idle';const r=m.result,last=L().pins.at(-1);let text=`Finished in ${r.time.toFixed(2)} s.`;
      if(last&&['route','timed'].includes(r.kind))text+=` Ended ${Math.hypot(r.truth.x-last.x,r.truth.y-last.y).toFixed(2)} in from the last path’s end point.${r.kind==='timed'?' Timed drive has no position feedback.':''}`;
      text+=r.violations.length?` Touched ${r.violations.length} no-go zone${r.violations.length>1?'s':''}.`:' No zones touched.';status('#sim-run-status',text);}
    else if(m.state==='error'){runState='idle';status('#sim-run-status','The program stopped.');err.hidden=false;err.replaceChildren(Object.assign(document.createElement('p'),{textContent:m.error}),...(m.trace?.length?[Object.assign(document.createElement('pre'),{textContent:m.trace.join('\n')})]:[]));selectTab('run');}
    else if(m.state==='stopped'){runState='idle';status('#sim-run-status','Stopped.');}
    else if(m.state==='reset'){runState='idle';trail=[];status('#sim-run-status','Back at the starting pose.');}
    else if(m.state==='practice-finished'){runState='idle';status('#sim-run-status','Practice complete. Drive input is disabled.');}
    else if(m.state==='auto-time-limit'){status('#sim-run-status',`Autonomous reached its ${m.result.time.toFixed(1)} s limit before the program finished.`);}
    transport();videoCheck?.(m.state);
  }

  // ------------------------------------------------------------------ smooth motion
  // Frames arrive about 30 times a second, unevenly. While a run plays, the robot, its mechanisms and the pieces are
  // drawn at the display's own rate between the two frames around a moment about one frame behind the newest, so
  // they glide instead of stepping. Readouts and the trail keep following the newest frame (`frame`).
  const glide={list:[],shown:null,raf:0,clock:0,wall:0,arrived:0,gap:.033,late:0};
  const lerp=(a,b,u)=>a+(b-a)*u,lerpAngle=(a,b,u)=>a+((((b-a)%360)+540)%360-180)*u;
  // About one and a half frames of run time (frames are further apart in run time when the run plays faster), plus how
  // late frames have lately been arriving (a busy computer), which fades over a few seconds.
  const glideDelay=()=>Math.max(.03,glide.gap*1.5+glide.late);
  // Takes a new live frame; false when it does not play (paused, stopped, finished), which ends the glide.
  function glideAdd(f){
    if(!f.playing||!f.truth){glideStop();return false;}
    const l=glide.list,last=l.at(-1),now=performance.now();
    // Time going back a long way (a new run) or jumping far ahead starts over; a frame older than the newest is late
    // and left out; a frame sent again for the same moment replaces it.
    if(last&&f.time<last.time-1e-9&&f.time>last.time-.5)return true;
    if(last&&(f.time<last.time||f.time-last.time>.5))l.length=0;else if(last&&f.time-last.time<1e-9)l.pop();
    else if(last){glide.gap+=(Math.min(.15,f.time-last.time)-glide.gap)*.2;glide.late=Math.max(glide.late*.99,Math.min(.25,(now-glide.arrived)/1000*(f.speed||1)-(f.time-last.time)));}
    // Frames are kept from the one before the picture shown on, so a longer delay never runs out of them.
    l.push(f);while(l.length>2&&l[1].time<=glide.clock||l.length>64)l.shift();glide.arrived=now;
    // Starting again after a wait, it goes on from the picture it last showed rather than jumping to the new frame.
    if(!glide.raf){glide.wall=now;glide.clock=l.length>1?Math.max(l[0].time,Math.min(glide.clock,f.time)):f.time;glide.raf=requestAnimationFrame(glideStep);}
    return true;
  }
  function glideStop(){cancelAnimationFrame(glide.raf);glide.raf=0;glide.list.length=0;glide.shown=null;}
  function glideStep(now){
    const l=glide.list,newest=l.at(-1);if(!newest||!active){glideStop();return;}
    const speed=newest.speed||1,since=(now-glide.arrived)/1000*speed;
    // Nothing new for a while (the robot stands still, or frames are late): show the newest frame as it is and wait,
    // keeping the frames for the next one.
    if(since>Math.max(.15,glide.gap*4)&&glide.clock>=newest.time){glide.raf=0;glide.shown=null;paint();return;}
    // The 3D view draws this picture at once (asking for its own frame now would draw it one frame late).
    glide.raf=requestAnimationFrame(glideStep);
    // The clock runs at the run's speed, nudged towards about one frame behind the newest frame.
    const dt=Math.max(0,Math.min(.1,(now-glide.wall)/1000))*speed,target=newest.time+Math.min(glide.gap,since)-glideDelay();glide.wall=now;
    let t=glide.clock+dt*Math.max(.6,Math.min(1.4,1+(target-glide.clock)*3));if(Math.abs(target-t)>.5)t=target;
    t=Math.max(l[0].time,Math.min(newest.time,t));glide.clock=t;
    const k=l.findIndex(f=>f.time>t);glide.shown=k<0?newest:k===0?l[0]:between(l[k-1],l[k],(t-l[k-1].time)/(l[k].time-l[k-1].time));
    paint();if(project.view==='3d')view3d?.draw();
  }
  // The picture between two frames: pose, estimate, mechanism angles and pieces in between; the rest is the later frame's.
  function between(a,b,u){
    const pose=(p,q)=>p&&q?{...q,x:lerp(p.x,q.x,u),y:lerp(p.y,q.y,u),heading:lerpAngle(p.heading,q.heading,u)}:q;
    const truth={...pose(a.truth,b.truth),z:lerp(a.truth.z||0,b.truth.z||0,u),vx:lerp(a.truth.vx,b.truth.vx,u),vy:lerp(a.truth.vy,b.truth.vy,u),omega:lerp(a.truth.omega,b.truth.omega,u)};
    const m=a.mechanisms,n=b.mechanisms,mechanisms=m&&n?{...n,...(finite(n.turret)?{turret:lerpAngle(m.turret??n.turret,n.turret,u)}:{}),...(n.turrets?{turrets:n.turrets.map((v,i)=>finite(v)?lerpAngle(m.turrets?.[i]??v,v,u):v)}:{}),...(n.ramps?{ramps:n.ramps.map((v,i)=>finite(v)?lerp(m.ramps?.[i]??v,v,u):v)}:{}),...(n.deploy?{deploy:n.deploy.map((v,i)=>finite(v)?lerp(m.deploy?.[i]??v,v,u):v)}:{})}:n;
    // Joint angles and slides; a spinning part's angle wraps, so each takes the short way round.
    const joints=a.joints&&b.joints?Object.fromEntries(Object.entries(b.joints).map(([k,v])=>{const w=a.joints[k];return [k,finite(v)&&finite(w)?lerpAngle(w,v,u):Array.isArray(v)&&Array.isArray(w)?v.map((x,i)=>finite(x)&&finite(w[i])?lerpAngle(w[i],x,u):x):v];})):b.joints;
    const was=new Map((a.fieldState?.balls||[]).map(x=>[x.id,x])),balls=b.fieldState?.balls?.map(x=>{const y=was.get(x.id);return !y||y.state?.kind!==x.state?.kind?x:{...x,pos:{...x.pos,x:lerp(y.pos.x,x.pos.x,u),y:lerp(y.pos.y,x.pos.y,u)},z:lerp(y.z||0,x.z||0,u)};});
    return {...b,time:lerp(a.time,b.time,u),truth,estimate:pose(a.estimate,b.estimate),mechanisms,joints,...(b.fieldState?{fieldState:{...b.fieldState,balls}}:{})};
  }

  // ------------------------------------------------------------------ drawing
  function robotPose(f=frame){return tab==='plan'||!f?preview:{x:f.truth.x,y:f.truth.y,heading:f.truth.heading};}
  // Pieces on the 2D field: one circle each, kept and moved rather than rebuilt with every frame. Each circle keeps
  // what it was last given, so a frame sets only what changed and reads nothing back from the page.
  const pieceCircles=new Map();
  function pieces(list){
    const seen=new Set();
    for(const p of list){const key=String(p.id);seen.add(key);let c=pieceCircles.get(key);if(!c||c.node.parentNode!==elementsLayer){c={node:svg('circle',{}),last:{}};elementsLayer.append(c.node);pieceCircles.set(key,c);}
      for(const k in p){if(k==='id')continue;const v=p[k];if(c.last[k]!==v){c.last[k]=v;c.node.setAttribute(k,String(v));}}}
    for(const [k,c] of pieceCircles)if(!seen.has(k)){c.node.remove();pieceCircles.delete(k);}
  }
  // Draws the run's moving parts as the frame shown now has them: the glide's picture while a run plays.
  function paint(){
    const f=glide.shown||frame;
    if(project.view==='3d'&&view3d){view3d.update(f,state3d());return;}
    pieces((f?.fieldState?.balls||[]).filter(b=>!['held','stock','scored'].includes(b.state?.kind)).map(b=>({id:b.id,cx:b.pos.x+72,cy:b.pos.y+72,r:L().field==='biobuzz'?(b.color==='yellow'?1.4:1.8):2.5,fill:{yellow:'#f2d14b',red:'#e2564d',blue:'#007be1',purple:'#a568ce',green:'#69bd74'}[b.color]||'#dadada',stroke:'#17191c','stroke-width':'.25','data-element':b.id})));
    // Attributes are set only when they change: setting one, even to the same value, makes the page lay out again.
    const set=(n,k,v)=>{v=String(v);if(n.getAttribute(k)!==v)n.setAttribute(k,v);};
    const p=robotPose(f);set(robotGlyph,'transform',`translate(${p.x} ${fieldHeight()-p.y}) rotate(${-p.heading})`);
    const e=f?.estimate;set(estimateShape,'points',e?pts(planner.body(e,geometry().footprint)):'');
    const c=f?.follower?.closest;set(targetMark,'cx',c?c.x:-99);set(targetMark,'cy',c?c.y:-99);
    // No-go zones the robot touches turn red; looked up only when that changes (draw() rebuilds the zones and clears it).
    const hit=f?.hit?.join()||'';if(paint.hit!==hit){paint.hit=hit;for(const z of $$('#sim-zones [data-zone]'))z.classList.toggle('hit',!!f?.hit?.includes(z.dataset.zone));}
  }
  function draw(){
    $('#sim-grab-cursor')?.remove();if(graph.dataset.dragging){const x=preview.x-startGrab.dx,y=preview.y-startGrab.dy;$('#sim-overlay').append(svg('path',{id:'sim-grab-cursor',d:`M${x-1.8} ${y}h3.6M${x} ${y-1.8}v3.6`,class:'sim-grab-cursor'}));}
    const g=geometry(),fp=g.footprint,l=L(),b=g.bounds;
    fieldDrawing();
    graph.dataset.field=l.field;graph.dataset.placing=String(tool==='start'&&active);graph.dataset.mode=tool;
    const rect=robotGlyph.querySelector('rect'),image=$('#sim-robot-image'),pic=model?.picture;
    rect.setAttribute('x',-fp.rear);rect.setAttribute('y',-fp.half);rect.setAttribute('width',fp.front+fp.rear);rect.setAttribute('height',2*fp.half);
    robotGlyph.classList.toggle('has-model',!!pic);
    // With mechanisms: the red outline is the chassis, each intake's box is outlined in the intake colour and
    // each shooter is a dotted circle in its piece colour. (This drawing's y points to the robot's right.)
    for(const n of robotGlyph.querySelectorAll('.sim-glyph-part'))n.remove();
    const mech=project.mechanisms,robot=project.robot;
    if(mech.enabled){const hl=robot.length/2,hw=robot.width/2;rect.setAttribute('x',-hl);rect.setAttribute('y',-hw);rect.setAttribute('width',2*hl);rect.setAttribute('height',2*hw);
      for(const i of mech.intakes)for(const e of i.sides){const along=e==='front'||e==='back',span=Math.min(i.width??(along?robot.width:robot.length),along?robot.width:robot.length),depth=Math.max(i.reach,1),out=(along?hl:hw)+i.reach;
        const box=e==='front'?{x:out-depth,y:-span/2,width:depth,height:span}:e==='back'?{x:-out,y:-span/2,width:depth,height:span}:e==='left'?{x:-span/2,y:-out,width:span,height:depth}:{x:-span/2,y:out-depth,width:span,height:depth};
        robotGlyph.append(svg('rect',{...box,class:'sim-glyph-part sim-glyph-intake'}));}
      for(const s of mech.shooters){const [fx,fy]=MECH.MOUNT_AT[s.mount];robotGlyph.append(svg('circle',{cx:fx*(hl-3),cy:-fy*(hw-3),r:2.6,class:`sim-glyph-part sim-glyph-shooter ${s.pieces}`}));}}
    if(pic){image.setAttribute('href',pic.url);image.setAttribute('x',pic.x0);image.setAttribute('y',-pic.y1);image.setAttribute('width',pic.x1-pic.x0);image.setAttribute('height',pic.y1-pic.y0);}else image.setAttribute('width',0);
    for(const [k,v] of Object.entries({x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0}))$('#sim-walls').setAttribute(k,v);
    const sel=selected?.kind==='zone'&&zoneById(selected.id);
    $('#sim-zones').replaceChildren(...l.zones.map(z=>zoneShape(z,sel===z?' selected':'')),...(sel?handles(sel).map(h=>svg('circle',{class:'sim-handle',cx:h.x,cy:h.y,r:1.4*marker()})):[]));paint.hit=null;
    $('#sim-route').replaceChildren(...onionShapes(),...(l.route?routeShapes(l.route):[]),...controlShapes());$('#sim-preview-row').hidden=!l.route;drawPreview();
    $('#sim-pins').replaceChildren(...l.pins.map((p,i)=>{const n=svg('g',{class:'sim-pin'+(selected?.kind==='pin'&&selected.index===i?' selected':'')+(p.wait>0||p.action?' stop':'')+(diagnostics.some(q=>q.pin===i)?' blocked':'')+(reviewing(i)?' reviewing':''),transform:`translate(${p.x} ${p.y}) scale(${marker()})`,'data-pin':i});
      // A pin that turns the robot shows the heading it turns to.
    if(finite(p.turn)){const h=l.route?.stops[i]?.turn??p.turn;n.append(svg('path',{class:'sim-pin-turn',d:`M0 0L${(5.2*Math.cos(h*Math.PI/180)).toFixed(2)} ${(5.2*Math.sin(h*Math.PI/180)).toFixed(2)}`}));}
      n.append(svg('circle',{r:2.8}),svg('text',{y:1.1,transform:'scale(1 -1)','text-anchor':'middle'},i+1));return n;}));
    drawRun(true);
    $('#field-coordinates').textContent=`X ${field.round(preview.x)} in · Y ${field.round(preview.y)} in · ${field.round(preview.heading)}°`;
    $('#field-help').textContent={start:'Press and drag the robot to move its starting pose. Arrow keys move 1 inch; Enter places; Escape cancels.',select:'Drag any robot, pin or obstacle to edit this field. New objects are added only with the tools in their own tab.',rect:'Drag on the field to draw a box the robot must avoid.',circle:'Press at the centre, then drag outwards to set the circle radius.',triangle:'Press where the base goes and drag: the tip follows your cursor.',draw:'Drag along the field to draw the route. It becomes pins kept out of red areas. Starting near the end of the route extends it; starting elsewhere replaces it.',shape:'Tap to add corners; the outline closes back to the first corner as you go. Two corners make a wall. Press Enter or Finish shape to confirm.',pin:'Click where the robot should go next. The whole footprint must fit inside the field.'}[tool]||'';
    if(targetPick)$('#field-help').textContent='Click the field target to aim at. Escape cancels target selection.';
    pressed('tool',tool);
  }
  // What a new frame changes on the 2D field: the trail, the starting outline and the robot. Everything else changes
  // with edits (draw), so frames do not rebuild the whole field.
  function drawRun(force=false){
    const key=`${trail.length}|${trail.at(-1)?.x}|${trail.at(-1)?.y}|${!!frame}|${tool}`;
    if(force||drawRun.key!==key){drawRun.key=key;const est=trail.filter(t=>t.e).map(t=>t.e);
      $('#sim-trail').replaceChildren(...(trail.length>1?[svg('polyline',{class:'sim-trail',points:pts(trail)})]:[]),...(est.length>1?[svg('polyline',{class:'sim-trail estimate',points:pts(est)})]:[]));
      $('#sim-start').setAttribute('points',frame&&tool!=='start'?pts(planner.body(start,geometry().footprint)):'');}
    paint();
  }
  function inputs(keepTyped=false){const b=geometry().bounds;$('#start-x').dataset.sliderMax=b.x1;$('#start-y').dataset.sliderMax=b.y1;for(const key of ['x','y','heading']){if(keepTyped&&$('#start-'+key).dataset.typed)continue;inputValue('#start-'+key,String(Math.round(start[key]*100)/100));}}
  function telemetry(){
    // At most ~8 updates a second (2 while the picture stands still, when only the clock moves), but never drop the
    // last frame (a paused simulation sends no more).
    const now=performance.now(),wait=(pictureKey.same>15?500:120)-(now-(telemetry.at||0));clearTimeout(telemetry.timer);
    if(wait>0){telemetry.timer=setTimeout(telemetry,wait);return;}telemetry.at=now;
    const f=frame,rows=[];if(!f){$('#sim-telemetry').replaceChildren();return;}
    const t=f.truth,e=f.estimate,r=v=>v.toFixed(1),add=(k,v,cls)=>rows.push([k,v,cls]);
    practicePanel(f.practice);refreshDiagnostics();
    add('Time',`${f.time.toFixed(2)} s${f.playing?'':' · paused'}`);
    add('Robot',`${r(t.x)}, ${r(t.y)} in · ${Math.round(((t.heading%360)+360)%360)}°`);add('Speed',`${r(Math.hypot(t.vx,t.vy))} in/s`);
    if(e)add('Sensor estimate',`off by ${Math.hypot(e.x-t.x,e.y-t.y).toFixed(2)} in`);if(f.execution==='timed')add('Autonomous','Timed power + IMU · no X/Y feedback');
    if(f.acting)add('Action path',f.acting);
    if(f.wait)add('Paused at end of path',`${f.wait.action||'Pause'} · ${f.wait.remaining.toFixed(1)} s left`);
    else if(f.mode==='program'&&f.follower)add('Route',`leg ${f.telemetry?.leg||f.telemetry?.Leg||Math.max(1,f.follower.pathIndex+1)}${finite(f.follower.remaining)?` · ${r(f.follower.remaining)} in to go`:''}`);
    // Whether the run has ended comes from the latest frame, so replaying an earlier moment keeps the report.
    const last=liveFrame||f,done=!!(last.result||last.practice?.phase==='finished'),box=$('#sim-run-analysis');box.hidden=!done||!runData?.frames().length;if(done&&runData&&runState!=='starting')runReport();
    if(f.mechanisms){const m=f.mechanisms;add('Pieces',`${m.held} held · ${m.shots} shot`);if(project.mechanisms.shooter.type!=='none')add('Flywheel',`${Math.round(m.flywheel*100)}%${m.ready?' · ready':''}`);const turrets=project.mechanisms.shooters.flatMap((s,n)=>s.type==='turret'&&!s.sharesTurret?[n]:[]);turrets.forEach(n=>add(turrets.length>1?`Turret ${n+1}`:'Turret',`${Math.round(m.turrets?.[n]??m.turret)}°${m.aligned?' · on target':''}`));if(finite(m.score))add('Score',`${m.score} pts · ${m.tips} tip${m.tips===1?'':'s'}`);}
    add('Zones',f.hit.length?'Touching a no-go zone':f.violations.length?`Touched ${f.violations.length} this run`:'Clear',f.hit.length||f.violations.length?'warn':'');
    // The running program's own telemetry, as a Driver Station would show it.
    if(f.mode==='program'&&f.telemetry)for(const [k,v] of Object.entries(f.telemetry).slice(0,10))add(k,String(v).slice(0,60));
    $('#sim-telemetry').replaceChildren(...rows.flatMap(([k,v,cls])=>[Object.assign(document.createElement('dt'),{textContent:k}),Object.assign(document.createElement('dd'),{textContent:v,className:cls||''})]));
    if(project.view!=='3d')drawRun();transport();
  }
  function transport(){
    videoCheck?.();
    $('#sim-play').textContent=frame?.playing?'Pause':'Play';{const paused=!frame?.playing&&runState==='running',b=$('#sim-pause'),label=paused?'Resume':'Pause';if(b.dataset.icon!==label){b.dataset.icon=label;b.innerHTML=`<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paused?'M8 5v14l11-7z':'M7 5h4v14H7zM13 5h4v14h-4z'}"/></svg>`;b.setAttribute('aria-label',label);b.title=label;}}
    for(const id of ['#sim-play','#sim-stop','#sim-reset','#sim-speed'])$(id).disabled=!native;
    $('#sim-play').disabled=!native||(!frame?.practice&&runState!=='running')||frame?.practice?.phase==='finished';$('#sim-pause').disabled=$('#sim-play').disabled||runState!=='running';
    $('#sim-run').disabled=!native||runState==='starting'||optimizing;$('#sim-optimize').disabled=!native||optimizing;
    runReadiness();
  }
  // What Run will do, under Run: the sensors it follows the route with, or what is missing first. Route checks call it too.
  function runReadiness(){
    const canFollow=C.sensors[project.sensors.localization].translation,teleop=project.practice.mode==='teleop';$('#sim-run-readiness').textContent=teleop?'Controller practice uses this setup’s robot, field and physical game elements.':canFollow?'The Deck controller follows this route using your selected odometry and IMU. Press Escape to stop.':'Timed power + IMU heading hold. There is no X/Y feedback; compare the actual endpoint against your planned pins.';$('#sim-run-sensors').hidden=canFollow||teleop||project.program.kind==='route';
    // A route program with nothing to drive yet points back to Path planning instead of failing on Run.
    const noRoute=!teleop&&['route','opmode'].includes(project.program.kind)&&!L().pins.length,blocked=routeBlocked();$('#sim-run-plan').hidden=!noRoute&&!blocked;if(noRoute)$('#sim-run-readiness').textContent='No route yet. Add at least one path in Path planning, then press Run here.';
    // ...and so does a route that cannot be driven yet, naming the path to fix.
    else if(blocked)$('#sim-run-readiness').textContent=`The route cannot run yet: ${blocked.pin!==null?`path ${blocked.pin+1} has a problem`:'it has a problem'} to fix in Path planning.`;
    // What Run plays is chosen under Export, so the Run column says when it is not the planned route.
    if(!teleop&&project.program.kind!=='route')$('#sim-run-readiness').textContent+=` Run plays ${project.program.kind==='opmode'?'the OnBot Java export':'your Java program'}: change it under Export → What Run plays.`;
    // Only something to act on shows in the Run column: no route, a route to fix, or a program other than the route.
    $('#sim-run-readiness').classList.toggle('sim-routine',!noRoute&&!blocked&&(teleop||project.program.kind==='route'));
    resultsPanel();
  }

  // Open one path in Path planning's list, from a run report or diagnostic.
  function editPath(i){selectTab('plan');setStep('pins');[...$('#sim-route-step').querySelectorAll('[role=tab]')].find(b=>b.textContent==='Paths')?.click();choosePath(i);}
  // The run report: rebuilt when a run ends and while its last pieces land, not on every frame.
    function runReport(){
    const frames=runData.frames(),end=[...frames].reverse().find(f=>f.result)?.result,m=frames.at(-1)?.mechanisms,key=JSON.stringify([runAttempt,frames[0]?.time,end?.time,end?.reason,m?.score,m?.landed,m?.shots]);if(key===reportKey)return;reportKey=key;
    const report=lastReport=window.DeckSimReport.build(frames,{pins:L().pins,defaultPower:project.tuning.maxPathSpeed,autoSeconds:project.practice.mode==='teleop'?null:project.practice.autoSeconds,optimized:!!L().tested?.length,whole:project.practice.mode==='teleop'});
    if(reportShown!==runAttempt)reviewLeg=null;
    window.DeckSimReport.render($('#sim-run-report'),report,{onEdit:editPath,onSeek:t=>runData.seek(t),onExport:()=>showRunView(1),onOutput:()=>{showDiag('output');showRunView(2);},onSetting:openSetting,
      selected:reviewLeg?.index??null,onSelect:leg=>{const changed=reviewLeg?.pin!==leg.pin;reviewLeg={index:leg.index,pin:leg.pin};if(changed)draw();}});
    // A new run's report: Results shows it from the top, or its tab is marked when another view is open.
    videoTab();if(report&&reportShown!==runAttempt){reportShown=runAttempt;const results=runViews?.panes[0];if(runViews?.shown()===0)results.pane.scrollTop=0;else results?.button.classList.add('has-news');}
    stageMarks();
  }
  // Route-check messages say "pin", the planner's word (and Run reads the number from it); the panels say path and end point.
  const plainWords=m=>String(m).replace(/\b(The p|the p|P|p)ath to pin (\d+)/g,(_,a,n)=>(/^[TP]/.test(a)?'Path ':'path ')+n)
    .replace(/\bpins? (\d+)/g,'end point $1').replace(/\bPin (\d+)/g,'End point $1').replace(/\bat a pin\b/g,'at an end point').replace(/\bpins\b/g,'end points');
  // The first thing stopping Run from driving the planned route ({message, pin}), or null: a route check that failed
  // or a plan error. Only when Run plays a route; teleop and Java programs do not need one.
  function routeBlocked(){
    if(project.practice.mode==='teleop'||!['route','opmode'].includes(project.program.kind)||!L().pins.length||analysisPending)return null;
    const issue=diagnostics.find(d=>d.pin!==null)||diagnostics[0];
    return issue?{message:plainWords(issue.message),pin:issue.pin??null}:planError?{message:plainWords(planError),pin:blockedPin>=0?blockedPin:null}:null;
  }
  // A path the route check or the planner flagged; its row in the path list glows amber.
  const pathNeedsChange=i=>diagnostics.some(d=>d.pin===i)||!!planError&&blockedPin===i;
  // A Route options setting a run report tip names (Optimize, Space around obstacles): open it in Path planning,
  // on the page of the view that holds it when short screens split it, and focus it.
  function openSetting(key){
    const el=$(key==='optimize'?'#sim-optimize':'#sim-clearance');selectTab('plan');setStep('pins');[...$('#sim-route-step').querySelectorAll('[role=tab]')].find(b=>b.textContent==='Route options')?.click();
    requestAnimationFrame(()=>{const unit=el.closest('.sim-settings-unit'),bar=unit?.parentElement?.querySelector(':scope>.sim-section-pages');
      if(unit&&bar)for(const pager of [bar.firstElementChild,bar.lastElementChild])for(let i=0;i<8&&unit.hidden&&!pager.disabled;i++)pager.click();
      el.scrollIntoView({block:'nearest'});el.focus();});
  }
  function showRunView(i){if(!runViews)return;runViews.choose(i);runViews.panes[i].pane.scrollTop=0;}
  // Results before a run: what Run does in this practice mode and what this view will show. Once the run's clock
  // moves, the replay and graphs take its place, and the report joins them when the route ends.
  function resultsPanel(){
    if(!resultsReady)return;const frames=runData?.frames()||[],ran=runState!=='idle'||frames.length>1&&frames.at(-1).time-frames[0].time>.05;
    resultsReady.hidden=ran;replayBox.hidden=!ran;if(ran)return;
    const mode=project.practice.mode,auto=project.practice.autoSeconds,est=routeEstimate(),kind=project.program.kind,blocked=routeBlocked(),noRoute=mode!=='teleop'&&['route','opmode'].includes(kind)&&!L().pins.length;
    const title=blocked?'Fix the route before running it':mode==='teleop'?'Ready to practise teleop':mode==='match'?'Ready for a full match':'Ready to test your autonomous';
    const text=blocked?blocked.message:mode==='teleop'?'Press Run and drive with your controller. Speed, heading and mechanisms are graphed here as you drive.':`Press Run. The robot drives ${kind==='route'?'your route':kind==='opmode'?'the OnBot Java export':'your Java program'} with physics, then this shows whether it finished, the points it scored and where its ${auto} seconds went.${mode==='match'?' Teleop follows, driven with your controller.':''}`;
    const note=blocked?'Run drives the planned route, so it cannot start until every path is clear. Diagnostics → Route checks lists every issue.':noRoute?'No route yet. Add at least one path in Path planning first.':est?.time&&mode!=='teleop'?`Path planning’s test drive took about ${est.time.toFixed(1)} s${est.time>auto?`, longer than the ${auto} s autonomous`:''}.`:'';
    const key=JSON.stringify([title,text,note,blocked?.pin]);if(resultsReady.dataset.key===key)return;resultsReady.dataset.key=key;resultsReady.classList.toggle('blocked',!!blocked);
    const go=blocked||noRoute?[Object.assign(document.createElement('button'),{type:'button',className:blocked?'primary':'secondary',textContent:blocked?.pin!=null?`Fix path ${blocked.pin+1} →`:'Go to Path planning',onclick:()=>blocked?.pin!=null?editPath(blocked.pin):$('#sim-run-plan').click()})]:[];
    resultsReady.replaceChildren(Object.assign(document.createElement('h3'),{textContent:title}),Object.assign(document.createElement('p'),{textContent:text}),...(note?[Object.assign(document.createElement('p'),{className:'hint',textContent:note})]:[]),...go);
  }
  // The stage tabs' number rings say what is done (green), what needs changing (amber) and what is still missing
  // (red), so the next step is plain from any tab: Setup while the robot still needs measurements, Path planning
  // with no paths yet, a path with a problem or a route that will not fit the autonomous, Run & review after a run,
  // from its report. The boxes to fill in or change glow the same red or amber.
  // A number the simulation cannot use (empty, or outside what its box allows: a 0 lb robot, 2000 mm wheels) glows red and
  // holds every later setup step, Path planning and Run until it is fixed. Returns the first step holding the rest, or null.
  // Boxes that may be left empty (a PIDF the SDK fills in) are only checked once they hold a number.
  var SETUP_ORDER=['field','robot','mechanisms','controller'],SETUP_NAMES={field:'Field',robot:'CAD',controller:'Chassis',mechanisms:'Mechanisms'};
  var SETUP_REQUIRED=new Set(['sim-field-width','sim-field-height','sim-length','sim-width','sim-height','sim-mass','sim-rpm','sim-wheel','sim-maxspeed']);
  const unusable=i=>{if(i.validity.badInput)return true;if(i.value==='')return SETUP_REQUIRED.has(i.id);const v=i.valueAsNumber,min=parseFloat(i.min),max=parseFloat(i.max);return !finite(v)||finite(min)&&v<min||finite(max)&&v>max;};
  function setupGate(){let held=null;if(!SETUP_ORDER)return null;
    for(const step of SETUP_ORDER){const page=document.querySelector(`[data-setup-page=${step}]`),tabButton=$(`#sim-setup-step-${step}`);if(!page||!tabButton)continue;
      const after=held!==null;tabButton.disabled=after;tabButton.title=after?`Fix the red value in ${SETUP_NAMES[held]} first`:'';
      let bad=0;for(const i of page.querySelectorAll('input[type=number]')){const h=i.closest('[hidden]'),wrong=(!h||h===page)&&!i.disabled&&unusable(i);i.classList.toggle('sim-bad-input',wrong);i.toggleAttribute('aria-invalid',wrong);bad+=wrong;}
      if(step==='robot'&&project.needsCad&&!project.model)bad++;
      for(const b of page.querySelectorAll('.sim-setup-nav .primary')){b.disabled=after||bad>0;b.title=b.disabled?'Fix the value marked red first':'';}
      if(!held&&bad)held=step;}
    for(const name of ['plan','run','video']){const b=$(`.sim-tabs [data-tab=${name}]`);if(b){b.disabled=!!held;if(held)b.title=`Finish setup first: ${SETUP_NAMES[held]} has a value marked red`;}}
    return held;}
  function stageMarks(){
    const est=L().route&&!diagnostics.length?routeEstimate():null,auto=project.practice.autoSeconds;
    for(const row of $$('#sim-pin-list .sim-path-row'))row.classList.toggle('needs-change',pathNeedsChange(Number(row.dataset.path)));
    const plan=!L().pins.length?['incomplete','No paths yet: add one']:diagnostics.length||planError?['attention',`${diagnostics.length||1} route issue${diagnostics.length>1?'s':''} to fix`]:
      est?.time>auto?['attention',`The route takes about ${est.time.toFixed(1)} s, longer than the ${auto} s autonomous`]:est&&(est.violations>0||est.miss>1.5)?['attention','The test drive touched something or missed the end point']:
      L().route&&!analysisPending?['done',`Route planned and checked${est?.time?` · about ${est.time.toFixed(1)} s`:''}`]:null;
    const run=lastReport&&!$('#sim-run-analysis').hidden?[lastReport.level==='ok'?'done':'attention',`Last run: ${lastReport.title}`]:null;
    const held=setupGate(),check=unconfirmed();
    const setup=held?['incomplete',held==='robot'&&project.needsCad&&!project.model?'CAD: import your robot’s CAD':`${SETUP_NAMES[held]}: a value is not usable (red)`]:check.length?['attention',`Check the robot’s ${check.map(k=>NEEDS[k][1]).join(', ').replace(/, ([^,]*)$/,' and $1')}`]:['done','Field, robot, controller and mechanisms set'];
    stepMarks(held,check);
    for(const [k,s] of Object.entries({setup,plan,run})){const b=$(`.sim-tabs [data-tab=${k}]`),[state,note]=s||['',''];if(!b||b.dataset.state===state&&b.title===note)continue;
      b.dataset.state=state;b.title=note;note?b.setAttribute('aria-description',note):b.removeAttribute('aria-description');}
  }
  // Each Setup step tab is red or amber when something on it needs changing, with what and a button to it, so the Setup
  // ring is never amber without showing where: a red value holds the steps after it; the robot's mass, wheel size and RPM
  // glow amber until checked (a CAD has none); more motors or servos than the game allows is red on Mechanisms.
  function stepMarks(held,check){
    const marks={};if(held)marks[held]=held==='robot'&&project.needsCad&&!project.model?['incomplete','Import your robot’s CAD (Import CAD…, or drop its file): its size, drivetrain and mechanisms come from it.',()=>$('#sim-model-open')]:['incomplete','A value marked red is not usable.',()=>$(`[data-setup-page=${held}] .sim-bad-input`)];
    const limits=project.controller==='ftc'&&window.DeckWiring?window.DeckWiring.state(project).problems:[],over=limits.find(p=>p.level==='limit'),unsure=limits.find(p=>p.check);if(over&&!marks.mechanisms)marks.mechanisms=['incomplete',over.text,()=>$('#mech-count')];else if(unsure&&!marks.mechanisms)marks.mechanisms=['attention',unsure.text,()=>$('#mech-count')];
    {const byStep={};for(const k of check)(byStep[$(NEEDS[k][0]).closest('[data-setup-page]').dataset.setupPage]||=[]).push(k);
      for(const [step,keys] of Object.entries(byStep))if(!marks[step])marks[step]=['attention',`Your CAD has no ${keys.map(k=>NEEDS[k][1]).join(', ').replace(/, ([^,]*)$/,' or $1')}: check the amber box${keys.length>1?'es':''} (click and leave ${keys.length>1?'each':'it'} to keep the number).`,()=>$(NEEDS[keys[0]][0])];}
    for(const step of SETUP_ORDER){const b=$(`#sim-setup-step-${step}`),[state,note]=marks[step]||['',''];if(!b)continue;b.dataset.state=state;if(!b.disabled)b.title=note;}
    const box=$('#sim-setup-flags'),list=Object.entries(marks).filter(([step,[state]])=>!(step==='mechanisms'&&held!=='mechanisms'));if(!box)return;const key=JSON.stringify(list.map(([s,[st,t]])=>[s,st,t]));if(box.dataset.key===key)return;box.dataset.key=key;box.hidden=!list.length;
    box.replaceChildren(...list.map(([step,[state,text,target]])=>{const b=document.createElement('button');b.type='button';b.className=`sim-setup-flag ${state}`;b.innerHTML='<b></b> <span></span>';b.querySelector('b').textContent=SETUP_NAMES[step]+':';b.querySelector('span').textContent=text;
      b.onclick=()=>{showSetupStep(step);requestAnimationFrame(()=>{const el=target();if(el){el.scrollIntoView({block:'center'});el.focus?.({preventScroll:true});}});};return b;}));}
  function diagnosticBox(id){const box=document.createElement('section');box.id=id;box.className='sim-diagnostics';return box;}
  const diagnosticPages={};
  function refreshDiagnostics(){
    if(analysisPending){try{diagnostics=planner.analyze({...planRequest(L().style).project,start:graph.dataset.dragging?preview:start},geometry().footprint,info?.fieldZones||[],geometry().bounds);}catch(e){diagnostics=[{pin:null,code:'setup',message:e.message}];}}
    const banner=$('#sim-live-status');if(banner){banner.hidden=tab!=='plan';banner.classList.toggle('has-issues',diagnostics.length>0);const est=!diagnostics.length&&!analysisPending&&L().route?routeEstimate():null,auto=project.practice.autoSeconds,late=est?.time>auto,missed=est&&(est.violations>0||est.miss>1.5);if(est&&!diagnostics.length)banner.classList.toggle('has-issues',!!(late||missed||est.error));
    const timing=!est?'':est.pending?' · test-driving for a time estimate…':est.error?` · test drive did not finish: ${est.error}`:`${missed?' · test drive touched something or missed the end point':''} · about ${est.time.toFixed(1)} s in simulation${late?`, longer than the ${auto} s autonomous`:''}`;
    const more=banner.getAttribute('aria-expanded')==='true'?' · Hide details':' · Details';
    banner.textContent=diagnostics.length?`${diagnostics.length} route issue${diagnostics.length>1?"s":""} · ${diagnostics.filter(d=>d.pin!==null).map(d=>'Path '+(d.pin+1)).filter((p,i,a)=>a.indexOf(p)===i).join(', ')||'Starting pose'}${more}`:analysisPending?'Analyzing route…':L().pins.length?`Route checks passed${timing}${more}`:'Add paths to check your route';}
    const warnings=[];if(!C.sensors[project.sensors.localization].translation&&L().pins.some(p=>['spin','turn','relative','start','track'].includes(p.path?.rotate)))warnings.push('Turning while driving with IMU-only sensing can accumulate large X/Y errors. Add odometry for accurate curves or stop and turn at pins.');
    for(const [i,p] of L().pins.entries())if((p.path?.power??project.tuning.maxPathSpeed)===0)warnings.push(`Path to pin ${i+1} has zero motor power. It will stop the autonomous until you change power and restart.`);
    // Contact: a no-go zone the robot sits in, a wall or part it is pushing while running, or contacts the last
    // run made after leaving its start pose (the run report's count; starting against the wall is normal).
    const touching=frame?.hit?.length||runState==='running'&&frame?.contacts?.length,events=lastReport?lastReport.contacts.length+(frame?.violations?.length&&!lastReport.contacts.some(c=>c.kind==='zone')?frame.violations.length:0):(frame?.violations?.length||0)+(frame?.contactEvents||0);
    if(touching||events)warnings.push(`Chassis contact: ${touching?'currently touching a wall or no-go area':`${events} contact event(s) during this run`}. Increase clearance or reduce path power.`);
    // Diagnostics → Route checks counts what it lists, so issues show without opening it.
    const checks=$('[data-diagview=checks] .sim-diag-value'),count=diagnostics.length+warnings.length,label=analysisPending?'Checking…':count?`${count} to look at`:!L().pins.length?'No paths yet':L().route?'All clear':'Planning…';
    if(checks&&checks.textContent!==label){checks.textContent=label;checks.parentElement.dataset.state=count?'warn':label==='All clear'?'ok':'';}
    stageMarks();runReadiness();
    for(const id of ['#sim-plan-diagnostics','#sim-run-diagnostics']){const box=$(id);if(!box)continue;const key=JSON.stringify([diagnostics,warnings,analysisPending,L().pins.length,!!L().route,diagnosticPages[id]||0]);if(box.dataset.content===key)continue;box.dataset.content=key;const head=document.createElement('h3');head.textContent=analysisPending?'Analyzing route…':diagnostics.length?`${diagnostics.length} route issue${diagnostics.length>1?"s":""}`:'Route checks';const legend=document.createElement('p');legend.className='hint';legend.textContent='Numbered markers on the field are path end points: red has a clearance or path issue, amber pauses or runs an action, plain only drives. Power is a limit, not a guaranteed speed.';
      // Run & review's copy scrolls, so it lists everything, under its card's own title.
      const runBox=id==='#sim-run-diagnostics',list=document.createElement('ul'),size=runBox?1e6:innerHeight<650?1:2,entries=[...diagnostics,...warnings.map(message=>({pin:null,code:'warning',message}))],pages=Math.ceil(entries.length/size),page=Math.max(0,Math.min(pages-1,diagnosticPages[id]||0));for(const issue of entries.slice(page*size,(page+1)*size)){const item=document.createElement('li');item.className=issue.code==='warning'?'hint warn':'sim-issue';item.textContent=plainWords(issue.message);if(issue.pin!==null){const jump=document.createElement('button');jump.type='button';jump.className='text-button';jump.textContent=`Edit path ${issue.pin+1}`;jump.onclick=()=>editPath(issue.pin);item.append(jump);}list.append(item);}
      if(!diagnostics.length&&!analysisPending){const item=document.createElement('li');if(L().route)item.className='sim-clear';item.textContent=L().pins.length?L().route?'Every end point and planned movement keeps the robot clear.':'Pin footprints checked. Planning route movements…':'Add paths to check their movements.';list.append(item);}box.replaceChildren(...runBox?[list]:[head,legend,list]);if(pages>1){const nav=document.createElement('div');nav.className='sim-pin-pages';const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');prev.textContent='← Previous';next.textContent='Next →';prev.disabled=page===0;next.disabled=page===pages-1;prev.type=next.type='button';prev.className=next.className='secondary';label.textContent=`${page*size+1}–${Math.min(entries.length,(page+1)*size)} of ${entries.length}`;prev.onclick=()=>{diagnosticPages[id]=page-1;refreshDiagnostics();};next.onclick=()=>{diagnosticPages[id]=page+1;refreshDiagnostics();};nav.append(prev,label,next);box.append(nav);}
    }
  }
  function liveEdit(robot=false){L().route=null;planError='';blockedPin=-1;planSeq++;analysisPending=true;refreshDiagnostics();draw();if(!robot)schedulePlan();}
  // ------------------------------------------------------------------ editing
  function changed(what){
    if(['zones','pins','start','robot','field','plan'].includes(what)){L().route=null;L().tested=null;planSeq++;planError='';blockedPin=-1;analysisPending=true;refreshDiagnostics();}
    save();draw();if(what==='zones'&&native&&info)void api.sim('zones',L().zones).catch(()=>{});zonePanel();pinPanel();tested();schedulePlan();
  }
  // ------------------------------------------------------------------ undo
  // Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes Path planning edits: the starting pose, pins and their
  // paths, obstacles and route settings. Every save compares them with the last save, so each committed
  // edit is one step. Each field of each setup keeps its own history while the app is open.
  const PLAN_KEYS=['start','zones','pins','clearance','style','rotate'],planHistories=new Map();let lastPlan=null;
  const planKey=()=>{const l=L();return [project.setupId,l.id,l.field,l.width,l.height].join('|');},planState=()=>JSON.stringify(PLAN_KEYS.map(k=>L()[k]??null));
  function planHistory(key=planKey()){if(!planHistories.has(key))planHistories.set(key,{undo:[],redo:[]});return planHistories.get(key);}
  function recordPlan(){if(drag?.moved||graph?.dataset.dragging)return;const key=planKey(),state=planState();
    if(lastPlan?.key===key&&lastPlan.state!==state){const h=planHistory(key);h.undo.push(lastPlan.state);if(h.undo.length>100)h.undo.shift();h.redo=[];}lastPlan={key,state};}
  function stepPlan(back){
    if(effects.session||optimizing)return;recordPlan();const h=planHistory(),from=back?h.undo:h.redo;
    if(!from.length)return status('#sim-plan-status',back?'Nothing to undo.':'Nothing to redo.');
    (back?h.redo:h.undo).push(planState());const state=JSON.parse(from.pop());PLAN_KEYS.forEach((k,i)=>{L()[k]=state[i];});lastPlan={key:planKey(),state:planState()};
    // Keep the open path or selected obstacle when it still exists, so its handles stay on screen.
    const kept=selected?.kind==='zone'?L().zones.some(z=>z.id===selected.id):['pin','path'].includes(selected?.kind)&&!!L().pins[selected.index];
    if(L().start)start=L().start;preview={...start};if(!kept)selected=null;drag=null;pointer=null;stroke=null;targetPick=null;inputs();robotPanel();
    changed('zones');if(native&&info)void api.sim('start',start).catch(()=>{});status('#sim-plan-status',back?'Undid the last change.':'Redid the change.');
  }
  document.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();if(!active||tab!=='plan'||!(event.ctrlKey||event.metaKey)||event.altKey||!['z','y'].includes(key))return;
    if(document.querySelector('dialog[open]')||event.target.closest?.('input,textarea,select,[contenteditable]'))return;
    event.preventDefault();
    // While a custom shape is being drawn, undo takes back its last corner first.
    if(key==='z'&&!event.shiftKey&&tool==='shape'&&sketch){sketch.pop();if(!sketch.length)sketch=null;showDraft(null);return;}
    stepPlan(key==='z'&&!event.shiftKey);
  });
  function commit(pose){
    const g=geometry(),next=field.validate(pose,g);
    if(info&&!planner.safePose(next,[...info.fieldZones,...L().zones],info.footprint,info.bounds))throw Error('That spot overlaps an obstacle. Choose a clear position outside the red boundary.');
    start=next;preview={...start};tool=planningStep==='start'?'start':'select';pointer=null;for(const key of ['x','y','heading'])delete $('#start-'+key).dataset.typed;inputs();L().start=start;
    let saved=save();try{localStorage.setItem(field.KEY,field.serialize(start,g));}catch{saved=false;}
    status('#start-status',saved?'Starting pose saved.':'Starting pose set for this session. Device storage is unavailable.');
    changed('start');if(native&&info)void api.sim('start',start).catch(e=>status('#start-status',e.message));
  }
  // A new heading pivots the starting pose along any wall it sits against, then steps clear of obstacles.
  function turnStart(angle){
    const p=field.turn(start,angle,geometry());if(!info||validPin(p,p.heading))return p;
    const clear=nearestPin(p,24,p.heading);return clear?{...p,...clear}:p;
  }
  function toField(event){const m=graph.getScreenCTM();if(!m)return null;const p=graph.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const l=p.matrixTransform(m.inverse());return {x:l.x,y:fieldHeight()-l.y};}
  function validPin(p,heading=start.heading){const g=geometry();return planner.safePose({...p,heading},[...(info?.fieldZones||[]),...L().zones],g.footprint,g.bounds);}
  function pinPosition(p,fallback){const q=field.constrain({...p,heading:start.heading},geometry()),r=field.constrain({x:field.round(q.x),y:field.round(q.y),heading:start.heading},geometry());return validPin(r)?{x:r.x,y:r.y}:fallback||{x:p.x,y:p.y};}
  // Pins tapped or dragged into a red area move to the nearest spot where the whole robot fits,
  // searched in growing half-inch rings so the first ring with a clear spot holds the closest one.
  function nearestPin(p,limit=36,heading=start.heading){
    const g=geometry(),snap=q=>{const c=field.constrain({...q,heading},g);return {x:field.round(c.x),y:field.round(c.y)};},first=snap(p);if(validPin(first,heading))return first;
    for(let r=.5;r<=limit;r+=.5){let best=null;const n=Math.max(8,Math.ceil(4*Math.PI*r));
      for(let i=0;i<n;i++){const a=2*Math.PI*i/n,q=snap({x:p.x+r*Math.cos(a),y:p.y+r*Math.sin(a)}),d=Math.hypot(q.x-p.x,q.y-p.y);if((!best||d<best.d)&&validPin(q,heading))best={...q,d};}
      if(best)return {x:best.x,y:best.y};}
    return null;
  }
  const dist2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  // Ramer-Douglas-Peucker: keep the points that carry the drawing's shape within `tolerance` inches.
  function simplify(points,tolerance){if(points.length<3)return points.slice();const a=points[0],b=points.at(-1);let worst=0,index=0;
    for(let i=1;i<points.length-1;i++){const d=Math.abs((b.x-a.x)*(a.y-points[i].y)-(a.x-points[i].x)*(b.y-a.y))/(dist2(a,b)||1);if(d>worst){worst=d;index=i;}}
    return worst>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[a,b];}
  // A drawn stroke becomes route pins: simplified, each moved clear of red areas. Starting near the
  // end of the current route extends it; starting anywhere else replaces the pins.
  function drawnPath(points){
    const l=L(),end=l.pins.at(-1)||start;if(points.length<2||dist2(points[0],points.at(-1))<2)return status('#sim-plan-status','Drag a longer path to draw the route.');
    const extend=l.pins.length&&dist2(points[0],end)<=12;let keep=[];for(let tolerance=2;tolerance<64;tolerance*=1.5){keep=simplify(points,tolerance);if(keep.length-1+(extend?l.pins.length:0)<=32)break;}
    const pins=[];for(const q of keep.slice(1)){const c=nearestPin(q);if(c&&!pins.some(p=>dist2(p,c)<1))pins.push({x:c.x,y:c.y,wait:0,action:''});}
    if(!pins.length)return status('#sim-plan-status','No clear spot along that path: the whole robot must fit inside the field and outside red areas.');
    l.pins=extend?l.pins.concat(pins).slice(0,32):pins.slice(0,32);selected=null;changed('pins');
    status('#sim-plan-status',`${extend?'Added':'Drew'} ${pins.length} pin${pins.length>1?'s':''} from your path. Planning…`);
  }
  function hit(p){
    const c=controlHit(p);if(c)return c;
    const l=L();for(let i=l.pins.length-1;i>=0;i--)if(Math.hypot(l.pins[i].x-p.x,l.pins[i].y-p.y)<=3.2*marker())return {kind:'pin',index:i};
    const z0=selected?.kind==='zone'&&zoneById(selected.id);if(z0){const i=handles(z0).findIndex(h=>Math.hypot(h.x-p.x,h.y-p.y)<=2.2*marker());if(i>=0)return {kind:'handle',id:z0.id,index:i};}
    const near=(q,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(q.x-a.x-dx*t,q.y-a.y-dy*t);};
    for(let i=l.zones.length-1;i>=0;i--){const z=l.zones[i],poly=planner.polygon(z);if(poly.length===2?near(p,poly[0],poly[1])<=1.5:planner.contains(p,poly))return {kind:'zone',id:z.id};}
    return null;
  }
  const zoneById=id=>L().zones.find(z=>z.id===id);
  function draftZone(a,b){
    if(tool==='circle')return {id:'zone-'+Date.now().toString(36),type:'circle',x:a.x,y:a.y,radius:Math.max(.25,Math.hypot(b.x-a.x,b.y-a.y))};
    if(tool==='triangle')return {id:'zone-'+Date.now().toString(36),type:'triangle',...triangleFrom(a,b)};
    return {id:'zone-'+Date.now().toString(36),type:tool,x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:Math.max(.5,Math.abs(b.x-a.x)),height:Math.max(.5,Math.abs(b.y-a.y)),angle:0};
  }
  // A triangle pressed at its base and pulled to its tip: it turns, flips and stretches with the cursor.
  function triangleFrom(base,tip,width){const h=Math.max(.5,Math.hypot(tip.x-base.x,tip.y-base.y)),angle=Math.atan2(tip.y-base.y,tip.x-base.x)*180/Math.PI-90;
    return {x:(base.x+tip.x)/2,y:(base.y+tip.y)/2,height:h,width:Math.max(.5,width??h),angle:((angle%360)+360)%360};}
  // Drag handles for the selected zone: box corner, circle edge, triangle tip, shape corners.
  function handles(z){
    if(z.type==='circle')return [{x:z.x+z.radius,y:z.y,set:p=>({radius:Math.max(.5,Math.hypot(p.x-z.x,p.y-z.y))})}];
    if(z.type==='polygon')return z.points.map((q,i)=>({x:q.x,y:q.y,set:p=>({points:z.points.map((r,j)=>j===i?{x:p.x,y:p.y}:r)})}));
    const a=(z.angle||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),world=(lx,ly)=>({x:z.x+lx*c-ly*sn,y:z.y+lx*sn+ly*c}),local=p=>({x:(p.x-z.x)*c+(p.y-z.y)*sn,y:-(p.x-z.x)*sn+(p.y-z.y)*c});
    if(z.type==='rect')return [{...world(z.width/2,z.height/2),set:p=>{const l=local(p);return {width:Math.max(1,2*Math.abs(l.x)),height:Math.max(1,2*Math.abs(l.y))};}}];
    const base=world(0,-z.height/2);return [{...world(0,z.height/2),set:p=>triangleFrom(base,p,z.width)}];
  }
  // Dashed outlines of the robot at its new heading wherever a turning route turns in place.
  function turnGhosts(route){if(!route.turns||!route.footprint)return [];const out=[];let heading=route.heading;
    for(const s of route.segments){if(Number.isFinite(s.heading)&&Math.abs(((s.heading-heading)%360+540)%360-180)>.5)out.push(svg('polygon',{class:'sim-turn-ghost',points:pts(planner.body({...s.points[0],heading:s.heading},route.footprint))}));heading=s.endHeading??s.heading??heading;}
    return out;}
  // The route path by path: action paths dashed in the action colour, and a mark halfway along each
  // path the robot turns or spins along. data-path is the pin each path leads to.
  const bez=(points,t)=>{let p=points;while(p.length>1)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));return p[0];};
  const segmentPoints=s=>Array.from({length:25},(_,j)=>bez(s.points,j/24));
  const pathOf=(l,k)=>l.pins[k]?.path||{kind:'regular',rotate:'keep'};
  // The path the run report has chosen, marked on the field while Run & review shows that report.
  function reviewing(k){return tab==='run'&&!!lastReport&&reviewLeg?.pin===k&&!$('#sim-run-analysis').hidden;}
  function routeShapes(route){
    const l=L(),to=exporter.pathIndex(route),out=[],marks=new Map();
    route.segments.forEach((s,i)=>{const k=to[i],path=pathOf(l,k),points=segmentPoints(s);
      const appearance=planner.pathAppearance(path,project.tuning.maxPathSpeed),line=svg('polyline',{class:'sim-path'+(path.kind==='action'?' action':'')+(['path','pin'].includes(selected?.kind)&&selected.index===k?' selected':'')+(reviewing(k)?' reviewing':''),points:pts(points),'data-path':k,role:'button','aria-label':`Path ${k+1}:${planner.pathDescription(path,project.tuning.maxPathSpeed).join('; ')}`});
      line.style.stroke=appearance.color;out.push(line);
      if(path.rotate!=='keep'&&!route.nonholonomic){for(const t of [.25,.75]){const p=bez(s.points,t),h=planner.headingAt(s,t)*Math.PI/180,dx=Math.cos(h),dy=Math.sin(h),end={x:p.x+4*dx,y:p.y+4*dy};out.push(svg('path',{class:'sim-heading-arrow',stroke:appearance.color,d:`M${p.x} ${p.y}L${end.x} ${end.y}m${-1.5*dx+dy} ${-1.5*dy-dx}L${end.x} ${end.y}l${-1.5*dx-dy} ${-1.5*dy+dx}`}));}}
      if(!marks.has(k))marks.set(k,[]);marks.get(k).push(...points);});
    if(!route.nonholonomic)for(const [k,points] of marks){const path=pathOf(l,k);if(path.rotate==='keep')continue;const mid=points[Math.floor(points.length/2)];
      const label=path.rotate==='tangent'?'Along path':path.rotate==='reverse'?'Backwards':path.rotate==='spin'?`${path.spins>0?'↺':'↻'}${Math.abs(path.spins)}`:path.rotate==='relative'?`${path.angle>=0?'+':''}${path.angle}°`:path.rotate==='track'?'Track':path.rotate==='start'?'Start heading':`${Math.round(path.heading)}°`;
      out.push(svg('text',{class:'sim-path-mark',x:mid.x.toFixed(2),y:(-mid.y-2).toFixed(2),transform:'scale(1 -1)','text-anchor':'middle'},label));
      if(path.rotate==='track'&&path.target){const t=path.target;out.push(svg('circle',{class:'sim-aim-target',cx:t.x,cy:t.y,r:2}),svg('path',{class:'sim-aim-target',d:`M${t.x-3} ${t.y}h6M${t.x} ${t.y-3}v6`}));}}
    out.push(...turnGhosts(route));return out;
  }
  // Custom curves (Pedro Pathing style): the open path's Bezier control points are drawn as handles with
  // guide lines from the path's ends, and can be dragged. The planner drives the curve exactly as drawn.
  const pathStart=i=>i>0?L().pins[i-1]:start;
  // The robot's outline every few inches along the open path, at the heading it has there.
  function onionShapes(){const i=openPath(),route=L().route,fp=route?.footprint;if(tab!=='plan'||i<0||!route||!fp)return [];const to=exporter.pathIndex(route),parts=route.segments.filter((_,k)=>to[k]===i),out=[];let since=Infinity,prev=null;
    for(const s of parts)for(let j=0;j<=40;j++){const t=j/40,p=bez(s.points,t);if(prev)since+=Math.hypot(p.x-prev.x,p.y-prev.y);prev=p;if(since<8&&!(s===parts.at(-1)&&j===40))continue;since=0;
      const h=planner.headingAt(s,t);out.push(svg('polygon',{class:'sim-onion',points:pts(planner.body({...p,heading:finite(h)?h:finite(route.heading)?route.heading:start.heading},fp))}));}
    return out.slice(0,60);}
  // Route preview (Paths step): the scrubber moves a robot outline along the planned route, without physics.
  let previewAt=0,previewCache=null,previewTimer=0;
  function previewPath(){const route=L().route;if(!route)return null;if(previewCache?.route!==route){const fp=route.footprint||geometry().footprint;previewCache={route,fp,poses:planner.previewPoses(route,fp,start)};}return previewCache.poses.length?previewCache:null;}
  function previewPose(){const c=previewPath();if(!c)return null;const p=c.poses,last=p.at(-1),s=previewAt/1000*last.s;let lo=0,hi=p.length-1;while(lo<hi){const m=(lo+hi)>>1;if(p[m].s<s)lo=m+1;else hi=m;}
    const b=p[lo],a=p[Math.max(0,lo-1)],t=b.s>a.s?(s-a.s)/(b.s-a.s):1,mix=k=>a[k]+(b[k]-a[k])*t;
    return {x:mix('x'),y:mix('y'),heading:mix('heading'),d:mix('d'),total:last.d,path:b.path,turning:!!b.turning,fp:c.fp,act:previewAct(b,finite(b.act)?(finite(a.act)&&a.action===b.action?mix('act'):b.act):null)};}
  // What the previewed robot is doing at a pose: a pause ('wait'), the game's shoot/intake/spin/aim or a team action
  // ('custom'), with progress 0..1 at a pin or null while driving. Shooting and aiming point at the hive cell on
  // BIOBUZZ, elsewhere straight out of the shooter.
  function previewAct(pose,progress){if(pose.action===undefined)return null;const kind=pose.action?MECH.action(pose.action).kind:'wait',m=MECH.sanitize(project.mechanisms),l=L();
    const aims=kind==='shoot'||kind==='aim'||kind==='spin',fixed=m.enabled&&m.shooters.length?m.shooters.map(s=>({mount:s.mount,facing:s.type==='fixed'?MECH.FACING[s.facing]||0:null})):[{mount:'center',facing:null}];
    return {kind,name:pose.action||'Pause',progress,target:aims&&(l.field==='biobuzz'||m.target)?MECH.target(m,l.field,l.alliance,pose.cell):null,shooters:fixed,
      intakes:m.enabled&&m.intakes.length?[...new Set(m.intakes.flatMap(i=>i.sides))]:['front'],dims:{length:project.robot.length,width:project.robot.width}};}
  function drawPreview(){const q=tab==='plan'&&previewAt>0&&previewPose(),act=q?.act;
    $('#sim-preview-note').textContent=q?`Path ${q.path+1}${act?' · '+act.name:q.turning?' · turning':''} · ${field.round(q.d)} of ${field.round(q.total)} in`:'';
    // The path card being previewed is marked in the list.
    for(const li of $$('#sim-pin-list .sim-path-row'))li.classList.toggle('previewing',!!q&&li.dataset.path===String(q.path));
    if(project.view==='3d')view3d?.update(frame,state3d());
    if(!q)return $('#sim-preview-ghost').replaceChildren();const r=q.heading*Math.PI/180;
    $('#sim-preview-ghost').replaceChildren(svg('polygon',{class:'sim-preview-robot'+(act?' acting':''),points:pts(planner.body(q,q.fp))}),svg('path',{class:'sim-preview-heading',d:`M${q.x.toFixed(2)} ${q.y.toFixed(2)}L${(q.x+Math.cos(r)*q.fp.front).toFixed(2)} ${(q.y+Math.sin(r)*q.fp.front).toFixed(2)}`}),...previewActShapes(q));}
  // The 2D outline's action: pieces flying to the goal along a dashed aim line, the intake side lit, or a ring for a pause.
  function previewActShapes(q){const a=q.act;if(!a)return [];const h=q.heading*Math.PI/180,c=Math.cos(h),s=Math.sin(h),at=(ox,oy)=>({x:q.x+ox*c-oy*s,y:q.y+ox*s+oy*c}),out=[];
    const k=a.progress??(performance.now()/900)%1;
    if(a.kind==='wait'||a.kind==='custom')out.push(svg('circle',{class:'sim-preview-act',cx:q.x,cy:q.y,r:(Math.max(q.fp.front,q.fp.rear,q.fp.half)+2+3*k).toFixed(2),'stroke-opacity':(1-k).toFixed(2)}));
    if(a.kind==='intake')for(const side of a.intakes){const along=side==='front'||side==='back',sign=side==='front'||side==='left'?1:-1,reach=(along?(sign>0?q.fp.front:q.fp.rear):q.fp.half)+1.5,span=along?q.fp.half:Math.max(q.fp.front,q.fp.rear);
      const e=along?[at(sign*reach,-span),at(sign*reach,span)]:[at(-span,sign*reach),at(span,sign*reach)];out.push(svg('polyline',{class:'sim-preview-act intake',points:pts(e)}));}
    if(a.kind==='shoot'||a.kind==='aim')for(const sh of a.shooters){const [ox,oy]=MECH.mountOffset(sh.mount,a.dims),o=at(ox,oy),dir=h+(sh.facing??0)*Math.PI/180,g=sh.facing===null&&a.target?a.target:{x:o.x+Math.cos(dir)*48,y:o.y+Math.sin(dir)*48};
      out.push(svg('polyline',{class:'sim-preview-act aim',points:pts([o,g])}));
      if(a.kind==='shoot')for(let n=0;n<3;n++){const f=(k*3+n/3)%1;out.push(svg('circle',{class:'sim-preview-piece',cx:(o.x+(g.x-o.x)*f).toFixed(2),cy:(o.y+(g.y-o.y)*f).toFixed(2),r:1.6}));}}
    return out;}
  function previewStop(){cancelAnimationFrame(previewTimer);previewTimer=0;$('#sim-preview-play').replaceChildren(Object.assign(document.createElement('span'),{ariaHidden:'true',textContent:'▶'}),' Preview');}
  function controlShapes(){const i=openPath(),q=L().pins[i],c=q?.path?.controls;if(tab!=='plan'||!c?.length)return [];const a=pathStart(i),out=[];
    out.push(svg('polyline',{class:'sim-control-guide',points:pts([a,c[0]])}),svg('polyline',{class:'sim-control-guide',points:pts([c.at(-1),q])}));if(c.length>2)out.push(svg('polyline',{class:'sim-control-guide',points:pts(c)}));
    if(!L().route||planError)out.push(svg('polyline',{class:'sim-path draft'+(diagnostics.some(d=>d.pin===i)?' blocked':''),points:pts(Array.from({length:33},(_,j)=>bez([a,...c,q],j/32)))}));
    c.forEach((h,j)=>out.push(svg('circle',{class:'sim-control'+(drag?.kind==='control'&&drag.control===j?' active':''),cx:h.x,cy:h.y,r:1.8*marker(),'data-control':j,role:'button','aria-label':`Path ${i+1} curve handle ${j+1}: drag to shape the curve`})));return out;}
  function controlHit(p){const i=openPath(),c=L().pins[i]?.path?.controls;if(tab!=='plan'||!c)return null;const m=graph.getScreenCTM(),reach=Math.max(2.4,9/(m?Math.hypot(m.a,m.b):1));
    for(let j=c.length-1;j>=0;j--)if(Math.hypot(c[j].x-p.x,c[j].y-p.y)<=reach)return {kind:'control',index:i,control:j};return null;}
  // Handles for a new custom curve keep the shape the robot drives now: the planned curve's own control
  // points when the path is one cubic, otherwise points a third and two thirds along the straight line.
  function startControls(i){const l=L(),a=pathStart(i),b=l.pins[i],route=l.route;
    if(route){const to=exporter.pathIndex(route),parts=route.segments.filter((_,k)=>to[k]===i);if(parts.length===1&&parts[0].points.length===4)return parts[0].points.slice(1,3).map(p=>({x:field.round(p.x),y:field.round(p.y)}));}
    return [1/3,2/3].map(t=>({x:field.round(a.x+(b.x-a.x)*t),y:field.round(a.y+(b.y-a.y)*t)}));}
  // The path (by the pin it leads to) under a field point, if the route passes within reach.
  function pathHit(p,reach=1.8){const route=L().route;if(!route)return null;const matrix=graph.getScreenCTM();reach=Math.max(reach,7/(matrix?Math.hypot(matrix.a,matrix.b):1));const to=exporter.pathIndex(route);let best=null;
    route.segments.forEach((s,i)=>{const q=segmentPoints(s);for(let j=1;j<q.length;j++){const a=q[j-1],b=q[j],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);if(d<=reach&&(!best||d<best.d))best={d,index:to[i]};}});
    return best&&{kind:'path',index:best.index};}
  // ------------------------------------------------------------ pin and path settings
  // Right-click (or press and hold) a pin or a path to open its settings. The simulator only plans and
  // drives the movement; each named action becomes a slot in the exported code for the team's own
  // mechanism code (RobotActions.java on a Control Hub, robot_actions.py on MotionModule).
  const effects={index:-1,session:null},tooltip=document.createElement('div');
  tooltip.id='sim-path-tooltip';tooltip.className='sim-path-tooltip';tooltip.role='tooltip';tooltip.hidden=true;root.append(tooltip);
  root.append($('#sim-effects'));
  let targetPick=null;
  function clampEditor(box,x,y){box.style.left=`${Math.max(4,Math.min(innerWidth-box.offsetWidth-4,x))}px`;box.style.top=`${Math.max(4,Math.min(innerHeight-box.offsetHeight-4,y))}px`;}
  window.addEventListener('resize',()=>{const b=$('#sim-effects');if(!b.hidden)clampEditor(b,parseFloat(b.style.left)||4,parseFloat(b.style.top)||4);});
  function openEffects(target,at,reuse=false){
    if(optimizing||effects.session&&!reuse)return;
    const l=L(),k=target.index;if(!l.pins[k])return;
    if(!reuse)effects.session=window.DeckSimEditor.begin(l,target);
    const p=effects.session.draft;targetPick=null;tooltip.hidden=true;p.path=planner.pathEffects(p.path);
    const box=$('#sim-effects'),isPath=target.kind==='path',path=p.path,holonomic=C.drives[project.robot.drivetrain].holonomic;
    effects.index=k;selected={kind:target.kind,index:k};box.setAttribute('aria-label',isPath?'Path settings':'Pin settings');
    const title=isPath?`Path ${k+1}`:`Pin ${k+1}`;
    box.innerHTML=`<div class="sim-pop-head" title="Drag to move this editor"><h3>${title}</h3><span class="sim-editor-grip" aria-label="Drag editor" title="Drag editor">⠿</span></div>
      <div class="sim-settings-tabs" role="tablist" aria-label="${isPath?'Path':'Pin'} settings"></div>
      <section class="sim-pop-sec" data-sec="main">${isPath?`
        <label class="check"><input id="eff-power-inherit" type="checkbox"> Use setup motor power</label>
        <label for="eff-path-power">Motor power · 0–1</label><input id="eff-path-power" type="number" min="0" max="1" step="any">
        <p class="hint">Applies to this entire path. 0 stops here; 0.5 caps motor power at 50%.</p>
        <label for="eff-path-shape">Path shape</label><select id="eff-path-shape"><option value="">Use route default</option><option value="sharp">Straight segments</option><option value="spline">Smooth spline</option><option value="custom">Custom curve (drag handles)</option></select>
        <h4 class="sim-pop-label">While driving this path</h4><div class="sim-steps" id="eff-steps"></div>`:`
        <ol class="sim-pop-steps"><li>Arrive (and turn, if set)</li><li>Pause</li><li>Run the steps, in order</li><li>Drive on</li></ol>
        <label for="eff-wait">Pause first · s</label><input id="eff-wait" type="number" min="0" step="any">
        <h4 class="sim-pop-label">Then, in order</h4><div class="sim-steps" id="eff-steps"></div>
        <p class="hint">Power, shape, heading and the steps while driving are in Path options.</p>`}</section>
      <section class="sim-pop-sec" data-sec="heading" hidden>
        <label for="eff-heading-mode">${isPath?'While driving this path':'Turn in place at this pin'}</label>
        <select id="eff-heading-mode"><option value="keep">${isPath?'Hold inherited heading':'No turn'}</option><option value="relative">Turn by… (relative)</option><option value="${isPath?'turn':'absolute'}">Face field heading…</option><option value="start">Return to starting heading</option><option value="track">${isPath?'Track a field target':'Aim at a field target'}</option>${isPath?'<option value="spin">Full spins</option><option value="tangent">Face along the path (tangent)</option><option value="reverse">Face backwards along the path</option>':''}</select>
        <div data-angle><label for="eff-angle">Turn by · ° (+ left, − right)</label><input id="eff-angle" type="number" step="any"></div>
        <div data-absolute><label for="eff-absolute">Field heading · °</label><input id="eff-absolute" type="number" step="any"></div>
        <div data-spins><label for="eff-spins">Full spins (+ left, − right)</label><input id="eff-spins" type="number" step="1"></div>
        <div data-target><div class="sim-grid2"><div><label for="eff-target-x">Target X · in</label><input id="eff-target-x" type="number" step="any"></div><div><label for="eff-target-y">Target Y · in</label><input id="eff-target-y" type="number" step="any"></div></div><button type="button" class="secondary" id="eff-pick-target">Pick target on field</button></div>
        <p class="hint">${isPath?'The final heading carries into later paths until another turn changes it. Tracking faces the target throughout the actual curve.':'Relative turns use the heading on arrival. The resulting heading carries into later paths.'}</p>
      </section>
      <section class="sim-pop-sec" data-sec="notes" hidden><label for="eff-note">${isPath?'What this path does':'What happens at this pin'}</label><textarea id="eff-note" rows="3" maxlength="160"></textarea></section>
      <p class="sim-editor-save-note" role="status">Draft · press Done to save</p><div class="button-row"><button type="button" class="text-button" data-reset>${isPath?'Reset path modifiers':'Reset pin modifiers'}</button><button type="button" class="primary" data-close>Done</button></div>`;
    const q=sel=>box.querySelector(sel),subject=isPath?path:p,mode=q('#eff-heading-mode');
    mode.value=isPath?path.rotate:finite(p.turn)?p.turnMode||'absolute':'keep';
    q('#eff-angle').value=isPath?path.angle:p.turnMode==='relative'?p.turn:90;q('#eff-absolute').value=isPath?path.heading:p.turn??start.heading;q('#eff-spins').value=path.spins;
    const t=subject.target||{x:geometry().bounds.x1/2,y:geometry().bounds.y1-8};q('#eff-target-x').value=t.x;q('#eff-target-y').value=t.y;
    q('#eff-note').value=subject.note||'';
    const show=()=>{for(const [sel,key] of [['[data-angle]','relative'],['[data-absolute]',isPath?'turn':'absolute'],['[data-spins]','spin'],['[data-target]','track']])q(sel).hidden=mode.value!==key;
      if(isPath){q('#eff-power-inherit').checked=!finite(path.power);q('#eff-path-power').disabled=!finite(path.power);q('#eff-path-power').value=path.power??project.tuning.maxPathSpeed??.8;}};
    const commit=()=>{if(isPath)p.path=planner.pathEffects(path);show();if(!box.hidden)clampEditor(box,parseFloat(box.style.left)||4,parseFloat(box.style.top)||4);};
    const readNumber=(id,assign,min=-Infinity,max=Infinity)=>{q(id).onchange=e=>{const v=e.target.valueAsNumber;if(!finite(v)||v<min||v>max){e.target.setCustomValidity(`Enter a finite value${finite(min)?' from '+min:''}${finite(max)?' to '+max:''}.`);e.target.reportValidity();return;}e.target.setCustomValidity('');assign(v);commit();};};
    mode.onchange=()=>{const m=mode.value;if(m!=='track')targetPick=null;if(isPath)path.rotate=m;else{p.turnMode=m==='keep'?'absolute':m;p.turn=m==='keep'?null:m==='relative'?Number(q('#eff-angle').value)||0:m==='absolute'?Number(q('#eff-absolute').value)||0:0;}
      if(m==='track')subject.target={x:Number(q('#eff-target-x').value),y:Number(q('#eff-target-y').value)};commit();};
    if(isPath&&!holonomic)for(const option of mode.options)option.disabled=option.value!=='keep';
    readNumber('#eff-angle',v=>{if(isPath)path.angle=v;else p.turn=v;});readNumber('#eff-absolute',v=>{if(isPath)path.heading=field.heading(v);else p.turn=field.heading(v);});
    readNumber('#eff-spins',v=>{path.spins=Math.round(v)||1;q('#eff-spins').value=path.spins;});
    for(const axis of ['x','y'])readNumber('#eff-target-'+axis,v=>{subject.target={x:Number(q('#eff-target-x').value),y:Number(q('#eff-target-y').value),[axis]:v};});
    q('#eff-note').onchange=e=>{subject.note=e.target.value.slice(0,160);commit();};
    if(isPath){q('#eff-path-shape').value=path.controls?'custom':path.style||'';q('#eff-path-shape').onchange=e=>{const v=e.target.value;if(v==='custom'){path.controls=path.controls||startControls(k);path.style=null;}else{path.controls=null;path.style=v||null;}path.shapeAuto=false;commit();};
      stepsEditor(q('#eff-steps'),'path',path,commit,'eff-steps');
      q('#eff-power-inherit').onchange=e=>{path.power=e.target.checked?null:project.tuning.maxPathSpeed??.8;commit();};readNumber('#eff-path-power',v=>path.power=v,0,1);
    }else{q('#eff-wait').value=p.wait||0;readNumber('#eff-wait',v=>p.wait=v,0);stepsEditor(q('#eff-steps'),'pin',p,commit,'eff-steps');}
    q('#eff-pick-target').onclick=()=>{targetPick={...target};q('#eff-pick-target').textContent='Click target on field…';draw();};
    effects.pickPoint=point=>{subject.target={x:field.round(point.x),y:field.round(point.y)};q('#eff-target-x').value=subject.target.x;q('#eff-target-y').value=subject.target.y;q('#eff-pick-target').textContent='Pick target on field';targetPick=null;commit();draw();};
    q('[data-reset]').onclick=()=>{if(isPath)p.path=planner.pathEffects({});else Object.assign(p,{wait:0,action:'',actionSeconds:null,steps:[],note:'',turn:null,turnMode:'absolute',target:null});openEffects(target,{clientX:parseFloat(box.style.left)-24,clientY:parseFloat(box.style.top)+30},true);};
    q('[data-close]').onclick=finishEditor;
    const tabs=q('.sim-settings-tabs');for(const [key,label]of [['main',isPath?'Power & steps':'Pause & steps'],['heading','Heading'],['notes','Notes']]){const b=document.createElement('button');b.type='button';b.role='tab';b.className='secondary';b.textContent=label;b.onclick=()=>{for(const sec of box.querySelectorAll('[data-sec]'))sec.hidden=sec.dataset.sec!==key;for(const other of tabs.children)other.setAttribute('aria-selected',String(other===b));clampEditor(box,parseFloat(box.style.left)||4,parseFloat(box.style.top)||4);};tabs.append(b);}tabs.firstElementChild.click();
    const header=q('.sim-pop-head');let grab=null;
    header.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;e.preventDefault();const r=box.getBoundingClientRect();grab={x:e.clientX-r.left,y:e.clientY-r.top};header.setPointerCapture(e.pointerId);};
    header.onpointermove=e=>{if(grab)clampEditor(box,e.clientX-grab.x,e.clientY-grab.y);};header.onpointerup=header.onpointercancel=()=>grab=null;
    show();box.hidden=false;clampEditor(box,(at?.clientX??innerWidth/2)+24,(at?.clientY??150)-30);draw();
    q(isPath?'#eff-path-power':'#eff-wait').focus({preventScroll:true});
  }
  // What a pin or a path can do: the game's actions (run by the Mechanisms settings), turret angles, the moving parts'
  // positions and angles (Setup → Moving parts), Wait, and your own actions by name (an empty method in the export).
  const stepCatalog=()=>window.DeckSimSteps.catalog({field:L().field,mechanisms:project.mechanisms,kinematics:project.kinematics});
  // A list of steps on the pin or path subject (a draft or the pin itself): subject.steps, then commit().
  function stepsEditor(host,where,subject,commit,id){
    return window.DeckSimSteps.editor(host,{steps:subject.steps||[],where,id,catalog:stepCatalog(),biobuzz:L().field==='biobuzz',onChange:steps=>{
      subject.steps=steps;if(where==='path')subject.kind=steps.length?'action':'regular';
      // The plain action every runtime reads comes from the steps.
      const e=where==='path'?planner.pathEffects(subject):planner.pinEffects(subject);for(const key of ['steps','action','actionSeconds','cell'])subject[key]=e[key];if(where==='path')subject.kind=e.kind;
      commit();}});
  }
  function finishEditor(){const box=$('#sim-effects');if(!effects.session)return;const invalid=[...box.querySelectorAll('input,textarea,select')].find(e=>!e.disabled&&!e.checkValidity());if(invalid){const section=invalid.closest('[data-sec]');if(section){const sections=[...box.querySelectorAll('[data-sec]')];box.querySelectorAll('[role=tab]')[sections.indexOf(section)]?.click();}invalid.reportValidity();return;}
    try{const kind=effects.session.target.kind;effects.session.commit();effects.session=null;effects.pickPoint=null;targetPick=null;box.hidden=true;box.replaceChildren();effects.index=-1;changed(kind==='zone'?'zones':'plan');programPanel();graph.focus({preventScroll:true});}catch(e){box.querySelector('.sim-editor-save-note').textContent=e.message;}}
  const pressedIn=(box,attr,value)=>{for(const b of box.querySelectorAll(`[data-${attr}]`))b.setAttribute('aria-pressed',String(b.dataset[attr]===value));};
  document.addEventListener('pointerdown',e=>{const box=$('#sim-effects');if(!effects.session||box.contains(e.target))return;if(targetPick&&graph.contains(e.target))return;if(e.target.closest?.('#sim-stop'))return;e.preventDefault();e.stopImmediatePropagation();box.querySelector('.sim-editor-save-note').textContent='Press Done to save before editing another object.';},true);
  document.addEventListener('click',e=>{if(effects.session&&!$('#sim-effects').contains(e.target)&&!e.target.closest?.('#sim-stop')){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;if(e.key==='Escape'&&active&&(runState==='starting'||runState==='running'||frame?.playing)){e.preventDefault();stopRun();return;}if(!effects.session)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(targetPick){targetPick=null;$('#eff-pick-target').textContent='Pick target on field';draw();}return;}if(e.key==='Tab'){const nodes=[...$('#sim-effects').querySelectorAll('input,select,textarea,button')].filter(n=>!n.disabled&&n.getClientRects().length),i=nodes.indexOf(document.activeElement);if(i<0||e.shiftKey&&i===0||!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0]?.focus();}}},true);
  graph.addEventListener('pointerleave',()=>tooltip.hidden=true);
  graph.addEventListener('pointermove',event=>{if(!active||drag||pointer!==null||targetPick||!$('#sim-effects').hidden){tooltip.hidden=true;return;}const p=toField(event),h=p&&!hit(p)&&pathHit(p);if(!h){tooltip.hidden=true;return;}
    const title=document.createElement('strong');title.textContent=`Path ${h.index?h.index:'Start'} → ${h.index+1}`;
    const route=L().route,indices=exporter.pathIndex(route),parts=route.segments.filter((_,i)=>indices[i]===h.index),first=parts[0],last=parts.at(-1),descriptions=planner.pathDescription(pathOf(L(),h.index),project.tuning.maxPathSpeed);
    if(first&&last)descriptions.push(`Heading: ${field.round(first.heading??route.heading)}° → ${field.round(field.heading(last.endHeading??last.heading??route.heading))}°`);
    const lines=descriptions.map(text=>Object.assign(document.createElement('div'),{textContent:text}));tooltip.replaceChildren(title,...lines);tooltip.hidden=false;
    tooltip.style.left=`${Math.max(4,Math.min(innerWidth-tooltip.offsetWidth-4,event.clientX+16))}px`;tooltip.style.top=`${Math.max(4,Math.min(innerHeight-tooltip.offsetHeight-4,event.clientY-tooltip.offsetHeight-14))}px`;
  });
  // Press and hold on a touchscreen or with a pen opens the same settings as a right-click (a mouse
  // has the right button, and a slow mouse drag must never turn into a hold).
  let hold=null;
  function holdStart(target,event){clearTimeout(hold?.timer);hold=null;if(event.pointerType==='mouse')return;hold={x:event.clientX,y:event.clientY,fired:false,timer:setTimeout(()=>{hold.fired=true;drag=null;pendingPin=null;openEffects(target,{clientX:hold.x,clientY:hold.y});},550)};}
  function holdMove(event){if(hold&&!hold.fired&&Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>8){clearTimeout(hold.timer);hold=null;}}
  let pendingPin=null,lastPinTap=null;
  function zoneShape(z,extra=''){const p=planner.polygon(z);return p.length===2?svg('polyline',{class:'sim-zone wall'+extra,points:pts(p),'data-zone':z.id}):svg('polygon',{class:'sim-zone'+extra,points:pts(p),'data-zone':z.id});}
  function showDraft(z){
    const nodes=[];if(z)nodes.push(zoneShape(z,' draft'));
    // The outline is always shown closed back to the first corner, so the shape is mapped out as corners are placed.
    if(sketch){const path=cursor?[...sketch,cursor]:sketch;if(path.length>2){let outline=path;try{outline=planner.validateZone({type:'polygon',points:path}).points;}catch{}nodes.push(svg('polygon',{class:'sim-zone draft',points:pts(outline)}));}else if(path.length>1)nodes.push(svg('polyline',{class:'sim-zone wall draft',points:pts(path)}));for(const [i,q] of sketch.entries())nodes.push(svg('circle',{class:'sim-corner'+(i===0&&sketch.length>2?' close':''),cx:q.x,cy:q.y,r:1.1}));}
    $('#sim-draft').replaceChildren(...nodes);shapeBar();
  }
  function shapeBar(){const n=sketch?.length||0;$('#sim-shape-bar').hidden=!n;if(!n)return;$('#sim-shape-status').textContent=n===1?'1 corner. Tap the next corner.':n===2?'2 corners: a wall line. Add a third to make a closed shape.':`${n} corners, closed back to the first. Press Enter or Finish shape to confirm.`;$('#sim-shape-finish').disabled=n<2;}
  function finishShape(){const points=sketch;sketch=null;cursor=null;showDraft(null);if(!points||points.length<2)return;
    if(L().zones.length>=24)return status('#sim-plan-status','Use at most 24 zones.');
    try{const z=planner.validateZone({id:'zone-'+Date.now().toString(36),type:'polygon',points});L().zones.push(z);selected={kind:'zone',id:z.id};selectTab('plan');changed('zones');}catch(e){status('#sim-plan-status',e.message);}}
  graph.addEventListener('contextmenu',event=>{if(!active||tab!=='plan'||effects.session||builtin(project.setupId))return;const p=toField(event);const h=p&&(hit(p)||pathHit(p));if(!h)return;event.preventDefault();if(h.kind==='control')return;
    if(hold?.fired)return;clearTimeout(hold?.timer);hold=null;
    if(h.kind==='pin'||h.kind==='path'){drag=null;pendingPin=null;openEffects(h,event);return;}selected=h;removeSelected();});
  graph.addEventListener('pointermove',event=>{
    if(!active||effects.session)return;holdMove(event);const p=toField(event);if(!p)return;
    // A locked mouse moves the robot by its own motion, so pushing into a wall never builds up
    // distance that has to be won back; touch follows the finger. Either way the robot slides.
    if(graph.dataset.dragging&&pointer===event.pointerId){const g=geometry(),m=graph.getScreenCTM(),locked=document.pointerLockElement===graph&&m;
      const target=field.constrain(locked?{x:preview.x+event.movementX/m.a,y:preview.y-event.movementY/m.d,heading:preview.heading}:{x:p.x+startGrab.dx,y:p.y+startGrab.dy,heading:preview.heading},g);
      preview=planner.slidePose(preview,target,[...(info?.fieldZones||[]),...L().zones],g.footprint,g.bounds);liveEdit(true);return;}
    if(drag?.kind==='draw'){drag.zone=draftZone(drag.from,p);showDraft(drag.zone);return;}
    if(drag?.kind==='zone'){const z=zoneById(drag.id);if(z){const dx=p.x-drag.from.x,dy=p.y-drag.from.y;if(!drag.moved&&Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY)<4)return;z.x=drag.zone.x+dx;z.y=drag.zone.y+dy;if(z.type==='polygon')z.points=drag.zone.points.map(q=>({x:q.x+dx,y:q.y+dy}));drag.moved=true;liveEdit();}return;}
    if(drag?.kind==='handle'){const z=zoneById(drag.id);if(z){try{Object.assign(z,planner.validateZone({...drag.zone,...handles(drag.zone)[drag.index].set(p)}));drag.moved=true;liveEdit();zonePanel();}catch{}}return;}
    if(tool==='shape'&&sketch){cursor=p;showDraft(null);}
    if(tool==='draw'&&stroke&&pointer===event.pointerId){if(dist2(stroke.at(-1),p)>=1)stroke.push({x:p.x,y:p.y});$('#sim-draft').replaceChildren(svg('polyline',{class:'sim-draw-stroke',points:pts(stroke)}));return;}
    if(drag?.kind==='control'){const q=L().pins[drag.index],b=geometry().bounds;if(!q?.path?.controls?.[drag.control])return;if(!drag.moved&&Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY)<3)return;
      // Shift snaps the handle to a 0.5 in grid.
      const snap=v=>event.shiftKey?Math.round(v*2)/2:v;
      q.path.controls[drag.control]={x:field.round(Math.max(b.x0,Math.min(b.x1,snap(p.x)))),y:field.round(Math.max(b.y0,Math.min(b.y1,snap(p.y))))};drag.moved=true;liveEdit();syncPaths();return;}
    if(drag?.kind==='pin'){const q=L().pins[drag.index];if(!drag.moved&&Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY)<4)return;clearTimeout(hold?.timer);hold=null;const at=drag.from?{x:drag.pin.x+p.x-drag.from.x,y:drag.pin.y+p.y-drag.from.y}:p;Object.assign(q,nearestPin(at,12)||q);drag.moved=true;liveEdit();return;}
    $('#field-coordinates').textContent=`X ${field.round(p.x)} in · Y ${field.round(p.y)} in`;
  });
  graph.addEventListener('pointerdown',event=>{
    if(!active||tab!=='plan'||event.button!==0||project.view==='3d'||builtin(project.setupId))return;const p=toField(event);if(!p)return;event.preventDefault();tooltip.hidden=true;
    if(targetPick){effects.pickPoint?.(p);return;}
    if(effects.session)return;
    graph.focus({preventScroll:true});pointer=event.pointerId;graph.setPointerCapture(event.pointerId);
    const existing=hit(p);
    if(existing?.kind==='control'&&!sketch){drag={...existing,clientX:event.clientX,clientY:event.clientY};return;}
    if(existing&&(!sketch||tool!=='shape')){selected=existing;if(existing.kind==='handle')drag={...existing,zone:JSON.parse(JSON.stringify(zoneById(existing.id)))};else if(existing.kind==='zone')drag={...existing,downTime:performance.now(),clientX:event.clientX,clientY:event.clientY,from:p,zone:JSON.parse(JSON.stringify(zoneById(existing.id)))};else{drag={...existing,downTime:performance.now(),clientX:event.clientX,clientY:event.clientY,from:p,pin:{...L().pins[existing.index]}};holdStart(existing,event);}draw();zonePanel();pinPanel();return;}
    if(!sketch&&planner.contains(p,planner.body(preview,geometry().footprint))){startGrab={dx:preview.x-p.x,dy:preview.y-p.y};graph.dataset.dragging='true';
      // A mouse grabs the robot by its centre: the pointer is locked and drawn there until release.
      if(event.pointerType==='mouse'&&graph.requestPointerLock){startGrab={dx:0,dy:0};void api.cursor?.('prepare').catch(()=>{});try{graph.requestPointerLock()?.catch?.(()=>{});}catch{}}
      draw();return;}
    if(!sketch){const onPath=pathHit(p);if(onPath){drag=null;pendingPin=null;if(planningStep!=='pins')setStep('pins');choosePath(onPath.index);return;}}
    if(planningStep==='zones'&&['rect','circle','triangle'].includes(tool)){drag={kind:'draw',from:p,zone:null};return;}
    if(tool==='draw'&&planningStep==='pins'){stroke=[{x:p.x,y:p.y}];return;}
    if(tool==='pin'&&planningStep==='pins'){const h=hit(p);if(h?.kind==='pin'){selected=h;drag={kind:'pin',index:h.index};holdStart(h,event);draw();pinPanel();return;}
      addPin(p);return;}
    if(tool==='shape'&&planningStep==='zones'){if(sketch&&sketch.length>2&&Math.hypot(sketch[0].x-p.x,sketch[0].y-p.y)<=2.5)return finishShape();const last=sketch?.at(-1);if(last&&Math.hypot(last.x-p.x,last.y-p.y)<.3)return;
      sketch=[...(sketch||[]),{x:field.round(p.x),y:field.round(p.y)}];if(sketch.length>=40)return finishShape();showDraft(null);return;}
    if(tool==='select'){const h=hit(p)||pathHit(p);if(h?.kind==='handle'){drag={kind:'handle',id:h.id,index:h.index,zone:JSON.parse(JSON.stringify(zoneById(h.id)))};return;}
      if(h?.kind==='pin')holdStart(h,event);if(h?.kind==='path'){choosePath(h.index);return;}
      selected=h;if(selected?.kind==='zone'){const z=zoneById(selected.id);drag={kind:'zone',id:z.id,from:p,zone:JSON.parse(JSON.stringify(z))};selectTab('plan');}else if(selected?.kind==='pin'){drag={kind:'pin',index:selected.index};openPart='pin';selectTab('plan');}draw();zonePanel();pinPanel();}
  });
  graph.addEventListener('pointerup',event=>{
    if(!active||pointer!==event.pointerId)return;const grabbed=!!graph.dataset.dragging;pointer=null;delete graph.dataset.dragging;$('#sim-grab-cursor')?.remove();
    const held=hold?.fired;clearTimeout(hold?.timer);hold=null;
    if(pendingPin){const p=pendingPin;pendingPin=null;if(!held)addPin(p);return;}
    if(held){drag=null;return;}
    if(grabbed){const clear=nearestPin(preview,72,preview.heading);if(clear&&Math.hypot(clear.x-preview.x,clear.y-preview.y)>.75)status('#start-status','Moved to the nearest clear spot outside the red area.');if(clear)preview={...preview,...clear};try{commit(preview);}catch(e){status('#start-status',e.message);preview={...start};tool='start';draw();}releaseCursor();return;}
    if(tool==='draw'&&stroke){const drawn=stroke;stroke=null;$('#sim-draft').replaceChildren();drawnPath(drawn);return;}
    if(drag?.kind==='draw'){const z=drag.zone;drag=null;showDraft(null);if(z&&(z.type==='circle'?z.radius>=.75:z.width>=1&&z.height>=1)){if(L().zones.length>=24)status('#sim-plan-status','Use at most 24 zones.');else{L().zones.push(planner.validateZone(z));selected={kind:'zone',id:z.id};selectTab('plan');changed('zones');}}return;}
    if(drag){const moved=drag.moved,kind=drag.kind,index=drag.index,downTime=drag.downTime;drag=null;if(moved){lastPinTap=null;changed(kind==='pin'||kind==='control'?'pins':'zones');}else if(['pin','zone'].includes(kind)&&performance.now()-downTime<500){const now=performance.now(),previous=lastPinTap;lastPinTap={kind,index,id:selected?.id,layout:L().id,time:now,x:event.clientX,y:event.clientY};if(previous&&previous.layout===L().id&&previous.kind===kind&&previous.index===index&&(kind!=='zone'||previous.id===selected?.id)&&now-previous.time<500&&Math.hypot(previous.x-event.clientX,previous.y-event.clientY)<10){lastPinTap=null;if(kind==='zone')openZoneEffects({kind:'zone',id:selected.id},event);else openEffects({kind:'pin',index},event);}}}
  });
  graph.addEventListener('dblclick',event=>{if(!active||tab!=='plan'||effects.session||builtin(project.setupId))return;if(tool==='shape'&&sketch){event.preventDefault();finishShape();return;}const p=toField(event),h=p&&(hit(p)||pathHit(p));if(h?.kind==='zone'){event.preventDefault();drag=null;openZoneEffects(h,event);return;}if(h&&['pin','path'].includes(h.kind)){event.preventDefault();drag=null;pendingPin=null;if(planningStep!=='pins')setStep('pins');const part=h.kind==='pin'?'pin':'path';choosePath(h.index,part);$(part==='pin'?'#pin-wait':'#path-x')?.focus({preventScroll:true});}});
  // Leave pointer lock with the system cursor on the robot's centre (where the drawn cursor was).
  function releaseCursor(){if(document.pointerLockElement!==graph)return;const m=graph.getScreenCTM(),x=m?m.a*preview.x+m.e:0,y=m?m.d*(fieldHeight()-preview.y)+m.f:0;
    if(m)document.addEventListener('pointerlockchange',()=>void api.cursor?.(x,y).catch(()=>{}),{once:true});document.exitPointerLock();}
  graph.addEventListener('wheel',e=>{if(!active||project.view==='3d')return;e.preventDefault();zoomBy(Math.exp(-e.deltaY*(e.deltaMode===1?.05:.0015)),e.clientX,e.clientY);},{passive:false});
  // A zoomed field pans by dragging empty floor (anywhere in Run & review), middle-drag or Space+drag, and
  // two fingers pinch to zoom. A press on empty floor waits to see whether it moves: if it does not, it is
  // the usual click (add a path, clear the selection). These run before (and instead of) the editing handlers.
  const zoomed=()=>zoom.z>1.001;
  function emptyFloor(e){if(tab==='run')return true;if(tab!=='plan'||sketch||targetPick||effects.session||!['pin','select','start'].includes(tool))return false;
    const p=toField(e);return !!p&&!hit(p)&&!pathHit(p)&&!planner.contains(p,planner.body(preview,geometry().footprint));}
  function floorClick(e){graph.focus({preventScroll:true});const p=toField(e);if(tab!=='plan'||!p)return;if(tool==='pin'&&planningStep==='pins')addPin(p);else if(tool==='select'){selected=null;draw();zonePanel();pinPanel();}}
  const svgPoint=(x,y)=>new DOMPoint(x,y).matrixTransform(graph.getScreenCTM().inverse());
  function panFrom(id){const at=panning.pointers.get(id);Object.assign(panning,{id,x:at.x,y:at.y,cx:zoom.cx,cy:zoom.cy,pinch:null});}
  graph.addEventListener('pointerdown',e=>{if(!active||project.view==='3d')return;
    // A second finger turns the drag into a pinch around the point between the fingers.
    if(panning?.touch&&e.pointerType==='touch'&&panning.pointers.size===1){e.preventDefault();e.stopImmediatePropagation();panning.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});graph.setPointerCapture(e.pointerId);
      const [a,b]=panning.pointers.values();panning.maybe=null;panning.pinch={d:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),z:zoom.z,at:svgPoint((a.x+b.x)/2,(a.y+b.y)/2)};graph.dataset.panning='true';return;}
    if(panning){e.preventDefault();e.stopImmediatePropagation();return;}
    const forced=e.button===1||spaceHeld&&e.button===0,touch=e.pointerType==='touch';
    if(!(forced?zoomed():e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(zoomed()||touch)&&emptyFloor(e)))return;
    e.preventDefault();e.stopImmediatePropagation();tooltip.hidden=true;panning={pointers:new Map([[e.pointerId,{x:e.clientX,y:e.clientY}]]),touch,maybe:forced?null:{x:e.clientX,y:e.clientY,clientX:e.clientX,clientY:e.clientY}};panFrom(e.pointerId);
    graph.setPointerCapture(e.pointerId);if(forced)graph.dataset.panning='true';},true);
  graph.addEventListener('pointermove',e=>{const at=panning?.pointers.get(e.pointerId);if(!at)return;e.stopImmediatePropagation();at.x=e.clientX;at.y=e.clientY;
    if(panning.pinch){const [a,b]=panning.pointers.values(),{d,z,at:point}=panning.pinch;zoom.z=Math.max(1,Math.min(8,z*Math.hypot(a.x-b.x,a.y-b.y)/d));applyZoom();const q=svgPoint((a.x+b.x)/2,(a.y+b.y)/2);zoom.cx+=point.x-q.x;zoom.cy+=point.y-q.y;applyZoom();return;}
    if(e.pointerId!==panning.id)return;
    if(panning.maybe){if(Math.hypot(e.clientX-panning.maybe.x,e.clientY-panning.maybe.y)<(panning.touch?8:4))return;panning.maybe=null;graph.dataset.panning='true';}
    const m=graph.getScreenCTM();if(!m)return;zoom.cx=panning.cx-(e.clientX-panning.x)/m.a;zoom.cy=panning.cy-(e.clientY-panning.y)/m.d;applyZoom();},true);
  for(const type of ['pointerup','pointercancel'])graph.addEventListener(type,e=>{if(!panning?.pointers.has(e.pointerId))return;e.stopImmediatePropagation();panning.pointers.delete(e.pointerId);
    if(panning.pointers.size){panFrom(panning.pointers.keys().next().value);return;}
    const click=type==='pointerup'&&panning.maybe;panning=null;delete graph.dataset.panning;if(click)floorClick(click);},true);
  // The grab cursor shows where a drag pans; with Click to add, the crosshair stays (a click still adds a path).
  graph.addEventListener('pointermove',e=>{const pan=!panning&&e.pointerType==='mouse'&&zoomed()&&tool!=='pin'&&project.view!=='3d'&&emptyFloor(e);if((graph.dataset.pan==='true')!==pan)graph.dataset.pan=String(pan);});
  graph.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
  graph.addEventListener('keydown',e=>{if(!active||effects.session||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key===' '){spaceHeld=true;if(zoom.z>1.001)e.preventDefault();return;}const k={'+':'in','=':'in','-':'out','_':'out','0':'fit'}[e.key];if(!k||project.view==='3d')return;e.preventDefault();k==='fit'?(zoom.z=1,applyZoom()):zoomBy(k==='in'?1.4:1/1.4);});
  graph.addEventListener('keyup',e=>{if(e.key===' ')spaceHeld=false;});addEventListener('blur',()=>{spaceHeld=false;});
  $('#sim-preview').oninput=e=>{previewStop();previewAt=Number(e.target.value);drawPreview();};
  // About 30 inches of route per second, between 2 and 20 seconds; stops if the route changes or the tab is left.
  $('#sim-preview-play').onclick=()=>{if(previewTimer)return previewStop();const c=previewPath();if(!c)return;if(previewAt>=1000)previewAt=0;const seconds=Math.max(2,Math.min(20,c.poses.at(-1).s/30));let last=performance.now();
    $('#sim-preview-play').textContent='Pause';const tick=now=>{previewAt=Math.min(1000,previewAt+(now-last)/seconds);last=now;$('#sim-preview').value=String(Math.round(previewAt));drawPreview();if(previewAt<1000&&tab==='plan'&&L().route===c.route)previewTimer=requestAnimationFrame(tick);else previewStop();};previewTimer=requestAnimationFrame(tick);};
  for(const b of $$('[data-zoom]'))b.onclick=()=>{if(b.dataset.zoom==='fit'){zoom.z=1;applyZoom();}else zoomBy(b.dataset.zoom==='in'?1.4:1/1.4);};
  graph.addEventListener('pointercancel',()=>{releaseCursor();delete graph.dataset.dragging;$('#sim-grab-cursor')?.remove();clearTimeout(hold?.timer);hold=null;pendingPin=null;pointer=null;drag=null;stroke=null;showDraft(null);preview={...start};draw();});
  graph.addEventListener('keydown',event=>{
    if(effects.session||!active||tab!=='plan'||event.ctrlKey||event.metaKey||event.altKey||builtin(project.setupId))return;
    if(tool==='start'){
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
      if(delta){event.preventDefault();preview=field.constrain({...preview,x:preview.x+delta[0],y:preview.y+delta[1]},geometry());draw();}
      else if(event.key==='Enter'){event.preventDefault();try{commit(preview);}catch(e){status('#start-status',e.message);}}
      else if(event.key==='Escape'){event.preventDefault();if(planningStep!=='start')tool='select';preview={...start};draw();}
      return;
    }
    if(tool==='shape'&&sketch){if(event.key==='Enter'){event.preventDefault();finishShape();return;}if(event.key==='Escape'){event.preventDefault();sketch=null;cursor=null;showDraft(null);return;}if(event.key==='Backspace'){event.preventDefault();sketch.pop();if(!sketch.length)sketch=null;showDraft(null);return;}}
    if(event.key==='Escape'){targetPick=null;tool='select';drag=null;showDraft(null);draw();return;}
    if(!selected)return;
    if(event.key==='Enter'&&['pin','path'].includes(selected.kind)){event.preventDefault();choosePath(selected.index,openPart);$(openPart==='pin'?'#pin-wait':'#path-x')?.focus({preventScroll:true});return;}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelected();return;}
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
    const target=selected.kind==='zone'?zoneById(selected.id):L().pins[selected.index];if(!target)return;
    if(delta){event.preventDefault();const s=event.shiftKey?.1:1,next={x:target.x+delta[0]*s,y:target.y+delta[1]*s};if(selected.kind==='pin')Object.assign(target,pinPosition(next,target));else{target.x=next.x;target.y=next.y;if(target.type==='polygon')for(const q of target.points){q.x+=delta[0]*s;q.y+=delta[1]*s;}}changed(selected.kind==='zone'?'zones':'pins');}
    else if(selected.kind==='zone'&&(event.key==='['||event.key===']')){event.preventDefault();target.angle=((target.angle||0)+(event.key===']'?15:-15)+360)%360;changed('zones');}
  });
  function addPin(p){
    if(L().pins.length>=32)return status('#sim-plan-status','Use at most 32 pins.');const q=nearestPin(p);if(!q)return status('#sim-plan-status','No clear spot nearby: the whole robot must fit inside the field and outside red areas.');
    L().pins.push({x:q.x,y:q.y,wait:0,action:''});selected={kind:'pin',index:L().pins.length-1};selectTab('plan');changed('pins');if(Math.hypot(q.x-p.x,q.y-p.y)>.75)status('#sim-plan-status',`Pin ${L().pins.length} moved to the nearest clear spot outside the red area.`);
  }
  function removeSelected(){
    const l=L();if(selected?.kind==='zone')l.zones=l.zones.filter(z=>z.id!==selected.id);else if(['pin','path'].includes(selected?.kind))l.pins.splice(selected.index,1);else return;
    const kind=selected.kind;selected=null;changed(kind==='zone'?'zones':'pins');
  }
  function setTool(next){if(!['select','rect','circle','triangle','shape','pin','draw','start'].includes(next))return;if(sketch&&next!=='shape')finishShape();tool=next;if(next==='start')preview={...start};draw();graph.focus({preventScroll:true});}
  for(const b of $$('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool);
  $('#sim-shape-finish').onclick=()=>finishShape();
  $('#sim-shape-undo').onclick=()=>{if(!sketch)return;sketch.pop();if(!sketch.length)sketch=null;showDraft(null);};
  $('#sim-shape-cancel').onclick=()=>{sketch=null;cursor=null;showDraft(null);};
  document.addEventListener('keydown',event=>{if(active&&tab==='plan'&&tool==='shape'&&sketch&&event.key==='Enter'&&!event.target.closest?.('input,textarea,select,#simulation-field')){event.preventDefault();finishShape();}});
  function zonePanel(){const box=$('#sim-zone-editor');box.hidden=true;}
  function openZoneEffects(target,at){
    if(optimizing||effects.session)return;effects.session=window.DeckSimEditor.begin(L(),target);selected={...target};const z=effects.session.draft,box=$('#sim-effects');tooltip.hidden=true;effects.index=-1;
    const name=z.type==='polygon'?(z.points.length===2?'Wall':'Custom shape'):{rect:'Box',circle:'Circle',triangle:'Triangle'}[z.type],fields=z.type==='circle'?[['x','X · in'],['y','Y · in'],['radius','Radius · in']]:z.type==='polygon'?[['x','Centre X · in'],['y','Centre Y · in']]:[['x','X · in'],['y','Y · in'],['width','Width · in'],['height','Height · in'],['angle','Rotation · °']];
    box.setAttribute('aria-label','Obstacle settings');box.innerHTML=`<div class="sim-pop-head"><h3>${name}</h3><span class="sim-editor-grip" aria-label="Drag editor">⠿</span></div><div class="sim-grid2">${fields.map(([key,label])=>`<div><label for="zone-edit-${key}">${label}</label><input id="zone-edit-${key}" data-zone-key="${key}" type="number" step="any" value="${field.round(z[key]||0)}" ${['width','height','radius'].includes(key)?'min="0.25"':''}></div>`).join('')}</div>${z.type==='polygon'?'<label for="zone-corner">Corner</label><select id="zone-corner">'+z.points.map((_,i)=>`<option value="${i}">Corner ${i+1}</option>`).join('')+'</select><div class="sim-grid2"><div><label for="zone-corner-x">Corner X · in</label><input id="zone-corner-x" type="number" step="any"></div><div><label for="zone-corner-y">Corner Y · in</label><input id="zone-corner-y" type="number" step="any"></div></div>':''}<p class="sim-editor-save-note" role="status">Draft · press Done to save</p><div class="button-row"><button type="button" class="primary" id="zone-edit-done">Done</button></div>`;
    for(const input of box.querySelectorAll('[data-zone-key]'))input.onchange=()=>{const key=input.dataset.zoneKey,v=input.valueAsNumber;if(!finite(v)){input.setCustomValidity('Enter a finite number.');input.reportValidity();return;}input.setCustomValidity('');if(z.type==='polygon'){const delta=v-z[key];for(const p of z.points)p[key]+=delta;}z[key]=v;};
    if(z.type==='polygon'){const corner=box.querySelector('#zone-corner'),show=()=>{for(const axis of ['x','y'])box.querySelector('#zone-corner-'+axis).value=field.round(z.points[+corner.value][axis]);};corner.onchange=show;for(const axis of ['x','y'])box.querySelector('#zone-corner-'+axis).onchange=e=>{const v=e.target.valueAsNumber;if(finite(v)){z.points[+corner.value][axis]=v;e.target.setCustomValidity('');}else e.target.setCustomValidity('Enter a finite number.');};show();}
    box.querySelector('#zone-edit-done').onclick=finishEditor;const header=box.querySelector('.sim-pop-head');let grab=null;header.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const r=box.getBoundingClientRect();grab={x:e.clientX-r.left,y:e.clientY-r.top};header.setPointerCapture(e.pointerId);};header.onpointermove=e=>{if(grab)clampEditor(box,e.clientX-grab.x,e.clientY-grab.y);};header.onpointerup=header.onpointercancel=()=>grab=null;
    box.hidden=false;clampEditor(box,(at?.clientX??innerWidth/2)+24,(at?.clientY??150)-30);draw();box.querySelector('input')?.focus({preventScroll:true});
  }
  // What happens at a pin, in order: e.g. "turn to 90° → pause 0.5 s → Shoot → Ramp down → Intake for 1 s → drive on".
  const pinSteps=p=>{const steps=[];if(finite(p.turn))steps.push(p.turnMode==='relative'?`turn by ${p.turn>=0?'+':''}${p.turn}°`:p.turnMode==='start'?'turn to the start heading':p.turnMode==='track'?'turn to the target':`turn to ${Math.round(p.turn)}°`);
    if(p.wait>0)steps.push(`pause ${p.wait} s`);const list=planner.pinEffects(p).steps;if(list.length)steps.push(window.DeckSimSteps.summary(list,'pin'));return steps.length?[...steps,'drive on'].join(' → '):'';};
  // A path row's summary: its power, heading and shape, and what runs while it is driven.
  function effectSummary(p){const path=planner.pathEffects(p.path),bits=[];
    if(finite(path.power))bits.push(`${Math.round(path.power*100)}% motor power`);
    if(path.steps.length)bits.push(`While driving: ${window.DeckSimSteps.summary(path.steps,'path')}`);
    bits.push(...planner.pathDescription({...path,steps:[],kind:'regular'},project.tuning.maxPathSpeed).slice(1).filter(v=>v!=='Hold inherited heading'));
    return bits.join(' · ');}
  // The route as a list, the start and then each path followed by the pin it ends at. The open row is edited in place:
  // a path's end point, heading, shape, power and its steps while driving; a pin's pause and its steps, one after
  // another. The pin and path editors (right-click, or the options buttons) have the rest.
  const HEADINGS={keep:'Constant (hold heading)',turn:'Linear to a field heading',tangent:'Face along the path (tangent)',reverse:'Face backwards along the path',relative:'Turn by an angle',track:'Face a target',start:'Back to start heading',spin:'Spin'};
  const HEADING_VALUE={turn:['heading','End heading · °'],relative:['angle','Turn by · ° (+ left, − right)'],spin:['spins','Full spins (+ left, − right)']};
  const openPath=()=>['pin','path'].includes(selected?.kind)&&L().pins[selected.index]?selected.index:-1;
  // Which half of the open path is unfolded in the list: the path ('path') or the pin it ends at ('pin').
  let openPart='path';
  function choosePath(i,part='path'){selected=i<0?null:{kind:'pin',index:i};openPart=part;pinPanel();draw();if(i>=0)$(`#sim-pin-list [data-${part==='pin'?'pin':'path'}="${i}"]`)?.scrollIntoView({block:'nearest'});}
  const xy=p=>`(${field.round(p.x)}, ${field.round(p.y)})`;
  function pinPanel(){
    const list=$('#sim-pin-list'),l=L(),open=openPath(),holonomic=C.drives[project.robot.drivetrain].holonomic,p=l.pins[open];
    $('#sim-add-path').disabled=l.pins.length>=32;
    // Rebuild only when the rows or the open card's fields change, so typing and Tab keep their place.
    const shape=JSON.stringify([l.id,l.pins.length,open,openPart,holonomic,project.tuning.maxPathSpeed,JSON.stringify(stepCatalog()),p&&[p.path?.rotate,p.action,p.path?.action,p.steps,p.path?.steps,p.path?.controls?.length||0]]);
    if(list.dataset.shape===shape)return syncPaths();
    const focus=list.contains(document.activeElement)?document.activeElement.id:'';list.dataset.shape=shape;
    const first=document.createElement('li');first.className='sim-path-start';
    first.innerHTML='<span class="sim-badge">S</span><span class="sim-path-title">Start</span><span class="sim-path-at" data-at></span><button type="button" class="text-button" data-edit-start>Edit</button>';
    first.querySelector('[data-edit-start]').onclick=()=>{void setView('2d');setStep('start');};
    list.replaceChildren(first,...l.pins.flatMap((q,i)=>[pathRow(q,i,i===open&&openPart!=='pin',holonomic),pinRow(q,i,i===open&&openPart==='pin')]));
    if(!l.pins.length){const li=document.createElement('li');li.className='hint sim-path-empty';li.textContent='No paths yet. Click the field or press + Add path.';list.append(li);}
    syncPaths();if(focus)document.getElementById(focus)?.focus({preventScroll:true});
  }
  const anchorAt=e=>{const r=e.target.getBoundingClientRect();return {clientX:r.left,clientY:r.top};};
  function pathRow(p,i,isOpen,holonomic){
    const l=L(),li=document.createElement('li'),name=`Path ${i+1}`;li.className='sim-path-row'+(isOpen?' selected':'');li.dataset.path=i;
    li.innerHTML=`<div class="sim-path-head"><button type="button" class="sim-path-pick" aria-expanded="${isOpen}"><span class="sim-path-swatch"></span><span class="sim-path-title">${name}</span><span class="sim-path-at" data-at></span></button><button type="button" class="icon-button" data-move="-1" aria-label="Move ${name} earlier" title="Move earlier"${i===0?' disabled':''}>↑</button><button type="button" class="icon-button" data-move="1" aria-label="Move ${name} later" title="Move later"${i===l.pins.length-1?' disabled':''}>↓</button><button type="button" class="icon-button" data-duplicate aria-label="Duplicate ${name}" title="Duplicate: a copy right after it"${l.pins.length>=32?' disabled':''}>⧉</button><button type="button" class="icon-button" data-remove aria-label="Delete ${name} and its pin" title="Delete path and its pin">×</button></div><p class="sim-pin-summary hint"></p>`;
    li.querySelector('.sim-path-pick').onclick=()=>choosePath(isOpen?-1:i,'path');
    for(const b of li.querySelectorAll('[data-move]'))b.onclick=()=>{const j=i+Number(b.dataset.move);if(!l.pins[j])return;[l.pins[i],l.pins[j]]=[l.pins[j],l.pins[i]];selected={kind:'pin',index:j};changed('pins');};
    li.querySelector('[data-remove]').onclick=()=>{l.pins.splice(i,1);selected=null;changed('pins');};
    // The copy keeps the path's settings (not its curve handles, which belonged to the original's start) and ends a short way along, at the nearest clear spot.
    li.querySelector('[data-duplicate]').onclick=()=>{if(l.pins.length>=32)return;const copy=JSON.parse(JSON.stringify(p)),spot=nearestPin({x:p.x+12,y:p.y})||nearestPin({x:p.x-12,y:p.y});if(!spot)return status('#sim-plan-status','No clear spot near this end point for a copy.');
      Object.assign(copy,spot);if(copy.path)copy.path.controls=null;l.pins.splice(i+1,0,copy);selected={kind:'pin',index:i+1};changed('pins');status('#sim-plan-status',`${name} copied as Path ${i+2}.`);};
    if(!isOpen)return li;
    const path=p.path=planner.pathEffects(p.path),body=document.createElement('div');body.className='sim-path-body';
    body.innerHTML=`<div class="sim-grid2"><div><label for="path-x">End X · in</label><input id="path-x" type="number" step="any"></div><div><label for="path-y">End Y · in</label><input id="path-y" type="number" step="any"></div></div>
      <label for="path-heading">Heading</label><select id="path-heading">${Object.entries(HEADINGS).map(([k,v])=>`<option value="${k}"${!holonomic&&k!=='keep'?' disabled':''}>${v}</option>`).join('')}</select>
      ${HEADING_VALUE[path.rotate]?`<label for="path-heading-value">${HEADING_VALUE[path.rotate][1]}</label><input id="path-heading-value" type="number" step="${path.rotate==='spin'?1:'any'}">`:''}
      ${path.rotate==='track'?'<div class="sim-grid2"><div><label for="path-target-x">Target X · in</label><input id="path-target-x" type="number" step="any"></div><div><label for="path-target-y">Target Y · in</label><input id="path-target-y" type="number" step="any"></div></div>':''}
      ${holonomic?'':'<p class="hint">Tank drivetrains turn in place between straight paths.</p>'}
      <div class="sim-grid2"><div><label for="path-shape">Shape</label><select id="path-shape"><option value="">Route default</option><option value="sharp">Straight</option><option value="spline"${holonomic?'':' disabled'}>Curve</option><option value="custom"${holonomic?'':' disabled'}>Custom curve (drag handles)</option></select></div><div><label for="path-power">Motor power · 0–1</label><input id="path-power" type="number" min="0" max="1" step="any" placeholder="Setup ${project.tuning.maxPathSpeed??.8}"></div></div>
      ${path.controls?path.controls.map((_,j)=>`<div class="sim-grid2"><div><label for="path-c${j}x">Handle ${j+1} X · in</label><input id="path-c${j}x" type="number" step="any"></div><div><label for="path-c${j}y">Handle ${j+1} Y · in</label><input id="path-c${j}y" type="number" step="any"></div></div>`).join(''):''}
      <h4 class="sim-pop-label sim-steps-title">While driving this path</h4><div class="sim-steps" id="path-steps"></div>
      <div class="sim-path-more"><button type="button" class="text-button" data-more="path">Path options…</button><button type="button" class="text-button" data-open-pin>Pin ${i+1}: what happens there →</button></div>`;
    li.append(body);const q=s=>body.querySelector(s);
    const number=(input,assign,min=-Infinity,max=Infinity,optional=false)=>{input.onchange=e=>{const raw=e.target.value.trim(),v=e.target.valueAsNumber;
      if(optional&&raw===''){e.target.setCustomValidity('');assign(null);return changed('plan');}
      if(!finite(v)||v<min||v>max){e.target.setCustomValidity(`Enter a number${finite(min)?' from '+min:''}${finite(max)?' to '+max:''}.`);e.target.reportValidity();return;}
      e.target.setCustomValidity('');assign(v);p.path=planner.pathEffects(path);changed('plan');};};
    const move=()=>{const want={x:q('#path-x').valueAsNumber,y:q('#path-y').valueAsNumber};if(!finite(want.x)||!finite(want.y))return syncPaths();
      const c=nearestPin(want);if(!c){status('#sim-plan-status','No clear spot near there: the whole robot must fit inside the field and outside red areas.');return syncPaths();}
      p.x=c.x;p.y=c.y;if(Math.hypot(c.x-want.x,c.y-want.y)>.75)status('#sim-plan-status',`${name} ends at the nearest clear spot outside the red area.`);changed('pins');};
    q('#path-x').onchange=q('#path-y').onchange=move;
    q('#path-heading').onchange=e=>{path.rotate=e.target.value;if(path.rotate==='track'&&!path.target){const b=geometry().bounds;path.target={x:field.round((b.x0+b.x1)/2),y:field.round(b.y1-8)};}p.path=planner.pathEffects(path);changed('plan');};
    if(q('#path-heading-value')){const [key]=HEADING_VALUE[path.rotate];number(q('#path-heading-value'),v=>path[key]=key==='heading'?field.heading(v):key==='spins'?Math.round(v)||1:v);}
    if(q('#path-target-x'))for(const axis of ['x','y'])number(q('#path-target-'+axis),v=>path.target={...path.target,[axis]:v});
    q('#path-shape').onchange=e=>{const v=e.target.value;if(v==='custom'){path.controls=startControls(i);path.style=null;}else{path.controls=null;path.style=v||null;}path.shapeAuto=false;p.path=planner.pathEffects(path);changed('plan');if(v==='custom')status('#sim-plan-status',`${name} is a custom curve: drag its two handles on the field to shape it.`);};
    if(path.controls){const b=geometry().bounds;path.controls.forEach((_,j)=>{number(q(`#path-c${j}x`),v=>path.controls[j]={...path.controls[j],x:v},b.x0,b.x1);number(q(`#path-c${j}y`),v=>path.controls[j]={...path.controls[j],y:v},b.y0,b.y1);});}
    number(q('#path-power'),v=>path.power=v,0,1,true);
    stepsEditor(q('#path-steps'),'path',path,()=>{p.path=planner.pathEffects(path);changed('plan');},`path-${i}-steps`);
    q('[data-more]').onclick=e=>openEffects({kind:'path',index:i},anchorAt(e));q('[data-open-pin]').onclick=()=>choosePath(i,'pin');
    return li;
  }
  // The pin a path ends at: where the robot stops (unless nothing happens there) and what it does, in order.
  function pinRow(p,i,isOpen){
    const li=document.createElement('li'),name=`Pin ${i+1}`;li.className='sim-stop-row'+(isOpen?' selected':'');li.dataset.pin=i;
    li.innerHTML=`<div class="sim-path-head"><button type="button" class="sim-path-pick sim-pin-pick" aria-expanded="${isOpen}"><span class="sim-pin-badge" aria-hidden="true">${i+1}</span><span class="sim-path-title">${name}</span><span class="sim-path-at" data-at></span></button></div><p class="sim-pin-summary hint"></p>`;
    li.querySelector('.sim-pin-pick').onclick=()=>choosePath(isOpen?-1:i,'pin');
    if(!isOpen)return li;
    const body=document.createElement('div');body.className='sim-path-body';
    body.innerHTML=`<div class="sim-grid2"><div><label for="pin-wait">Pause first · s</label><input id="pin-wait" type="number" min="0" step="any"></div><div><label>Turn here</label><button type="button" class="secondary sim-pin-turn" data-more="pin" title="Turn in place, face a heading or aim at a point at this pin">${finite(p.turn)?pinSteps({turn:p.turn,turnMode:p.turnMode}).split(' → ')[0]:'No turn'} …</button></div></div>
      <h4 class="sim-pop-label sim-steps-title">At this pin, in order</h4><div class="sim-steps" id="pin-steps"></div>
      <div class="sim-path-more"><button type="button" class="text-button" data-more="pin">Pin options…</button>${L().pins[i+1]?`<button type="button" class="text-button" data-open-next>Path ${i+2} →</button>`:''}</div>`;
    li.append(body);const q=s=>body.querySelector(s);
    q('#pin-wait').onchange=e=>{const v=e.target.valueAsNumber;if(!finite(v)||v<0){e.target.setCustomValidity('Enter 0 or more seconds.');e.target.reportValidity();return;}e.target.setCustomValidity('');p.wait=v;changed('plan');};
    stepsEditor(q('#pin-steps'),'pin',p,()=>changed('plan'),`pin-${i}-steps`);
    for(const b of body.querySelectorAll('[data-more]'))b.onclick=e=>openEffects({kind:'pin',index:i},anchorAt(e));
    if(q('[data-open-next]'))q('[data-open-next]').onclick=()=>choosePath(i+1,'path');
    return li;
  }
  // Fills the list from the layout without rebuilding it; the field being typed in keeps its text.
  function syncPaths(){
    const list=$('#sim-pin-list'),l=L(),power=project.tuning.maxPathSpeed??.8,set=(input,v)=>{if(input&&input!==document.activeElement)input.value=v;};
    const first=list.querySelector('.sim-path-start [data-at]');if(first)first.textContent=`${xy(start)} · ${Math.round(start.heading)}°`;
    for(const row of list.querySelectorAll('.sim-stop-row')){const i=Number(row.dataset.pin),p=l.pins[i];if(!p)continue;const what=pinSteps(p);
      row.classList.toggle('acts',!!what);row.querySelector('[data-at]').textContent=xy(p);row.querySelector('.sim-pin-summary').textContent=what||'Drives straight on';
      if(row.classList.contains('selected'))set(row.querySelector('#pin-wait'),p.wait||0);}
    for(const row of list.querySelectorAll('.sim-path-row')){const i=Number(row.dataset.path),p=l.pins[i];if(!p)continue;
      row.classList.toggle('needs-change',pathNeedsChange(i));row.querySelector('[data-at]').textContent=`→ ${xy(p)}`;row.querySelector('.sim-path-swatch').style.background=planner.pathAppearance(p.path,power).color;row.querySelector('.sim-pin-summary').textContent=effectSummary(p);
      if(!row.classList.contains('selected'))continue;const path=planner.pathEffects(p.path),q=s=>row.querySelector(s);
      set(q('#path-x'),field.round(p.x));set(q('#path-y'),field.round(p.y));set(q('#path-heading'),path.rotate);set(q('#path-shape'),path.controls?'custom':path.style||'');set(q('#path-power'),path.power??'');
      (path.controls||[]).forEach((c,j)=>{set(q(`#path-c${j}x`),field.round(c.x));set(q(`#path-c${j}y`),field.round(c.y));});
      if(HEADING_VALUE[path.rotate])set(q('#path-heading-value'),path[HEADING_VALUE[path.rotate][0]]);if(path.target){set(q('#path-target-x'),path.target.x);set(q('#path-target-y'),path.target.y);}}
  }

  // ------------------------------------------------------------------ planning
  let worker=null;
  function planWith(request){
    if(worker===null){try{worker=new Worker('simulation-worker.js');}catch{worker=false;}}
    if(worker)return new Promise((resolve,reject)=>{const id=++planWith.id,w=worker,cleanup=()=>{clearTimeout(timer);w.removeEventListener('message',done);w.removeEventListener('error',failed);},done=event=>{if(event.data?.id!==id)return;cleanup();event.data.error?reject(Object.assign(Error(event.data.error),{issues:event.data.issues||[]})):resolve(event.data.result);},failed=event=>{cleanup();reject(Error(event.message||'The planner stopped. Adjust the route and try again.'));},timer=setTimeout(()=>{cleanup();reject(Error('Planning took too long. Simplify the zones or add intermediate pins.'));},30000);w.addEventListener('message',done);w.addEventListener('error',failed);w.postMessage({id,...request});});
    return script('vendor/planning.js').then(()=>planner.plan(request.project,request.footprint,request.fieldZones,request.field));
  }
  planWith.id=0;
  const planRequest=(style,tension)=>{const l=L(),g=geometry();return {project:{start,zones:l.zones,pins:MECH.prepare(l.pins,project.mechanisms,info?.target),clearance:l.clearance,style,tension,rotate:l.rotate!==false,nonholonomic:!C.drives[project.robot.drivetrain].holonomic,defaultPower:project.tuning.maxPathSpeed??.8},footprint:g.footprint,fieldZones:info?.fieldZones||[],field:g.bounds};};
  const schedulePlan=(()=>{let t;const schedule=()=>{clearTimeout(t);t=setTimeout(()=>void plan(),220);};schedule.cancel=()=>clearTimeout(t);return schedule;})();
  async function plan(){
    if(native){try{await ready();}catch(e){planError=e.message;status('#sim-plan-status',e.message);return null;}}
    const l=L(),seq=++planSeq;refreshDiagnostics();if(!l.pins.length){l.route=null;analysisPending=false;planError='';refreshDiagnostics();draw();status('#sim-plan-status','Add pins to make a route.');return null;}
    if(native&&!info)return null;
    try{const route=await planWith(planRequest(l.style));if(seq!==planSeq||l!==L())return null;route.defaultPower=project.tuning.maxPathSpeed??.8;l.route=route;blockedPin=-1;planError='';diagnostics=[];analysisPending=false;refreshDiagnostics();save();draw();
      const stops=route.stops.filter(s=>s.wait>0).length,avoid=info?.obstacleName?` and ${info.fieldName}'s ${info.obstacleName}`:'';
      status('#sim-plan-status',`Route ready: ${route.length.toFixed(0)} in${stops?`, ${stops} pause${stops>1?'s':''}`:''}. It stays ${(route.clearance/2).toFixed(1)}+ in from your zones${avoid}.`);
      tested();programPanel();void autoExport();scheduleEstimate();return route;
    }catch(e){if(seq===planSeq){l.route=null;planError=e.message;analysisPending=false;diagnostics=e.issues?.length?e.issues:planner.analyze(planRequest(l.style).project,geometry().footprint,info?.fieldZones||[],geometry().bounds);const m=/pin (\d+)/i.exec(e.message);blockedPin=m?Number(m[1])-1:-1;if(!diagnostics.length)diagnostics=[{pin:blockedPin>=0?blockedPin:null,code:'path',message:e.message}];refreshDiagnostics();draw();status('#sim-plan-status',`${diagnostics.length} issue${diagnostics.length===1?'':'s'} found. Open the route checks above the paths for every affected path.`);}return null;}
  }
  // Simulated time for the planned route: once edits settle, the route is test-driven in the background
  // with the same physics and follower as Run (about a second). It is the simulator's estimate, shown as one.
  function routeEstimate(){const e=estimates.get(L().id);return e&&e.route===L().route?e:null;}
  function scheduleEstimate(delay=700){clearTimeout(estimateTimer);if(native&&L().route&&!routeEstimate()?.time)estimateTimer=setTimeout(()=>void estimate(),delay);}
  async function estimate(){
    const l=L(),route=l.route;if(!route||routeEstimate())return;// Wait while a route is being driven; once it has finished (the practice clock may still run) test-drive away.
    if(optimizing||runState==='starting'||runState==='running'&&!frame?.result)return scheduleEstimate(3000);
    const seq=++estimateSeq;estimates.set(l.id,{route,pending:true});refreshDiagnostics();
    try{const [r]=await call('evaluate',[route]),last=l.pins.at(-1);if(seq!==estimateSeq)return;estimates.set(l.id,r?.ok?{route,time:r.time,violations:r.violations,miss:last?Math.hypot(r.truth.x-last.x,r.truth.y-last.y):0}:{route,error:r?.error||'The test drive stopped early.'});}
    catch(e){if(seq===estimateSeq)estimates.set(l.id,{route,error:e.message});}
    if(seq===estimateSeq){refreshDiagnostics();resultsPanel();}
  }
  // Plan each route shape, test-drive them all with the real follower and physics, keep the fastest
  // one that touched no zone and ended on target.
  async function optimize(){
    if(effects.session)return;try{await ready();}catch(e){return status('#sim-plan-status',e.message);}schedulePlan.cancel();const l=L();if(!l.pins.length)return status('#sim-plan-status','Add pins first.');optimizing=true;optimize.layoutId=l.id;transport();const seq=++planSeq,generation=load.seq,request=planRequest(l.style),rows=[],seen=new Set();let chosen=null,reason='';
    const check=()=>{if(seq!==planSeq||generation!==load.seq||l!==L())throw Error('The field changed during optimization. Run Optimize again.');};
    const compare=async candidates=>{const planned=[];for(const candidate of candidates){check();const signature=candidate.styles.join(',');if(seen.has(signature))continue;seen.add(signature);try{planned.push({...candidate,route:await planWith({...request,project:candidate.project})});}catch(e){reason=reason||e.message;}}
      for(let from=0;from<planned.length;from+=6){check();status('#sim-plan-status',`Test-driving shape combinations ${rows.length+1}–${rows.length+Math.min(6,planned.length-from)}…`);const batch=planned.slice(from,from+6),results=await call('evaluate',batch.map(c=>c.route));check();for(const [i,candidate]of batch.entries()){const result=results[i],last=l.pins.at(-1),ok=!!(result?.ok&&result.violations===0&&Math.hypot(result.truth.x-last.x,result.truth.y-last.y)<1.5),row={label:candidate.label,time:result?.time,ok,note:result?.error||(!ok?'touched a zone or missed the final pin':'')};rows.push(row);if(ok&&(!chosen||result.time<chosen.time))chosen={...candidate,time:result.time,row};}}};
    try{const candidates=C.drives[project.robot.drivetrain].holonomic?planner.shapeCandidates(request.project):[{project:request.project,styles:l.pins.map(()=> 'sharp'),label:'Tank route'}];await compare(candidates);if(chosen&&l.pins.length>4)await compare(planner.shapeCandidates(request.project,chosen.styles));
      if(!chosen)throw Error(reason||'No tested route finished clear of obstacles and on target. Increase clearance or move the pins.');check();
      l.pins=chosen.project.pins;l.route=chosen.route;l.tested=rows.map(r=>({...r,best:r===chosen.row}));estimates.set(l.id,{route:chosen.route,time:chosen.time,violations:0,miss:0});refreshDiagnostics();save();draw();pinPanel();tested();programPanel();status('#sim-plan-status',`Fastest tested safe route: ${chosen.label.toLowerCase()} in ${chosen.time.toFixed(2)} s. Explicit path shapes were kept.`);void autoExport();
    }catch(e){status('#sim-plan-status',e.message);}finally{optimizing=false;transport();}
  }
  function tested(){const rows=L().tested||[];$('#sim-tested').replaceChildren(...(rows.length?[Object.assign(document.createElement('div'),{className:'hint',textContent:'Last Optimize test drives:'})]:[]),...[...rows.filter(r=>r.best),...rows.filter(r=>!r.best)].slice(0,6).map(r=>{const d=document.createElement('div');d.className='sim-tested-row'+(r.best?' best':'');d.textContent=`${r.label||STYLES[r.style]||r.style}: ${finite(r.time)&&r.ok?r.time.toFixed(2)+' s':r.note}${r.best?' · fastest tested':''}`;return d;}));}
  $('#sim-optimize').onclick=()=>void optimize();
  for(const b of $$('[data-style]'))b.onclick=()=>{L().style=b.dataset.style;for(const p of L().pins)if(p.path?.shapeAuto)p.path={...p.path,style:null,shapeAuto:false};pressed('style',L().style);changed('plan');};
  for(const b of $$('[data-rotate]'))b.onclick=()=>{L().rotate=b.dataset.rotate==='auto';rotatePanel();changed('plan');};
  function rotatePanel(){const holonomic=C.drives[project.robot.drivetrain].holonomic;pressed('rotate',holonomic?(L().rotate===false?'off':'auto'):'auto');for(const b of $$('[data-rotate]'))b.disabled=!holonomic;
    $('#sim-rotate-note').textContent=!holonomic?'Tank drivetrains always turn the whole chassis between straight legs, backing out to line up when there is no room to turn.':L().rotate===false?'Paths keep the starting heading unless you set a heading or turn on a path or pin. That heading then carries on to the next paths.':'Paths with no heading of their own may turn the robot to get past obstacles. A heading or turn you set on a path or pin always wins, and the next paths start from it. Dashed outlines show where the robot turns on the spot.';}
  $('#sim-clearance').onchange=e=>{L().clearance=Math.max(planner.MIN_CLEARANCE,finite(e.target.valueAsNumber)?e.target.valueAsNumber:L().clearance);e.target.value=L().clearance;changed('plan');};
  $('#sim-clear-pins').onclick=()=>{L().pins=[];selected=null;changed('pins');};
  // A .pp from the Pedro Pathing visualizer (or Deck) replaces the starting pose and paths; one Ctrl+Z undoes it.
  $('#sim-import-pp').onclick=async()=>{try{const file=await api.simFile('pp-open');if(!file)return;const l=L(),fp=geometry().footprint,r=exporter.fromPP(file.text,{field:l.field,bounds:geometry().bounds,robot:{length:fp.front+fp.rear,width:2*fp.half}});
    l.start=start=field.validate({...r.start},geometry());l.pins=r.pins;if(r.zones.length||r.exact)l.zones=r.zones;preview={...start};selected=null;inputs();changed('zones');if(native&&info)void api.sim('start',start).catch(()=>{});
    status('#sim-plan-status',`Imported ${r.pins.length} path${r.pins.length===1?'':'s'} from ${file.name}${r.exact?' exactly as Deck saved them':''}. Ctrl+Z undoes it.${r.notes.length?' '+r.notes.join(' '):''}`);}catch(e){status('#sim-plan-status',e.message);}};
  $('#sim-clear-zones').onclick=()=>{L().zones=[];selected=null;changed('zones');};

  // ------------------------------------------------------------------ export
  // Why there is nothing to export: no paths yet, still planning, or a route issue to fix first.
  const noRoute=()=>!L().pins.length?'Add a path first: click the field in Path planning.':diagnostics.length?`Fix the route issue first (${diagnostics[0].message}) — see the route checks in Path planning.`:planError?`Fix the route first: ${planError}`:'The route is still being planned. Try again in a moment.';
  function exportText(format){
    if(format==='config')return window.DeckSimFtc.robotConfiguration({robot:info?.robot||project.robot,localization:project.sensors.localization,mechanisms:info?.mechanisms||project.mechanisms,kinematics:project.kinematics}).xml;
    const l=L(),route=l.route;if(!route)throw Error(noRoute());
    if(format==='onbot')return teamCode(route,true).source;
    if(format==='motionmodule')return window.DeckSimMotionModule.autonomous(route,{...project.timing,...(project.timing.source==='robot'?info?.timing:{}),power:project.tuning.maxPathSpeed??.8},{name:l.name,mechanisms:info?.mechanisms,target:info?.target,robot:project.robot});
    if(format==='timed')return JSON.stringify({format:'deck-timed-drive-v1',controller:project.controller,units:'inches',feedback:'IMU heading only; no X/Y feedback',notice:'Simulation schedule; not a MotionModule firmware integration.',start,field:l.field,...window.DeckTimed.compile(route,{...project.timing,...(project.timing.source==='robot'?info?.timing:{}),power:project.tuning.maxPathSpeed??.8})},null,2);
    const lay={name:l.name,field:l.field,fieldName:GAMES[l.field],width:l.width,height:l.height,start,zones:l.zones};
    return format==='java'?exporter.java(route,lay,{className:project.export.className,packageName:project.export.packageName,polygon:planner.polygon}):exporter.pp(route,lay,{polygon:planner.polygon,bounds:geometry().bounds,pins:L().pins});
  }
  // MotionModule actions run the team's code in robot_actions.py, created beside autonomous.py once.
  const companion=format=>format==='motionmodule'&&L().route?{name:'robot_actions.py',text:window.DeckSimMotionModule.actionsFile(L().route,{name:L().name,mechanisms:info?.mechanisms})}:undefined;
  // The OnBot Java check TeleOp goes beside the autonomous on every export.
  const beside=format=>{if(format!=='onbot'||!L().route)return undefined;const check=teamCode(L().route,true).check;return [{name:check.name,text:check.source}];};
  async function exportRoute(format){
    try{const text=exportText(format),name=format==='config'?`${(project.setupName||'Deck').replace(/[^\w -]/g,'')||'Deck'} configuration.xml`:format==='onbot'?project.export.className+'Auto.java':format==='java'?project.export.className+'.java':format==='motionmodule'?'autonomous.py':(L().name.replace(/[^\w -]/g,'')||'route')+(format==='timed'?'.json':'.pp');
      const r=await api.simFile('export-save',{key:L().id,format,text,name,keep:project.export.keep,companion:companion(format),beside:beside(format)});
      if(r)status('#sim-export-status',(project.export.keep?`Exported ${r.name}. It updates whenever this route changes.`:`Exported ${r.name}.`)+(r.beside?.length?` Beside it: ${r.beside.join(', ')}, the TeleOp that tests each device on the robot. Upload both to OnBot Java.`:'')+(r.created?` Created ${r.created} for your action code.`:''));}
    catch(e){status('#sim-export-status',e.message);}
  }
  async function autoExport(){
    if(!native||!project.export.keep||!L().route)return;
    for(const format of ['onbot','java','pp','timed','motionmodule']){try{const r=await api.simFile('export-update',{key:L().id,format,text:exportText(format),companion:companion(format),beside:beside(format)});if(r)status('#sim-export-status',`Updated ${r.name}.`);}catch(e){status('#sim-export-status',e.message);}}
  }
  async function exportPanel(){
    exportChecklist();void sendPanel();
    delete $('#sim-export-ready').dataset.pedro;
    $('#sim-export-keep').checked=project.export.keep;$('#sim-export-package').value=project.export.packageName;$('#sim-export-class').value=project.export.className;status('#sim-export-status','');
    if(native&&project.export.keep){try{const t=await api.simFile('export-status',{key:L().id});status('#sim-export-status',t?`Keeping ${t.name} updated.`:'');}catch{}}
  }
  // Everything a Control Hub needs for this route: OpMode, Deck controller configuration, route (and a drive-encoder
  // localizer when used), written under a TeamCode java folder the team picks.
  function teamCode(route,onbot=false){const l=L(),lay={name:l.name,field:l.field,fieldName:GAMES[l.field],width:l.width,height:l.height,start,zones:l.zones};
    if(!info)throw Error('Wait for the simulation to load.');
    const out=window.DeckSimFtc[onbot?'onBotJava':'files']({route,layout:lay,mechanisms:info.mechanisms,kinematics:project.kinematics,target:info.target,tuning:info.tuning,robot:info.robot,localization:project.sensors.localization,setupName:project.setupName,packageName:project.export.packageName,className:project.export.className,
      routeJava:exporter.java(route,lay,{className:project.export.className,packageName:project.export.packageName,polygon:planner.polygon})});
    // What Calibrate checked on the real robot goes with the code it is sent with: TorqueCalibration.java, beside the op modes.
    try{const code=onbot?chassisCal?.code?.():null,first=Object.keys(out.files||{})[0];if(code&&first){const dir=first.slice(0,first.lastIndexOf('/'));out.files[dir+'/TorqueCalibration.java']=`package ${project.export.packageName||'org.firstinspires.ftc.teamcode'};\n\n${code}\n`;}}catch{}
    return out;}
  $('#sim-export-onbot').onclick=()=>void exportRoute('onbot');$('#sim-export-config').onclick=()=>void exportRoute('config');
  // ------------------------------------------------------------------ send to robot
  // A Control Hub on this computer's Wi-Fi: read its configuration and check every device name the OnBot Java export
  // uses, picking the robot's own names where they differ. Devices the robot does not have go into a new configuration
  // (a copy of its active one, or one made from a scan of its hubs), each with the port to plug it into. Then the code
  // is uploaded and built, and the autonomous is selected in Drive. The robot side is src/robot-link.cjs.
  const RobotConfig=window.DeckRobotConfig;let sendState=null;
  // Choices made in the lists, kept while the panel is re-read: robot names by "<host>|<export name>", and ports and
  // motor types of planned devices by the same key.
  const namePicks=new Map(),portPicks=new Map(),pickKey=name=>`${sendState?.host}|${name}`;
  // The same robot and mechanisms the export is generated from.
  const robotNeeds=()=>{const F=window.DeckSimFtc,r=info?.robot||project.robot,m=info?info.mechanisms:project.mechanisms,rows=F.wiredRows(r,project.sensors.localization,m?.enabled?m:null,project.kinematics);
    return rows.length?window.DeckHardware.needs(rows):F.robotNeeds(r,project.sensors.localization,m);};
  const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
  // Send to robot reaches the robot one of two ways: the Control Hub's USB cable, or the robot's own Wi-Fi. Each time the
  // panel shows, the app looks for both (src/main.cjs detect) and picks what it finds, USB first; a pick by hand is kept.
  // The hidden #sim-send-robot holds the chosen address ("usb" or the robot's host) for the send and the guided check.
  const link={usb:null,wifi:null,choice:null,looking:null,at:0};
  // hubLive: what the USB watch last pushed, while it runs (hubPushed below). setupGen goes up each time the Control Hub leaves the cable,
  // so anything started before that can tell, and neither its late answer nor its late error reaches the screen.
  let hubLive=null,setupGen=0,robotSending=0;const HUB_UNPLUGGED='The Control Hub was unplugged. Plug it back in and try again.';
  function detectLink(){if(!native||!api.robotLink)return Promise.resolve();if(link.looking)return link.looking;link.at=Date.now();
    link.looking=(async()=>{try{const d=await api.robotLink('detect');link.usb=hubLive?.status??d.usb;link.wifi=d.wifi;}catch(e){link.usb=hubLive?.status??{found:false,message:e.message};link.wifi=null;}finally{link.looking=null;showLink();mechanismsPanel();robotPanel();}})();showLink();return link.looking;}
  const linkChoice=()=>link.choice||(link.usb?.found?'usb':link.wifi?.robot?'wifi':'usb');
  function showLink(){
    const usb=link.usb,wifi=link.wifi,choice=linkChoice(),looking=!!link.looking&&!usb;
    const usbText=looking?'Looking…':usb?.found?`Control Hub ${usb.serial}`:usb?.message||'Not plugged in.';
    const wifiText=looking?'Looking…':wifi?.robot?`${wifi.name||wifi.ssid} · ${wifi.host}`:wifi?.ssid?`${wifi.ssid} is not a robot network`:'Not on a robot’s Wi-Fi';
    for(const [key,text,found] of [['usb',usbText,!!usb?.found],['wifi',wifiText,!!wifi?.robot]]){const b=$(`[data-link=${key}]`);if(!b)continue;b.setAttribute('aria-checked',String(choice===key));b.dataset.found=looking?'':String(found);$(`#sim-link-${key}`).textContent=text;}
    const select=$('#sim-send-robot'),host=wifi?.host||'192.168.43.1',options=[['usb','the Control Hub on USB'],[host,`${wifi?.name||(wifi?.robot&&wifi.ssid)||'the Control Hub'} (${host})`]];
    if(select.options.length!==2||[...select.options].some((o,i)=>o.value!==options[i][0]||o.text!==options[i][1]))select.replaceChildren(...options.map(([value,text])=>new Option(text,value)));select.value=choice==='usb'?'usb':host;
  }
  for(const b of $$('[data-link]'))b.onclick=()=>{link.choice=b.dataset.link;sendState=null;showCheck();showPlan();$('#sim-send-confirm').hidden=true;status('#sim-send-status','');showLink();};
  $('#sim-link-look').onclick=()=>{link.choice=null;void detectLink();};
  async function crossCheck(){if(!$('#sim-send').hidden)await detectLink();}
  async function sendPanel(){
    // On Simulate, with the USB watch resting, it looks again now and then. detectLink draws the robot panel, which comes back here, so never without the wait.
    const box=$('#sim-send');box.hidden=!native||!api.robotLink||$('#sim-export-onbot').hidden;if(!box.hidden&&!link.looking&&(!link.usb||active&&!hubLive&&Date.now()-link.at>15000))void detectLink();
  }
  // One line per device name: whether the robot has it, and for one it lacks, its devices to choose from (or, for a
  // name it has no device for, adding it to the robot's configuration).
  function showCheck(){
    const list=$('#sim-send-devices'),result=sendState?.result;if(!result){list.replaceChildren();$('#sim-send-apply').hidden=true;return;}
    list.replaceChildren(...result.rows.map((row,i)=>{const li=document.createElement('li'),mark=document.createElement('b'),text=document.createElement('span');
      const good=row.status==='ok'&&!row.duplicate;li.className=good?'ok':'problem';mark.textContent=`${good?'✓':'✗'} ${row.label}`;text.textContent=' '+RobotConfig.explain(row);li.append(mark,text);
      const usable=row.candidates.filter(name=>C.deviceName(name)===name);
      if(!good&&usable.length){const pick=document.createElement('select');pick.dataset.row=String(i);pick.setAttribute('aria-label',`Robot device for ${row.label}`);
        pick.append(new Option(row.status==='missing'&&!row.duplicate?`Add "${row.name}" to the robot`:`Keep "${row.name}"`,''),...usable.map(name=>new Option(`Use "${name}"`,name)));
        const kept=namePicks.get(pickKey(row.name));pick.value=kept!==undefined&&(!kept||usable.includes(kept))?kept:row.suggestion&&usable.includes(row.suggestion)?row.suggestion:'';
        pick.onchange=()=>{namePicks.set(pickKey(row.name),pick.value);refreshPlan();};li.append(pick);}
      return li;}));
    $('#sim-send-apply').hidden=!list.querySelector('select');
  }
  // The robot devices picked for names: {export name: robot name}.
  const pickedNames=()=>Object.fromEntries($$('#sim-send-devices select').map(s=>[sendState?.result?.rows[+s.dataset.row]?.name,s.value]).filter(([mine,theirs])=>mine&&theirs));
  // scan: also scan the robot's hubs, which adding devices needs.
  async function readRobot(scan=false){
    const host=$('#sim-send-robot').value,label=$('#sim-send-robot').selectedOptions[0]?.textContent||host,gen=setupGen;status('#sim-send-status',`Reading the configuration of ${label}…`);$('#sim-send-confirm').hidden=true;
    try{const robot=host==='usb'?{...await api.robotLink('read-usb'),usb:true}:await api.robotLink('read',{host,scan});if(host==='usb'&&gen!==setupGen)return null;sendState={host,label,robot,result:RobotConfig.check(robotNeeds(),robot)};showCheck();showPlan();
      if(!robot.active){status('#sim-send-status',`The robot has no active configuration${robot.configurations.length?` (it has ${robot.configurations.join(', ')}: you can activate one on the Driver Station, in Configure Robot)`:''}. Send to robot makes one for this code.`);return sendState;}
      const bad=sendState.result.rows.filter(r=>r.status!=='ok'||r.duplicate).length;
      status('#sim-send-status',bad?`${bad} of ${sendState.result.rows.length} device names do not match the configuration “${robot.active.name}”. Pick the robot's own names below, or let Send to robot add the devices.`:`Every device name matches the configuration “${robot.active.name}” (${sendState.result.rows.length} devices).${sendState.result.unused.length?` Not used by this code: ${sendState.result.unused.map(d=>d.name).join(', ')}.`:''}`);
      return sendState;}
    catch(e){sendState=null;showCheck();showPlan();status('#sim-send-status',host==='usb'&&gen!==setupGen?HUB_UNPLUGGED:e.message);return null;}
  }
  // The picked robot names go into the setup: drive and sensor names (Robot controller) and mechanism names (Mechanisms).
  function usePicks(chosen){const m=structuredClone(project.mechanisms),devices={...(project.robot.devices||{})},base=deviceDefaults();let robotChanged=false,count=0;
    for(const row of sendState.result.rows){const name=chosen[row.name];if(!name)continue;count++;
      if(row.setting.robot){const key=row.setting.robot,entry={...(devices[key]||{}),name};if(name===base.find(s=>s.key===key)?.name)delete entry.name;if(Object.keys(entry).length)devices[key]=entry;else delete devices[key];robotChanged=true;}
      else{const part=m[row.setting.list]?.[row.setting.index];if(part)part[row.setting.field]=name;}}
    if(!count)return 0;for(const mine of Object.keys(chosen))namePicks.delete(pickKey(mine));
    project.mechanisms=MECH.sanitize(m);if(robotChanged)project.robot=C.robot({...project.robot,devices},project.controller);save();mechanismsPanel();robotPanel();reload();return count;}
  $('#sim-send-apply').onclick=()=>{if(!sendState)return;const count=usePicks(pickedNames());if(!count)return status('#sim-send-status','Pick a robot device for at least one name first.');
    sendState.result=RobotConfig.check(robotNeeds(),sendState.robot);showCheck();refreshPlan();
    status('#sim-send-status',`Using ${plural(count,'name')} from the robot.${sendState.result.ok?' Every device name matches now.':''} The setup is saved with them.`);};
  // The devices to add: names the robot has no device for and no robot device was picked for, on planned ports (or the
  // ports picked instead). A robot with an active configuration gets a copy of it with them added; one without gets a
  // configuration of every hub its scan found. null: nothing to add; {scan: true}: the robot's hubs are not known yet.
  function makePlan(){
    const s=sendState,chosen=pickedNames(),adds=RobotConfig.missingDevices(s.result.rows.filter(r=>!chosen[r.name]));if(!adds.length||s.robot.usb)return null;if(!s.robot.portals)return {scan:true};
    const fresh=!s.robot.active,context={modules:fresh?RobotConfig.modulesFromScan(s.robot.portals):RobotConfig.modulesOf(s.robot,s.robot.portals),devices:fresh?[]:s.robot.devices};
    let {assignments,problems}=RobotConfig.planPorts(adds.map(a=>a.device==='motor'&&portPicks.get(pickKey(a.name))?.motorType?{...a,motorType:portPicks.get(pickKey(a.name)).motorType}:a),context);
    for(const a of [...assignments]){const key=portPicks.get(pickKey(a.name))?.key,at=assignments.findIndex(b=>b.name===a.name);
      if(key&&RobotConfig.portChoices(assignments,at,context).some(c=>c.key===key&&!c.taken))assignments=RobotConfig.movePort(assignments,at,key,context);}
    const name=RobotConfig.configurationName(fresh?`Deck ${project.setupName||L().name}`:`${s.robot.active.name} Deck`,s.robot.configurations);
    return {fresh,assignments,problems,context,name,unseen:context.modules.filter(m=>m.missing).map(m=>m.name)};
  }
  // The planned devices: each with the port to plug it into (a list to move it to the port it is already in) and, for a
  // motor, its type. done: after saving, as a plain wiring list.
  function showPlan(done=false){
    const box=$('#sim-send-plan'),plan=sendState?.plan;box.hidden=!plan?.assignments||!plan.assignments.length&&!plan.problems.length;if(box.hidden)return;const from=sendState.robot.active?.name;
    $('#sim-send-plan-title').textContent=done?`Plug these into the robot (configuration “${plan.name}”)`:plan.fresh?`New configuration “${plan.name}”`:`Added to a copy of “${from}”, saved as “${plan.name}”`;
    $('#sim-send-plan-note').textContent=done?'The robot now expects each device on this port: the code cannot drive one plugged in somewhere else.':`Plug each device into the port beside it, or pick the port it is already in.${plan.fresh?'':` “${from}” stays as it is.`}${plan.unseen.length?` The robot did not report ${plan.unseen.join(' or ')}: check its cable.`:''}`;
    $('#sim-send-ports').replaceChildren(...plan.assignments.map((a,i)=>{const li=document.createElement('li'),head=document.createElement('div'),mark=document.createElement('b'),text=document.createElement('span');mark.textContent=a.name;text.textContent=` ${a.label}`;head.append(mark,text);li.append(head);
      const choices=done?[]:RobotConfig.portChoices(plan.assignments,i,plan.context),type=a.device==='motor'?`, ${RobotConfig.MOTOR_TYPES[a.tag]||a.tag}`:'';
      if(!choices.length){const at=document.createElement('span');at.textContent=`: ${RobotConfig.portLabel(a)}${a.device==='imu'?' (the hub’s own IMU)':done?type:''}`;head.append(at);}
      else{const port=document.createElement('select');port.setAttribute('aria-label',`Port for ${a.label}`);
        port.append(...choices.map(c=>{const o=new Option(c.label+(c.taken?` (has ${c.taken})`:c.swap?` (swap with ${c.swap})`:''),c.key);o.disabled=!!c.taken;return o;}));port.value=RobotConfig.portKeyOf(a);
        port.onchange=()=>{let moved;try{moved=RobotConfig.movePort(plan.assignments,i,port.value,plan.context);}catch(e){return status('#sim-send-status',e.message);}
          for(const b of moved)portPicks.set(pickKey(b.name),{...portPicks.get(pickKey(b.name)),key:RobotConfig.portKeyOf(b)});refreshPlan();};li.append(port);
        if(a.device==='motor'){const kind=document.createElement('select');kind.setAttribute('aria-label',`Motor type for ${a.label}`);kind.append(...Object.entries(RobotConfig.MOTOR_TYPES).map(([tag,label])=>new Option(label,tag)));kind.value=a.tag;
          kind.onchange=()=>{portPicks.set(pickKey(a.name),{...portPicks.get(pickKey(a.name)),motorType:kind.value});refreshPlan();};li.append(kind);}}
      return li;}),...plan.problems.map(p=>{const li=document.createElement('li');li.className='problem';li.textContent=p;return li;}));
  }
  // After a pick or a port changes. A device newly left to add on a robot not scanned yet needs Send to robot again.
  function refreshPlan(){
    if(!sendState?.result||!sendState.plan&&$('#sim-send-confirm').hidden)return;const plan=makePlan();
    if(plan?.scan){sendState.plan=null;showPlan();$('#sim-send-confirm').hidden=true;return status('#sim-send-status','Press Send to robot again: Deck scans the robot to plan the devices to add.');}
    sendState.plan=plan;showPlan();if(!$('#sim-send-confirm').hidden)summary();
  }
  // What Send does, in order: the names picked, the configuration, the upload. Nothing runs on the robot.
  function summary(){
    const s=sendState,plan=s.plan,chosen=Object.entries(pickedNames()),steps=[],adding=plan?.assignments?.length||0;
    if(chosen.length)steps.push(`Use the robot's own names: ${chosen.map(([mine,theirs])=>`“${theirs}” for “${mine}”`).join(', ')}. The setup is saved with them.`);
    if(adding)steps.push(plan.fresh?`Save a new configuration “${plan.name}” with the robot's hubs and ${plural(adding,'device')} (below, with the port for each). It becomes the active configuration, and the robot restarts.`
      :`Save “${plan.name}”: a copy of “${s.robot.active.name}” with ${plural(adding,'device')} added (below, with the port for each). It becomes the active configuration, and the robot restarts.`);
    if(s.robot.usb){const missing=RobotConfig.missingDevices(s.result.rows.filter(r=>!chosen[r.name])).length;if(missing)steps.push(`${plural(missing,'device')} the code uses ${missing>1?'are':'is'} not in “${s.robot.active?.name}”. Over USB Deck does not change the configuration: add ${missing>1?'them':'it'} in Configure Robot (on the robot’s Wi-Fi, or in Setup & Calibrate), or the autonomous stops at INIT.`);}
    steps.push(`Upload ${s.fileNames.join(' and ')} to ${s.label} and build them. Files with these names are replaced; one that was changed on the robot is copied to this computer first.`);
    const left=s.result.rows.filter(r=>!chosen.some(([mine])=>mine===r.name)&&(r.status==='kind'||r.duplicate)).length+(plan?.problems?.length||0);
    $('#sim-send-summary').textContent=left?`${plural(left,'device')} will still not match the robot, and the autonomous stops at INIT until ${left>1?'they do':'it does'} (see below).`:'';
    $('#sim-send-steps').replaceChildren(...steps.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));$('#sim-send-yes').textContent=adding?'Save and send':'Upload and build';
  }
  // Send: check the robot (scanning its hubs when devices are to be added), say what will happen, then do it all on a
  // second press.
  $('#sim-send-go').onclick=async()=>{
    if(!L().route)return status('#sim-send-status',noRoute());if(!info)return status('#sim-send-status','Wait for the simulation to load.');
    let check=await readRobot();if(!check)return;let out;try{out=teamCode(L().route,true);}catch(e){return status('#sim-send-status',e.message);}
    if(makePlan()?.scan){status('#sim-send-status',`Scanning the hubs of ${check.label}…`);check=await readRobot(true);if(!check)return;}
    check.plan=makePlan();check.fileNames=Object.keys(out.files).map(f=>f.split('/').pop());showPlan();summary();$('#sim-send-confirm').hidden=false;$('#sim-send-yes').focus();};
  $('#sim-send-no').onclick=()=>{$('#sim-send-confirm').hidden=true;status('#sim-send-status','Nothing was sent.');};
  $('#sim-send-yes').onclick=async()=>{const s=sendState;if(!s?.fileNames)return;const plan=s.plan?.assignments?.length?s.plan:null,chosen=pickedNames(),gen=setupGen;$('#sim-send-confirm').hidden=true;$('#sim-send-go').disabled=true;robotSending++;
    try{
      if(usePicks(chosen))await ready();
      if(plan){status('#sim-send-status',`Saving the configuration “${plan.name}” on ${s.label}…`);
        await api.robotLink('configure',{host:s.host,name:plan.name,xml:plan.fresh?RobotConfig.newConfiguration(s.robot.portals,plan.assignments):RobotConfig.addDevices(s.robot.xml,plan.assignments)});
        for(const a of plan.assignments)portPicks.delete(pickKey(a.name));}
      // The code is generated now, with the names just picked.
      const out=teamCode(L().route,true),opModes=[out.source,out.check.source].map(src=>(/@(?:Autonomous|TeleOp)\(name = "((?:\\.|[^"\\])*)"/.exec(src)||[])[1]).filter(Boolean);
      status('#sim-send-status',`Uploading to ${s.label}…`);const r=await api.robotLink('send',{host:s.host,files:out.files});
      const saved=plan?`Saved “${plan.name}” as the robot's active configuration (the robot restarted). `:'',kept=r.backups.length?` The robot's earlier ${r.backups.map(f=>f.split(/[\\/]/).pop().replace(/^[\d-TZ]+-/,'')).join(' and ')} ${r.backups.length>1?'are':'is'} kept in ${r.backups[0].replace(/[\\/][^\\/]+$/,'')}.`:'';
      let picked='';if(r.built&&opModes[0]&&s.host!=='usb')try{await api.robotLink('select',{host:s.host,opMode:opModes[0]});picked=` In Drive, “${opModes[0]}” is selected when you open this robot.`;}catch{}
      status('#sim-send-status',r.built?`${saved}Built on the robot in ${r.seconds} s. ${plan?'Plug in the devices listed below, then on':'On'} the Driver Station, run “${opModes[1]||'the check TeleOp'}” (TeleOp) first to test each device, then “${opModes[0]||'the autonomous'}” (Autonomous).${picked}${kept}`
        :`${saved}Uploaded, but the robot could not build it${r.errors.length?`: ${r.errors.slice(0,3).map(e=>`${e.file} line ${e.line}: ${e.message}`).join('; ')}`:'.'} An error in any OnBot Java file stops the whole build, including files Deck did not send.`);
      sendState={...s,result:null,fileNames:null};showCheck();showPlan(true);}
    catch(e){status('#sim-send-status',s.host==='usb'&&gen!==setupGen?HUB_UNPLUGGED:e.message);}finally{robotSending--;$('#sim-send-go').disabled=false;}};
  if(native&&api.onRobotLink)api.onRobotLink(({stage,file})=>status('#sim-send-status',stage==='uploading'?`Uploading ${file}…`:'Building on the robot… (this takes up to a minute)'));
  // ------------------------------------------------------------------ guided check
  // The check TeleOp, run from here (src/robot-link.cjs runCheck): Deck starts it on the robot, shows each step with its
  // answers as buttons that press gamepad 1's on the robot, and puts the results into the setup.
  let checking=null;
  const checkOpModeName=()=>{try{const out=teamCode(L().route,true);return (/@TeleOp\(name = "((?:\\.|[^"\\])*)"/.exec(out.check.source)||[])[1]?.replace(/\\(.)/g,'$1')||null;}catch{return null;}};
  const ARROWS={up:'▲',down:'▼',left:'◀',right:'▶'};
  // The check's answers line ("A: yes | B: no, the other way | D-pad up/down: move") as gamepad buttons.
  function answerButtons(text){
    const out=[];for(const part of String(text||'').split(' | ')){const at=part.indexOf(': ');if(at<0)continue;const key=part.slice(0,at),label=part.slice(at+2);
      if(/^[ABXY]$/.test(key))out.push({button:key.toLowerCase(),text:`${key} · ${label}`});
      else{const pad=/^D-pad ((?:up|down|left|right)(?:\/(?:up|down|left|right))*)$/.exec(key);if(pad)for(const dir of pad[1].split('/'))out.push({button:'dpad_'+dir,text:`${ARROWS[dir]} ${label}`});}}
    return out;}
  $('#sim-export-teamcode').onclick=async()=>{try{if(!L().route)throw Error(noRoute());const out=teamCode(L().route),r=await api.simFile('teamcode-save',{files:out.files,keep:out.keep,retire:out.retire});if(r)status('#sim-export-status',`Wrote ${r.count} TeamCode files under ${r.name}${r.kept?.length?` (kept your ${r.kept.join(', ')})`:''}.${r.retired?.length?` Took the empty ${r.retired.join(', ')} out of your RobotActions.java: Deck runs ${r.retired.length>1?'those actions':'that action'} itself now (the old file is beside it, as RobotActions.java.bak).`:''} OpMode: ${out.opMode.split('.').pop()}. Mechanism code goes in RobotActions.java.`);}catch(e){status('#sim-export-status',e.message);}};
  // Pedro Pathing 3: the route, its OpMode and action slots for a TeamCode built from the Pedro Quickstart.
  function pedroCode(route){const l=L(),lay={name:l.name,field:l.field,fieldName:GAMES[l.field],width:l.width,height:l.height,start,zones:l.zones};if(!info)throw Error('Wait for the simulation to load.');
    return window.DeckSimPedro.files({route,layout:lay,mechanisms:info.mechanisms,kinematics:project.kinematics,localization:project.sensors.localization,target:info.target,robot:info.robot,setupName:project.setupName,packageName:project.export.packageName,className:project.export.className,defaultPower:project.tuning.maxPathSpeed??.8,hardware:window.DeckSimFtc.hardwareIfSupported(info.robot,project.sensors.localization),tuning:info.tuning});}
  $('#sim-export-pedro').onclick=async()=>{try{if(!L().route)throw Error(noRoute());const out=pedroCode(L().route),r=await api.simFile('teamcode-save',{files:out.files,keep:out.keep,retire:out.retire});if(r){status('#sim-export-status',`Wrote ${r.count} Pedro Pathing ${window.DeckSimPedro.PEDRO_VERSION} files under ${r.name}${r.kept?.length?` (kept your ${r.kept.join(', ')})`:''}. OpMode: ${out.opMode.split('.').pop()}. It uses the Follower from your Quickstart's pedro/Constants.java.`);$('#sim-export-ready').dataset.pedro='1';checklist(out.checklist);}}catch(e){status('#sim-export-status',e.message);}};
  // What an export proves and what the team still has to do, shown under the export buttons.
  // The Control Hub checklist for the current route; re-read when opened, since the route may have been re-planned.
  function exportChecklist(){try{const route=L().route;checklist(project.controller==='motionmodule'?[]:window.DeckSimFtc.checklist({mechanisms:info?.mechanisms?.enabled?info.mechanisms:null,actions:route?exporter.actions(route):[]}));}catch{checklist([]);}}
  $('#sim-export-ready').ontoggle=e=>{if(e.target.open&&!e.target.dataset.pedro)exportChecklist();};
  function checklist(items){const list=$('#sim-export-checklist');list.replaceChildren(...items.map(c=>{const li=document.createElement('li');li.dataset.status=c.status;const b=document.createElement('strong');b.textContent=c.label+(c.status==='verified'?' · checked by Deck':c.status==='physical'?' · needs your robot':c.status==='calibration'?' · tune on your robot':' · your setup');li.append(b,document.createTextNode(' '+c.detail));return li;}));$('#sim-export-ready').hidden=!items.length;}
  $('#sim-export-motionmodule').onclick=()=>void exportRoute('motionmodule');
  $('#sim-export-java').onclick=()=>void exportRoute('java');$('#sim-export-pp').onclick=()=>void exportRoute('pp');$('#sim-export-timed').onclick=()=>void exportRoute('timed');
  $('#sim-export-keep').onchange=e=>{project.export.keep=e.target.checked;save();if(!project.export.keep&&native)void api.simFile('export-forget',{key:L().id}).catch(()=>{});status('#sim-export-status',project.export.keep?'Export once; the file then follows every route change.':'');};
  $('#sim-export-package').onchange=e=>{try{exporter.validName(project.export.className,e.target.value.trim());project.export.packageName=e.target.value.trim();save();status('#sim-export-status','');}catch(err){status('#sim-export-status',err.message);}};
  $('#sim-export-class').onchange=e=>{try{exporter.validName(e.target.value.trim(),project.export.packageName);project.export.className=e.target.value.trim();save();status('#sim-export-status','');}catch(err){status('#sim-export-status',err.message);}};

  // ------------------------------------------------------------------ run
  function programPanel(){pressed('program',project.program.kind);$('#sim-program-note').textContent=project.program.kind==='opmode'?'Run plays the exact single-file OnBot Java export, the file Send to robot uploads, on a virtual Control Hub with simulated motors, encoders and IMU.':project.program.kind==='source'?'Run plays your own Java autonomous using the Deck controller API. Compiler errors and println messages appear in Diagnostics → Run output.':'Run drives your planned route with the Deck controller. Each step below comes from the saved path and pin settings.';$('#sim-source-box').hidden=project.program.kind!=='source';$('#sim-source').value=project.program.source;$('#sim-source-name').textContent=project.program.name?`Program · ${project.program.name}`:'Program';
    const box=$('#sim-program-preview');box.hidden=project.program.kind==='source';const route=L().route;box.textContent=route?exporter.legs(route).map((leg,i)=>`${i+1}. Path ${leg.path}: ${leg.power??route.defaultPower??project.tuning.maxPathSpeed} motor power${leg.rotate?' · '+leg.rotate:''}${leg.moving?.action?' · '+leg.moving.action+' while driving':''}${leg.turn!==null?' · then face '+field.round(leg.turn)+'°':''}${leg.wait?' · pause '+leg.wait+' s':''}${leg.action?' · '+leg.action:''}`).join('\n'):'Add route pins in Path planning to generate the autonomous steps.';
  }
  for(const b of $$('[data-program]'))b.onclick=()=>{project.program.kind=b.dataset.program;save();programPanel();transport();};
  $('#sim-source').oninput=e=>{project.program.source=e.target.value;save();};
  $('#sim-java-example').onclick=()=>{project.program={kind:'source',name:'MyAuto.java',source:EXAMPLE};save();programPanel();};
  $('#sim-java-open').onclick=async()=>{try{const file=await api.simFile('java-open');if(file){project.program={kind:'source',name:file.name,source:file.source};save();programPanel();}}catch(e){status('#sim-run-status',e.message);}};
  $('#sim-run').onclick=async()=>{
    // Run shows Results, where the run is graphed and then reported; a Java program being edited under Export stays open.
    if(!(project.program.kind==='source'&&runViews?.shown()===1))showRunView(0);
    const attempt=++runAttempt;$('#sim-error').hidden=true;status('#sim-run-status','Starting…');runState='starting';transport();
    try{
      await ready();if(attempt!==runAttempt)return;schedulePlan.cancel();const teleop=project.practice.mode==='teleop',needsRoute=['route','opmode'].includes(project.program.kind)&&!teleop;let route=L().route;if(needsRoute)route=await plan();
      if(attempt!==runAttempt)return;
      if(!route&&needsRoute){runState='idle';transport();return status('#sim-run-status',L().pins.length?`The route can't be planned yet: ${planError||'check the Path planning tab.'}`:'No route yet. Add at least one path in Path planning first.');}
      const exported=project.program.kind==='opmode'&&!teleop?teamCode(route,true):null;
      const payload={kind:project.program.kind,preview:needsRoute,source:project.program.kind==='source'?project.program.source:undefined,files:exported?.files,opMode:exported?.opMode,route:route?{heading:route.heading,segments:route.segments,stops:route.stops,turns:!!route.turns,nonholonomic:!!route.nonholonomic,effects:!!route.effects}:null};
      trail=[];lastReport=null;reportKey='';reviewLeg=null;runData?.reset();setTool('select');const r=await api.sim('practice',{mode:project.practice.mode,timing:project.practice,program:payload});if(attempt!==runAttempt)return;if(!r.ok){runState='idle';if(r.error!=='Stopped.')status('#sim-run-status',r.error);}else{runState='running';if(teleop)status('#sim-run-status','Teleop practice started. Centre the controller sticks to enable driving.');}
    }catch(e){runState='idle';status('#sim-run-status',e.message);}transport();
  };
  // Pause holds the run where it is (the clock, the robot and every piece); Resume carries on from there.
  $('#sim-play').onclick=$('#sim-pause').onclick=()=>void call(frame?.playing?'pause':'play').catch(e=>status('#sim-run-status',e.message));
  // A run belongs to its setup: opening another setup stops it and clears its replay, graphs and report.
  function clearRun(){runAttempt++;runState='idle';trail=[];frame=null;liveFrame=null;lastReport=null;reportKey='';reviewLeg=null;reportShown=-1;runData?.reset();$('#sim-run-report').replaceChildren();$('#sim-run-analysis').hidden=true;if(resultsReady)resultsReady.dataset.key='';$('#sim-error').hidden=true;status('#sim-run-status','');if(native&&info)void call('stop').catch(()=>{});if(!take){studio?.clear();studioRun=null;videoTab();}transport();}
  function stopRun(){runAttempt++;runState='idle';status('#sim-run-status','Stopped. Press Run to start again.');transport();void call('stop').catch(e=>status('#sim-run-status',e.message));}
  $('#sim-stop').onclick=stopRun;
  $('#sim-reset').onclick=()=>{runAttempt++;runState='idle';trail=[];void call('reset').catch(e=>status('#sim-run-status',e.message));};
  $('#sim-speed').onchange=e=>void call('speed',Number(e.target.value)).catch(()=>{});
  const clockText=seconds=>`${Math.floor(Math.ceil(seconds)/60)}:${String(Math.ceil(seconds)%60).padStart(2,'0')}`;
  function practicePanel(current=frame?.practice){pressed('practice',project.practice.mode);$('#sim-run').textContent={autonomous:'Run autonomous',teleop:'Run teleop',match:'Run full match'}[project.practice.mode];for(const [id,k] of [['#sim-auto-seconds','autoSeconds'],['#sim-transition-seconds','transitionSeconds'],['#sim-teleop-seconds','teleopSeconds']])if(document.activeElement!==$(id))$(id).value=project.practice[k];
    const p=project.practice,sum=$('#sim-period-summary');if(sum)sum.textContent=p.mode==='autonomous'?`Autonomous period · ${p.autoSeconds} s`:p.mode==='teleop'?`Teleop period · ${p.teleopSeconds} s`:`Periods · ${p.autoSeconds} s auto, ${p.transitionSeconds} s transition, ${p.teleopSeconds} s teleop`;
    $('#sim-practice-phase').textContent=current?{auto:'Autonomous',transition:'Transition · controls locked',teleop:current.neutralRequired?'Teleop · centre sticks':'Teleop · Controller 1',finished:'Complete'}[current.phase]:'Ready';$('#sim-practice-time').textContent=clockText(current?.remaining??(project.practice.mode==='teleop'?project.practice.teleopSeconds:project.practice.autoSeconds));
    $('#sim-practice-help').textContent=project.practice.mode==='autonomous'?'Autonomous only. Controller driving stays disabled.':project.practice.mode==='match'?'Auto → transition → teleop. Early autonomous completion holds still until its timer ends. Controller 1 is enabled only in teleop.':'Controller 1: left stick moves, right stick turns, left bumper slows down. Release both sticks after starting or reconnecting.';
    if(project.mechanisms.enabled&&project.practice.mode!=='autonomous')$('#sim-practice-help').textContent+=` Mechanisms in teleop: right bumper intakes, left trigger spins up, right trigger shoots${project.mechanisms.intakes?.some(i=>i.kind==='ramp')?', Y folds the ramp down or back up (keyboard: E, Shift, G, F)':' (keyboard: E, Shift, G)'}.`;
    $('[data-program]').parentElement.hidden=project.practice.mode==='teleop'||project.controller==='motionmodule';if($('#sim-run-program'))$('#sim-run-program').hidden=$('[data-program]').parentElement.hidden;$('#sim-source-box').hidden=project.practice.mode==='teleop'||project.controller==='motionmodule'||project.program.kind!=='source';
  }
  for(const b of $$('[data-practice]'))b.onclick=()=>{if(native&&(frame?.playing||frame?.practice))void call('stop');project.practice.mode=b.dataset.practice;save();practicePanel(null);transport();};
  for(const [id,key] of [['#sim-auto-seconds','autoSeconds'],['#sim-transition-seconds','transitionSeconds'],['#sim-teleop-seconds','teleopSeconds']])$(id).onchange=e=>{const n=e.target.valueAsNumber;if(finite(n)){project.practice[key]=Math.max(key==='transitionSeconds'?0:.000001,n);save();}e.target.value=project.practice[key];window.DeckNumberSliders?.sync(e.target);practicePanel();};

  // ------------------------------------------------------------------ robot and model
  // Preset robots (ui/sim-preset-robots.js) set the drivetrain, size, motors, CAD, robot controller, wiring and
  // mechanisms in one click, and bring a demo route on a field of their own. Their settings are shown but locked
  // (inert); Custom robot (Customize this robot) keeps the same robot with every setting open to change.
  const PR=()=>window.DeckPresetRobots;let chassisEdit=false,presetPicking=false;
  function presetPanel(){
    reliableNote();
    const id=project.robotPreset,preset=id&&MECH.PRESETS[id],lock=!!preset,adjust=!!preset?.adjustable,fixed=lock&&!adjust,picking=!id&&presetPicking;
    for(const b of $$('[data-robot-source]'))b.setAttribute('aria-pressed',String(b.dataset.robotSource===(id||picking?'preset':'custom')));
    $('#sim-presets').hidden=true;$('#sim-robot-custom').hidden=false;demoPanel();
    for(const b of $$('[data-preset]'))b.setAttribute('aria-pressed',String(b.dataset.preset===id));
    const r=project.robot;$('#sim-preset-note').textContent=preset?`${C.drives[r.drivetrain].name}, ${r.length} × ${r.width} in, ${r.massLb} lb, ${r.driveRpm} RPM wheels; ${MECH.summary(project.mechanisms).replace(/\.$/,'')}.`:'';
    $('#sim-preset-lock').hidden=!lock;$('#ctl-preset').hidden=!lock;$('#mech-preset').hidden=!lock;
    // The Robot step shows a preset as its card alone; one a team builds itself (adjustable: the Starter Mecanum kit)
    // also shows its size, weight, wheels and power, and its wiring stays open in Robot controller.
    document.querySelector('[data-setup-page=robot]').dataset.preset=!lock?'':adjust?'adjust':'fixed';
    if(lock){const route=builtin(project.setupId)&&L().pins.length?' Its route is planned and optimized: press Run in Run & review.':'';
      const kept=project.customRobot?` Your own robot${project.customRobot.model?.name?` (${project.customRobot.model.name})`:''} is kept: Custom robot brings it back.`:'';
      $('#sim-preset-lock-text').textContent=builtin(project.setupId)?(adjust?`${project.setupName}: goBILDA’s Strafer chassis kit, with its size, weight, wheels and motors as goBILDA lists them. Set its auto power and driving style below, and in Chassis say where each motor is plugged in, whether its encoder cable is in, and whether odometry is plugged in. Nothing else changes.`:`${project.setupName} is ready to run and can’t be changed. Make a new setup for your own robot.`):adjust?`${preset.name} is ready to drive.${route}${kept} It is goBILDA’s Strafer chassis kit, with its size, weight, wheels and motors as goBILDA lists them. Set its auto power and driving style below, and in step 3 (Chassis) say where each motor is plugged in, whether its encoder cable is in, and whether odometry is plugged in. To change anything else, choose Customize this robot.`
        :`${preset.name} is ready to drive: its CAD, size, motors, robot controller and mechanisms are set up and can’t be changed.${route}${kept} To change anything, choose Customize this robot: it becomes a custom robot that starts from this one.`;
      $('#ctl-preset-text').textContent=adjust?`The ${preset.name} runs on one Control Hub with its built-in IMU. Set up from your Control Hub, or say below where each motor is plugged in, whether its encoder cable is in, and whether odometry is plugged in.`
        :`These are the ${preset.name} preset’s controller, sensors and wiring, and they can’t be changed. To change them, choose Customize this robot (Custom robot in step 2).`;
      $('#mech-preset-text').textContent=(project.mechanisms.enabled?`These are the ${preset.name} preset’s mechanisms, rigged on its CAD, and they can’t be changed.`:`The ${preset.name} has no mechanisms: it pushes pieces.`)+' To add or change mechanisms, choose Customize this robot (Custom robot in step 2).';}
    aboutPreset(lock&&builtin(project.setupId)&&!adjust);
    // Mechanisms is closed on a kit, so its wheels, power and driving style stay beside its size, and its ports go on Robot controller.
    {const box=$('#sim-drive-settings'),specs=$('#sim-robot-custom .sim-robot-specs'),ports=$('#mech-drive-ports'),ctlPorts=$('#sim-ctl-ports');if(adjust){if(box.parentElement!==specs)specs.append(box);if(ports.parentElement!==ctlPorts)ctlPorts.append(ports);}else{if(ports.parentElement===ctlPorts)$('#mech-drive').append(ports);if(box.parentElement===specs)$('#mech-drive').insertBefore(box,ports);}}
    // What runs the robot: its settings (hub mounting, device names, the robot's configuration, timed driving) go in
    // Chassis → Robot controller; a kit keeps them on its Chassis page.
    {const cols=$('#sim-ctl-cols'),body=$('#mech-controller-body'),mount=$('#sim-hub-mount'),page=document.querySelector('[data-setup-page=controller]');
      if(!adjust){if(cols.parentElement!==body)body.append(cols);if(mount.parentElement!==body)body.prepend(mount);mount.after($('#mech-controller-imu'));}
      else{if(cols.parentElement===body)page.querySelector('.sim-setup-nav').before(cols);if(mount.parentElement===body)$('#sim-imu-note').after(mount);}}
    $('#sim-robot-custom').toggleAttribute('data-locked',lock);const ctl=document.querySelector('[data-setup-page=controller]');
    $('#sim-robot-custom .sim-robot-specs').inert=fixed;
    // The kit's size, weight, wheel speed and wheel size are goBILDA's and cannot be typed over; how hard it drives by itself and the driving style stay open.
    for(const el of [document.querySelector('#sim-robot-custom .sim-hitbox'),$('#sim-rpm')?.closest('.start-xy')])if(el){el.inert=adjust;el.toggleAttribute('data-kit-fixed',adjust);}
    // Its odometry, when it has any, sits where goBILDA's pods go: set values, shown and not asked for.
    odometryPanel();$('#sim-ctl-cols').inert=fixed;for(const el of ctl.querySelectorAll('.sim-ctl-choice,#sim-sensor-cards,#sim-imu-cards'))el.inert=lock;
    ctl.toggleAttribute('data-locked',lock);document.querySelector('[data-setup-page=mechanisms]').toggleAttribute('data-locked',lock);
    for(const b of $$('[data-preset-customize]'))b.hidden=builtin(project.setupId)&&!project.customRobot;
    chassisEdit=false;$('#mech-chassis-edit').checked=false;document.querySelector('[data-setup-page=mechanisms]').toggleAttribute('data-chassis',false);
  }
  // The demo setups are run, not edited: the field, the route and the robot stay as made. The Starter Mecanum demo, a kit
  // teams build, keeps its size, weight, wheels, power and driving style open, and in Robot controller (Control Hub only)
  // its motor ports, I2C buses and whether it has a Pinpoint.
  function demoPanel(){const demo=builtin(project.setupId),kit=demo&&!!MECH.PRESETS[project.robotPreset]?.adjustable;
    document.querySelector('[data-setup-page=field] .sim-setup-cols').inert=demo;for(const id of ['#sim-start-step','#sim-obstacle-step','#sim-route-step'])$(id).inert=demo;
    $('.sim-toolbar [data-tool]').parentElement.classList.toggle('sim-demo-locked',demo);root.toggleAttribute('data-demo',demo);
    document.querySelector('[data-setup-page=controller]').toggleAttribute('data-demo',kit);$('.sim-pinpoint-on').hidden=!kit;$('#sim-pinpoint-on').checked=project.sensors.localization==='fused';
    const note=$('#sim-demo-note');note.hidden=!demo;note.textContent=demo?`${project.setupName} can’t be changed: run it in Run & review. Make a new setup for your own robot.`:'';}
  $('#sim-pinpoint-on').onchange=e=>setLocalization(e.target.checked?'fused':'encoders');
  // What a demo robot is, part by part: its chassis and drivetrain, how it senses, each mechanism and what drives it,
  // and what its route does.
  function aboutPreset(show){const box=$('#sim-preset-about');box.hidden=!show;if(!show)return box.replaceChildren();
    const r=project.robot,m=project.mechanisms,H=window.DeckHardware,st=window.DeckWiring.state(project),model=key=>H.MODELS[st.rows.find(x=>x.key===key)?.model]?.short;
    const on=(key,what)=>{const md=model(key);return md?`${what} on a ${md}`:what;};
    const rows=[['Chassis',`${MECH.PRESETS[project.robotPreset]?.drive||C.drives[r.drivetrain].name}, ${r.length} × ${r.width} in, ${r.massLb} lb, ${r.driveRpm} RPM wheels${model('robot.left')||model('robot.frontLeft')?` on ${model('robot.left')||model('robot.frontLeft')} motors`:''}`],
      ['Senses with',C.sensors[project.sensors.localization].name]];
    if(m.enabled){m.intakes.forEach((i,n)=>rows.push([`Intake${m.intakes.length>1?' '+(n+1):''}`,on(`intakes.${n}.motor`,`${MECH.INTAKES[i.kind]} at the ${i.sides.join(' and ')}`)+`, takes up to ${m.storage} pieces`]));
      m.shooters.forEach((s,n)=>rows.push([`Shooter${m.shooters.length>1?' '+(n+1):''}`,[s.type==='turret'?'A turret':`Fixed, firing out of the ${s.facing}`,`${MECH.PIECES[s.pieces].toLowerCase()}`,on(`shooters.${n}.motor`,'flywheel'),on(`shooters.${n}.indexer`,{motor:'feeder roller',crservo:'feeder roller',pusher:'servo pusher',gate:'servo gate'}[s.indexerKind]||'feeder')].join(', ')]));
      for(const a of project.kinematics.actuators||[])if(a.name)rows.push([a.name,`Moved by route actions (${Object.keys(a.states||{}).join(', ')})`]);}
    else rows.push(['Mechanisms','None: it drives and pushes pieces.']);
    const l=L();if(l.pins.length)rows.push(['Route',`${l.pins.length} stops: ${l.pins.map(q=>q.action||q.note?.split(/[:,(]/)[0].trim()).filter(Boolean).slice(0,6).join(' → ')}`]);
    box.replaceChildren(...rows.flatMap(([k,v])=>[Object.assign(document.createElement('dt'),{textContent:k}),Object.assign(document.createElement('dd'),{textContent:v})]));}
  // A preset's demo route: a field of the setup's own, replaced when the preset is chosen again.
  const presetLayoutId=id=>'preset-'+id;
  let presetSeq=0;
  async function usePreset(id){const P=PR(),p=MECH.PRESETS[id];if(!p||!P?.has(id))return;const seq=++presetSeq;presetPicking=false;
    if(native&&(frame?.playing||frame?.practice))void call('stop');
    // A custom robot (its CAD, settings, mechanisms and wiring, and the field it was on) is kept, not replaced.
    if(!project.robotPreset){const {controller,robot,sensors,imuSource,mechanisms,kinematics,model:cad,setupDone,active}=snapshot();project.customRobot={controller,robot,sensors,imuSource,mechanisms,kinematics,model:cad,setupDone,active};}
    Object.assign(project,P.apply(id,project,C));project.model=null;model=null;project.setupDone=false;
    // The setup keeps its own field and route (a preset's demo route is in its built-in setup). Placing the model makes
    // its CAD (placeModel: a preset robot with no model yet).
    save();robotPanel();mechanismsPanel();presetPanel();setupSteps();changed('robot');await placeModel();
    if(seq!==presetSeq)return;refreshAll();reload();
    // Ready to run: its route is optimized once (test-driven in the simulator), so Path planning and Run need nothing.
    if(native&&L().pins.length&&!L().tested)void optimize();}
  // Back to the custom robot a preset replaced: its CAD, settings, mechanisms, wiring and field.
  async function restoreCustom(){const keep=project.customRobot;if(!keep)return customRobot();if(native&&(frame?.playing||frame?.practice))void call('stop');
    const next=sanitize({...snapshot(),...keep,robotPreset:null});for(const k of ['controller','robot','sensors','imuSource','mechanisms','kinematics','model','setupDone'])project[k]=next[k];
    project.robotPreset=null;project.customRobot=null;model=null;modelPreview?.dispose();modelPreview=null;save();presetPanel();robotPanel();mechanismsPanel();changed('robot');
    setupSteps();await placeModel();refreshAll();reload();}
  // Custom robot: the same robot (its CAD or bundled chassis, joints, wiring and mechanisms) with every setting open to change.
  function customRobot(){project.robotPreset=null;project.robot.appearance=project.model?'custom':builtins.has(project.robot.appearance)?project.robot.appearance:'plain';$('#sim-appearance').value=project.robot.appearance;save();presetPanel();mechanismsPanel();robotPanel();void placeModel();reload();}
  for(const b of $$('[data-preset]'))b.onclick=()=>void choosePreset(b.dataset.preset);
  // A preset in a setup already set up (its own CAD, mechanisms or route) asks first: open the preset's own setup, or put
  // the preset in this one (its custom robot is kept to come back to). In a preset's built-in setup, it opens the other's.
  async function choosePreset(id){const name=MECH.PRESETS[id]?.name;if(!name||project.robotPreset===id)return;
    if(builtin(project.setupId))return switchSetup('preset:'+id);
    if(configured()){const a=await askMajor(`Use the ${name}?`,`“${project.setupName}” is already set up${project.model?` with ${project.model.name}`:''}. Open the ${name}’s own setup, or put it in this one (your robot is kept: Custom robot brings it back).`,`Open the ${name} setup`);
      if(a==='cancel'){presetPicking=false;presetPanel();setupSteps();return;}if(a==='new')return switchSetup('preset:'+id);}
    await usePreset(id);}
  // A preset's built-in setup is customized as a copy, so the preset stays as it is.
  async function customizeBuiltin(){await cloneSetup(project.setupId);}
  for(const b of $$('[data-robot-source]'))b.onclick=()=>{if(b.dataset.robotSource==='preset'){if(!project.robotPreset){presetPicking=true;presetPanel();setupSteps();}return;}
    if(presetPicking&&!project.robotPreset){presetPicking=false;presetPanel();setupSteps();return;}if(builtin(project.setupId))return void customizeBuiltin();if(project.robotPreset)void restoreCustom();};
  for(const b of $$('[data-preset-customize]'))b.onclick=()=>{if(builtin(project.setupId))return void customizeBuiltin().then(()=>showSetupStep('robot'));customRobot();showSetupStep('robot');};
  for(const b of $$('[data-preset-plan]'))b.onclick=()=>{if(setupGate())return showSetupStep(setupGate());selectTab('plan');setStep('pins');void setView('2d');};
  // A robot file from an older version (Save robot to file, before setup files held the robot) loads into this setup.
  async function loadRobotFile(file,raw){
      const next=sanitize({...snapshot(),controller:raw.controller,robot:raw.robot,sensors:raw.sensors,imuSource:raw.imuSource,timing:raw.timing,mechanisms:raw.mechanisms,kinematics:raw.kinematics,model:raw.model,robotPreset:null});
      for(const k of ['controller','robot','sensors','imuSource','timing','mechanisms','kinematics'])project[k]=next[k];project.robotPreset=null;project.model=null;model=null;
      if(raw.modelData&&raw.model){const bin=atob(raw.modelData),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const stored=await api.simFile('model-save',{name:raw.model.name||'robot.glb',bytes});project.model=modelMeta({...raw.model,id:stored.id});if(project.kinematics.model===raw.model.id)project.kinematics={...project.kinematics,model:stored.id};}
      save();refreshAll();await placeModel();reload();status('#start-status',`Loaded the robot from ${file.name} into this setup.`);}
  function robotPanel(committed=false){
    const r=project.robot;for(const [id,value] of Object.entries({'#sim-drivetrain':r.drivetrain,'#sim-length':r.length,'#sim-width':r.width,'#sim-height':r.heightIn,'#sim-mass':r.massLb,'#sim-rpm':r.driveRpm,'#sim-wheel':r.wheelDiameterMm,'#sim-drive-style':r.driveStyle,'#sim-appearance':r.appearance,'#sim-localization':project.sensors.localization,'#sim-maxspeed':project.tuning.maxPathSpeed??.8}))inputValue(id,value,committed);
    const f=geometry().footprint,hitbox=C.chassisHitbox(r)?`Hitbox: the chassis, ${(f.front+f.rear).toFixed(2)} × ${(f.half*2).toFixed(2)} in.`:`Hitbox: ${f.front.toFixed(2)} in front, ${f.rear.toFixed(2)} in rear, ${f.half.toFixed(2)} in each side.`;let text='';
    const ext=field.extents(start.heading,C.footprint(r)),bounds=geometry().bounds;if(ext[1]-ext[0]>bounds.x1-bounds.x0||ext[3]-ext[2]>bounds.y1-bounds.y0)text+='This robot does not fit in this field at the selected heading. Increase the field size or reduce the robot size.';
    if(info){const e=info.robot;if(e.length!==r.length||e.width!==r.width)text+=` (Applied ${e.length} × ${e.width} in: the closest size the physics supports.)`;}
    $('#sim-footprint').textContent=text.trim();$('#sim-footprint').title=hitbox;inputValue('#sim-clearance',L().clearance);pressed('style',C.drives[r.drivetrain].holonomic?L().style:'sharp');rotatePanel();for(const button of $$('[data-style]'))button.disabled=!C.drives[r.drivetrain].holonomic&&button.dataset.style!=='sharp';
    const d=C.drives[r.drivetrain];$('#sim-drive-note').textContent='';
    const s=C.sensors[project.sensors.localization],motion=project.controller==='motionmodule';pressed('controller',project.controller);if(!project.controllerSet)for(const b of $$('#mech-controller [data-controller]'))b.setAttribute('aria-pressed','false');$('#mech-controller-note').textContent=!project.controllerSet?'':motion?'MotionModule: add 2 or 3 odometry pods or an OTOS with + Add to Chassis to know position; without them the robot drives by time.':`Control Hub${project.calibration?.hub?.config?`, filled in from “${project.calibration.hub.config.name}” in Setup & Calibrate`:''}. Odometry and the IMU are added with + Add to Chassis.`;$('#sim-controller-now').textContent=`${motion?'Other robot':`FTC · Control Hub${project.calibration?.hub?.config?`, filled in from “${project.calibration.hub.config.name}” in Setup`:''}`}. Change it in the Setup tab.`;$('#sim-controller-note').textContent=motion?'MotionModule: add 2 or 3 odometry pods or an OTOS to know position; without them the robot drives by time.':'';
    const select=$('#sim-localization');if(select.dataset.forController!==project.controller){select.innerHTML=options(Object.fromEntries(C.sensorChoices(project.controller).map(k=>[k,C.sensors[k].name])),project.sensors.localization);select.dataset.forController=project.controller;}inputValue('#sim-localization',project.sensors.localization);select.disabled=false;
    const device=['fused','optical'].includes(project.sensors.localization),sources=device?{device:project.sensors.localization==='fused'?'Pinpoint integrated IMU':'OTOS integrated IMU'}:motion?{module:'MotionModule IMU',external:'Separate IMU over I²C'}:{hub:'Control Hub built-in IMU',external:'Separate IMU over I²C'};
    if(!Object.hasOwn(sources,project.imuSource))project.imuSource=Object.keys(sources)[0];const sourceKey=JSON.stringify(sources);if($('#sim-imu-source').dataset.options!==sourceKey){$('#sim-imu-source').innerHTML=options(sources,project.imuSource);$('#sim-imu-source').dataset.options=sourceKey;}inputValue('#sim-imu-source',project.imuSource);hubPanel();
    $('#sim-imu-note').textContent='';
    $('#sim-sensor-note').textContent={gyro:'No position sensing: the robot drives for set times and the IMU keeps it facing the right way. It cannot correct a missed spot, so expect a few inches of error.',odometry:'2 unpowered tracking pods: one parallel and one perpendicular, plus the selected IMU.',odometry3:'3 unpowered tracking pods: two parallel and one perpendicular, plus the selected IMU.',encoders:'Drive motor encoders plus IMU. No separate tracking pods; wheel slip affects the position estimate.',fused:'2 dead-wheel pods connected to the Pinpoint odometry computer, with its integrated IMU.',optical:'SparkFun OTOS measures optical X/Y motion and heading. No odometry pods; mounting height and surface affect real performance.'}[project.sensors.localization];
    $('#sim-timed-settings').hidden=s.translation;timedPanel(committed);sensorList();odometryPanel();deviceNamesPanel();wiringPanel();
    const hub=!motion&&s.translation&&['mecanum','tank'].includes(C.drives[project.robot.drivetrain].engine);$('#sim-export-onbot').hidden=!hub;$('#sim-export-config').hidden=motion;$('#sim-export-java').hidden=motion||!s.translation;$('#sim-export-timed').hidden=s.translation;$('#sim-export-teamcode').hidden=!hub;$('#sim-export-pedro').hidden=motion||!s.translation||!['mecanum','swerve'].includes(C.drives[project.robot.drivetrain].engine);$('#sim-export-motionmodule').hidden=!motion;$('#sim-export-title').textContent=motion?'Put it on your MotionModule robot':'Put it on your robot';for(const b of $$('[data-program=opmode]'))b.hidden=!hub;void sendPanel();if(!hub&&project.program.kind==='opmode')project.program.kind='route';$('#sim-execution-note').textContent=motion?'Saves the route as autonomous.py for MotionModule, with a Mechanisms class on its motor and servo outputs.':!s.translation?'Timed-command JSON records powers, seconds, pauses and an IMU heading target. It does not configure or deploy to a robot.':hub?'To upload it yourself: Program & Manage → OnBot Java, then Build Everything.':'This drivetrain exports as Route Java or Pedro Pathing 3, under Other formats.';
    $('#sim-export-names-note').textContent=s.translation&&!motion?'Match hardware names, sensor offsets and calibration before running. '+(project.mechanisms.enabled?'Intake and shooter actions drive the mechanisms set up in Deck (check their device names); other actions need your own code.':'Actions need your own mechanism code, or set up Mechanisms to get working intake and shooter code.'):'';
    transport();queueMicrotask(stageMarks);
  }
  const settle=()=>{project=sanitize(project);save();changed('robot');reload();};
  const num=(id,set)=>{$(id).onchange=e=>{const v=e.target.valueAsNumber,min=parseFloat(e.target.min),max=parseFloat(e.target.max);e.target.setCustomValidity('');if(!finite(v)||finite(min)&&v<min||finite(max)&&v>max){e.target.setCustomValidity(`Enter a finite value${finite(min)?` at least ${min}`:''}${finite(max)?` and no more than ${max}`:''}.`);e.target.reportValidity();return;}set(v);settle();robotPanel(true);};$(id).oninput=e=>e.target.setCustomValidity('');};
  // Bundled chassis CAD is only in personal local builds; public releases show the plain footprint.

  const chassisFor=drive=>{const id=C.drives[drive].engine==='swerve'?'swechanum':drive==='mecanum'?'strafer':'plain';return builtins.has(id)?id:'plain';};
  function appearanceOptions(){for(const o of $('#sim-appearance').options)if(['strafer','swechanum'].includes(o.value)){o.disabled=!builtins.has(o.value);o.textContent=o.textContent.replace(/ \(not included in this build\)$/,'')+(o.disabled?' (not included in this build)':'');}}
  if(native&&typeof api.simFile==='function')void api.simFile('assets').then(a=>{builtins=new Set(a.robots);Object.assign(window.DeckFieldArt.available,a.fields);appearanceOptions();void placeModel();}).catch(()=>{});
  $('#sim-drivetrain').onchange=e=>{project.robot.drivetrain=e.target.value;if(!project.model)project.robot.appearance=chassisFor(e.target.value);settle();robotPanel();void placeModel();drivePicker();};
  // ---- the chassis picker ----
  // Five drivetrains; each says how many motors or modules it has and, for swerve, what steers a module. Each pick is one of
  // Simulate's drive models (C.drives): tank with 2 or 4 motors, swerve with 3 or 4 modules, differential swerve with 2 or 4.
  const DRIVE_FAMILIES={mecanum:{name:'Mecanum',models:{4:'mecanum'}},tank:{name:'Tank',count:'Motors',models:{2:'tank2',4:'tank'}},kiwi:{name:'Kiwi (3 omni wheels)',models:{3:'kiwi'}},
    swerve:{name:'Swerve',count:'Modules',models:{3:'kiwiSwerve',4:'coaxSwerve'}},diff:{name:'Differential swerve',count:'Modules',models:{2:'diffSwerve2',4:'diffSwerve'}}};
  // Older setups may name a drive model that is not one of these (X-drive, butterfly): it is kept, and shown as itself.
  function driveFamilyOf(model){for(const [f,d] of Object.entries(DRIVE_FAMILIES))for(const [n,m] of Object.entries(d.models))if(m===model)return {family:f,count:+n};return model==='swerve'?{family:'swerve',count:4}:{family:model,count:0,legacy:true};}
  function drivePicker(){const model=project.robot.drivetrain,at=driveFamilyOf(model),fam=$('#sim-drive-family'),cnt=$('#sim-drive-count'),d=DRIVE_FAMILIES[at.family];
    const famHtml=Object.entries(DRIVE_FAMILIES).map(([k,v])=>`<option value="${k}"${k===at.family?' selected':''}>${v.name}</option>`).join('')+(at.legacy?`<option value="${model}" selected>${C.drives[model]?.name||model}</option>`:'');
    if(fam.dataset.html!==famHtml){fam.innerHTML=famHtml;fam.dataset.html=famHtml;}fam.value=at.legacy?model:at.family;
    const counts=d?Object.keys(d.models):[],cntHtml=counts.map(n=>`<option value="${n}"${+n===at.count?' selected':''}>${n}</option>`).join('');if(cnt.dataset.html!==cntHtml){cnt.innerHTML=cntHtml;cnt.dataset.html=cntHtml;}cnt.value=String(at.count);
    $('#sim-drive-count-box').hidden=!d||counts.length<2;$('#sim-drive-count-label').textContent=d?.count||'Motors';
    // What the robot has on its chassis, as Setup & Calibrate and the configuration will see it.
    let st;try{st=window.DeckWiring.state(project);}catch{st=null;}const rows=(st?.rows||[]).filter(r=>['drive','steer'].includes(r.role)),drive=rows.filter(r=>r.role==='drive'),steer=rows.filter(r=>r.role==='steer');
    const steerKind=steer[0]?window.DeckWiring.typeOf(steer[0],st):null;$('#sim-drive-steer-box').hidden=!steer.length;if(steerKind)$('#sim-drive-steer').value=steerKind;
    const word={crservo:'continuous servo',servo:'servo',dcmotor:'steering motor'}[steerKind]||'steering servo',n=(k,w)=>`${k} ${w}${k===1?'':'s'}`;
    $('#sim-drive-parts').textContent=rows.length?`${n(drive.length,'drive motor')}${steer.length?`, ${n(steer.length,word)}, and an absolute encoder on each module if it has one`:''}.`:'';}
  $('#sim-drive-family').onchange=e=>{const d=DRIVE_FAMILIES[e.target.value];if(!d)return;const was=driveFamilyOf(project.robot.drivetrain),n=d.models[was.count]?was.count:+Object.keys(d.models).at(-1),sel=$('#sim-drivetrain');sel.value=d.models[n];sel.dispatchEvent(new Event('change'));};
  $('#sim-drive-count').onchange=e=>{const d=DRIVE_FAMILIES[driveFamilyOf(project.robot.drivetrain).family],m=d?.models[e.target.value];if(!m)return;const sel=$('#sim-drivetrain');sel.value=m;sel.dispatchEvent(new Event('change'));};
  // Every module steers the same way: a continuous servo, a servo, or a motor.
  $('#sim-drive-steer').onchange=e=>{let st;try{st=window.DeckWiring.state(project);}catch{return;}for(const r of st.rows.filter(x=>x.role==='steer'))deviceKind(r.key,e.target.value);drivePicker();};
  // Typing a size takes over from the CAD's own size.
  const manual=()=>{if(project.model)project.model.autoSize=false;};
  num('#sim-length',v=>{project.robot.length=v;manual();});num('#sim-width',v=>{project.robot.width=v;manual();});num('#sim-mass',v=>{project.robot.massLb=v;entered('mass');});num('#sim-rpm',v=>{project.robot.driveRpm=v;entered('rpm');});
  num('#sim-height',v=>project.robot.heightIn=v);num('#sim-wheel',v=>{project.robot.wheelDiameterMm=v;entered('wheel');});$('#sim-drive-style').onchange=e=>{project.robot.driveStyle=e.target.value;settle();};
  num('#sim-maxspeed',v=>{project.tuning.maxPathSpeed=v;project.tuning.powerSet=true;project.timing.power=v;});
  $('#sim-localization').onchange=e=>{project.sensors.localization=e.target.value;save();robotPanel();reload();};
  $('#sim-imu-source').onchange=e=>{project.imuSource=e.target.value;save();robotPanel();reload();};
  // Control Hub mounting: a USB direction along the logo's axis is not possible, so those choices are disabled.
  for(const [id,key] of [['#sim-hub-logo','hubLogo'],['#sim-hub-usb','hubUsb']])$(id).onchange=e=>{Object.assign(project.robot,C.hubMounting({...project.robot,[key]:e.target.value}));save();robotPanel();reload();};
  function hubPanel(){const names={up:'Up',down:'Down',forward:'Forward',backward:'Backward',left:'Left',right:'Right'},axis=d=>Math.floor(C.HUB.indexOf(d)/2),r=project.robot;
    $('#sim-hub-mount').hidden=project.controller==='motionmodule'||project.imuSource!=='hub'&&!$('#mech-controller-body').contains($('#sim-hub-mount'));
    for(const [id,key] of [['#sim-hub-logo','hubLogo'],['#sim-hub-usb','hubUsb']]){const s=$(id);if(!s.options.length)s.innerHTML=options(names,r[key]);s.value=r[key];}
    for(const o of $('#sim-hub-usb').options)o.disabled=axis(o.value)===axis(r.hubLogo);}
  for(const b of $$('[data-controller]'))b.onclick=()=>{if(project.controller===b.dataset.controller){if(!project.controllerSet){project.controllerSet=true;save();robotPanel();mechanismsPanel();}return;}project.controllerSet=true;const oldKey=project.controller==='motionmodule'?'motionSensors':'ftcSensors';project[oldKey]={...project.sensors,imuSource:project.imuSource,driveAmps:project.robot.driveAmps};const oldAmps=project.robot.driveAmps;project.controller=b.dataset.controller;project.robot.driveAmps=project.controller==='ftc'?C.current(oldAmps,'ftc'):C.electrical.motionmodule.defaultAmps;const saved=project[project.controller==='motionmodule'?'motionSensors':'ftcSensors'];if(saved?.driveAmps)project.robot.driveAmps=C.current(saved.driveAmps,project.controller);project.sensors=saved?{...saved}:{localization:C.localization(project.controller)};project.imuSource=saved?.imuSource||(project.controller==='motionmodule'?'module':'hub');if(project.controller==='motionmodule')project.program.kind='route';save();robotPanel();mechanismsPanel();programPanel();practicePanel(null);reload();};
  for(const [id,key]of TIMED_FIELDS)num(id,v=>project.timing[key]=v);
  // Sensors as a list: the IMU, at most one position sensor and drive encoders. The list decides the sensing the
  // simulator runs and the exports set up (2 pods → odometry, Pinpoint → its 2 pods and IMU, encoders alone → drive
  // encoder odometry, nothing → IMU-only timed driving).
  const POSITION={odometry:'2 odometry pods',odometry3:'3 odometry pods',fused:'goBILDA Pinpoint computer + 2 pods',optical:'SparkFun OTOS optical sensor'};
  function sensorList(){
    const loc=project.sensors.localization,choices=C.sensorChoices(project.controller),hasEnc=loc==='encoders'||!!project.sensors.driveEncoders&&choices.includes('encoders'),pos=POSITION[loc]?loc:null;
    // Each choice as a picture of the very sensor, larger under the pointer. Drive motor encoders are in the motors, so they get no close-up.
    const art=window.DeckDeviceArt,fig=tag=>tag?`<span class="ce-fig sim-pick-fig" data-fig="${tag}">${art?art.svg(tag,{title:false}):''}</span>`:'<span class="ce-fig empty sim-pick-fig"></span>',card=(attr,key,tag,name,what,on,tip=!!tag)=>`<button type="button" class="sim-pick-card" ${attr}="${key}" aria-pressed="${on}"${tip?` data-tip-tag="${tag}"`:''}>${fig(tag)}<b>${name}</b><small>${what}</small></button>`;
    const CARDS={fused:['goBILDAPinpoint','goBILDA Pinpoint + 2 pods','A small computer reads the pods and its own IMU.'],odometry:['goBILDAOdometryPod','2 odometry pods','One rolls forward, one sideways.'],odometry3:['goBILDAOdometryPod','3 odometry pods','Two roll forward, one sideways.'],optical:['SparkFunOTOS','SparkFun OTOS','Tracks the floor optically, with its own IMU.']};
    const position=Object.keys(CARDS).filter(k=>choices.includes(k)).map(k=>card('data-sensor-card',k,CARDS[k][0],CARDS[k][1],CARDS[k][2],k===pos));
    if(choices.includes('encoders'))position.push(card('data-sensor-card','encoders','goBILDA5202SeriesMotor','Drive motor encoders',pos?'Also read the wheels’ own encoders.':'Position from the wheels. They slip more than pods.',hasEnc,false));
    const imuTag={hub:'ControlHubImuBHI260AP',external:'AdafruitBNO055IMU',device:pos==='fused'?'goBILDAPinpoint':'SparkFunOTOS'},imuWhat={hub:'Inside the Control Hub.',external:'Its own board, on an I²C port.',module:'Inside the MotionModule.',device:project.controller==='ftc'&&pos==='fused'?'The Control Hub’s IMU is its backup.':'Part of the sensor you picked.'};
    const turning=[...$('#sim-imu-source').options].map(o=>card('data-imu-card',o.value,imuTag[o.value]||'',o.textContent,imuWhat[o.value]||'',o.value===project.imuSource));
    for(const [box,list] of [[$('#sim-sensor-cards'),position],[$('#sim-imu-cards'),turning]]){const html=list.join('');if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;window.DeckPartPicker?.dress?.(box);}}
  }
  $('#sim-sensor-cards').addEventListener('click',e=>{const k=e.target.closest('[data-sensor-card]')?.dataset.sensorCard;if(!k)return;const loc=project.sensors.localization,pos=POSITION[loc]?loc:null,hasEnc=loc==='encoders'||!!project.sensors.driveEncoders;
    if(k==='encoders'){if(hasEnc){project.sensors.driveEncoders=false;if(loc==='encoders')setLocalization('gyro');else{save();robotPanel();}}else{project.sensors.driveEncoders=true;if(!pos)setLocalization('encoders');else{save();robotPanel();}}return;}
    setLocalization(k===pos?(hasEnc&&C.sensorChoices(project.controller).includes('encoders')?'encoders':'gyro'):k);});
  $('#sim-imu-cards').addEventListener('click',e=>{const k=e.target.closest('[data-imu-card]')?.dataset.imuCard,sel=$('#sim-imu-source');if(!k||k===sel.value)return;sel.value=k;sel.dispatchEvent(new Event('change'));});
  // The robot's own names for the drive motors and sensors the Control Hub exports use, and drive motors that turn the
  // other way. Only what differs from Deck's defaults is stored (project.robot.devices).
  const deviceDefaults=()=>window.DeckSimFtc.deviceSlots(C.robot({...project.robot,devices:undefined},project.controller),project.sensors.localization);
  function deviceNamesPanel(){
    const slots=project.controller==='motionmodule'?[]:window.DeckSimFtc.deviceSlots(project.robot,project.sensors.localization);$('#sim-device-names').hidden=!slots.length;
    if(!slots.length||document.activeElement?.closest?.('#sim-device-list'))return;
    $('#sim-device-list').innerHTML=slots.map(s=>`<div class="start-xy"><div><label for="sim-device-${s.key}">${s.label}</label><input id="sim-device-${s.key}" data-device="${s.key}" maxlength="40" autocomplete="off" spellcheck="false" value="${s.name}"></div>${'reversed' in s?`<label class="check" for="sim-device-rev-${s.key}"><input id="sim-device-rev-${s.key}" data-device-reversed="${s.key}" type="checkbox"${s.reversed?' checked':''}> Turns the other way</label>`:''}</div>`).join('');
  }
  function setDevice(key,change){const devices={...(project.robot.devices||{})},entry={...(devices[key]||{})},base=deviceDefaults().find(s=>s.key===key);change(entry,base);
    if(entry.name===base?.name)delete entry.name;if(entry.reversed===base?.reversed)delete entry.reversed;if(Object.keys(entry).length)devices[key]=entry;else delete devices[key];
    project.robot=C.robot({...project.robot,devices},project.controller);save();reload();}
  $('#sim-device-list').addEventListener('change',e=>{const el=e.target;
    if(el.dataset.device){const name=C.deviceName(el.value);if(!name){el.value=window.DeckSimFtc.deviceSlots(project.robot,project.sensors.localization).find(s=>s.key===el.dataset.device)?.name||'';return;}setDevice(el.dataset.device,entry=>{entry.name=name;});}
    else if(el.dataset.deviceReversed)setDevice(el.dataset.deviceReversed,entry=>{entry.reversed=el.checked;});});
  // ---- Control Hub wiring (ui/sim-wiring.js) ----
  // The drivetrain comes from the CAD's wheel names when it has them (Configure from CAD, import); otherwise the team picks it.
  function driveFromCad(){const found=project.model?.drivetrain,name=found&&C.drives[found]?.name;
    return !project.model?'':found?(found===project.robot.drivetrain?`From your CAD: ${name} (from its wheel names).`:`Your CAD’s wheels look like ${name}; you chose ${C.drives[project.robot.drivetrain].name}.`):'Your CAD does not name its wheels, so choose the drivetrain.';}
  function applyWiring(next){const focus=document.activeElement?.id,was=project.robot.wiring?.devices||{};project.robot=C.robot({...project.robot,wiring:next},project.controller);
    const now=project.robot.wiring?.devices||{},moved=Object.keys({...was,...now}).filter(k=>(was[k]?.model||'')!==(now[k]?.model||''));if(moved.length)modelSpeeds(moved,was);
    save();robotPanel();mechanismsPanel();reload();if(focus&&document.activeElement?.id!==focus)document.getElementById(focus)?.focus();}
  // A device's configuration name, wherever Setup keeps it: drive motors and sensors on the robot, game devices on their
  // intake or shooter, a moving part's on its actuator.
  function deviceName(key,name){const k=window.DeckHardware.parseKey(key);if(!k)return;
    if(k.robot){const devices={...(project.robot.devices||{})};devices[k.robot]={...(devices[k.robot]||{}),name};project.robot=C.robot({...project.robot,devices},project.controller);return;}
    if(k.list){const m=structuredClone(project.mechanisms),part=m[k.list]?.[k.index],x=/^more[0-9]$/.test(k.field)?part?.more?.[+k.field.slice(4)]:null;if(x)x.name=name;else if(part)part[k.field]=name;if(part)project.mechanisms=MECH.sanitize(m);return;}
    if(k.kin){const kin=structuredClone(project.kinematics),at=window.DeckKinematics.deviceAt(kin.actuators,k.kin);if(at){window.DeckKinematics.nameDevice(at.actuator,at.n,name);project.kinematics=window.DeckKinematics.sanitize(kin);}}}
  // One actuator for two mechanisms (belted or geared together): this device takes the other's name and port, so the
  // configuration has one motor and both mechanisms drive it. other null: a name of its own again.
  function shareDevice(key,other){const W=window.DeckWiring,st=W.state(project),row=st.rows.find(r=>r.key===key),mate=other&&st.rows.find(r=>r.key===other);if(!row)return;
    if(mate){deviceName(key,mate.name);if(mate.hub)project.robot=C.robot({...project.robot,wiring:W.setPort(project.robot.wiring,key,mate.family==='i2c'?`${mate.hub}:${mate.bus}`:`${mate.hub}:${mate.port}`,mate.family)},project.controller);}
    else{const used=new Set(st.rows.map(r=>r.name));let name=`${row.name}_${String(key.split('.').pop()).toLowerCase()}`.slice(0,40);for(let n=2;used.has(name);n++)name=`${row.name}_${n}`;deviceName(key,name);}
    save();robotPanel();mechanismsPanel();reload();}
  // A device's type (a DC motor or a continuous servo for a roller, a servo pusher or gate for a feeder...), set on the
  // mechanism; a model of another type is cleared.
  // A mechanism on a shared motor sets only how fast it turns.
  function deviceRpm(key,rpm){const row=window.DeckWiring.state(project).rows.find(r=>r.key===key);if(!row)return;
    if(row.role==='flywheel'){const m=structuredClone(project.mechanisms);m.shooter.rpm=rpm;project.mechanisms=MECH.sanitize(m);}else{const kin=structuredClone(project.kinematics);for(const j of kin.joints)if(row.joints?.includes(j.id))j.rpm=rpm;project.kinematics=window.DeckKinematics.sanitize(kin);}
    save();mechanismsPanel();reload();}
  // What each chosen model says about how fast things go, through the CAD's ratios. With no model chosen, REV's numbers: an HD Hex
  // 20:1 motor, a Smart Robot Servo. only: the devices whose model just changed (every device when left out); before: them as they
  // were, so a flywheel that was running flat out still does on its new motor, and one set slower stays where the team put it.
  function modelSpeeds(only,before={}){const H=window.DeckHardware,kin=structuredClone(project.kinematics),m=structuredClone(project.mechanisms),round=(v,d=1)=>+v.toFixed(d);
    const free=(row,id)=>H.MODELS[id]?.rpm??H.MODELS[row.kind==='crservo'?'rev-smart-cr':'rev-hd-hex-20'].rpm,sweep=id=>H.MODELS[id]?.speed??H.MODELS['rev-smart'].speed;
    // Degrees its servo turns for one of the joint's, through the gears the CAD shows.
    const stepUp=id=>{let r=1,at=id;for(let n=0;n<6;n++){const c=kin.couplings.find(x=>x.from===at&&String(x.to).startsWith(id+'gear'));if(!c)break;r*=Math.abs(c.ratio)||1;at=c.to;}return r;};
    for(const row of window.DeckWiring.state(project).rows){if(only&&!only.includes(row.key))continue;const mine=kin.joints.filter(j=>row.joints?.includes(j.id)),spins=row.kind==='dcmotor'||row.kind==='crservo',model=row.model;
      if(row.role==='roller'||row.role==='feeder'&&spins)for(const j of mine)j.rpm=round(free(row,model)*(j.ratio||1));
      else if(row.role==='feeder')for(const j of mine)j.speed=round(sweep(model));
      else if(row.role==='flywheel')for(const j of mine){const top=free(row,model)*(j.ratio||1),had=free(row,before[row.key]?.model)*(j.ratio||1);j.rpm=round(top);if(m.shooter.rpm>top||only&&m.shooter.rpm>=had*.95)m.shooter.rpm=Math.max(100,Math.round(top));}
      else if(row.role==='turret')m.turret.speed=Math.max(5,Math.min(2000,Math.round((spins?free(row,model)*6:sweep(model))/(gearRatio(m.turret.gears)||1))));
      else if(row.role==='hood'&&row.kind==='servo')for(const j of mine)j.speed=round(sweep(model)/stepUp(j.id));
      else if((row.role==='ramp'||row.role==='kicker')&&row.kind==='servo'){const i=m.intakes[row.setting?.index];if(i)for(const j of mine){const range=Math.abs((j.states?.lowered??0)-(j.states?.raised??0))||i.travel||0;if(range)i.down=i.up=Math.min(3,Math.max(.05,round(range*stepUp(j.id)/sweep(model),2)));}}
      else if(/^kin-/.test(row.role)&&H.MODELS[model]){const a=kin.actuators.find(x=>x.id===H.parseKey(row.key)?.kin),j=a&&kin.joints.find(x=>x.id===a.joint),md=H.MODELS[model],ratio=Math.abs(a?.ratio)||1;if(a&&j&&(md.kind==='linear')===(j.type==='prismatic')&&!(md.kind==='dcmotor'&&j.type==='prismatic'))a.speed=round((md.rpm?md.rpm*6:md.speed)/ratio);}}
    project.kinematics=window.DeckKinematics.sanitize(kin);project.mechanisms=MECH.sanitize(m);}
  // Plugged into means something only with a Control Hub: on USB, on Wi-Fi, or read and saved in Calibrate.
  // A port the robot's configuration has: the device takes that port, and its name there.
  function deviceAssign(key,value){const W=window.DeckWiring,row=W.state(project).rows.find(r=>r.key===key);if(!row)return;const [at,name]=value.split('|');if(value)deviceName(key,name);applyWiring(W.setPort(project.robot.wiring,key,at||'',row.family));mechanismsPanel();robotPanel();}
  function deviceKind(key,kind){const k=window.DeckHardware.parseKey(key),W=window.DeckWiring;if(!k)return;
    const firstOf=kind2=>window.DeckHardware.ACTUATORS.find(m=>m.kind===kind2)?.id;let model=project.robot.wiring?.devices?.[key]?.model;const md=window.DeckHardware.MODELS[model];
    if(k.list){const m=structuredClone(project.mechanisms),part=m[k.list]?.[k.index];if(!part)return;
      if(k.list==='intakes'&&(k.field==='motor'||k.field==='motor2'))part.device=kind==='crservo'?'crservo':'motor';
      else if(k.list==='intakes'&&/^more[0-9]$/.test(k.field)){const x=part.more?.[+k.field.slice(4)];if(x&&x.device!=='servo')x.device=kind==='crservo'?'crservo':'motor';}
      else if(k.field==='indexer')part.indexerKind={dcmotor:'motor',crservo:'crservo',pusher:'pusher',gate:'gate'}[kind]||part.indexerKind;
      else if(k.field==='turretMotor'||k.field==='turretMotor2')m.turret.kind=kind==='servo'||kind==='crservo'?kind:'motor';
      else if(k.list==='intakes'&&k.field==='servo'){if(kind==='servo')delete part.rampKind;else part.rampKind=kind;}
      project.mechanisms=MECH.sanitize(m);}
    const want={pusher:'servo',gate:'servo'}[kind]||kind;if(md&&md.kind!==want)model='';if(want==='linear'&&!md)model=firstOf('linear');if(want==='servo'&&md?.kind==='linear')model='';
    // A swerve module's steering is a continuous servo unless its model says otherwise: a servo or a motor takes the first model of its kind.
    if(/^steer/.test(k.robot||'')&&want!=='crservo'&&window.DeckHardware.MODELS[model]?.kind!==want)model=firstOf(want);
    project.robot=C.robot({...project.robot,wiring:W.setModel(project.robot.wiring,key,model)},project.controller);save();robotPanel();mechanismsPanel();reload();}
  // A robot starts with a Control Hub and one Expansion Hub, until the team takes it away or the robot says it has none.
  function hubDefaults(){const h=project.robot.wiring?.hubs?.expansion;if(project.controller!=='ftc'||h||h===false)return;
    project.robot=C.robot({...project.robot,wiring:window.DeckWiring.setHub(project.robot.wiring,'expansion',true)},project.controller);save();}
  function wiringPanel(){hubDefaults();
    const ftc=project.controller==='ftc';$('#sim-drive-cad').textContent=driveFromCad();$('#sim-ctl-ports').hidden=!ftc;
    // A Control Hub's step is one column: models and electronics are Setup & Calibrate's. A MotionModule's timed driving and
    // path correction sit in a column of their own.
    {const cols=$('#sim-ctl-cols'),[left,right]=cols.children;cols.classList.toggle('sim-ctl-one',ftc);for(const el of [$('#sim-timed-settings'),$('.sim-advanced')])if(el.parentElement!==(ftc?left:right))(ftc?left:right).append(el);}}
  // ---- Configure Robot in Deck: the robot's configurations, read over USB (ADB) or its Wi-Fi (as a Driver Station),
  // edited hub by hub and port by port, and saved back over Wi-Fi under a new name, made active, as Configure Robot does.
  // Each device also shows the Java that gets it from the hardware map (DeckRobotConfig.javaOf), as Blocks lists them.
  let robotRead=null,robotEdit=null;
  const robotDevices=()=>robotEdit?.devices||[];
  function robotSelect(name){const r=robotRead;robotEdit=null;if(!r?.files?.[name])return;try{robotEdit={name,devices:RobotConfig.parse(r.files[name]).devices.map(d=>({...d})),changed:false};}catch{}}
  async function robotSources(){const select=$('#sim-robot-source'),keep=select.value;let saved=[];try{saved=await api.robotLink('robots');}catch{}
    const list=[['usb','USB cable (Control Hub plugged into this computer)'],...saved.map(r=>[r.host,`${r.name} over Wi-Fi (${r.host})`]),['192.168.43.1','Control Hub over Wi-Fi (192.168.43.1)']];
    select.replaceChildren(...list.filter((c,i)=>list.findIndex(x=>x[0]===c[0])===i).map(([v,t])=>new Option(t,v)));if(keep&&[...select.options].some(o=>o.value===keep))select.value=keep;}
  function robotReadPanel(){
    const r=robotRead,select=$('#sim-robot-configs'),box=$('#sim-robot-devices');if(!r){select.hidden=true;box.replaceChildren();return;}
    const opts=r.configurations.map(n=>new Option(n===r.active?.name?`${n} (active)`:n,n));select.replaceChildren(...opts);select.value=robotEdit?.name||r.active?.name||'';select.hidden=!r.configurations.length;
    if(!robotEdit){box.replaceChildren();return;}
    const E=robotEdit,devices=E.devices,hubs=RobotConfig.parse(r.files[E.name]).hubs.filter(h=>h.tag==='LynxModule'||h.tag==='ServoHub'),java=RobotConfig.javaOf(devices),editor=!$('#sim-source-box').hidden;
    const esc=window.DeckWiring.esc,familyName={motor:'Motor port',servo:'Servo port',analog:'Analog port',digital:'Digital port',i2c:'I2C bus'};
    const sameHub=(d,h)=>d.module?d.module.address===h.address&&!!d.module.servoHub===(h.tag==='ServoHub'):d.hub===h.name;
    const html=hubs.map(h=>{const mine=devices.map((d,i)=>({d,i})).filter(x=>sameHub(x.d,h));
      const rows=mine.map(({d,i})=>{const fam=RobotConfig.familyOfTag(d.tag),types=RobotConfig.EDIT_TYPES[fam]||[[d.tag,d.tag]],n=RobotConfig.PORT_COUNT[fam]||4,at=fam==='i2c'?d.bus:d.port,j=java.list[i];
        return `<tr data-dev="${i}"><td><select data-dev-port aria-label="Port">${Array.from({length:n},(_,k)=>`<option value="${k}"${k===at?' selected':''}>${familyName[fam]||'Port'} ${k}</option>`).join('')}</select></td>
          <td><select data-dev-tag aria-label="Type">${[...types.some(([t])=>t===d.tag)?[]:[[d.tag,d.tag]],...types].map(([t,l])=>`<option value="${esc(t)}"${t===d.tag?' selected':''}>${esc(l)}</option>`).join('')}</select></td>
          <td><input data-dev-name aria-label="Name" maxlength="40" spellcheck="false" value="${esc(d.name)}"></td><td><code>${esc(j.declare)}</code></td>
          <td><button type="button" class="text-button" data-dev-copy>Copy</button>${editor?'<button type="button" class="text-button" data-dev-insert>Insert</button>':''}<button type="button" class="icon-button" data-dev-remove aria-label="Remove ${esc(d.name)}" title="Remove">×</button></td></tr>`;}).join('');
      return `<h4 class="sim-setup-group">${esc(h.name)}${h.parent?'':` (address ${h.address})`}</h4><table class="sim-wire-table sim-robot-table"><thead><tr><th>Port</th><th>Type</th><th>Name</th><th>Java</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="button-row"><label class="sr-only" for="sim-robot-add-${h.address}">Add a device to ${esc(h.name)}</label><select id="sim-robot-add-${h.address}" data-dev-add="${h.address}"><option value="">+ Add a device…</option>${Object.entries(familyName).map(([f,l])=>`<option value="${f}">${l.replace(/ (port|bus)$/,'')}</option>`).join('')}</select></div>`;}).join('');
    const save=`<div class="sim-robot-save"><label for="sim-robot-save-name">Save to the robot as</label><div class="button-row"><input id="sim-robot-save-name" maxlength="40" spellcheck="false" value="${esc(E.saveName||RobotConfig.configurationName(`${E.name} Deck`,r.configurations))}"><button type="button" class="primary" id="sim-config-save"${E.changed?'':' disabled'}>Save and make active</button>${E.name!==r.active?.name?'<button type="button" class="secondary" id="sim-config-activate">Make this one active</button>':''}</div><p class="hint">A new configuration, so “${esc(E.name)}” stays as it is. The robot makes it active and restarts, as Configure Robot does.</p></div>`;
    box.innerHTML=`${html}<div class="button-row"><button type="button" class="secondary" id="sim-robot-copy-all">Copy all Java</button><button type="button" class="secondary" id="sim-robot-use">Use these names and ports in Setup</button></div>${save}`;}
  // Edits: a port, a type, a name, a device added or removed. The Java column follows each change.
  const robotBox=$('#sim-robot-devices');
  robotBox.addEventListener('change',e=>{const el=e.target,E=robotEdit;if(!E)return;const i=+el.closest('[data-dev]')?.dataset.dev,d=E.devices[i];
    if(el.matches('[data-dev-add]')){const fam=el.value;if(!fam)return;const address=+el.dataset.devAdd,hub=RobotConfig.parse(robotRead.files[E.name]).hubs.find(h=>h.address===address),module={portal:hub.portal,address},taken=new Set(E.devices.filter(x=>x.module?.address===address&&RobotConfig.familyOfTag(x.tag)===fam).map(x=>fam==='i2c'?x.bus:x.port));
      const free=Array.from({length:RobotConfig.PORT_COUNT[fam]},(_,k)=>k).find(k=>!taken.has(k)||fam==='i2c')??0,tag=RobotConfig.EDIT_TYPES[fam][0][0],names=new Set(E.devices.map(x=>x.name));let name=fam==='i2c'?'sensor':fam,n=1;while(names.has(name+n))n++;
      E.devices.push({name:name+n,tag,kind:RobotConfig.kindOf(tag),hub:hub.name,module,...(fam==='i2c'?{port:0,bus:free}:{port:free})});}
    else if(!d)return;else if(el.matches('[data-dev-port]')){if(RobotConfig.familyOfTag(d.tag)==='i2c')d.bus=+el.value;else d.port=+el.value;}
    else if(el.matches('[data-dev-tag]')){d.tag=el.value;d.kind=RobotConfig.kindOf(el.value);}else if(el.matches('[data-dev-name]'))d.name=el.value.trim();
    else if(el.id==='sim-robot-save-name'){E.saveName=el.value;return;}else return;
    E.changed=true;robotReadPanel();});
  robotBox.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!robotEdit)return;const i=+b.closest('[data-dev]')?.dataset.dev,java=RobotConfig.javaOf(robotEdit.devices);
    if(b.matches('[data-dev-copy]'))return void copyText(java.list[i].declare);if(b.matches('[data-dev-insert]'))return insertSource(java.list[i].declare);
    if(b.matches('[data-dev-remove]')){robotEdit.devices.splice(i,1);robotEdit.changed=true;return robotReadPanel();}
    if(b.id==='sim-robot-copy-all')return void copyText([...java.imports,'',...java.fields.map(f=>'    '+f),'','    // in init:',...java.init.map(l=>'    '+l)].join('\n'));
    if(b.id==='sim-robot-use')return useRobotConfig();
    if(b.id==='sim-config-save')return void saveRobotConfig();if(b.id==='sim-config-activate')return void activateRobotConfig();});
  async function copyText(text){try{await navigator.clipboard.writeText(text);status('#sim-robot-status','Copied.');}catch{status('#sim-robot-status','Could not copy: select the line and copy it.');}}
  function insertSource(line){const t=$('#sim-source'),at=t.selectionStart??t.value.length;t.value=t.value.slice(0,at)+line+'\n'+t.value.slice(t.selectionEnd??at);project.program.source=t.value;save();t.focus();}
  async function readRobotConfigs(){const b=$('#sim-robot-usb'),source=$('#sim-robot-source').value||'usb';b.disabled=true;status('#sim-robot-status',source==='usb'?'Reading the Control Hub on USB…':`Reading the robot at ${source}…`);
    try{robotRead=source==='usb'?await api.robotLink('read-usb'):await api.robotLink('read-all',{host:source});robotSelect(robotRead.active?.name||robotRead.configurations[0]);robotReadPanel();const n=robotDevices().length,c=robotRead.configurations.length;
      status('#sim-robot-status',c?`${robotRead.source==='usb'?`Control Hub ${robotRead.serial} on USB`:`The robot at ${robotRead.host}`}: ${c} configuration${c>1?'s':''}. ${robotRead.active?.guessed?'The robot did not say which is active; this is the newest.':`“${robotRead.active.name}” is active`}, with ${n} device${n===1?'':'s'}.`:'The robot has no configurations yet: make one in Configure Robot, or let Send to robot make one.');}
    catch(e){robotRead=null;robotEdit=null;robotReadPanel();status('#sim-robot-status',e.message);}finally{b.disabled=false;}}
  async function saveRobotConfig(){const E=robotEdit,r=robotRead,name=(E.saveName||$('#sim-robot-save-name').value).trim();let xml;try{xml=RobotConfig.rebuild(r.files[E.name],E.devices);}catch(e){return status('#sim-robot-status',e.message);}
    status('#sim-robot-status',`Saving “${name}” on the robot…`);try{const out=await api.robotLink('configure',{host:r.host||'usb',name,xml});status('#sim-robot-status',`Saved “${out.name}” with ${out.devices} device${out.devices===1?'':'s'}; it is the active configuration and the robot restarted.`);await readRobotConfigs();}catch(e){status('#sim-robot-status',e.message);}}
  async function activateRobotConfig(){const r=robotRead,name=robotEdit.name;status('#sim-robot-status',`Making “${name}” active…`);try{await api.robotLink('activate',{host:r.host||'usb',name});status('#sim-robot-status',`“${name}” is the active configuration; the robot restarted.`);await readRobotConfigs();}catch(e){status('#sim-robot-status',e.message);}}
  $('#sim-robot-usb').onclick=()=>void readRobotConfigs();
  $('#sim-robot-dashboard').onclick=async()=>{status('#sim-robot-status','Opening the robot’s dashboard over USB…');try{const r=await api.robotLink('usb-dashboard');status('#sim-robot-status',`The robot’s dashboard is open in its own window (Control Hub ${r.serial} on USB): Program & Manage, OnBot Java and Blocks, with this computer on any Wi-Fi.`);}catch(e){status('#sim-robot-status',e.message);}};
  $('#sim-robot-configs').onchange=e=>{robotSelect(e.target.value);robotReadPanel();};
  if(native&&api.robotLink){void robotSources();$('#sim-robot-source').addEventListener('focus',()=>void robotSources());}
  // Setup's devices take the robot's: each export name matched to the robot's device of that kind (front_left to
  // frontleft or FL), then its name and its hub port; a device on another hub turns the Expansion Hub on at its address.
  function useRobotConfig(){
    const H=window.DeckHardware,W=window.DeckWiring,HS=window.DeckHubSetup,devices=robotDevices(),result=RobotConfig.check(robotNeeds(),{devices}),st=W.state(project),hubs=HS.hubsOf(RobotConfig.parse(robotRead.files[robotEdit.name]));let wiring=project.robot.wiring,count=0;
    for(const row of result.rows){const pick=row.status==='ok'&&!row.duplicate?row.name:row.suggestion,dev=devices.find(d=>d.name===pick),key=H.settingKey(row.setting);if(!dev||!key)continue;
      if(pick!==row.name)deviceName(key,pick);const fam=st.rows.find(r=>r.key===key)?.family,at=HS.placeOf(dev,hubs);
      if(at&&at.hub!=='control')wiring=W.setHub(wiring,at.hub,true,hubs.ids.find(([id])=>id===at.hub)[1].address);
      if(fam&&at)wiring=W.setPort(wiring,key,`${at.hub}:${at.bus??at.port}`,fam);count++;}
    project.robot=C.robot({...project.robot,wiring},project.controller);save();robotPanel();mechanismsPanel();reload();
    status('#sim-robot-status',count?`Setup uses the robot’s names and ports for ${count} device${count===1?'':'s'}.${result.rows.length>count?` ${result.rows.length-count} have no match on the robot: Send to robot can add them.`:''}`:'None of the robot’s devices match what this setup uses.');}
  // ---- One-button setup from the Control Hub (ui/sim-hub-setup.js): it has to be plugged in by USB. Its active
  // configuration is matched to everything Setup wires (only the chassis for a preset robot), names, hubs and ports taken.
  // From Mechanisms (Configure from Control Hub) the result shows there, under what Configure from CAD found; from
  // Calibrate → Electronics or the Setup view, under its button.
  // One configuration into the project: hubs, names, ports, sensors, and what Calibrate shows as read from the hub.
  // background: nobody on the Simulate page asked for this, so a simulation running there stays as it is. Simulate loads what is current each time it opens.
  function useHubConfig(config,{name,serial,source='usb',guessed=false,background=false},out,list){
    const HS=window.DeckHubSetup,chassis=!!project.robotPreset,result=HS.plan(project,config,{only:chassis?'chassis':undefined}),next=HS.apply(project,result);
    for(const k of ['robot','sensors','mechanisms','kinematics'])project[k]=next[k];inputValue('#sim-localization',project.sensors.localization);
    save();robotPanel();mechanismsPanel();if(active&&!background)reload();calHubRead({source,name,...(serial?{serial}:{}),readout:HS.readout(config),config:{name,devices:config.devices||[],hubs:config.hubs||[]}});
    status(out,`“${name}”${guessed?' (the newest; the robot did not say which is active)':source==='usb'?' (active)':''}${serial?` on Control Hub ${serial}`:''}${chassis?', chassis only':''}. ${HS.summary(result)}`);
    const lines=HS.lines(result),li=l=>{const x=document.createElement('li');x.className='sim-hub-'+l.level;x.textContent=l.text;return x;},fine=lines.filter(l=>l.level==='ok'),look=lines.filter(l=>l.level!=='ok');
    // What needs a look shows; what simply matched is one line to open.
    if(fine.length>3){const more=document.createElement('li'),d=document.createElement('details'),sum=document.createElement('summary'),ul=document.createElement('ul');more.className='sim-hub-ok sim-hub-more';sum.textContent=`${fine.length} matched and linked`;ul.className='sim-hub-result';ul.append(...fine.map(li));d.append(sum,ul);more.append(d);list.replaceChildren(...look.map(li),more);}
    else list.replaceChildren(...lines.map(li));list.hidden=!list.children.length;setupRender();calRender();}
  async function hubSetup(from){
    const out=from==='setup'?'#rs-status':'#cal-hub-status',list=$(from==='setup'?'#rs-result':'#cal-hub-result'),buttons=[$('#cal-hub-setup'),$('#rs-read')];
    if(project.controller!=='ftc')return status(out,'Set up from the Control Hub is for an FTC Control Hub: choose it in Setup.');
    if(!native||!api.robotLink)return status(out,'Setting up from the Control Hub needs the desktop app, with the Control Hub plugged into this computer by USB.');
    for(const b of buttons)b.disabled=true;list.hidden=true;status(out,'Reading the Control Hub on USB…');const gen=setupGen;
    try{let read;try{read=await api.robotLink('read-usb');}catch(e){return status(out,gen!==setupGen?HUB_UNPLUGGED:`Plug the Control Hub into this computer with its USB-C data cable, turn the robot on and press this again. (${e.message})`);}
      if(gen!==setupGen)return status(out,HUB_UNPLUGGED);
      const name=read.active?.name||read.configurations[0];if(!name||!read.files?.[name])return status(out,'The Control Hub has no configuration yet. Make one in Configure Robot on the Driver Station (name each motor, servo and sensor), then press this again.');
      let config;try{config=RobotConfig.parse(read.files[name]);}catch(e){return status(out,e.message);}
      setupRead=read;useHubConfig(config,{name,serial:read.serial,guessed:!!read.active?.guessed},out,list);}
    finally{for(const b of buttons)b.disabled=false;}}
  // ---- the Setup view ------------------------------------------------------------------------------------------------
  // Plugging in the Control Hub is enough: the robot lists its hubs (their addresses and kinds) and Deck reads its active
  // configuration, which says what is on each port; a hub cannot sense that by itself. A test is offered only when two hubs
  // of one kind could be mistaken for each other.
  let setupShown=false,setupGone=0,setupRead=null,setupRobot=null,setupConn=null,setupTried=null,setupBusy=false,setupTimer=null,hubTest=null,configEditor=null,setupChecking=null,setupAutoFor=null,setupAutoTries=0,setupAgain=0;
  // What the last Scan found on the Control Hub's USB (a webcam, a Limelight), kept with the setup. Over the USB-C cable Torque reads the hub's ports itself as well, and .devices is
  // what is on them now (DeckUsbKinds.classifyAll, undefined until read; Wi-Fi never has it). Setup, Configure and Camera all read this, so they cannot disagree; null when no hub is
  // connected to say. hubUsbChanged draws whatever shows it, and Configure keeps its unsaved edits.
  const hubUsb=()=>{if(!setupConn)return null;const others=project.calibration?.hub?.scan?.others,rows=setupConn.host==='usb'?hubUsbRows:null;return rows?Object.assign([...(others||[])],{devices:rows,stuck:hubScanStuck()}):others||null;};
  function hubUsbChanged(){if(setupShown)setupRender();if(calibrating){camTab();liveCamera?.refresh();usbDevices?.refresh();usbLive?.refresh();}}
  // ---- What main reads of the hub's ports (src/hub-usb.cjs), pushed with the USB watch. hubUsbRead: {serial, devices, addresses, at}. hubFound: the last scan's answer and when it began.
  // hubCovers: what the last scan that answered was asked about. Whenever that is not what is plugged in now it scans: that one rule takes in a change during a scan, a scan that failed,
  // and a change while nobody was looking, with nothing to remember. A scan never runs off these tabs, and only ever one: setupBusy. Scans nobody pressed for start nothing on the robot, and after
  // HUB_SCAN_TRIES failures they stop, with one line to say so, until something changes: what a scan can see, or the Robot Controller app starting to listen (hubRcLook).
  let hubUsbRead=null,hubUsbRows=null,hubUsbAsks=0,hubUsbAsking=false,hubFound=null,hubCovers=null,hubScanTimer=null,hubScanFails=0,hubScanWhy='',hubRcUp=null,hubRcAt=0,hubRcAsking=false,hubLime=null;const hubUsbBorn=new Map(),HUB_SCAN_AGAIN=[3000,6000,12000,30000],HUB_SCAN_TRIES=HUB_SCAN_AGAIN.length+1,HUB_LIME_AGAIN=[2000,4000,8000,16000];
  const HUB_RC_QUIET='The Robot Controller app is not answering, so Torque has stopped asking it. To try again, press Scan in Setup. That also starts the app if it has stopped.';
  const hubScanStuck=()=>hubScanFails>=HUB_SCAN_TRIES?hubScanWhy||HUB_RC_QUIET:null;
  const hubUsbKey=d=>`${d.path}|${d.dev??''}`,hubUsbTabs=()=>(setupShown&&flowStep!=='axon')||calibrating,hubScanSet=()=>hubUsbRead?window.DeckUsbKinds.scanSet(hubUsbRead.devices,hubUsbRead.addresses):null;
  // A scan speaks only for what was there when it began; a device newer than that has no answer yet. The Limelight's answer stays undefined until it has been asked.
  function hubUsbClassify(){hubUsbRows=hubUsbRead?window.DeckUsbKinds.classifyAll(hubUsbRead.devices,d=>({scan:hubFound&&hubFound.began>=(hubUsbBorn.get(hubUsbKey(d))??Infinity)?hubFound:undefined,limelight:hubLime?.answer})):null;}
  function hubUsbUpdate(list){if(hubUsbRead?.at===list.at&&hubUsbRead.serial===list.serial)return;if(hubUsbRead&&hubUsbRead.serial!==list.serial)hubUsbForget();const was=hubScanSet(),keys=new Set(list.devices.map(hubUsbKey)),now=Date.now();hubUsbRead=list;
    for(const k of hubUsbBorn.keys())if(!keys.has(k))hubUsbBorn.delete(k);for(const k of keys)if(!hubUsbBorn.has(k))hubUsbBorn.set(k,now);
    hubLimeFollow();hubUsbClassify();void hubLimeAsk();
    // Settling: another change starts the wait again, and is a new reason to try after failures.
    if(hubScanSet()!==was){clearTimeout(hubScanTimer);hubScanTimer=null;hubScanFails=0;}hubUsbChanged();hubScanLook();}
  // Answers whether there was anything to forget.
  function hubUsbForget(){const had=!!hubUsbRead;clearTimeout(hubScanTimer);clearTimeout(hubLime?.timer);hubUsbRead=hubUsbRows=hubFound=hubCovers=hubScanTimer=hubLime=hubRcUp=null;hubScanFails=0;hubUsbAsks=0;hubUsbBorn.clear();return had;}
  // Asked if nothing has come by itself yet, a few times for each connection.
  async function hubUsbAsk(){if(hubUsbAsking||hubUsbRead||hubUsbAsks>=3||!hubUsbTabs()||setupConn?.host!=='usb')return;hubUsbAsking=true;hubUsbAsks++;let got=null;try{got=await api.robotLink('hub-usb');}catch{}hubUsbAsking=false;if(got?.devices&&!hubUsbRead&&setupConn?.host==='usb'&&hubUsbTabs())hubUsbUpdate(got);}
  // A USB network device: is it a Limelight? It is asked when it appears and again when the hub gets an address from it. Its network comes up before its software does, so an ask that
  // finds nothing is tried a few more times over half a minute, and until then it says Checking rather than calling a Limelight something else.
  function hubLimeFollow(){const nets=hubUsbRead.devices.filter(d=>window.DeckUsbKinds.scanKind(d)==='network').map(hubUsbKey),key=nets.length?JSON.stringify([nets,hubUsbRead.addresses||[]]):null;if((hubLime?.key??null)===key)return;clearTimeout(hubLime?.timer);hubLime=key?{key,tries:0,answer:undefined,timer:null,asking:false}:null;}
  async function hubLimeAsk(){const me=hubLime;if(!me||me.answer!==undefined||me.asking||me.timer||!hubUsbTabs())return;me.asking=true;let got=null;try{got=await api.robotLink('limelight',{});}catch{}me.asking=false;if(hubLime!==me)return;
    if(got?.status&&typeof got.status==='object')me.answer=got;else if(me.tries>=HUB_LIME_AGAIN.length)me.answer={status:null};else{me.timer=setTimeout(()=>{me.timer=null;void hubLimeAsk();},HUB_LIME_AGAIN[me.tries++]);return;}
    hubUsbClassify();hubUsbChanged();}
  // After a settling second, or longer after failures. Anything that may have made it possible calls this; it does nothing if it is already waiting or there is nothing to do.
  function hubScanLook(){if(hubScanTimer||hubScanFails>=HUB_SCAN_TRIES||!hubUsbTabs()||!hubUsbRead||hubScanSet()===hubCovers)return;hubScanTimer=setTimeout(hubScanRun,hubScanFails?HUB_SCAN_AGAIN[hubScanFails-1]:1000);}
  // What is using the robot, or building on it, and must not be disturbed by a scan nobody pressed for. A scan's link would also fool the check that Torque Debug did not crash the app.
  const hubRobotBusy=()=>{const d=liveDebug?.state?.();return !!(liveDebug?.running()||d?.starting||d?.installing||robotSending);};
  async function hubScanRun(){hubScanTimer=null;const c=setupConn;if(hubScanFails>=HUB_SCAN_TRIES||!hubUsbTabs()||!hubUsbRead||hubScanSet()===hubCovers||project.controller!=='ftc'||(c&&c.host!=='usb'))return;
    // Not yet: no connection, a read or scan under way, the robot in use, or on Setup the read and the first scan that come with plugging in. Calibrate has no read to wait for.
    if(!c||setupBusy||hubRobotBusy()||(setupShown&&(setupRobot?.id!==c.id||!setupRead||setupAutoFor!==c.id)))return hubScanLook();
    await setupScan({auto:true,silent:true});}
  // Stopped asking: a quick read of the hub now and then, which starts nothing, sees the app begin to listen. Then a couple more tries, since a build that crashes keeps doing that.
  async function hubRcLook(){if(hubScanFails<HUB_SCAN_TRIES||hubRcAsking||setupConn?.host!=='usb'||Date.now()-hubRcAt<15000)return;hubRcAsking=true;hubRcAt=Date.now();let up=null;try{up=await api.robotLink('hub-rc-up');}catch{}hubRcAsking=false;
    const began=up===true&&hubRcUp===false;if(typeof up==='boolean')hubRcUp=up;if(!began||hubScanFails<HUB_SCAN_TRIES||!hubUsbTabs())return;hubScanFails=HUB_SCAN_TRIES-2;hubUsbChanged();void hubScanRun();}
  // From Calibrate → Camera to the cameras at the top of Configure.
  async function configureUsb(serial){flowStep='configure';flowMarks();await api.page('setup');for(let i=0;i<40&&setupRoot.hidden;i++)await new Promise(r=>setTimeout(r,25));setupRender();configEditor?.showUsb(serial);}
  // A device that works on I2C and not USB: Configure's I2C bus, with it ready to pick. An Axon programmer: its own tab.
  async function configureI2c(tag){flowStep='configure';flowMarks();await api.page('setup');for(let i=0;i<40&&setupRoot.hidden;i++)await new Promise(r=>setTimeout(r,25));setupRender();setupEditor()?.showI2c(tag);}
  const axonTab=()=>setupRoot?.querySelector('[data-flow=axon]')?.click();
  const setupPlug=(text,on)=>{const p=$('#rs-plug');p.querySelector('span').textContent=text;p.querySelector('i').className=`dot${on?' live':''}`;};
  const setupNote=text=>status('#rs-status',text);
  // Over USB-C if a Control Hub is plugged in, else over the robot's Wi-Fi. Reading a configuration asks no hub anything; only Scan does.
  function setupChecks(steps){const list=$('#rs-checks');list.replaceChildren(...steps.map(s=>{const li=document.createElement('li');li.className=s.ok?'ok':'bad';li.append(Object.assign(document.createElement('b'),{textContent:s.name}),Object.assign(document.createElement('span'),{textContent:s.detail||''}));return li;}));list.hidden=!steps.length;}
  // What is running holds setupBusy, and whoever wants a turn waits for it rather than being dropped. setupPress: presses waiting, which the buttons show as busy. A scan nobody pressed for says
  // nothing, so on its own it leaves the buttons as they were: pressing one waits for it. Waiters check again as they wake (the while around setupIdle), since only one of them gets the turn.
  let setupPress=0;const setupWaiters=[],setupIdle=()=>new Promise(r=>setupWaiters.push(r)),setupFree=()=>{setupBusy=false;for(const r of setupWaiters.splice(0))r();},setupLooksBusy=()=>(setupBusy&&!setupScanning?.silent)||setupPress>0;
  // press: a button was pressed for this, which may start the Robot Controller app if it has stopped. Nothing else may.
  async function setupRead_({check=false,press=false}={}){const asked=setupGen;while(setupBusy)await setupIdle();if(asked!==setupGen||project.controller!=='ftc'||!setupConn)return;setupBusy=true;const conn=setupConn,gen=setupGen;setupRender();
    try{setupPlug('Control Hub found. Reading what is connected…',true);setupNote('');
      const read=conn.host==='usb'?await api.robotLink('read-usb'):await api.robotLink('read-all',{host:conn.host});if(gen!==setupGen)return;
      const name=read.active?.name||read.configurations[0],xml=name?read.files?.[name]:null,config=xml?RobotConfig.parse(xml):{devices:[],hubs:[]},had=setupRobot?.id===conn.id?setupRobot:null;
      setupRead=read;setupRobot={id:conn.id,serial:read.serial||conn.host,configured:config.hubs.map(h=>h.address),...(had?.scanned?{portals:had.portals,scanned:had.scanned,hubsKey:had.hubsKey}:{})};
      useHubConfig(window.DeckHubSetup.withScan(config,had?.portals),{name:name||'no configuration',...(read.serial?{serial:read.serial}:{}),guessed:!!read.active?.guessed,background:true},'#rs-matched',document.createElement('ul'));
      if(!name)setupNote('The robot has no configuration yet. Press New configuration to make one from what Scan finds.');
      setupPlug(`Control Hub ${setupRobot.serial} connected over ${conn.host==='usb'?'USB-C':'Wi-Fi'}.`,true);
      // Android is up before the Robot Controller app: its answer on which configuration is active comes a little later.
      setupAgain=read.active?.guessed?setupAgain+1:0;
      if(check){setupChecks([{name:'Checking the connection…',ok:true}]);const checking=api.robotLink('check',{host:conn.host,...(press?{}:{noStart:true})}).then(steps=>{if(gen===setupGen)setupChecks(steps);},e=>{if(gen===setupGen)setupChecks([{name:'Talk to the robot',ok:false,detail:e.message}]);}).finally(()=>{if(setupChecking===checking)setupChecking=null;});setupChecking=checking;}}
    catch(e){if(gen!==setupGen)return;setupRobot=null;setupAutoFor=null;if(/still starting/.test(e.message)){setupTried=null;setupPlug(e.message,true);}
      // Just plugged in, ADB can say it is not there yet or not ready. That is only a wait: the next look reads it.
      else if(hubOnUsb&&/No Control Hub on USB|has not allowed|on USB is /.test(e.message)){setupTried=null;setupPlug('Control Hub plugged in. Waiting for it to answer…',true);}
      else setupPlug(`Could not read the Control Hub. ${e.message}`,false);}
    finally{if(gen===setupGen){setupFree();setupRender();}}}
  // Scan: what answers on the robot now, as Configure Robot's Scan does. It adds what it found to the hubs Setup uses.
  // What Scan has so far: the hubs the robot has open at once, then each answer from the cable. Setup only takes new hubs when the list changes.
  let setupScanning=null;
  // On Calibrate nothing has been read from the robot, so a scan only says what is on its USB and its hubs. Off these tabs, Drive and Simulate above all, nothing it says touches anything.
  // A scan nobody pressed for takes only its final answer, and changes the project only if the hubs really differ from those already taken: setupRobot.hubsKey.
  function setupScanned({portals,others},checking){const scan=setupScanning;if(!scan||!hubUsbTabs()||(scan.silent&&checking))return;if(!checking&&setupShown&&setupConn?.host==='usb'&&setupRead?.serial)setTimeout(()=>void liveDebug?.prepare('usb',setupRead.serial),0);
    if(setupRobot){setupRobot.portals=portals;setupRobot.checking=checking;setupRobot.scanned=portals.flatMap(p=>[...p.modules.map(m=>m.address),...(p.servoHubs||[]).map(h=>h.address)]);}
    const usbWas=JSON.stringify(project.calibration.hub?.scan?.others??null);project.calibration.hub={...project.calibration.hub,scan:{expansion:portals.reduce((n,p)=>n+p.modules.filter(m=>!m.parent).length,0),servoHub:portals.reduce((n,p)=>n+(p.servoHubs||[]).length,0),others:others??project.calibration.hub?.scan?.others??[],at:new Date().toISOString()}};if(JSON.stringify(project.calibration.hub.scan.others)!==usbWas)hubUsbChanged();
    if(!setupRobot)return;const name=setupRead.active?.name||setupRead.configurations[0],xml=name?setupRead.files?.[name]:null,config=xml?RobotConfig.parse(xml):{devices:[],hubs:[]};
    const key=[...setupRobot.scanned].sort().join();if(key===scan.key||(scan.silent&&key===setupRobot.hubsKey))return setupRender();scan.key=setupRobot.hubsKey=key;
    useHubConfig(window.DeckHubSetup.withScan(config,portals),{name:name||'no configuration',...(setupRead.serial?{serial:setupRead.serial}:{}),background:true},'#rs-matched',document.createElement('ul'));}
  // auto: nobody pressed anything, so it starts nothing on the robot. silent: asked for by something plugged in. It says nothing either way, and hubScanLook tries again if it fails.
  // A press waits its turn; what is not pressed for comes back later by itself.
  async function setupScan({auto=false,silent=false}={}){const pressed=!auto&&!silent;if(pressed&&setupConn&&setupRobot&&setupRead&&setupBusy){const asked=setupGen;setupPress++;setupPlug('Scanning for hubs and devices…',true);setupRender();while(setupBusy)await setupIdle();setupPress--;setupRender();if(asked!==setupGen)return;}
    if(setupBusy||!setupConn||(!silent&&(!setupRobot||!setupRead)))return;const quiet=silent||(auto&&setupAutoTries>1),gen=setupGen,covers=hubScanSet(),began=Date.now();setupBusy=true;setupScanning={key:null,silent};if(setupRobot&&!silent){setupRobot.scanned??=[];setupRobot.checking=true;}if(!quiet)setupRender();
    // With no answer, nothing has been found or not found.
    const unanswered=()=>{if(!setupRobot)return;setupRobot.checking=false;if(!setupRobot.scanned?.length)delete setupRobot.scanned;};
    try{if(setupChecking)await setupChecking;if(gen!==setupGen)return;if(!silent)setupPlug('Scanning for hubs and devices…',true);const found=await api.robotLink('scan',{host:setupConn.host,...(pressed?{}:{noStart:true})});if(gen!==setupGen)return;
      // The student left for Drive or Simulate while it ran: its answer goes nowhere, and the scan comes again on coming back.
      if(!hubUsbTabs()){unanswered();if(auto&&!silent)setupAutoFor=null;return;}
      setupScanned(found,false);calSave();
      hubFound={portals:found.portals,others:found.others||[],began};hubCovers=covers;hubScanFails=0;hubUsbClassify();hubUsbChanged();
      if(setupRobot)setupPlug(`Control Hub ${setupRobot.serial} connected over ${setupConn.host==='usb'?'USB-C':'Wi-Fi'}.`,true);return true;}
    catch(e){if(gen!==setupGen)return;unanswered();
      if(silent){hubScanFails++;if(/app on this Control Hub is not answering/.test(e.message)){hubRcUp=false;hubScanWhy='';}else{hubRcUp=true;hubScanWhy=/^(Another Driver Station|Close the robot in Drive|The guided check)/.test(e.message)?e.message:'';}if(hubScanStuck())hubUsbChanged();}
      else if(auto&&setupAutoTries<12){setupAutoFor=null;setupPlug('Waiting for the Robot Controller app to answer…',true);}else setupPlug(`The scan did not finish. ${e.message}`,false);}
    finally{if(gen===setupGen){setupScanning=null;setupFree();setupRender();hubScanLook();}}}
  // A hub Scan did not find: out of the active configuration on the robot, with the devices set up on it, and out of Setup.
  async function setupRemoveHub(id){if(!setupRobot||!setupRead)return;const hub=window.DeckHardware.wiringOf(project.robot).hubs[id],label=window.DeckHardware.hubName(id,{hubs:window.DeckHardware.wiringOf(project.robot).hubs}),name=setupRead.active?.name||setupRead.configurations[0],xml=name?setupRead.files?.[name]:null;if(!hub)return;
    const tag=window.DeckHardware.hubKind(id)==='servoHub'?'ServoHub':'LynxModule',out=xml?RobotConfig.removeHub(xml,{address:hub.address,tag}):{xml,devices:[]};
    if(out.xml===xml)return useHubConfig(window.DeckHubSetup.withScan(xml?RobotConfig.parse(xml):{devices:[],hubs:[]},setupRobot.portals),{name:name||'no configuration'},'#rs-matched',document.createElement('ul'));
    if(out.devices.length&&!confirm(`${label} has ${out.devices.length===1?'1 device':`${out.devices.length} devices`} set up on it: ${out.devices.map(d=>d.name).join(', ')}. Remove the hub and ${out.devices.length===1?'it':'them'} from “${name}”?`))return;
    if(configEditor?.current()===name&&configEditor.dirty()&&!confirm(`Your changes to “${name}” in Configure are not saved. Discard them?`))return;
    await setupAct(`Removing ${label} from “${name}”. The robot restarts…`,async()=>{await api.robotLink('configure',{host:setupConn.host,name,xml:out.xml,replace:true});if(configEditor?.current()===name)configEditor.open(name,out.xml,setupRobot?.portals);});}
  // Each look: one at a time, and a change that came while asking asks again. Wi-Fi has nothing to push, so a timer keeps this going;
  // with the USB watch up, none of it runs ADB. Where the watch is down, a hub that stops answering gets one chance to come back.
  let hubAsking=false,hubAskAgain=false,hubNudged;
  async function setupWatch(){const watched=()=>setupShown||calibrating;if(!watched()||setupBusy||!native||!api.robotLink)return;if(hubAsking){hubAskAgain=true;return;}hubAsking=true;let d;try{d=await api.robotLink('detect');}catch(e){d={usb:{found:false,message:e.message}};}finally{hubAsking=false;}
    if(hubAskAgain){hubAskAgain=false;return setupWatch();}if(!watched()||setupBusy)return;
    // What the watch last pushed is newer than this answer.
    const usb=hubLive?.status??d.usb,pushing=hubLive?.usb||hubLive?.adb?.running;
    // The watch saw the hub and has not said it left, so ADB is only restarting, and what it answers now says nothing: the watch waits that out and then tells. If the watch itself stays dark, asking takes over.
    if(hubPushedOn&&!hubLive?.hub&&!usb?.found&&(pushing||Date.now()-hubDarkAt<HUB_DARK_MS))return;hubLinkFollow(usb,d.wifi);
    if(usb?.found){hubOnUsb=true;hubMisses=0;}else if(!pushing&&hubOnUsb&&project.controller==='ftc'){hubMisses++;if(hubMisses===1){await api.robotLink('usb-recover').catch(()=>{});return;}hubLeft();}
    // On the cable, and ADB stuck on it (after the computer sleeps, say): one nudge each time it is plugged in, offline soon, and not listed only once Android has had time to start.
    const stuck=usb?.plugged&&usb.state!=='unauthorized'&&usb.state!=='update';
    if(pushing&&stuck&&hubNudged!==usb.state&&Date.now()-hubPlugAt>(usb.state==='offline'?5000:60000)){hubNudged=usb.state;void api.robotLink('usb-recover').catch(()=>{});}
    const conn=usb?.found?{id:'usb:'+usb.serial,host:'usb'}:d.wifi?.robot&&d.wifi.reachable!==false?{id:'wifi:'+d.wifi.host,host:d.wifi.host}:null;
    if(!conn&&setupRobot?.id?.startsWith('wifi:')&&++setupGone<2)return;
    if(conn)setupGone=0;
    if(!conn){setupConn=null;setupTried=null;setupAutoFor=null;setupAutoTries=0;setupAgain=0;if(setupRobot){setupRobot=null;setupRead=null;setupChecks([]);setupRender();}if(hubUsbForget())hubUsbChanged();
      setupPlug(usb?.plugged?(stuck&&Date.now()-hubPlugAt>90000?'Control Hub plugged in, but it is not answering. Check the robot is on, or unplug it and plug it back in.':usb.message):usb?.message&&!/Not plugged/.test(usb.message)?usb.message:HUB_PLUG,!!usb?.plugged);return;}
    const had=setupConn;setupConn=conn;if(!had)hubUsbChanged();void hubUsbAsk();void hubLimeAsk();hubScanLook();void hubRcLook();if((setupShown||calibrating)&&setupRobot?.id!==conn.id&&setupTried!==conn.id){setupTried=conn.id;await setupRead_({check:setupShown});}
    else if((setupShown||calibrating)&&setupRobot?.id===conn.id&&setupAgain>0&&setupAgain<8)await setupRead_();
    // Plugged in: it scans by itself, once for each time the hub is connected.
    if(setupShown&&setupRobot?.id===conn.id&&setupAutoFor!==conn.id&&!setupBusy&&!hubRobotBusy()&&(setupAgain===0||setupAgain>=8)){setupAutoFor=conn.id;setupAutoTries++;await setupScan({auto:true});}}
  // One press that changes something on the robot, in its turn, then the robot read again. What must not happen unless the robot took it, such as closing a draft, goes at the end of task.
  // Throws what went wrong, in words for the student, and HUB_UNPLUGGED if the hub left meanwhile.
  async function setupDo(task){if(!setupConn)throw Error(HUB_UNPLUGGED);const gen=setupGen;setupPress++;setupRender();while(setupBusy)await setupIdle();setupPress--;if(gen!==setupGen||!setupConn){setupRender();throw Error(HUB_UNPLUGGED);}setupBusy=true;setupRender();
    try{if(setupChecking)await setupChecking;if(gen!==setupGen)throw Error(HUB_UNPLUGGED);await task();}catch(e){if(gen!==setupGen)throw Error(HUB_UNPLUGGED);setupFree();setupRender();throw e;}
    if(gen!==setupGen)return;setupFree();await setupRead_();}
  // The same with what it is doing on the screen, and what went wrong too. Answers whether it happened.
  async function setupAct(doing,task){const gen=setupGen;setupNote(doing);try{await setupDo(()=>{setupNote(doing);return task();});return true;}catch(e){if(gen===setupGen)setupNote(e.message);return false;}}
  function setupConfigs(){const box=$('#rs-configs'),names=[...(setupRead?.configurations||[])].sort((a,b)=>a.localeCompare(b)),active=setupRead?.active?.name;
    box.replaceChildren(...names.map(name=>{const row=document.createElement('div'),on=name===active,b=(text,act,off)=>{const x=Object.assign(document.createElement('button'),{type:'button',className:act==='delete'?'secondary danger':'secondary',textContent:text,disabled:setupLooksBusy()||!!off});x.dataset.cfg=act;x.dataset.name=name;x.setAttribute('aria-label',`${text} ${name}`);return x;};
      row.className='rs-config'+(on?' active':'');row.setAttribute('role','listitem');const title=document.createElement('div');title.append(Object.assign(document.createElement('b'),{textContent:name}));if(on)title.append(Object.assign(document.createElement('span'),{className:'rs-pill ok',textContent:'Active'}));
      row.append(title,b('Edit','edit'),b('Activate','activate',on),b('Delete','delete'));return row;}));
    if(!names.length){const p=Object.assign(document.createElement('p'),{className:'hint',textContent:setupRobot?'This robot has no saved configurations.':'Connect to the robot to see its configurations.'});box.replaceChildren(p);}
    $('#rs-new').disabled=setupLooksBusy()||!setupRobot;}
  // Opens one configuration in Configure: from its Edit button in Setup, or from the list beside Configure's Save.
  // A Control Hub that was connected and is gone: in the middle of the screen until OK is pressed or it is plugged back in. Only on the
  // tabs that work with the hub (Setup, Configure, Calibrate); never while driving.
  const hubDropped=document.createElement('dialog');hubDropped.id='hub-dropped';hubDropped.setAttribute('role','alertdialog');hubDropped.setAttribute('aria-labelledby','hub-dropped-title');hubDropped.innerHTML='<h2 id="hub-dropped-title">Your Control Hub dropped</h2><p>The USB connection to the Control Hub was lost. Plug its USB-C cable back into this computer and check the robot is on. Torque reconnects by itself.</p><button id="hub-dropped-ok" type="button">OK</button>';document.body.append(hubDropped);
  hubDropped.addEventListener('cancel',e=>e.preventDefault());hubDropped.querySelector('button').onclick=()=>hubDropped.close();
  const HUB_PLUG='Plug the Control Hub in by USB-C, or join its Wi-Fi, with the robot on.';
  let hubOnUsb=false,hubMisses=0,hubPushedOn=false,hubPlugAt=0,hubDarkAt=0;const HUB_DARK_MS=15000;
  // Send to robot's choices follow the cable too. Only those: Simulate's panels are heavy to draw, are not on these tabs, and look for themselves when they show (detectLink).
  function hubLinkFollow(usb,wifi=link.wifi){if(JSON.stringify(link.usb)===JSON.stringify(usb)&&JSON.stringify(link.wifi)===JSON.stringify(wifi))return;link.usb=usb;link.wifi=wifi;showLink();}
  // It left the cable: everything about it goes now, whatever was going on. A read or scan still out there is abandoned (setupGen).
  function hubLeft(){hubOnUsb=false;hubPushedOn=false;hubMisses=0;setupGen++;setupFree();setupScanning=null;setupChecking=null;setupConn=null;setupTried=null;setupAutoFor=null;setupAutoTries=0;setupAgain=0;setupRobot=null;setupRead=null;setupChecks([]);setupNote('');
    if(hubTest){hubTest=null;void liveDebug?.stop();}liveDebug?.unplugged();setupPlug(HUB_PLUG,false);hubLinkFollow({found:false,message:'Not plugged in.'});
    if(sendState?.host==='usb'){sendState=null;showCheck();showPlan();$('#sim-send-confirm').hidden=true;status('#sim-send-status',HUB_UNPLUGGED);}
    hubUsbForget();if(project.controller==='ftc'&&!hubDropped.open){hubDropped.showModal();}setupRender();hubUsbChanged();}
  // What the USB watch pushes (src/usb-watch.cjs): Windows's word on the cable first, then ADB's, and this comes at once whatever else is busy.
  function hubPushed(s){if(!s||!setupTimer)return;hubLive=s;const there=!!s.hub,seeing=s.usb||s.adb?.running;hubDarkAt=seeing?0:hubDarkAt||Date.now();
    if(there&&!hubPushedOn){hubPushedOn=true;liveCamera?.replugged?.();liveDebug?.recheck?.();hubOnUsb=true;hubMisses=0;hubPlugAt=Date.now();hubNudged=undefined;if(hubDropped.open)hubDropped.close();if(setupRobot?.id!=='usb:'+s.hub.serial)setupPlug('Control Hub plugged in.',true);}
    // Only the watch's own word that the hub left. A list with no hub in it says nothing by itself: ADB's first after its server restarts is often empty. A Driver Hub found out never was a Control Hub,
    // and a hub leaving update mode is restarting: they just go.
    else if(!there&&hubPushedOn&&s.drop){hubPushedOn=false;hubOnUsb=false;if(s.drop==='unplugged')hubLeft();}
    // Nothing is known yet as the watch starts, which is not the same as nothing being there.
    if(s.hubUsb)hubUsbUpdate(s.hubUsb);else if(!there&&seeing&&hubUsbForget())hubUsbChanged();
    // Only the hub's own ports changed: the hub itself is as it was.
    if(s.why==='hub-usb')return;
    if(s.status)hubLinkFollow(s.status);void setupWatch();
    // For usb-watch.log: when the page drew it.
    if(s.why==='+'||s.why==='-')requestAnimationFrame(()=>void api.robotLink('usb-watch',{shown:s.seq,at:Date.now()}).catch(()=>{}));}
  if(native&&api.onUsbWatch)api.onUsbWatch(hubPushed);
  function hubWatch(){const on=(setupShown&&flowStep!=='axon')||calibrating;if(on&&!setupTimer){hubOnUsb=false;hubMisses=0;hubPushedOn=false;hubLive=null;hubDarkAt=0;if(hubScanWhy)hubScanFails=0;setupTimer=setInterval(()=>void setupWatch(),3000);if(native&&api.robotLink)void api.robotLink('usb-watch',{on:true}).then(hubPushed,()=>{});void setupWatch();}
    else if(!on&&setupTimer){clearInterval(setupTimer);setupTimer=null;hubLive=null;hubPushedOn=false;clearTimeout(hubScanTimer);hubScanTimer=null;if(native&&api.robotLink)void api.robotLink('usb-watch',{on:false}).catch(()=>{});}}
  const setupAskActive=name=>new Promise(done=>{const d=$('#rs-active-confirm'),unsaved=configEditor?.dirty();if(d.open)return done(false);const answer=v=>{d.oncancel=d.onkeydown=null;d.close();done(v);};$('#rs-active-title').textContent=`Make “${name}” your active configuration?`;$('#rs-active-text').textContent=`The robot restarts to use it, and Configure shows it.${unsaved?` Your changes to “${configEditor.current()}” are not saved and will be lost.`:''}`;$('#rs-active-yes').onclick=()=>answer(true);$('#rs-active-no').onclick=()=>answer(false);d.oncancel=ev=>{ev.preventDefault();answer(false);};d.onkeydown=ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();answer(false);}};d.showModal();$('#rs-active-no').focus();});
  // Only the active configuration is ever on the Configure screen. Anything else has to become active first, and the team says so.
  async function setupSwitch(name,{go=false}={}){const show=()=>{if(go){flowStep='configure';flowMarks();}setupRender();};
    if(name===setupRead?.active?.name)return show();
    if(!setupConn||!setupRead?.files?.[name])return setupNote(`Could not read “${name}”.`);
    if(!await setupAskActive(name)){configEditor?.render();return;}
    // The draft goes only once the robot has taken the change the student agreed to lose it for.
    if(!await setupAct(`Making “${name}” active. The robot restarts…`,async()=>{await api.robotLink('activate',{host:setupConn.host,name});if(configEditor?.dirty())configEditor.close();})){configEditor?.render();return;}
    // A restarting robot's web server can't say what is active yet, so ask until it says this one.
    for(let i=0;i<6&&setupRead?.active?.name!==name&&setupConn;i++){await new Promise(r=>setTimeout(r,2000));await setupRead_();}
    if(setupConn&&setupRead?.active?.name!==name)setupNote(`The robot has not reported “${name}” as active yet. Press Check again in a moment.`);show();}
  // What Configure holds follows the robot, except while there are changes to save.
  // A newer scan's hubs go into the draft whatever else is in it. A draft that only has those in it is not the team's to keep, so it still follows.
  let editorRead=null,editorPortals=null;function setupFollowActive(){const name=setupRead?.active?.name,xml=name&&setupRead.files?.[name],portals=setupRobot?.portals;configEditor?.usePortals(portals);if(!configEditor||!xml||configEditor.edited())return;
    if(configEditor.current()!==name)configEditor.open(name,xml,portals);else if(editorRead!==setupRead||editorPortals!==portals)configEditor.refresh(name,xml,portals);editorRead=setupRead;editorPortals=portals;}
  const setupSave=async(name,xml)=>{await setupDo(()=>api.robotLink('configure',{host:setupConn.host,name,xml,replace:true}));liveDebug?.warm(90000,10000);};
  function setupEditor(){if(configEditor||!setupRoot)return configEditor;const W=window.DeckWiring;configEditor=window.DeckConfigEditor.create({box:$('#rs-step-configure'),api:{save:setupSave,photo:tag=>api.devicePhoto(tag),names:()=>setupRead?.configurations||[],pick:name=>void setupSwitch(name),pinout:o=>window.DeckPinoutView.show({...o,photo:native?tag=>api.devicePhoto(tag):null,save:api.savePinout}),usb:hubUsb,auto:()=>autoConfigure(),autoOff:()=>autoBusy||!setupConn,told:()=>autoTold,axon:axonTab,extra:()=>project.controller==='ftc'?`<div id="rc-spm">${W.hubsHtml(W.state(project),{ids:'rc-',only:['spm']})}</div>`:''}});return configEditor;}
  // A robot with no configuration yet gets one from what a scan found: every hub, and the Control Hub's own IMU.
  function configFromScan(portals){const imus=[];for(const p of portals){const parent=p.modules.find(m=>m.parent),tag=parent&&RobotConfig.IMU_TAGS[parent.imu];if(tag&&p.serial==='(embedded)')imus.push({name:'imu',tag,device:'imu',port:0,bus:0,module:{portal:p.serial,address:parent.address,name:'Control Hub'}});}return RobotConfig.newConfiguration(portals,imus);}
  // ---- Auto-configure: one press puts what is plugged in into the active configuration and goes to Camera. Every webcam plugged in, a Limelight that answers, every hub on the cable.
  // It writes only if there is something new, by the same way as Save, which restarts the robot. Unsaved edits are asked about once and never lost. Camera, Setup and Configure all press this one.
  let autoBusy=false,autoTold='';
  const autoDialog=document.createElement('dialog');autoDialog.id='rs-auto-confirm';autoDialog.setAttribute('aria-labelledby','rs-auto-title');autoDialog.innerHTML='<h2 id="rs-auto-title"></h2><p>Auto-configure is about to write the new devices to the robot. Should your other changes go with them? If you keep them for later they stay in Configure, for you to save or cancel.</p><div class="button-row"><button type="button" class="primary" data-auto-answer="save">Save them too</button><button type="button" class="secondary" data-auto-answer="keep">Keep them for later</button><button type="button" class="secondary" data-auto-answer="cancel">Cancel</button></div>';document.body.append(autoDialog);
  const autoAsk=name=>new Promise(done=>{const answer=v=>{autoDialog.onclick=autoDialog.oncancel=null;autoDialog.close();done(v);};autoDialog.querySelector('h2').textContent=`You have changes to “${name}” that are not saved`;autoDialog.onclick=e=>{const b=e.target.closest('[data-auto-answer]');if(b)answer(b.dataset.autoAnswer);};autoDialog.oncancel=e=>{e.preventDefault();answer('cancel');};autoDialog.showModal();autoDialog.querySelector('[data-auto-answer=cancel]').focus();});
  const calTold=text=>{const el=$('#cal-told');if(!el)return;el.textContent=text||'';el.hidden=!text;};
  // While it runs, every screen that can press it says what it is doing. autoEnd: the last word, for wherever the student is.
  function autoSay(text){autoTold=text;calTold(calibrating?text:'');setupRender();}
  function autoEnd(text){autoBusy=false;autoTold='';setupNote(text);configEditor?.say(text);calTold(calibrating?text:'');setupRender();return false;}
  const namesOf=list=>list.length<2?list.join(''):`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`;
  // What happened, in a sentence or two, with what stayed out and why.
  function autoWords({wrote,cameras,hubs,imus=[],ready,left}){const on=(list,word)=>list.length?`${namesOf(list)} ${list.length>1?'are':'is'} ${word}.`:'';
    return [wrote?'':'Everything plugged in is already configured, so nothing was written.',on(cameras.length?cameras:ready,'connected and ready'),on([...hubs,...imus],'in the configuration now'),...left.map(r=>`Not added: ${r.word}. ${r.warn}`)].filter(Boolean).join(' ');}
  // The robot restarts to use a new configuration. A read and then a scan, which the Robot Controller itself answers, so an answer means it is back.
  async function autoBack(){for(let i=0;i<3&&setupConn;i++){if(!setupRobot||!setupRead)await setupRead_();if(setupRobot&&setupRead&&await setupScan())return true;}return false;}
  async function autoConfigure(){if(autoBusy||!setupRoot)return false;if(!native||!api.robotLink||project.controller!=='ftc'||!setupConn)return autoEnd('Connect to the Control Hub first, by USB-C with the robot on.');
    autoBusy=true;const gen=setupGen,done=text=>autoEnd(gen===setupGen?text:HUB_UNPLUGGED);
    try{setupEditor();autoSay('Looking at what is connected…');
      // In use: live debug, a build or a Send has the robot. Torque Debug started by itself gives way to all of this. Over the cable the file can still be read; over Wi-Fi nothing can.
      const inUse=()=>hubRobotBusy()&&!liveDebug?.state?.().auto;
      // The file as it is on the robot now: Send or a Driver Hub may have changed it since the last read. Unsaved edits stay on the file they began from, and are asked about below.
      if(!setupRobot||!setupRead||(!configEditor.edited()&&(setupConn.host==='usb'||!inUse())))await setupRead_();if(gen!==setupGen||!setupRobot||!setupRead)return done(setupRobot?'':'Could not read the Control Hub. Check the robot is on, then press Auto-configure again.');
      // A guess at which is active is only the newest file, and saving it would make it active.
      if(setupRead.active?.guessed)return done('The Robot Controller app has not said which configuration is active yet, so Torque changed nothing. Wait for the robot to finish starting, then press Auto-configure again.');
      // What is plugged in comes from the hub's own ports, read over the cable, or from a scan that answers now: over Wi-Fi that is all there is, and an older one may be out of date.
      let answered=false;if(!inUse()&&(setupConn.host!=='usb'||!setupRobot.portals||!hubUsb()?.devices))answered=await setupScan()===true;if(gen!==setupGen||!hubUsbTabs())return done('');
      if(!hubUsb()?.devices&&!answered)return done(inUse()?'Torque is using the robot right now, so it cannot ask what is plugged in. Stop live debug or wait for the build to finish, then press Auto-configure again.':'Torque could not ask the robot what is plugged in, so it changed nothing. Check the robot is on, then press Auto-configure again.');
      setupFollowActive();const active=setupRead.active?.name||setupRead.configurations[0],none=!active||!setupRead.files?.[active];
      if(none){const portals=setupRobot.portals||[];if(!portals.length)return done('The scan found no hubs. Check the hubs are powered and connected, then press Auto-configure again.');configEditor.open(RobotConfig.configurationName('robot',setupRead.configurations||[]),configFromScan(portals),portals);}
      const plan=configEditor.plan(),left=plan.left.filter(r=>r.word);
      let cameras=[],hubs=[],imus=[];
      if(plan.writes||none){let withEdits=false;if(!none&&configEditor.edited()){const answer=await autoAsk(configEditor.current());if(answer==='cancel')return done('');withEdits=answer==='save';}
        autoSay('Saving to the robot. The robot restarts to use it…');const r=await configEditor.autoWrite(withEdits);if(!r.ok)return done(r.error);({cameras,hubs,imus}=r);
        autoSay('The robot is restarting to use it. Waiting for it to come back…');if(!await autoBack())return done('It is saved, but the robot has not come back yet. Torque reconnects by itself. When it says connected, go to Calibrate.');}
      // The student left for Drive or Simulate while it ran: it does not pull them back.
      if(gen!==setupGen||!hubUsbTabs())return done('');
      const words=autoWords({wrote:plan.writes||none,cameras,hubs,imus,ready:plan.ready,left}),serial=plan.webcams[0]?.add||plan.readyKey;autoBusy=false;autoTold='';await autoGo(serial,words);return true;}
    catch(e){return done(e.message);}finally{autoBusy=false;}}
  // To Calibrate → Camera, on the camera it was about, with what happened said above the tabs.
  async function autoGo(serial,words){liveDebug?.warm(90000);await api.page('calibrate');for(let i=0;i<40&&calRoot.hidden;i++)await new Promise(r=>setTimeout(r,25));calSelect('camera');if(serial)liveCamera?.select(serial);else liveCamera?.refresh();calTold(words);}
  window.DeckAutoConfigure=()=>autoConfigure();
  function setupTestHtml(){const HS=window.DeckHubSetup,D=window.DeckHardware,w=D.wiringOf(project.robot),kinds=HS.needsTest(w),word=k=>D.HUBS[k].name;if(!kinds.length)return '';
    const many=kinds.map(k=>`${D.hubsOfKind(w.hubs,k).length} ${word(k)}s`).join(' and ');
    if(!hubTest)return `<p class="hint">You have ${many}, and they look the same from here. Want to move one thing on each to see which is which?</p><div class="button-row"><button type="button" class="primary" data-hub-test="begin">Test them</button></div>`;
    if(hubTest.stage==='confirm')return `<p>Motors and servos will move. Put the robot on blocks with its wheels off the floor and keep clear.</p><p class="hint">This puts a small test program, Torque Debug, on the robot as team code. It does not touch the hub’s firmware, and you can delete it in OnBot Java.</p><div class="button-row"><button type="button" class="primary" data-hub-test="go">It’s on blocks: start</button><button type="button" class="secondary" data-hub-test="cancel">Cancel</button></div>`;
    if(hubTest.stage==='starting')return `<p class="hint" role="status">${W_esc(hubTest.text||'Starting the test on the robot…')}</p><div class="button-row"><button type="button" class="secondary" data-hub-test="cancel">Cancel</button></div>`;
    const s=hubTest.steps[hubTest.at];if(!s)return `<p>All done. Your hubs’ names are saved in this setup.</p><div class="button-row"><button type="button" class="primary" data-hub-test="cancel">Finish</button></div>`;
    const of=`Step ${hubTest.at+1} of ${hubTest.steps.length}: the ${word(s.kind)} at address ${s.address}`,mates=D.hubsOfKind(w.hubs,s.kind).length,pick=`<label for="rs-test-label">Which one moved?</label><select id="rs-test-label" data-wire-hub-label="${s.hub}"><option value="0">Not decided</option>${Array.from({length:mates},(_,i)=>`<option value="${i+1}"${w.hubs[s.hub].label===i+1?' selected':''}>${word(s.kind)} ${i+1}</option>`).join('')}</select>`;
    if(!s.device)return `<p>${of}</p><p class="hint">Nothing is configured on this hub, so there is nothing to move. Add a device in Configure Robot, or name this hub yourself.</p>${pick}<div class="button-row"><button type="button" class="primary" data-hub-test="next">Next</button><button type="button" class="secondary" data-hub-test="cancel">Stop</button></div>`;
    return `<p>${of}</p><p class="hint">Moves ${s.device.kind==='motor'?'motor':'servo'} port ${s.device.port}, “${W_esc(s.device.name)}”, for one second.</p><div class="button-row"><button type="button" class="primary" data-hub-test="run"${hubTest.running?' disabled':''}>${hubTest.ran?'Move it again':'Move it'}</button></div>${hubTest.note?`<p class="hint" role="status">${W_esc(hubTest.note)}</p>`:''}${pick}<div class="button-row"><button type="button" class="secondary" data-hub-test="next">Next</button><button type="button" class="secondary" data-hub-test="cancel">Stop</button></div>`;}
  const W_esc=v=>window.DeckWiring.esc(v);
  let flowStep='setup';
  // The steps are a pipeline: Setup finds the robot, Configure gives it a configuration, Debug puts Torque Debug on it, then Calibrate.
  // A step whose step before is not done shows one line saying what to do, and nothing else. A robot without a Control Hub has no such steps.
  function pipeline(){const ftc=project.controller==='ftc',robot=!ftc||!!setupRobot,config=!ftc||robot&&!!setupRead?.active?.name,debug=!ftc||config&&liveDebug?.ready?.()===true,sim=simTodo();return {robot,config,debug,sim};}
  function simTodo(){const todo=[];try{if(window.DeckWiring.state(project).problems.some(x=>x.level==='red'))todo.push('fix what Setup marks in red');}catch{}
    if(!L().pins.length)todo.push('plan a path in Path planning');else if(diagnostics.length||planError)todo.push('fix the route in Path planning');return todo;}
  let gateAsked=0;
  // Calibrate works through Torque Debug, so it starts it by itself: once a visit, over the cable (where the crash guard can
  // bring the Robot Controller app back), it puts this version on the robot if its copy is missing or older, and starts it.
  // It is a helper: it stops when Setup & Calibrate is left (for Drive), and a STOP in Debug is kept.
  let calAutoTried=false,calAutoText='';
  async function calAutoDebug(p){const here=calibrating&&calTop==='calibrate';if(!here){calAutoTried=false;return;}
    const s=liveDebug?.state?.(),usb=($('#sim-send-robot')?.value||'usb')==='usb';if(!liveDebug||!p.config||!usb||calAutoTried||liveDebug.running()||s?.starting||s?.installing)return;
    calAutoTried=true;calAutoText='';const r=await liveDebug.run({host:'usb',noStart:true,mayBuild:true,still:()=>calibrating&&calTop==='calibrate'}).catch(e=>({error:e.message}));
    liveCamera?.ran?.(r,{usb:true});calAutoText=r?.problem||r?.error?`Torque Debug did not start: ${r.problem||r.error}`:'';linksCal?.refresh();}
  function calGate(){const p=pipeline();for(const b of $$('.flow-steps [data-flow]')){const f=b.dataset.flow,locked=f==='configure'?!p.robot:f==='debug'?!p.config:f==='calibrate'?!p.config:false;b.toggleAttribute('data-locked',locked);b.title=locked?'Finish the step before this one first':'';}
    if(!calRoot)return;
    // Whether the robot has Torque Debug is only known once asked: Calibrate asks for itself, at most every 5 s.
    if(calibrating&&calTop==='calibrate'&&p.config&&!liveDebug?.known?.()&&Date.now()-gateAsked>5000){gateAsked=Date.now();void liveDebug?.recheck?.();}
    const text=!p.robot?'Connect to the robot first: plug the Control Hub in by USB-C, or join its Wi-Fi, with the robot on. Setup shows it once it answers.':!p.config?'The robot needs an active configuration first. In Setup, press Edit or Activate on one of its configurations, or make a new one.':'';
    const page=calRoot.querySelector('.cal-page'),g=$('#cal-gate');if(!page||!g)return;page.toggleAttribute('data-gated',!!text);g.hidden=!text;if(g.firstChild.textContent!==text)g.firstChild.textContent=text;$('#cal-gate-sim').hidden=true;calAutoDebug(p);if(!text&&calibrating&&calTop==='calibrate'&&calTab==='mechanisms')sensorCal?.refresh();linksCal?.refresh();calMechSim();}
  function flowMarks(){if(gateLive)calGate();for(const b of $$('.flow-steps [data-flow]')){const here=b.closest('#calibrate-view')?(calTop==='debug'?'debug':'calibrate'):flowStep;b.toggleAttribute('data-here',b.dataset.flow===here);}
    if(setupRoot){$('#rs-step-setup').hidden=flowStep!=='setup';$('#rs-step-configure').hidden=flowStep!=='configure';$('#rs-step-axon').hidden=flowStep!=='axon';}}
  // The Axon Programmer tab: its programmer is only touched while the tab shows, and the Control Hub's USB watch rests meanwhile.
  const axonShown=()=>window.DeckAxon?.shown(setupShown&&flowStep==='axon');
  window.DeckAxon?.install($('#rs-step-axon'),native?api:null);
  function setupRender(){if(!setupRoot||setupRoot.hidden)return;hubDefaults();flowMarks();const W=window.DeckWiring,HS=window.DeckHubSetup,st=W.state(project),ftc=project.controller==='ftc',busy=setupLooksBusy(),stuck=setupConn?.host==='usb'&&hubScanStuck();
    $('#rs-scan-stuck').hidden=!stuck;$('#rs-scan-stuck').textContent=stuck||'';$('#rs-read').disabled=!ftc||busy;$('#rs-scan').disabled=!ftc||busy||!setupRobot;$('#rs-scan').title=setupRobot?'':'Connect to the robot first';$('#rs-robot-card').hidden=!ftc;$('#rs-configs-card').hidden=!ftc;setupConfigs();
    setupEditor();setupFollowActive();configEditor.render();
    if(!ftc){calHtml($('#rs-hubs'),'<p class="hint">This setup is for a robot without a Control Hub, so there are no hubs or ports to set here.</p>');calHtml($('#rs-problems'),'');$('#rs-test').hidden=true;return;}
    const usb=hubUsb(),plan=setupRobot?configEditor.plan():null,cable=setupRobot?.portals||[];calHtml($('#rs-hubs'),W.scanHtml(st,usb?project.calibration?.hub?.scan||null:null,{busy,rows:usb?.devices||null,seen:setupRobot?.scanned?id=>HS.hubSeen(id==='control'?173:st.wiring.hubs[id].address,setupRobot):()=>null,
      conn:setupConn&&setupRobot?{how:setupConn.host==='usb'?'USB-C':'Wi-Fi',serial:setupRead?.serial}:null,checking:!!setupRobot?.checking,onUsb:id=>cable.some(p=>p.serial!=='(embedded)'&&[...p.modules,...(p.servoHubs||[])].some(m=>m.address===st.wiring.hubs[id]?.address)),configured:(project.calibration?.hub?.config?.devices||[]).filter(d=>!d.module),auto:plan?.writes?{text:window.DeckConfigEditor.offerText(plan),off:autoBusy||busy}:null,told:autoTold}));
    calHtml($('#rs-problems'),st.problems.filter(x=>!x.keys.length).map(x=>`<p class="sim-wire-problem ${x.level}">${W_esc(x.text)}</p>`).join(''));
    const test=setupRobot?setupTestHtml():'';$('#rs-test').hidden=!test;calHtml($('#rs-test-body'),test);}
  async function hubTestAct(act){const HS=window.DeckHubSetup,set=next=>{hubTest=next;setupRender();};
    if(act==='begin')return set({stage:'confirm'});
    if(act==='cancel'){if(hubTest?.stage!=='confirm')await liveDebug?.stop().catch(()=>{});return set(null);}
    if(act==='go'){if(!liveDebug)return;set({stage:'starting',text:'Putting the test on the robot and building it…'});await detectLink();
      if(!await liveDebug.install()){if(hubTest)status('#rs-status','The robot could not build the test program. Check OnBot Java for errors in its code.');return set(null);}
      if(!hubTest)return;set({stage:'starting',text:'Starting the test on the robot…'});await liveDebug.start();
      try{await new Promise((ok,fail)=>{const end=Date.now()+15000,t=setInterval(()=>{if(liveDebug.latest().frame&&liveDebug.running()){clearInterval(t);ok();}else if(!hubTest||Date.now()>end){clearInterval(t);fail(Error('The robot did not start the test.'));}},200);});}catch(e){if(hubTest)status('#rs-status',e.message);await liveDebug.stop().catch(()=>{});return set(null);}
      return set({stage:'steps',steps:HS.testSteps(project.calibration.hub?.readout||[],project.robot.wiring),at:0});}
    if(act==='next')return set({...hubTest,at:hubTest.at+1,ran:false,note:''});
    if(act==='run'){const d=hubTest.steps[hubTest.at]?.device;if(!d||hubTest.running)return;set({...hubTest,running:true,note:'Moving…'});
      const r=await liveDebug.pulse(d.command,d.name,d.command==='S'?.6:.25,1);if(d.command==='S')void liveDebug.send(`S\t${d.name}\t0.5`);
      if(hubTest)set({...hubTest,running:false,ran:true,note:r.error||(r.changes.length?`The robot read a change: ${r.changes[0].text}.`:'Watch the robot: did it move? If not, check the wire, then move it again.')});}}
  if(setupRoot){const after=fn=>(...a)=>{fn(...a);setupRender();};
    for(const b of setupRoot.querySelectorAll('[data-controller]'))b.addEventListener('click',()=>setupRender());
    window.DeckWiring.bind($('#rs-step-configure'),{project:()=>project,apply:after(applyWiring)});
    window.DeckWiring.bind($('#rs-test'),{project:()=>project,apply:after(applyWiring)});
    $('#rs-test').addEventListener('click',e=>{const b=e.target.closest('[data-hub-test]');if(b)void hubTestAct(b.dataset.hubTest);});
    $('#rs-read').onclick=async()=>{setupTried=null;setupPress++;setupRender();while(setupBusy)await setupIdle();setupPress--;setupRender();await setupWatch();if(setupConn&&setupRobot)await setupRead_({check:true,press:true});};
    $('#rs-scan').onclick=()=>void setupScan();api.onRobotScan?.(p=>setupScanned(p,true));
    $('#rs-hubs').addEventListener('click',e=>{const b=e.target.closest('[data-hub-remove]');if(b)return void setupRemoveHub(b.dataset.hubRemove);if(e.target.closest('[data-auto-configure]'))return void autoConfigure();const i=e.target.closest('[data-usb-i2c]');if(i)return void configureI2c(i.dataset.usbI2c);if(e.target.closest('[data-usb-axon]'))axonTab();});
    $('#rs-configs').addEventListener('click',e=>{const b=e.target.closest('[data-cfg]');if(!b)return;const name=b.dataset.name,act=b.dataset.cfg;
      if(act==='edit')return void setupSwitch(name,{go:true});
      if(act==='activate')return void setupSwitch(name);
      if(act==='delete'&&confirm(`Delete the configuration “${name}” from the robot?${configEditor?.current()===name&&configEditor.dirty()?' Your unsaved changes to it in Configure go with it.':''}`))void setupAct(`Deleting “${name}”…`,async()=>{await api.robotLink('delete-config',{host:setupConn.host,name});if(configEditor.current()===name)configEditor.close();});});
    $('#rs-new').onclick=()=>{$('#rs-new-form').hidden=false;$('#rs-new').hidden=true;$('#rs-new-name').value=RobotConfig.configurationName('robot',setupRead?.configurations||[]);$('#rs-new-name').select();};
    const closeNew=()=>{$('#rs-new-form').hidden=true;$('#rs-new').hidden=false;};$('#rs-new-cancel').onclick=closeNew;
    $('#rs-new-form').onsubmit=e=>{e.preventDefault();const name=$('#rs-new-name').value.trim();if(!RobotConfig.validName(name))return setupNote('Use letters, digits, spaces, - and _ (up to 40), starting with a letter or digit.');if((setupRead?.configurations||[]).some(n=>n.toLowerCase()===name.toLowerCase()))return setupNote(`The robot already has a configuration named “${name}”.`);closeNew();
      void setupAct(`Scanning the robot and making “${name}”. The robot restarts…`,async()=>{const {portals}=await api.robotLink('scan',{host:setupConn.host});if(!portals.length)throw Error('The scan found no hubs. Check the hubs are powered and connected, then try again.');
        await api.robotLink('configure',{host:setupConn.host,name,xml:configFromScan(portals)});});};
    api.onRobotConfig?.(({name,xml})=>{if(project.controller!=='ftc')return;try{const config=RobotConfig.parse(xml);if(setupRobot)setupRobot.configured=config.hubs.map(h=>h.address);useHubConfig(window.DeckHubSetup.withScan(config,setupRobot?.portals),{name,source:'driver station'},'#rs-matched',document.createElement('ul'));}catch(e){status('#rs-status',e.message);}});}
  // Where the odometry sits and which way it counts (project.robot.odometry; only what differs from Deck's defaults is
  // stored). The exports configure the Pinpoint, OTOS or pods with it, and the guided check measures it on the robot.
  // A key starting with - is shown negated (the right pod's inches right of centre).
  const ODO_ROWS={
    fused:[[['pinpoint.pods','Pod type']],[['pinpoint.xOffset','X (forward) pod · in left of centre'],['pinpoint.xReversed','Counts backwards']],[['pinpoint.yOffset','Y (strafe) pod · in forward of centre'],['pinpoint.yReversed','Counts backwards']]],
    optical:[[['otos.x','OTOS chip · in forward of centre'],['otos.y','OTOS chip · in left of centre']],[['otos.heading','Its X arrow points · ° counterclockwise from the front']],[['otos.linearScalar','Distance scalar'],['otos.angularScalar','Turn scalar']]],
    odometry:[[['pods.par.y','Forward pod · in left of centre'],['pods.par.reversed','Counts backwards']],[['pods.perp.x','Sideways pod · in forward of centre'],['pods.perp.reversed','Counts backwards']]],
    odometry3:[[['pods.par_left.y','Left forward pod · in left of centre'],['pods.par_left.reversed','Counts backwards']],[['-pods.par_right.y','Right forward pod · in right of centre'],['pods.par_right.reversed','Counts backwards']],[['pods.perp.x','Sideways pod · in forward of centre'],['pods.perp.reversed','Counts backwards']]]};
  const ODO_FIND=' The guided check in Calibrate measures all of this on your robot.',PODS_NOTE='Inches from the robot’s centre; negative is the other way (right of it, or behind it). A pod counts backwards when pushing the robot forward (left, for the sideways pod) makes its count go down.'+ODO_FIND;
  const ODO_NOTES={fused:'Inches from the robot’s centre, as goBILDA’s setOffsets takes them: the X pod rolls forward, the Y pod sideways. Negative is the other way (right of centre, or behind it). A pod counts backwards when pushing the robot forward (X) or left (Y) makes its count go down.'+ODO_FIND,
    optical:'Where the OTOS chip sits, in inches from the robot’s centre (negative: behind it or right of it), and which way its X arrow points: -90° when its Y arrow points forward, 0° when its X arrow does. The scalars (0.872 to 1.127) correct how far it reads the robot move and turn.'+ODO_FIND,odometry:PODS_NOTE,odometry3:PODS_NOTE};
  const odoPath=key=>key.replace(/^-/,'').split('.'),odoGet=(odo,key)=>{const v=odoPath(key).reduce((o,k)=>o?.[k],odo);return key[0]==='-'?-v:v;};
  function odoField([key,label]){const id='sim-odo-'+odoPath(key).join('-'),last=odoPath(key).pop();
    if(/reversed$/i.test(last))return `<label class="check" for="${id}"><input id="${id}" data-odo="${key}" type="checkbox"> ${label}</label>`;
    if(last==='pods')return `<div><label for="${id}">${label}</label><select id="${id}" data-odo="${key}">${options(Object.fromEntries(Object.entries(C.POD_TYPES).map(([k,p])=>[k,p.name])))}</select></div>`;
    const [min,max,step,sliderMin,sliderMax]=/Scalar$/.test(last)?[...C.OTOS_SCALARS,0.001,...C.OTOS_SCALARS]:last==='heading'?[-180,180,1,-180,180]:[-36,36,0.25,-12,12];
    return `<div><label for="${id}">${label}</label><input id="${id}" data-odo="${key}" type="number" min="${min}" max="${max}" step="any" inputmode="decimal" data-slider="off" data-slider-min="${sliderMin}" data-slider-max="${sliderMax}" data-slider-step="${step}"></div>`;}
  function odometryPanel(){
    const loc=project.sensors.localization,rows=project.controller==='motionmodule'?null:ODO_ROWS[loc],list=$('#sim-odometry-list');$('#sim-odometry').hidden=!rows;if(!rows)return;
    if(list.dataset.for!==loc){list.dataset.for=loc;list.innerHTML=rows.map(row=>`<div class="start-xy">${row.map(odoField).join('')}</div>`).join('');$('#sim-odometry-note').textContent=ODO_NOTES[loc];}
    const odo=C.odometryOf(project.robot);for(const el of list.querySelectorAll('[data-odo]')){if(el.type==='number'&&el===document.activeElement)continue;const v=odoGet(odo,el.dataset.odo);if(el.type==='checkbox')el.checked=!!v;else{el.value=String(v);el.setCustomValidity?.('');}
      // The kit's pods sit where goBILDA puts them, so where they are is shown and not asked; which way each counts is the team's wiring.
      const fixedHere=!!window.DeckMechanisms.PRESETS[project.robotPreset]?.robot?.odometry&&!/reversed$/i.test(el.dataset.odo);el.disabled=fixedHere;el.closest('div,label')?.toggleAttribute('data-kit-fixed',fixedHere);}
  }
  $('#sim-odometry-list').addEventListener('change',e=>{const el=e.target,key=el.dataset.odo;if(!key)return;let v=el.type==='checkbox'?el.checked:el.value;
    if(el.type==='number'){v=el.valueAsNumber;el.setCustomValidity('');if(!finite(v)||v<+el.min||v>+el.max){el.setCustomValidity(`Enter a number from ${el.min} to ${el.max}.`);el.reportValidity();return;}if(key[0]==='-')v=-v;}
    const odo=C.odometryOf(project.robot),path=odoPath(key),last=path.pop();path.reduce((o,k)=>o[k],odo)[last]=v;
    project.robot=C.robot({...project.robot,odometry:odo},project.controller);save();reload();odometryPanel();});
  function setLocalization(v){const sel=$('#sim-localization');if(![...sel.options].some(o=>o.value===v))return;sel.value=v;sel.dispatchEvent(new Event('change'));}
  // Timed driving: the engine works the numbers out from the robot settings unless the team measured them.
  function timedPanel(committed=false){
    const measured=project.timing.source==='measured',t=measured?project.timing:info?.timing,fmt=(v,unit)=>finite(v)?`${+v.toFixed(unit==='s'?2:1)} ${unit}`:'…';
    $('#sim-timed-measured').checked=measured;$('#sim-timed-manual').hidden=!measured;
    $('#sim-timed-summary').replaceChildren(...[['Forward at full power',fmt(t?.forwardSpeed,'in/s')],['Sideways at full power',fmt(t?.strafeSpeed,'in/s')],['Speed-up',fmt(t?.startup,'s')],['Coasting',fmt(t?.stopping,'s')]].flatMap(([k,v])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;return [dt,dd];}));
    for(const [id,key]of TIMED_FIELDS)inputValue(id,project.timing[key],committed);
  }
  // Switching to measured numbers starts from the worked-out ones.
  $('#sim-timed-measured').onchange=e=>{if(e.target.checked){Object.assign(project.timing,info?.timing?{forwardSpeed:info.timing.forwardSpeed,strafeSpeed:info.timing.strafeSpeed,startup:info.timing.startup,stopping:info.timing.stopping,strafeStopping:info.timing.strafeStopping}:{});project.timing.source='measured';}else project.timing.source='robot';save();robotPanel();reload();};
  $('#sim-appearance').onchange=e=>{project.robot.appearance=e.target.value;project.needsCad=false;if(e.target.value!=='custom')project.model=null;if(e.target.value==='swechanum')project.robot.drivetrain='swerve';if(e.target.value==='strafer')project.robot.drivetrain='mecanum';settle();robotPanel();void placeModel();};
  const M=()=>window.DeckRobotModel,modelCache=new Map(),LIGHT_TRIANGLES=400000;
  async function three(){await script('vendor/three-view.js');await script('sim-robot-model.js');}
  // The Test setup's robot (ui/sim-test-robot.js): generated from FTC parts and stored like a CAD import, with its joints.
  // A custom robot whose joints name its parts but has no model (a first run, examples/test-setup.json, a cleared models
  // folder) gets it attached (a preset or plain robot chosen instead keeps its own look); it is the same file every
  // time, so its id does not change.
  const testRobotParts=()=>{const T=window.DeckTestRobot;return !!T&&project.kinematics.joints.some(j=>(j.parts||[]).some(p=>String(p).startsWith(T.NAME+'/')));};
  // A generated robot (the Test robot, a preset robot: an import result made from its parts) stored like a CAD import,
  // with its joints on it; joints the project already has are kept. still: whether the project still wants it once made.
  async function storeGenerated(result,info,joints,still=()=>true){
    await three();const body=await M().bodyFromImport(result),glb=await M().toGlb(body.geometry),stored=await api.simFile('model-save',{name:result.name+'.glb',bytes:glb});
    modelCache.set(stored.id,{id:stored.id,geometry:body.geometry});if(!still())return null;
    project.model=M().meta({...info,id:stored.id,parts:window.DeckTestRobot.metaParts(body.groups||result.groups,MECH),drivetrain:MECH.drivetrainFromNames(result.names||[])});project.robot.appearance='custom';
    project.kinematics=window.DeckKinematics.sanitize({...(project.kinematics.joints.length?project.kinematics:joints()),model:stored.id});
    save();robotPanel();mechanismsPanel();return stored.id;
  }
  async function testRobot(){const T=window.DeckTestRobot;return storeGenerated(await api.simFile('test-robot'),T.MODEL,()=>T.kinematics());}
  // A preset robot's CAD: kept only while the setup still has that preset (chosen, or customized from it).
  async function presetRobot(id){const P=PR();return storeGenerated(await api.simFile('preset-robot',{id}),P.model(id),()=>P.kinematics(id),()=>project.robotPreset===id&&!project.model||P.ofModel(project.model)===id);}
  const presetLoading=new Map();
  let testRobotLoading=null;
  // The stored one-body model, placed in the robot frame for 2D and 3D.
  // A preset whose vendor CAD is in this build (the goBILDA Strafer, NYC FIRST's A301 Swechanum) shows it, with its
  // curated wheel and module animation, in place of its generated model.
  const presetCad=()=>{const cad=PR()?.ROBOTS[project.robotPreset]?.cad;return cad&&builtins.has(cad)?cad:null;};
  // Each preset robot is a saved setup of its own ("Starter Mecanum"), built in: it cannot be deleted or renamed, and
  // opens on its demo route, optimized, ready to run. Clone one to change it freely.
  function ensurePresetSetups(){const P=PR();if(!P)return;let added=false;
    for(const id of Object.keys(MECH.PRESETS)){const name=`${MECH.PRESETS[id].name} demo`,have=project.setups.find(s=>s.id==='preset:'+id);
      if(have&&have.name!==name){have.name=name;if(have.data)have.data.setupName=name;if(project.setupId===have.id)project.setupName=name;added=true;}
      // A demo whose route changed in a new version gets the new route (its field cannot be edited, so nothing is lost);
      // Optimize reshapes paths and aiming sets turns, but each stop stays, so stops are compared.
      const stops=pins=>JSON.stringify((pins||[]).map(q=>[q.x,q.y,q.action||'',q.wait||0])),fresh=have&&P.has(id)?cleanLayout({...P.layout(id),id:presetLayoutId(id)}):null;
      if(fresh){const d=project.setupId===have.id?project:have.data,l=d?.layouts?.[0];if(l&&stops(l.pins)!==stops(fresh.pins)){d.layouts=[fresh];d.active=fresh.id;d.tuning={...d.tuning,maxPathSpeed:1,powerSet:true};const m=P.apply(id,d,C).mechanisms;d.mechanisms=m;if(d===project){info=null;void switchLayout(fresh.id);}added=true;}}
      if(!P.has(id)||have||project.setups.length>=20)continue;
      const d=defaults(),demo=cleanLayout({...P.layout(id),id:presetLayoutId(id)});Object.assign(d,P.apply(id,d,C));d.tuning={...d.tuning,maxPathSpeed:1,powerSet:true};d.model=null;d.layouts=[demo];d.active=demo.id;d.setupDone=true;d.setupName=`${MECH.PRESETS[id].name} demo`;
      const {setups,...data}=JSON.parse(JSON.stringify(d));project.setups.push({id:'preset:'+id,name:`${MECH.PRESETS[id].name} demo`,data});added=true;}
    if(added){save();setupPanel();presetPanel();}}
  async function placeModel(){
    const cad=presetCad();if(cad&&(project.model||project.robot.appearance!==cad)){project.model=null;project.robot.appearance=cad;project.kinematics=window.DeckKinematics.sanitize({});save();robotPanel();mechanismsPanel();}
    if(native&&typeof api.simFile==='function'&&(!project.model&&project.robot.appearance==='custom'&&testRobotParts()||project.model?.name===window.DeckTestRobot?.NAME&&placeModel.missing===project.model.id)){
      testRobotLoading??=testRobot().catch(e=>status('#start-status',`Could not build the Test robot: ${e.message}`)).finally(()=>{testRobotLoading=null;placeModel.retried=placeModel.missing;placeModel.missing=null;});await testRobotLoading;}
    // A preset robot's CAD is made when it has none yet (just chosen, or a setup saved before presets had CAD; that one gets
    // the rest of its preset too) and again when its stored file is gone (a cleared models folder, another computer).
    const preset=project.robotPreset&&!project.model?(cad?null:project.robotPreset):PR()?.ofModel(project.model);
    if(native&&typeof api.simFile==='function'&&PR()?.has(preset)&&(!project.model||placeModel.missing===project.model.id)){
      if(!project.model&&!project.kinematics.joints.some(j=>(j.parts||[]).some(p=>String(p).startsWith(PR().ROBOTS[preset].name+'/'))))Object.assign(project,PR().apply(preset,project,C));
      if(!presetLoading.has(preset))presetLoading.set(preset,presetRobot(preset).catch(e=>status('#start-status',`Could not build the ${MECH.PRESETS[preset].name}: ${e.message}`)).finally(()=>{presetLoading.delete(preset);placeModel.retried=placeModel.missing;placeModel.missing=null;}));
      await presetLoading.get(preset);}
    const seq=placeModel.seq=(placeModel.seq||0)+1;
    const imported=project.model,builtin=!imported&&builtins.has(project.robot.appearance)?project.robot.appearance:null,identity=imported?.id||builtin,meta=imported||(builtin?{units:'in',...(project.orientations?.[builtin]||{front:builtin==='strafer'?'-x':'+x',top:'+z'})}:null);
    if(!identity||!native){model=null;modelUi();draw();view3d?.setModel(null);return;}
    try{await three();if(model?.id!==identity){model=modelCache.get(identity)||null;if(!model){const data=await api.simFile(builtin?'builtin-model':'model-read',identity);if(!data){if((imported?.name===window.DeckTestRobot?.NAME||PR()?.ofModel(imported))&&placeModel.retried!==identity){placeModel.missing=identity;return placeModel();}throw Error('The saved robot model is missing. Import it again.');}const object=builtin?await M().builtin(data.bytes,data.meta):await M().fromGlb(data.bytes);if(seq!==placeModel.seq)return;model={id:identity,geometry:object,builtin,meta:data.meta};modelCache.set(identity,model);}}
      if(seq!==placeModel.seq)return;const chassis=chassisFootprint(),key=JSON.stringify([meta,chassis]),look=JSON.stringify([meta?.front,meta?.top]);
      // The top-down picture is drawn again only when the model turns; a new size stretches the one there is.
      if(key!==model.placeKey){model.holder=M().place(model.geometry,meta||{front:'+x',top:'+z',units:'in'},chassis);model.picture=M().silhouette(model.holder,model.look===look?model.picture:null);model.look=look;model.placeKey=key;}
    }catch(e){model=null;status('#start-status',e.message);}
    modelUi();draw();view3d?.setModel(fieldRig());
    // A setup whose CAD has not been traced yet (saved before this could, or a mechanism was removed): what powers what is
    // worked out once, by itself. Built-in test and preset robots come with theirs set.
    if(imported&&model?.id===imported.id&&model.holder&&project.controller==='ftc'&&project.mechanisms.enabled&&!project.mechanisms.traced&&imported.name!==window.DeckTestRobot?.NAME&&!PR()?.ofModel(imported)&&placeModel.tracedId!==`${imported.id}:${project.mechanisms.intakes.length+project.mechanisms.shooters.length}`){
      placeModel.tracedId=`${imported.id}:${project.mechanisms.intakes.length+project.mechanisms.shooters.length}`;
      try{if(project.kinematics.joints.length){actuatorsFromCad();save();reload();mechanismsPanel();robotPanel();}else void configureFromCad();}catch(e){status('#mech-list-status',`Could not read what powers each mechanism: ${e.message}`);}}
  }
  // The field views (3D, run videos) draw a lighter copy of a heavy CAD body (DeckRobotModel.lighten), made once per
  // model in the background; until it is ready they show the plain robot. The Setup previews keep every triangle,
  // so parts can still be picked there.
  function fieldBody(){
    const m=model;if(!m?.holder)return null;
    if(m.lite===undefined){m.lite=null;const g=m.geometry,tris=g?.isObject3D?0:(g?.index?.count??g?.attributes?.position?.count??0)/3;
      if(tris>LIGHT_TRIANGLES){m.lighten=M().lighten(g,{target:LIGHT_TRIANGLES}).catch(()=>g).then(lite=>{m.lite=lite;if(model===m)view3d?.setModel(fieldRig());});}else m.lite=g;}
    if(!m.lite)return null;if(m.lite===m.geometry)return m.holder;
    if(m.liteOf!==m.holder){m.liteOf=m.holder;m.liteHolder=m.holder.clone();m.liteHolder.traverse(o=>{if(o.isMesh&&o.geometry===m.geometry)o.geometry=m.lite;});}
    return m.liteHolder;
  }
  // The body with its joints: split into moving links (DeckRobotModel.rig) for the 3D field, run videos (from the
  // lighter copy) and the Mechanisms preview (every triangle, for picking). Made again only when the body, its joints or
  // the mechanisms change.
  function rigOf(base,slot){
    // The split depends only on which parts each joint moves and what stand-ins the mechanisms need; other joint settings retune it.
    const k=project.kinematics,game=L().field==='biobuzz'&&project.mechanisms,shape=k.joints.map(j=>[j.id,j.parent,j.parts,j.drive&&j.drive.signal+':'+(j.drive.of||'')]);
    if(!base||!model)return base;const key=JSON.stringify([base.uuid,project.model?.id,k.model,shape,game&&{on:game.enabled,i:game.intakes.map(i=>[i.kind,i.sides,i.parts]),s:game.shooters.map(x=>[x.type,x.mount,x.parts,x.sharesTurret])},chassisFootprint(),project.robot.heightIn]);if(model[slot+'Key']===key)return M().retune(model[slot],k);
    model[slot]=M().rig(base.clone(),{meta:project.model,mechanisms:L().field==='biobuzz'?project.mechanisms:null,kinematics:project.kinematics,footprint:chassisFootprint(),height:base.userData?.size?.height??project.robot.heightIn});model[slot+'Key']=key;
    M().hitboxes(model[slot],project.hitboxes);return model[slot];
  }
  // Hitboxes (the 3D view's button and the Moving parts panel's): the field's markers and each moving part's box.
  function showHitboxes(on){project.hitboxes=!!on;save();$('#sim-hitboxes').setAttribute('aria-pressed',String(project.hitboxes));for(const slot of ['fieldRig','mechRig'])M()?.hitboxes(model?.[slot],project.hitboxes);
    view3d?.update(frame,state3d());mechPreview?.resize();}
  const fieldRig=()=>rigOf(fieldBody(),'fieldRig'),mechRig=()=>rigOf(model?.holder,'mechRig');
  function modelUi(){
    const meta=project.model,builtin=model?.builtin;$('#sim-model-box').hidden=!meta&&!builtin;$('#sim-model-remove').hidden=!meta||!!builtin;$('#sim-model-drop').classList.toggle('compact',!!meta||!!builtin);
    $('#sim-model-credit').textContent=builtin?model.meta?.credit||'':meta?'Its moving parts (turrets, hoods, rollers, ramps) are found and checked under Mechanisms.':'Choose a bundled chassis or import your own.';
    // The Mechanisms page shows the same model with its parts marked.
    queueMicrotask(()=>mechModel());
    if(!meta&&!builtin){modelPreview?.dispose();modelPreview=null;partsPanel();return;}
    $('#sim-model-help').hidden=false;
    $('#sim-units-box').hidden=!!builtin||meta?.source==='step';$('#sim-model-units').value=meta?.units||'in';
    const s=model?.holder?.userData.size,name=meta?.name||model?.meta?.name||'Chassis';$('#sim-mesh-size').textContent=s?`${name}: fitted to ${s.length.toFixed(1)} × ${s.width.toFixed(1)} in, ${s.height.toFixed(1)} in tall.`:name;
    if(model?.holder){if(!modelPreview){modelPreview=M().preview($('#sim-model-preview'),{onSide:side=>{selectedSide=side;for(const b of $$('[data-assign-side]'))b.disabled=!side;status('#sim-model-help','');}});modelPreview.pick(pickPart);}modelPreview.update(model.holder,chassisFootprint());}
    partsPanel();needsYou();
  }
  // ---- the CAD's parts: click one, say what it is (like a slicer's object list) ----------------------------
  // The team's choice is stored as a part with its box; the robot (size, intakes, shooters) is set up from them.
  const NEEDS={mass:['#sim-mass','mass'],wheel:['#sim-wheel','wheel diameter'],rpm:['#sim-rpm','wheel RPM']};
  function entered(key){if(project.model?.entered&&!project.model.entered.includes(key)){project.model.entered.push(key);save();}needsYou();}
  // Touching an amber box and leaving it (Done, Enter, another box) confirms the value as it is: 312 RPM is often right.
  for(const [k,[id]] of Object.entries({mass:['#sim-mass'],wheel:['#sim-wheel'],rpm:['#sim-rpm']})){const box=$(id).closest('div');box.addEventListener('focusout',()=>{if(unconfirmed().includes(k))entered(k);});box.addEventListener('keydown',e=>{if(e.key==='Enter'&&unconfirmed().includes(k))entered(k);});}
  // A CAD file has no mass, wheel RPM or wheel size, so those keep the example robot's numbers until the team types its
  // own. Many robots really are 312 RPM on 104 mm wheels, so the boxes only glow amber as a reminder; they never block.
  const unconfirmed=()=>project.model?.entered?Object.keys(NEEDS).filter(k=>!project.model.entered.includes(k)):[];
  function needsYou(){const left=unconfirmed();
    for(const [k,[id,what]] of Object.entries(NEEDS)){const box=$(id).closest('div');box?.classList.toggle('sim-check-input',left.includes(k));if(left.includes(k))$(id).title=`Your CAD has no ${what}. Check this is your robot’s.`;else $(id).removeAttribute('title');}
    queueMicrotask(stageMarks);}
  const ROLES=[['chassis','Drivetrain / chassis'],['intake','Intake'],['kicker','Kicker'],['shooter:pollen','Pollen shooter'],['shooter:nectar','Nectar shooter'],['shooter:both','Pollen + nectar shooter'],['turret','Turret'],['indexer','Indexer'],['other','Not a mechanism']];
  let partSel=null,importProgress=null;
  const partsOf=()=>{if(!model?.geometry||model.geometry.isObject3D||!M())return null;if(model.tree===undefined)model.tree=M().partTree(model.geometry);return model.tree;};
  const choiceOf=p=>!p?null:p.role==='intake'&&p.kind==='kicker'?'kicker':p.role==='shooter'?(p.type==='turret'&&!p.pieces?'turret':'shooter:'+(p.pieces||'pollen')):p.role;
  const bare=name=>String(name).replace(/\s*<\d+>$/,'');
  const roleLabel=key=>{const p=project.model?.parts?.find(x=>x.key===key);return p&&(p.role!=='other'||p.chosen)?ROLES.find(r=>r[0]===choiceOf(p))?.[1]||'':'';};
  function partsPanel(){
    const tree=partsOf(),box=$('#sim-parts');box.hidden=!tree||!project.model;if(box.hidden){partSel=null;return;}
    if(partSel&&!tree.byKey.has(partSel.key))partSel=null;
    const item=n=>{const li=document.createElement('li'),b=document.createElement('button'),name=document.createElement('span'),role=document.createElement('em');b.type='button';b.className='sim-part-item'+(partSel===n?' selected':'');
      name.textContent=bare(n.name);role.textContent=roleLabel(n.key)||'—';b.append(name,role);b.onclick=()=>selectPart(n);li.append(b);return li;};
    $('#sim-part-list').replaceChildren(...tree.top.slice(0,80).map(item));
    $('#sim-part-pick').hidden=!partSel;
    if(partSel){$('#sim-part-name').textContent=bare(partSel.name);$('#sim-part-path').textContent=partSel.key.split('/').slice(0,-1).map(bare).join(' › ');
      const current=choiceOf(project.model.parts?.find(p=>p.key===partSel.key));
      $('#sim-part-roles').replaceChildren(...ROLES.map(([k,label])=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=label;b.setAttribute('aria-pressed',String(current===k));b.onclick=()=>assignPart(partSel,k);return b;}));
      $('#sim-part-up').hidden=!(partSel.parent>=0&&!tree.top.includes(partSel));}
    modelPreview?.highlight(partSel?tree.under(partSel):null);
  }
  function selectPart(n){partSel=n||null;partsPanel();}
  function assignPart(n,choice){
    const tree=partsOf(),boxOf=M().meshesBox(model.geometry,tree.under(n));if(!boxOf)return;
    const named=MECH.partRole(n.name,n.children.map(c=>c.name)),[role,pieces]=choice.split(':');
    const part={name:bare(n.name),key:n.key,chosen:true,box:boxOf,
      ...(role==='turret'?{role:'shooter',type:'turret',pieces:named.pieces||'pollen'}:role==='shooter'?{role:'shooter',pieces,type:/turret/i.test(n.name)?'turret':'fixed'}:role==='kicker'?{role:'intake',kind:'kicker'}:role==='intake'?{role:'intake',kind:named.kind&&named.kind!=='kicker'?named.kind:'sweeper'}:{role})};
    project.model.parts=[...(project.model.parts||[]).filter(p=>p.key!==n.key),part];
    if(role==='chassis')project.model.autoSize=false;
    const cad=setUpFromCad({replace:true});save();robotPanel();mechanismsPanel();void placeModel();
    // The answer is saved with the part, so the picker closes; click the part again to change it.
    status('#sim-model-help',`${part.name}: ${ROLES.find(r=>r[0]===choice)[1]}.${cad?.found?.length?' Robot set up: '+cad.found.join('; ')+'.':''}`);partSel=null;partsPanel();
  }
  $('#sim-part-up').onclick=()=>{const tree=partsOf();if(partSel?.parent>=0)selectPart(tree.nodes[partSel.parent]);};
  $('#sim-part-clear').onclick=()=>selectPart(null);
  // The picker also closes on a click outside it (the list and the model still pick parts) or on Enter / Escape.
  document.addEventListener('pointerdown',e=>{if(partSel&&!e.target.closest?.('#sim-part-pick,#sim-part-list,#sim-model-preview'))selectPart(null);});
  document.addEventListener('keydown',e=>{if(!partSel||$('#sim-part-pick').hidden||!['Enter','Escape'].includes(e.key)||e.target.closest?.('input,textarea,select'))return;
    if(e.key==='Enter'&&e.target.closest?.('#sim-part-pick button'))return;e.preventDefault();selectPart(null);});
  function pickPart(point){const tree=partsOf();if(!tree||!point||!Number.isFinite(point.part))return;
    selectPart(tree.at(point.part,partSel&&tree.under(partSel).has(point.part)?partSel:null));}
  // The robot set up from the CAD's named parts: chassis size, intakes (side, how far out, mouth, height) and
  // shooters (where, turret or fixed, which pieces). Returns what was found, or null without named parts.
  // Without a named chassis, the robot's size is the model's own size (in its units, after the front and top are
  // set); a size outside 4–48 in usually means the file's units are wrong, so it is left for the team to set.
  function sizeFromModel(){
    if(!project.model?.autoSize)return null;const n=model?.holder?.userData.nativeSize,q=v=>Math.round(v*4)/4;if(!n)return null;
    // A robot file with joints keeps its true size in the views, so its footprint follows it as far as the 4–48 in allowed.
    const exact=['urdf','sdf','mjcf','usd'].includes(project.model.source),c=v=>exact?Math.min(48,Math.max(4,v)):v;
    if(!exact&&![n.length,n.width].every(v=>v>=4&&v<=48))return null;
    Object.assign(project.robot,{length:q(c(n.length)),width:q(c(n.width)),...(n.height>=1&&n.height<=48?{heightIn:q(n.height)}:{})});save();robotPanel();void placeModel();
    return `${project.robot.length} × ${project.robot.width} × ${project.robot.heightIn} in`;
  }
  // merge (Configure from CAD, a new import): the intakes and shooters the team added take what the CAD says about them
  // (MECH.adoptCad); replace (a part's role picked by hand): they become exactly what the parts say.
  function setUpFromCad({replace=false,merge=false}={}){
    const boxes=project.model&&M()?.partBoxes(project.model);if(!boxes)return null;
    const out=MECH.fromCad(boxes.parts,{length:boxes.extent.length,width:boxes.extent.width,chassis:boxes.chassis?.derived?boxes.chassis:null});if(!out.found.length)return out;
    // A robot is 4 to 48 in each way: a size outside that came from the wrong part, and the size there is stays.
    const sane=v=>Number.isFinite(v)&&v>=4&&v<=48;if(out.robot&&sane(out.robot.length)&&sane(out.robot.width))Object.assign(project.robot,out.robot);
    if(merge&&!replace){const r=MECH.adoptCad(project.mechanisms,out);project.mechanisms=r.mechanisms;return {...out,matched:r.matched,extra:r.extra};}
    // A choice made by clicking (replace) sets the intakes and shooters to exactly what the parts say.
    if(out.intakes.length||out.shooters.length||replace){const m=structuredClone(project.mechanisms);if(!m.enabled||replace){m.intakes=[];m.shooters=[];}
      if(out.intakes.length)m.intakes=out.intakes;if(out.shooters.length)m.shooters=out.shooters;if(out.capacity&&!m.capacity?.nectar)m.capacity=out.capacity;m.enabled=m.intakes.length+m.shooters.length>0||m.enabled&&!replace;project.mechanisms=MECH.sanitize(m);}
    return out;
  }
  // Progress shows in the drop box while reading; the finished summary once, under the model (or in the drop box when
  // there is no model to show it under).
  const importStatus=(text,busy=false,done=false)=>{const under=done&&!$('#sim-model-box').hidden;$('#start-status').textContent=text;$('#sim-model-status').textContent=under||!text?text:'';$('#sim-model-import-status').textContent=under?'':text;$('#sim-model-drop').classList.toggle('busy',busy);};
  async function importModel(get,{front='+x',top='+z',stay=false}={}){
    const began=Date.now();let ticking=null;
    importProgress=null;const reading=()=>{const t=Math.round((Date.now()-began)/1000),p=importProgress;importStatus(`Reading your robot… ${p?.stage==='read'?`${p.done} of ${p.total} pieces · `:p?.stage==='split'?'splitting the assembly · ':''}${t} s`,true);};
    try{await three();ticking=setInterval(reading,1000);reading();const result=await get();clearInterval(ticking);if(!result){importStatus('');return;}
      if(result.kind==='step')importStatus(`Merging ${result.parts} parts into one body…`,true);
      const body=await M().bodyFromImport(result),glb=await M().toGlb(body.geometry),stored=await api.simFile('model-save',{name:result.name||'robot.glb',bytes:glb});
      // Each named assembly (chassis, intake, shooter...) is kept as a part with its box, classified by its name.
      const parts=(body.groups||[]).map(g=>({name:g.name,...(g.key?{key:g.key}:{}),...MECH.partRole(g.name,g.inner),box:g.box}));
      project.model=M().meta({id:stored.id,name:result.name||stored.name,units:body.units,front:front||'+x',top:top||'+z',source:body.source,parts,bodyChassis:true});project.robot.appearance='custom';$('#sim-appearance').value='custom';model={id:stored.id,geometry:body.geometry};
      // A robot file's joints (URDF, SDFormat, MuJoCo, USD) come with it, confirmed.
      if(body.kinematics)project.kinematics=window.DeckKinematics.sanitize({...body.kinematics,model:stored.id});
      project.robotPreset=null;const cad=setUpFromCad({merge:true});project.model.autoSize=!cad?.robot;project.model.entered=[];placeModel.tracedId=`${stored.id}:${project.mechanisms.intakes.length+project.mechanisms.shooters.length}`;
      // The drivetrain from part names ("104mm Mecanum Wheel", "Swerve module"...).
      const drive=MECH.drivetrainFromNames(result.names||[]);if(drive&&C.drives[drive]){project.robot.drivetrain=drive;project.model.drivetrain=drive;cad?.found.unshift(`Drivetrain: ${C.drives[drive].name}`);}
      save();robotPanel();mechanismsPanel();presetPanel();
      if(!stay){selectTab('setup');showSetupStep('robot');}await placeModel();const sized=sizeFromModel();reload();
      // What powers each mechanism comes from the CAD too, so the count of motors and servos is the robot's and not a guess
      // (a robot file's joints are already confirmed).
      if(cad?.found.length&&!body.kinematics){importStatus('Finding what powers each mechanism…',true);try{await configureFromCad();}catch(e){status('#mech-list-status',`Could not read what powers each mechanism: ${e.message}`);}}
      importStatus(`Imported ${body.parts} part${body.parts===1?'':'s'} in ${Math.round((Date.now()-began)/1000)} s${result.cached?' (from the last import of this file)':''}.${sized?` Size from the CAD: ${sized}.`:''}${cad?.found.length?` From the assembly names: ${cad.found.join('; ')}.`:body.kinematics?'':' Name the assemblies Chassis, Intake, Shooter (or Turret, Pollen shooter, Nectar shooter) and Indexer in your CAD to set the robot up from them.'} Check the front and top with the cube.${body.kinematics?` Its ${body.kinematics.joints.filter(j=>j.type!=='fixed').length} joints come from the ${body.format?body.format+' file':'file'} (Setup → Moving parts).`:''}${body.missing?.length?` Not drawn: ${body.missing.slice(0,4).join('; ')}${body.missing.length>4?'…':''}.`:''}${body.notes?.length?` Not read from the file: ${body.notes.slice(0,2).join(' ')}${body.notes.length>2?` (and ${body.notes.length-2} more)`:''}`:''}`,false,true);
    }catch(e){importStatus(`Could not import the robot: ${e.message}`);}finally{clearInterval(ticking);$('#sim-model-drop').classList.remove('busy');}
  }
  // The robot is simulated as its CAD is posed, so nothing is read until the user confirms it is the starting configuration.
  const confirmStart=name=>new Promise(resolve=>{const d=$('#sim-start-confirm');$('#sim-start-confirm-file').textContent=name;d.returnValue='';
    d.addEventListener('close',()=>resolve(d.returnValue==='yes'),{once:true});d.showModal();$('#sim-start-no').focus();});
  const importConfirmed=async(file,options)=>{const name=file.split(/[\\/]/).pop();
    if(options?.ask!==false&&configured()){const a=await askMajor(`Import ${name}?`,`“${project.setupName}” is already set up${project.model?` with ${project.model.name}`:project.robotPreset?` as the ${MECH.PRESETS[project.robotPreset].name}`:''}. Make a new setup for this robot, or replace this setup’s robot.`,'Make a new setup');
      if(a==='cancel')return;if(a==='new'&&!await newSetup())return;}
    if(!await confirmStart(name))return importStatus('Import canceled. Export your CAD in the robot’s starting position, then import it again.');return importModel(()=>api.simFile('model-drop',{file}),options);};
  $('#sim-model-open').onclick=async()=>{try{const picked=await api.simFile('model-pick');if(picked)await importConfirmed(picked.file);}catch(e){importStatus(`Could not import the robot: ${e.message}`);}};
  const drop=$('#sim-model-drop');
  for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('over');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');const file=e.dataTransfer?.files?.[0];if(!file||!native)return;const filePath=api.simDropPath?.(file);if(!filePath)return importStatus('That file could not be opened.');void importConfirmed(filePath);});
  const reorient=side=>{if(!selectedSide||!model)return;const builtin=model.builtin,current=project.model||project.orientations?.[builtin]||{front:builtin==='strafer'?'-x':'+x',top:'+z'},next=M().assignSide(current,selectedSide,side);const followed=project.model?followOrientation(current,next):false;if(project.model)Object.assign(project.model,next);else project.orientations[builtin]=next;save();selectedSide=null;for(const b of $$('[data-assign-side]'))b.disabled=true;
    if(project.model){robotPanel();mechanismsPanel();reload();}if(followed)status('#mech-model-help','');
    const said=followed?'Orientation saved. The intakes and shooters from your CAD moved with it. If one looks wrong, press “Configure from CAD” in Mechanisms.':'Orientation saved. The floor marks the bottom.';
    void placeModel().then(()=>{const sized=sizeFromModel();if(sized)status('#sim-model-help',said+' Size from the CAD: '+sized+'.');});status('#sim-model-help',said);void placeModel().then(()=>modelPreview?.look(null));};
  // A new front or top for the CAD carries its intakes, shooters and chassis size with it, so the hitboxes stay on
  // the parts they came from. Returns whether the mechanisms changed.
  function followOrientation(from,to){
    const turn=M().turnBetween(from,to),cad=o=>{const b=M().partBoxes({...project.model,...o});return b&&MECH.fromCad(b.parts,{length:b.extent.length,width:b.extent.width,chassis:b.chassis?.derived?b.chassis:null});};
    const before=cad(from),after=cad(to);
    if(turn%2===1)Object.assign(project.robot,{length:project.robot.width,width:project.robot.length});else if(turn===null&&after?.robot)Object.assign(project.robot,after.robot);
    if(!project.mechanisms?.enabled)return false;const was=JSON.stringify(project.mechanisms);project.mechanisms=MECH.reoriented(project.mechanisms,{turn,before,after});return JSON.stringify(project.mechanisms)!==was;
  }
  for(const b of $$('[data-assign-side]'))b.onclick=()=>reorient(b.dataset.assignSide);
  $('#sim-model-units').onchange=e=>{if(!project.model)return;project.model.units=e.target.value;save();void placeModel();};
  $('#sim-model-remove').onclick=()=>{project.model=null;project.robot.appearance='plain';model=null;save();robotPanel();modelUi();draw();view3d?.setModel(null);};

  // ------------------------------------------------------------------ layouts and files
  function layoutPanel(){
    $('#sim-game-elements').checked=L().elements;$('#sim-game-elements').disabled=L().field==='empty';
    const sel=$('#sim-field');sel.replaceChildren(...['biobuzz','empty'].map(k=>new Option(GAMES[k],k,false,k===L().field)));
    const l=L();$('#sim-field-note').textContent=l.field==='empty'?'Only your own no-go zones on this field.':`Routes avoid ${GAMES[l.field]}'s ${info?.field===l.field?info.obstacleName:'field parts'} automatically (red dotted collision outlines).`;
    const b=info?.field===l.field?geometry().bounds:C.bounds(l);inputValue('#sim-field-width',b.x1-b.x0);inputValue('#sim-field-height',b.y1-b.y0);
    for(const id of ['#sim-field-width','#sim-field-height'])$(id).disabled=l.field!=='empty';
    $('#sim-field-size-note').textContent='Custom field. Dimensions are saved with this layout.';
    // Game fields keep FTC's playing area (inside the perimeter wall, from the official field CAD); only empty fields resize.
    $('#sim-alliance-box').hidden=l.field!=='biobuzz';pressed('alliance',l.alliance||'red');mechanismsPanel();if(typeof setupStepPanel==='function'&&setupStep)setupStepPanel();
    $('#sim-field-size').hidden=l.field!=='empty';$('#sim-field-official').hidden=l.field==='empty';
    $('#sim-field-official').textContent=l.field==='empty'?'':`Official ${GAMES[l.field]} field · ${(b.x1-b.x0).toFixed(1)} × ${(b.y1-b.y0).toFixed(1)} in inside the perimeter wall. FTC sets this size, so it cannot be changed. Clone the setup to keep a separate plan.`;
  }
  async function switchLayout(id){
    if(native&&info)await api.sim('stop');project.active=id;info=null;const l=L();selected=null;trail=[];frame=null;start=l.start||field.edgePose(0,geometry());preview={...start};tool=l.start?'select':'start';save();fieldArtKey='';
    layoutPanel();inputs();planningPanel();pinPanel();zonePanel();tested();robotPanel();draw();view3d?.setField(null,l);await reloadNow();void exportPanel();if(($('#sim-3d').hidden?'2d':'3d')!==project.view)await setView(project.view);
  }
  // The setup's one field becomes BIOBUZZ or an empty field, with that field's defaults; its start and paths stay.
  $('#sim-field').onchange=e=>{const game=e.target.value,l=L();if(!Object.hasOwn(GAMES,game)||game===l.field)return;
    const next=cleanLayout({...layout(game,GAMES[game]),id:l.id,start:l.start,pins:l.pins,alliance:l.alliance});project.layouts=project.layouts.map(x=>x===l?next:x);info=null;fieldArtKey='';changed('field');void switchLayout(next.id);};
  for(const [id,key] of [['#sim-field-width','width'],['#sim-field-height','height']])$(id).onchange=e=>{const n=e.target.valueAsNumber;if(L().field!=='empty'||!finite(n)||n<1){e.target.value=L()[key];return layoutPanel();}L()[key]=n;info=null;fieldArtKey='';L().start=null;start=field.constrain(start,geometry());preview={...start};changed('field');layoutPanel();reload();};
  $('#sim-save').onclick=async()=>{
    try{save();const data=snapshot();if(project.model&&model){const glb=await M().toGlb(model.geometry);let s='';for(let i=0;i<glb.length;i+=32768)s+=String.fromCharCode(...glb.subarray(i,i+32768));data.modelData=btoa(s);}
      const r=await api.simFile('project-save',JSON.stringify({deckSimulation:2,...data}));if(r)status('#start-status',`Saved ${r.name}.`);}catch(e){status('#start-status',e.message);}
  };
  $('#sim-open').onclick=async()=>{try{const file=await api.simFile('project-open');if(file)await openProject(file);}catch(e){status('#start-status',e.message);}};
  // A setup sent from the terminal (tools/deck-sim.cjs show): open it as a new saved setup, attach
  // the robot CAD it names, plan it and show the requested tab, optionally starting the run.
  if(native&&api.onSimOpen){
    api.onSimOpen(request=>void (async()=>{
      try{await openProject(request);if(request.model)await importConfirmed(typeof request.model==='string'?request.model:request.model.file,{front:request.front,top:request.top,stay:true,ask:false});
        selectTab(request.tab);if(request.tab!=='setup'&&L().pins.length)await plan();if(request.run&&L().route&&!$('#sim-run').disabled)$('#sim-run').click();}
      catch(e){selectTab('setup');status('#start-status',`${request.name}: ${e.message}`);}
    })());
    void api.simOpenReady().catch(()=>{});
  }
  async function openProject(file){
    const raw=JSON.parse(file.text);if(raw?.deckRobot===1)return loadRobotFile(file,raw);if(raw?.deckSimulation!==2&&raw?.deckSimulation!==1)throw Error('That file is not a Deck setup.');
      const next=sanitize(oneField(raw));if(raw.modelData&&typeof raw.modelData==='string'&&raw.model){const bin=atob(raw.modelData),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const stored=await api.simFile('model-save',{name:raw.model.name||'robot.glb',bytes});next.model=modelMeta({...raw.model,id:stored.id});}
      clearRun();save();const bank=project.setups,active=next.active;for(const l of next.layouts){const old=l.id;l.id=newId();if(old===active)next.active=l.id;}next.export.keep=false;next.setupId=newId();next.setupName=file.name.replace(/\.json$/i,'').slice(0,40);next.setups=bank;project=next;model=null;save();refreshAll();await switchLayout(project.active);await placeModel();status('#start-status',`Opened ${file.name}.`);
  }
  // Saved setups. Each one holds its fields (with their planned routes), robot, mechanisms, controller,
  // program and run settings. The picker lists what every setup holds; the bar beside it creates, renames
  // and deletes setups and opens or saves them as files, and right-clicking one (or the menu key) opens,
  // clones, renames or deletes it.
  const CONTROLLERS={ftc:'FTC Control Hub',motionmodule:'Other robot'};
  function setupFacts(d){
    if(d?.needsCad&&!d.model)return [['Robot','Not set up yet: import its CAD in 2 · CAD']];
    const layouts=Array.isArray(d?.layouts)?d.layouts:[],l=layouts.find(x=>x.id===d.active)||layouts[0]||{},r=d?.robot||{},m=d?.mechanisms||{},preset=MECH.PRESETS[d?.robotPreset];
    const game=l.field==='biobuzz',drive=(C.drives[r.drivetrain]?.name||'').split(' · ')[0],count=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
    const fieldText=(l.name||GAMES[l.field]||'Field')+(game?` · ${l.alliance==='blue'?'blue':'red'} alliance`:finite(l.width)&&finite(l.height)?` · ${l.width} × ${l.height} in`:'')+(layouts.length>1?` (+${layouts.length-1} more)`:'');
    const robotText=`${preset?preset.name:d?.model?.name||'Custom robot'} · ${drive}${finite(r.length)&&finite(r.width)?` · ${r.length} × ${r.width} in`:''}`;
    const intakes=Array.isArray(m.intakes)?m.intakes.length:0,shooters=Array.isArray(m.shooters)?m.shooters:[];
    // The game's intakes and shooters (BIOBUZZ), then the moving mechanisms by name.
    const TYm=window.DeckMechanismTypes,k=d?.kinematics||{},moving=(Array.isArray(k.joints)?k.joints:[]).filter(j=>TYm?.TYPES[j.kind]&&TYm.TYPES[j.kind].signal!=='wheel'&&(!j.drive||j.drive.signal==='action')&&!(k.couplings||[]).some(c=>c.to===j.id)).map(j=>j.name);
    const gameText=game&&m.enabled?`${intakes?count(intakes,'intake'):'No intake'} · ${[[shooters.filter(s=>s.type==='turret').length,'turret'],[shooters.filter(s=>s.type!=='turret').length,'fixed shooter']].filter(([n])=>n).map(([n,w])=>count(n,w)).join(' + ')||'no shooter'}`:'';
    const mechText=[gameText,moving.length>3?`${moving.slice(0,3).join(', ')} +${moving.length-3} more`:moving.join(', ')].filter(Boolean).join(' · ')||'None';
    const pins=Array.isArray(l.pins)?l.pins.length:0;
    return [['Field',fieldText],['Robot',robotText],['Mechanisms',mechText],['Controller',CONTROLLERS[d?.controller]||CONTROLLERS.ftc],['Route',pins?`${count(pins,'pin')}${l.route?' · planned':''}`:'No route yet']];
  }
  function setupPanel(){
    reliableNote();
    const current=$('#sim-setup'),facts=setupFacts(project);current.querySelector('strong').textContent=project.setupName;current.querySelector('small').textContent=facts.slice(0,4).map(f=>f[1]).join(' · ');current.title=facts.map(f=>f.join(': ')).join('\n');
    if(!$('#sim-setup-list').hidden)setupList();activeSetupPanel();
  }
  function setupList(){
    const list=$('#sim-setup-list'),tip=document.createElement('p');
    list.replaceChildren(...project.setups.map(s=>{const on=s.id===project.setupId,b=document.createElement('button'),name=document.createElement('strong'),facts=document.createElement('span');
      b.type='button';b.className='sim-setup-option';b.dataset.setupId=s.id;b.setAttribute('role','option');b.setAttribute('aria-selected',String(on));name.textContent=on?project.setupName:s.name;facts.className='sim-setup-facts';
      for(const [k,v] of setupFacts(on?project:s.data)){const key=document.createElement('b'),value=document.createElement('span');key.textContent=k;value.textContent=v;facts.append(key,value);}
      b.append(name,facts);return b;}));
    tip.className='hint';tip.textContent='Right-click a setup to clone, rename or delete it.';list.append(tip);
  }
  function showSetupList(open){const list=$('#sim-setup-list');if(open)setupList();list.hidden=!open;$('#sim-setup').setAttribute('aria-expanded',String(open));if(open)(list.querySelector('[aria-selected=true]')||list.querySelector('button'))?.focus();}
  const cycle=(items,e)=>{if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return false;e.preventDefault();const i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();return true;};
  $('#sim-setup').onclick=()=>showSetupList($('#sim-setup-list').hidden);
  $('#sim-setup-list').onclick=e=>{const b=e.target.closest('[data-setup-id]');if(!b)return;showSetupList(false);$('#sim-setup').focus();if(b.dataset.setupId!==project.setupId)void switchSetup(b.dataset.setupId);};
  $('#sim-setup-list').onkeydown=e=>{if(cycle($$('#sim-setup-list [data-setup-id]'),e))return;if(e.key==='Escape'){showSetupList(false);$('#sim-setup').focus();}};
  let menuSetup=null;
  function hideSetupMenu(){$('#sim-setup-menu').hidden=true;menuSetup=null;}
  function setupMenu(id,x,y){
    const menu=$('#sim-setup-menu'),entry=project.setups.find(s=>s.id===id);if(!entry)return;hideSetupMenu();menuSetup=id;
    menu.querySelector('[data-setup-act=open]').hidden=id===project.setupId;menu.querySelector('[data-setup-act=clone]').disabled=project.setups.length>=20;menu.querySelector('[data-setup-act=delete]').disabled=project.setups.length<2||builtin(id);menu.querySelector('[data-setup-act=rename]').disabled=builtin(id);
    menu.setAttribute('aria-label',`${id===project.setupId?project.setupName:entry.name}: setup actions`);menu.hidden=false;
    menu.style.left=Math.max(4,Math.min(x,innerWidth-menu.offsetWidth-4))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-menu.offsetHeight-4))+'px';
    menu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
  }
  root.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-setup-id],#sim-setup');if(!b)return;e.preventDefault();const r=b.getBoundingClientRect();setupMenu(b.dataset.setupId||project.setupId,e.clientX||r.left+16,e.clientY||r.bottom);});
  $('#sim-setup-menu').onclick=e=>{
    const button=e.target.closest('[data-setup-act]'),id=menuSetup;if(!button||!id)return;const act=button.dataset.setupAct;
    hideSetupMenu();showSetupList(false);
    if(act==='open')void switchSetup(id);else if(act==='clone')void cloneSetup(id);else if(act==='delete')void confirmDeleteSetup(id);
    else if(act==='rename')void (id===project.setupId?Promise.resolve():switchSetup(id)).then(renameSetup);
  };
  $('#sim-setup-menu').onkeydown=e=>{if(cycle($$('#sim-setup-menu button').filter(b=>!b.hidden&&!b.disabled),e))return;if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();hideSetupMenu();$('#sim-setup').focus();}};
  document.addEventListener('pointerdown',e=>{if(!$('#sim-setup-menu').hidden&&!e.target.closest?.('#sim-setup-menu'))hideSetupMenu();if(!$('#sim-setup-list').hidden&&!e.target.closest?.('.sim-setup-picker,#sim-setup-menu'))showSetupList(false);},true);
  function builtin(id){return String(id||'').startsWith('preset:');}
  function configured(){return !!(project.model||project.robotPreset||project.mechanisms.enabled||L().pins.length);}
  // A big change (a new CAD, a preset robot) to a setup already set up: 'new' (a setup of its own), 'this' or 'cancel'.
  const askMajor=(title,text,newLabel)=>new Promise(resolve=>{const d=$('#sim-major-confirm');$('#sim-major-title').textContent=title;$('#sim-major-text').textContent=text;$('#sim-major-new').textContent=newLabel;d.returnValue='';
    d.addEventListener('close',()=>resolve(['new','this'].includes(d.returnValue)?d.returnValue:'cancel'),{once:true});d.showModal();$('#sim-major-new').focus();});
  // Another setup is another robot: it opens on the tab and Setup step you are on, at the part you last had open on it,
  // and nothing of the one before (a part being placed, the chassis being edited) carries over.
  async function switchSetup(id){const was={tab,step:setupStep};clearRun();keepPlace();save();const bank=project.setups,entry=bank.find(s=>s.id===id);if(!entry)return;project=sanitize({...entry.data,setups:bank,setupId:entry.id,setupName:entry.name});model=null;modelPreview?.dispose();modelPreview=null;
    garagePick=project.garageTile||null;garageKeys=null;wheelPlacing=null;wheelsSaid="";mechPlacing=null;mechFocus=null;chassisEdit=false;save();setupPanel();
    if(was.tab==='setup'){selectTab('setup');showSetupStep(was.step);}else if(['plan','run','video'].includes(was.tab))selectTab(was.tab);else openSetupAt();await switchLayout(project.active);refreshAll();resumePlace();if(native&&project.robotPreset&&L().pins.length&&!L().tested)void optimize();}
  // Where this setup is being edited, kept with it: its Setup step and how far down the page.
  function keepPlace(){if(tab==='setup')project.setupStep=setupStep;}
  // The box or list in Setup the team last used (a mechanism's motor model, a port), so a half-done setup opens on it.
  root.addEventListener('focusin',e=>{const el=e.target;if(tab!=='setup'||!el.id||!el.closest?.('[data-setup-page]')||!/^[\w.:-]{1,80}$/.test(el.id))return;project.setupFocus=el.id;});
  // Setup at 1 · Field, or, for a setup left half done (Setup not finished yet), the step it was left on.
  function openSetupAt(){const resume=!project.setupDone;setupStep=resume&&project.setupStep||'field';if(stepHidden(setupStep))setupStep='robot';selectTab('setup');setupStepPanel();if(!resume)project.setupFocus='';}
  function resumePlace(){const id=!project.setupDone&&project.setupFocus;if(!id)return;
    setTimeout(()=>{const el=document.getElementById(id);if(!el||!el.closest(`[data-setup-page=${setupStep}]`)||el.closest('[hidden]'))return;for(let d=el.closest('details');d;d=d.parentElement?.closest('details'))d.open=true;el.scrollIntoView({block:'center'});el.focus({preventScroll:true});},150);}
  // A clone is "<name> copy", placed after the original and opened for editing (its name first).
  async function cloneSetup(id){
    save();if(project.setups.length>=20)return status('#start-status','Use at most 20 saved setups.');const source=project.setups.find(s=>s.id===id);if(!source)return;
    const names=new Set(project.setups.map(s=>s.name)),base=source.name.slice(0,32);let name=`${base} copy`;for(let n=2;names.has(name);n++)name=`${base} copy ${n}`;
    // The copy gets its own field ids, so it never updates the original's kept export file.
    const data=JSON.parse(JSON.stringify(source.data));for(const l of data.layouts||[]){const old=l.id;l.id=newId();if(data.active===old)data.active=l.id;}if(data.export)data.export.keep=false;
    const entry={id:newId(),name,data};project.setups.splice(project.setups.indexOf(source)+1,0,entry);
    // A demo's copy is a robot of your own: everything on it can be changed (its CAD is made when the copy opens).
    await switchSetup(entry.id);if(builtin(id)){customRobot();setupSteps();}status('#start-status',`Cloned “${source.name}”. You are editing the copy; the original is unchanged.`);renameSetup();
  }
  function deleteSetup(id){
    if(project.setups.length<2||builtin(id))return;if(id!==project.setupId){project.setups=project.setups.filter(s=>s.id!==id);save();setupPanel();return;}
    clearRun();const bank=project.setups.filter(s=>s.id!==id),entry=bank[0];project=sanitize({...entry.data,setups:bank,setupId:entry.id,setupName:entry.name});model=null;save();setupPanel();openSetupAt();void switchLayout(project.active).then(()=>{refreshAll();resumePlace();});
  }
  async function newSetup(){clearRun();keepPlace();save();if(project.setups.length>=20){status('#start-status','Use at most 20 saved setups.');return false;}const next=defaults(),bank=project.setups,names=new Set(bank.map(s=>s.name));let n=1;while(names.has(`Setup ${n}`))n++;next.setupName=`Setup ${n}`;next.needsCad=true;next.robot.appearance='plain';next.setups=bank;project=next;save();setupPanel();model=null;modelPreview?.dispose();modelPreview=null;openSetupAt();await switchLayout(project.active);refreshAll();return true;}
  $('#sim-setup-new').onclick=async()=>{if(await newSetup())renameSetup();};
  function renameSetup(){const input=document.createElement('input'),sel=$('#sim-setup');input.value=project.setupName;input.maxLength=40;input.setAttribute('aria-label','Setup name');sel.hidden=true;sel.after(input);input.focus();input.select();let done=false;const finish=keep=>{if(done)return;done=true;if(keep&&input.value.trim())project.setupName=input.value.trim();input.remove();sel.hidden=false;save();setupPanel();};input.onblur=()=>finish(true);input.onkeydown=e=>{if(e.key==='Enter')finish(true);if(e.key==='Escape')finish(false);};}
  // Deleting cannot be undone, so it always asks first, naming the setup; "No" is focused so Enter keeps it.
  const confirmDeleteSetup=id=>new Promise(resolve=>{
    const entry=project.setups.find(s=>s.id===id);if(!entry||project.setups.length<2||builtin(id))return resolve(false);const d=$('#sim-setup-delete-confirm');
    $('#sim-setup-delete-title').textContent=`Delete “${id===project.setupId?project.setupName:entry.name}”?`;d.returnValue='';
    d.addEventListener('close',()=>{const yes=d.returnValue==='yes';if(yes)deleteSetup(id);resolve(yes);},{once:true});d.showModal();$('#sim-setup-delete-no').focus();});
  // Path planning and Run & review hide the setup bar, so the panel names the setup being edited; click it to go back to Setup.
  function activeSetupPanel(){const b=$('#sim-active-setup');if(!b)return;b.querySelector('strong').textContent=project.setupName;b.title=`${setupFacts(project).map(f=>f.join(': ')).join('\n')}\n\nClick to open Setup.`;b.hidden=tab==='setup';}
  // Autosave: handlers save as they change things, and any edit, click or drag in the simulator saves again
  // a moment later, so no change in Setup, Path planning or Run & review waits for a Save button.
  let autosaveTimer=0;const autosave=()=>{clearTimeout(autosaveTimer);autosaveTimer=setTimeout(save,300);};
  for(const type of ['input','change','click','pointerup','keyup','drop'])root.addEventListener(type,autosave,true);
  // Typed values commit when their box loses focus, so closing or suspending the app commits the box being edited first.
  const saveNow=()=>{if(root.contains(document.activeElement))document.activeElement.blur?.();clearTimeout(autosaveTimer);keepPlace();save();};
  addEventListener('pagehide',saveNow);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveNow();});

  // ------------------------------------------------------------------ views
  function script(src){return script.cache[src]||(script.cache[src]=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{delete script.cache[src];reject(Error(`Could not load ${src}.`));};document.head.append(s);}));}
  script.cache={};
  function state3d(){return {layout:L(),start,info,trail,frame,hitboxes:project.hitboxes,preview:tab==='plan'&&previewAt>0&&previewPose()||null};}
  async function setView(next){
    project.view=next;save();pressed('view',next);const three3=next==='3d';$('#sim-3d').hidden=!three3;graph.style.display=three3?'none':'';applyZoom();
    // −/Fit/+ zoom the 2D field only, so 3D shows Hitboxes in their place.
    $('[data-tool]').parentElement.classList.toggle('three',three3);$('#sim-hitboxes').hidden=!three3;$('.sim-zoom').hidden=three3;$('#sim-hitboxes').setAttribute('aria-pressed',String(project.hitboxes));videoRefresh?.();
    if(three3){tool='select';try{await three();await script('sim-3d.js');view3d=view3d||window.DeckSim3D.create($('#sim-3d'));view3d.setField(info,L());view3d.setModel(fieldRig());view3d.update(frame,state3d());}catch(e){status('#sim-run-status',e.message);}}
    draw();
  }
  for(const b of $$('[data-view]'))b.onclick=()=>void setView(b.dataset.view);
  $('#sim-hitboxes').onclick=()=>showHitboxes(!project.hitboxes);
  $('#sim-game-elements').onchange=e=>{L().elements=e.target.checked;save();reload();};
  function selectTab(name){if(tab!==name){pointer=null;drag=null;}tab=name;if(name!=='setup'&&!project.setupDone){project.setupDone=true;save();}root.dataset.tab=name;if(name==='plan'&&planningStep==='start')tool='start';for(const b of $$('[data-tab]')){b.setAttribute('aria-selected',String(b.dataset.tab===name));b.tabIndex=b.dataset.tab===name?0:-1;}for(const p of $$('[data-panel]'))p.hidden=p.dataset.panel!==name;$('.simulation-layout').hidden=name==='video';studio?.show(name==='video');$('.field-area').hidden=name==='setup';$('.sim-toolbar [data-tool]').parentElement.hidden=name==='run';$('#sim-telemetry').hidden=name!=='run';$('#sim-run-timing').hidden=name!=='run';$('.sim-planning-steps').hidden=name!=='plan';
    document.body.classList.toggle('sim-workspace',active&&name!=='setup');if($('#sim-live-status'))$('#sim-live-status').hidden=name!=='plan'||!$('#sim-live-status').textContent;activeSetupPanel();window.scrollTo(0,0);if(name==='plan')planningPanel();if(name==='setup')stageMarks();else if(name!=='video')refreshDiagnostics();if(name!=='run'&&frame?.playing)void call('pause');view3d?.resize();modelPreview?.resize?.();}
  // Field obstacles are a step only on the empty field; game fields go from the start straight to paths.
  const hasObstacleStep=()=>L().field==='empty';
  function planningPanel(){if(planningStep==='zones'&&!hasObstacleStep())planningStep='pins';const zones=hasObstacleStep();$('#sim-step-zones').hidden=!zones;
    $('#sim-step-pins').textContent=`${zones?3:2} · Paths`;$('#sim-start-next').textContent=zones?'Next: field obstacles →':'Next: paths →';$('.sim-planning-steps').style.setProperty('--steps',zones?3:2);
    root.dataset.step=planningStep;$('#sim-start-step').hidden=planningStep!=='start';$('#sim-obstacle-step').hidden=planningStep!=='zones';$('#sim-route-step').hidden=planningStep!=='pins';for(const step of ['start','zones','pins']){const button=$('#sim-step-'+step);button.setAttribute('aria-pressed',String(planningStep===step));button.setAttribute('aria-selected',String(planningStep===step));}$('.sim-toolbar [data-tool]').parentElement.hidden=tab==='run';for(const b of $$('[data-tool]'))b.hidden=['pin','draw'].includes(b.dataset.tool)?planningStep!=='pins':b.dataset.tool==='select'?false:planningStep!=='zones';}
  function setStep(next){if(sketch)finishShape();planningStep=next;selected=null;tool=next==='pins'?'pin':next==='start'?'start':'select';preview={...start};planningPanel();draw();}
  const steps=$('.sim-planning-steps');$('.sim-panel').prepend(steps);steps.hidden=true;
  const activeSetup=document.createElement('button');activeSetup.id='sim-active-setup';activeSetup.type='button';activeSetup.className='sim-active-setup';activeSetup.hidden=true;activeSetup.innerHTML='<span>Setup</span><strong></strong>';activeSetup.onclick=()=>selectTab('setup');steps.after(activeSetup);
  const liveStatus=document.createElement('button');liveStatus.id='sim-live-status';liveStatus.type='button';liveStatus.className='sim-live-status';liveStatus.hidden=true;activeSetup.after(liveStatus);
  // The status line opens and closes the route checks right under it, in any planning step.
  liveStatus.setAttribute('aria-expanded','false');liveStatus.setAttribute('aria-controls','sim-plan-diagnostics');
  liveStatus.onclick=()=>{liveStatus.setAttribute('aria-expanded',String(liveStatus.getAttribute('aria-expanded')!=='true'));refreshDiagnostics();};
  $('#sim-start-step').prepend($('#sim-start-controls'));
  // ------------------------------------------------------------------ mechanisms
  // The robot's parts, edited like DSIM's robot builder: option cards, side chips and a 3×3 position
  // grid, with the robot model (when there is one) updating as you choose.
  // Every change goes through the shared sanitizer, so this page, the engine and the exports agree.
  let mechPreview=null,mechPlacing=null,mechList=null,garagePick=project.garageTile||null,garageKeys=null;
  const GRID=Object.keys(MECH.MOUNT_AT),title=s=>s[0].toUpperCase()+s.slice(1);
  const chip=(field,value,label,on,disabled=false)=>`<button type="button" class="sim-chip" data-field="${field}" data-value="${value}" aria-pressed="${on}"${disabled?' disabled':''}>${label}</button>`;
  const choiceCards=(field,list,notes,value)=>`<div class="sim-choice-cards">${Object.entries(list).map(([k,v])=>`<button type="button" class="sim-choice" data-field="${field}" data-value="${k}" aria-pressed="${k===value}"><strong>${v}</strong><span>${notes[k]}</span></button>`).join('')}</div>`;
  const mountGrid=(value,blocked)=>`<div class="sim-mount-grid" role="group" aria-label="Position on the robot"><span class="sim-mount-front">▲ Front</span>${GRID.map(k=>`<button type="button" data-field="mount" data-value="${k}" aria-pressed="${k===value}"${blocked.has(k)?' disabled title="Too close to the other shooter"':''}>${MECH.MOUNTS[k]}</button>`).join('')}</div>`;
  const placeButton=part=>model?.holder?`<button type="button" class="secondary sim-place" data-place="${part}" aria-pressed="${mechPlacing===part}">${mechPlacing===part?'Click the part on the model…':'Place on model'}</button>`:'';
  // A deployable ramp is two intakes that work as one: the ramp that pivots, on a servo, and the rollers, on a motor or a servo.
  // They share one pick-up box on one side of the robot, so they are grouped under it.
  // How far it swings starts from 0, the CAD's pose.
  const deployJoint=n=>project.kinematics.joints.find(j=>j.drive?.signal==='deploy'&&j.drive.of==='intake:'+n);
  const swingRange=(intake,n)=>{const j=deployJoint(n);return j?+Math.abs((j.states?.lowered??0)-(j.states?.raised??0)).toFixed(1):intake.travel??90;};
  const swingFields=(intake,n)=>{const ramp=intake.kind==='ramp';return `<div class="start-xy"><div><label for="mech-deploy-time-${n}">${ramp?'Folds up and down in':'Swings up and down in'} · s</label><input id="mech-deploy-time-${n}" data-field="fold" type="number" min="0" max="3" step="any" data-slider-max="1.5" data-slider-step="0.05" value="${intake.down}"></div><div><label for="mech-intake-range-${n}">${ramp?'Folds through':'Swings through'} · ° from 0</label><input id="mech-intake-range-${n}" data-range="${n}" type="number" min="-360" max="360" step="any" data-slider="off" value="${swingRange(intake,n)}"></div></div>`;};
  // An intake's rollers as a column (MECH sanitize: column {a, b, d}): a piece is taken only where it touches them when
  // pickup is 'rollers'. Configure from CAD measures it from the roller axle; Pick its end wheels sets it by hand.
  const columnLength=c=>+Math.hypot(...c.b.map((x,i)=>x-c.a[i])).toFixed(2);
  function pickupFields(intake,n){const c=intake.column,on=intake.pickup==='rollers'&&!!c,picking=mechPlacing?.startsWith(`column:${n}:`);
    return `<span class="sim-mech-label">Where it picks up</span><div class="sim-chips">${chip('pickup','box','Anywhere in the box',!on)}${chip('pickup','rollers','Only on its rollers',on,!c)}</div>
      ${c?`<div class="sim-grid3"><div><label for="mech-column-d-${n}">Roller wheels across · in</label><input id="mech-column-d-${n}" data-field="columnD" type="number" min="0.25" max="12" step="any" data-slider-max="6" data-slider-step="0.05" value="${c.d}"></div><div><label>Column length · in<input type="number" value="${columnLength(c)}" disabled data-slider="off"></label></div><div><label>Height of its axle · in<input type="number" value="${+((c.a[2]+c.b[2])/2).toFixed(2)}" disabled data-slider="off"></label></div></div>`:''}
      <p class="hint">${on?'A piece is taken only when it touches the roller wheels: the cylinder drawn on the model, from one end wheel to the other.':c?'Any piece in the box is taken. Choose Only on its rollers to need a piece to touch the roller wheels.':'Any piece in the box is taken. Configure from CAD measures the roller wheels, or pick its two end wheels on the model.'}${c?.by==='hand'?' Its ends were picked on the model.':''}</p>
      ${model?.holder?`<div class="sim-joint-buttons"><button type="button" class="secondary" data-column="pick:${n}" aria-pressed="${picking}">${picking?(mechPlacing.endsWith(':b')?'Now click the other end wheel…':'Click one end wheel on the model…'):'Pick its two end wheels'}</button>${project.kinematics.joints.some(j=>j.drive?.signal==='roller'&&j.drive.of==='intake:'+n)?`<button type="button" class="secondary" data-column="cad:${n}">Measure from the CAD</button>`:''}</div>`:''}`;}
  function intakeCard(intake,n,used,num=n+1){
    const deploy=!!SWINGS[intake.kind],group=intake.kind==='ramp',where=intake.sides.map(title).join(' and ').toLowerCase();
    return `<section class="sim-mech-part" data-part="intake:${n}"><div class="sim-mech-head"><h4>${group?`Intake ${num} · ramp and rollers on the ${where} of the robot`:`Intake ${num}`}</h4><button type="button" class="icon-button" data-mech-remove="intake:${n}" aria-label="Remove intake ${n+1}" title="Remove">×</button></div>
      ${choiceCards('kind',MECH.INTAKES,INTAKE_SHORT,intake.kind)}
      <div class="sim-box-fields"><span class="sim-mech-label">${group?'Pick-up box, shared by both':'Pick-up box'}</span><div class="sim-grid3"><div><label for="mech-intake-reach-${n}">Sticks out past the frame · in</label><input id="mech-intake-reach-${n}" data-field="reach" type="number" min="0" max="18" step="any" data-slider-max="8" data-slider-step="0.25" value="${intake.reach}"></div><div><label for="mech-intake-width-${n}">Mouth width · in</label><input id="mech-intake-width-${n}" data-field="width" type="number" min="1" max="48" step="any" data-slider-max="${Math.max(project.robot.width,project.robot.length)}" data-slider-step="0.25" value="${+(intake.width??(intake.sides.some(e=>e==='front'||e==='back')?project.robot.width:project.robot.length)).toFixed(2)}"></div><div><label for="mech-intake-height-${n}">Opening height · in</label><input id="mech-intake-height-${n}" data-field="height" type="number" min="1" max="24" step="any" data-slider-max="12" data-slider-step="0.25" value="${intake.height}"></div></div>
      ${intake.kind==='kicker'?'':pickupFields(intake,n)}
      <span class="sim-mech-label">Picks up from</span><div class="sim-chips">${MECH.EDGES.map(e=>chip('side',e,title(e),intake.sides.includes(e),used.has(e)&&!intake.sides.includes(e))).join('')}</div>${placeButton('intake:'+n)}</div>
      ${group?`<div class="sim-mech-sub"><h5>Intake ${num} · Deployable ramp</h5>${swingFields(intake,n)}<div class="sim-wire-block" data-wire-for="intakeRamp:${n}"></div></div><div class="sim-mech-sub"><h5>Intake ${num} · Rollers</h5><div class="sim-wire-block" data-wire-for="intakeRoller:${n}"></div></div>`:`${deploy?swingFields(intake,n):''}<div class="sim-wire-block" data-wire-for="intake:${n}"></div>`}</section>`;
  }
  // One line on each option card; the full notes are under "How this … works".
  const INTAKE_SHORT={sweeper:'Edge roller that sweeps pieces off the floor.',siderollers:'Grips from the sides; reaches into flowers.',ramp:'Fold-down ramp with rollers; reaches into flowers.',kicker:'Servo arm that scoops pieces in.'},
    SHOOTER_SHORT={turret:'Turns to aim; the robot can face any way.',fixed:'Fires one way; the robot turns to aim.'};
  const SWINGS={kicker:true,ramp:true};
  function shooterCard(s,n,m){
    // Two shooters on one turret sit together; on their own turrets they must stay apart.
    const shared=!!m.shooters[1]?.sharesTurret,other=m.shooters.length===2&&!shared?m.shooters[1-n]:null,blocked=new Set(other?['center',...GRID.filter(k=>MECH.adjacent(k,other.mount))]:[]);
    const pieces=`<span class="sim-mech-label">Shoots</span><div class="sim-chips">${Object.entries(MECH.PIECES).map(([k,v])=>chip('pieces',k,v,s.pieces===k)).join('')}</div>`;
    const turretChoice=n===1&&s.type==='turret'&&m.shooters[0].type==='turret'?`<span class="sim-mech-label">Turret</span><div class="sim-chips">${chip('sharesTurret','false','Its own turret',!shared)}${chip('sharesTurret','true','On shooter 1’s turret',shared)}</div>`:'';
    const riding=n===1&&shared;
    return `<section class="sim-mech-part" data-part="shooter:${n}"><div class="sim-mech-head"><h4>Shooter ${n+1} · ${MECH.PIECES[s.pieces].toLowerCase()}</h4><button type="button" class="icon-button" data-mech-remove="shooter:${n}" aria-label="Remove shooter ${n+1}" title="Remove">×</button></div>
      ${choiceCards('type',{turret:'On a turret',fixed:'Fixed'},SHOOTER_SHORT,s.type)}${pieces}${turretChoice}
      ${riding?'':`<span class="sim-mech-label">Position on the robot</span>${mountGrid(s.mount,blocked)}${placeButton('shooter:'+n)}`}
      ${s.type==='fixed'?`<span class="sim-mech-label">Fires toward</span><div class="sim-chips">${Object.keys(MECH.FACING).map(f=>chip('facing',f,title(f),s.facing===f)).join('')}</div>`:''}
      <span class="sim-mech-label">Hood</span><div class="sim-chips">${chip('hood','on','Moves on a servo',!!s.hood)}${chip('hood','off','Fixed',!s.hood)}</div>
      <div class="sim-wire-block" data-wire-for="shooter:${n}"></div></section>`;
  }
  function mechanismsPanel(){
    // The game's intakes and shooters are BIOBUZZ's; on another field only the moving mechanisms are listed.
    const m=project.mechanisms,l=L(),on=m.enabled&&l.field==='biobuzz',intakes=on?m.intakes:[],shooters=on?m.shooters:[],used=new Set(intakes.flatMap(i=>i.sides));
    // Rebuilt from settings; keep focus on a text field the user is typing in.
    const typing=document.activeElement?.closest?.('#mech-intakes,#mech-shooters')&&document.activeElement.matches('input:not([type=number]):not([type=checkbox])');
    if(!typing){
      $('#mech-intakes').innerHTML=intakes.map((i,n)=>intakeCard(i,n,used,1+intakes.slice(0,n).reduce((t,x)=>t+(x.kind==='ramp'?2:1),0))).join('');$('#mech-shooters').innerHTML=shooters.map((s,n)=>shooterCard(s,n,m)).join('');}
    $('#mech-flywheel').hidden=!shooters.length;$('#mech-turret').hidden=!on||!MECH.hasTurret(m);$('#mech-feeder').hidden=!shooters.length;$('#mech-preloads').hidden=!on;gearsPanel();
    const nectarOk=shooters.some(s=>s.pieces!=='pollen');$('#mech-cap-nectar').disabled=!nectarOk;$('#mech-preload').max=String(m.capacity.pollen);
    $('#mech-nectar-note').textContent=nectarOk?`Holds ${m.storage} pieces in any mix: up to ${m.capacity.pollen} pollen and up to ${m.capacity.nectar} nectar, ${MECH.STORAGE_MAX} at most together.`:'To carry nectar, set a shooter to shoot nectar (or pollen and nectar).';
    for(const [id,v] of [['#mech-cap-pollen',m.capacity.pollen],['#mech-cap-nectar',m.capacity.nectar],['#mech-preload',m.preload.pollen],['#mech-spinup',m.shooter.spinUp],['#mech-transfer',m.transfer.seconds],['#mech-index',m.indexer.seconds],['#mech-turret-speed',m.turret.speed],['#mech-turret-range',Math.max(-m.turret.min,m.turret.max)],['#mech-rpm',m.shooter.rpm],...['p','i','d','f'].map(k=>['#mech-pidf-'+k,m.shooter.pidf?.[k]??''])])inputValue(id,v);
    {const fly=window.DeckWiring.state(project).rows.find(r=>r.role==='flywheel'),j=fly&&project.kinematics.joints.find(x=>fly.joints?.includes(x.id));$('#mech-rpm-note').textContent=j?.rpm?`Its motor can spin it up to ${Math.round(j.rpm)} RPM.`:'';
      const together=$('#mech-with-intake'),named=MECH.onOneMotor(m);together.closest('label').hidden=!intakes.length;together.checked=MECH.chained(m);together.disabled=named;}
    $('#sim-action-list').replaceChildren(...MECH.actions(m).map(v=>new Option(v,v)));
    queueMicrotask(stageMarks);mechList?.render();$('#mech-empty').hidden=intakes.length+shooters.length+(mechList?.listed().length||0)>0;$('#mech-from-cad').disabled=!project.model;mechCount(intakes,shooters);
    $('#mech-from-cad').title=project.model?'Finds each mechanism in your CAD by its name':'Import your robot’s CAD in step 2 first';
    wireBlocks();mechModel();observeMechCards();chassisPanel();garage();
  }
  // The chassis alone (a preset robot with Edit the chassis motors ticked): each drive motor's configuration name, then its
  // model and port.
  function chassisPanel(){const box=$('#mech-chassis'),on=!!project.robotPreset&&chassisEdit&&project.controller==='ftc';box.hidden=!on;if(!on){box.innerHTML='';box.dataset.html='';return;}
    if(box.contains(document.activeElement)&&document.activeElement.matches('input'))return;
    const W=window.DeckWiring,st=W.state(project),rows=st.rows.filter(r=>r.role==='drive'||r.role==='steer');
    const html=`<h3 class="sim-setup-sub">Chassis</h3><p class="hint">Type each motor’s name as the robot’s configuration has it, or plug in the Control Hub and Setup reads them all.</p>${rows.map(r=>`<div class="sim-chassis-row"><label for="chassis-name-${W.esc(r.key)}">${W.esc(r.label)} · name on the robot</label><input id="chassis-name-${W.esc(r.key)}" data-chassis-name="${W.esc(r.key)}" maxlength="40" autocomplete="off" spellcheck="false" value="${W.esc(r.name)}">${W.deviceHtml(r,st,{noHub:noHub()})}</div>`).join('')||'<p class="hint">No drive motors to wire.</p>'}`;
    if(box.dataset.html!==html){const focus=document.activeElement?.id;box.innerHTML=html;box.dataset.html=html;if(focus)document.getElementById(focus)?.focus();}}
  window.DeckWiring.bind($('#mech-chassis'),{project:()=>project,apply:applyWiring});
  window.DeckWiring.bind($('#mech-drive-ports'),{project:()=>project,apply:applyWiring,assign:deviceAssign});
  window.DeckWiring.bind($('#mech-controller-imu'),{project:()=>project,apply:applyWiring,assign:deviceAssign});
  // Where each wheel or module is (project.robot.wheelPos): found in the CAD's moving parts (DeckChassisCal.wheelSlots), or typed.
  // wheelPlacing: the wheel (its key) the next click on the model places.
  let wheelsSaid='',wheelPlacing=null;
  const setWheelPos=pos=>{project.robot=C.robot({...project.robot,wheelPos:pos},project.controller);save();mechanismsPanel();};
  const wheelKeys=()=>{try{return window.DeckWiring.state(project).rows.filter(r=>r.role==='drive'&&!/B$/.test(r.key)).map(r=>r.key.replace(/^robot\./,''));}catch{return [];}};
  // Each drive wheel the CAD's moving parts found, given to the wheel or module it points at. Returns what it said, or '' when it found none.
  // The wheels Moving parts found, or else the CAD's own (joints.cadWheels): Find the wheels needs only the CAD.
  function findWheels(){const slots=wheelKeys().map(key=>({key})),found_=(project.kinematics?.joints||[]).filter(j=>j.drive?.signal==='wheel'),list=found_.length?found_:joints.cadWheels(),found=window.DeckChassisCal.wheelSlots(slots,list,{toRobot:joints.toRobot}),keys=Object.keys(found);
    if(!keys.length){wheelsSaid=project.model?'No drive wheels found in the CAD: press Click it on the model on each wheel, or type where it is.':'Import the robot’s CAD first, or type where each wheel is.';mechanismsPanel();return '';}
    const pos={...project.robot.wheelPos};for(const k of keys)pos[k]={x:found[k].x,y:found[k].y,from:'cad'};const n=keys.reduce((a,k)=>a+found[k].wheels.length,0);
    wheelsSaid=`Found ${n} wheel${n===1?'':'s'} for ${keys.length} of ${slots.length}${keys.length<slots.length?': click the rest on the model':''}.`;setWheelPos(pos);return wheelsSaid;}
  // The drivetrain the CAD's names say ("Kiwi Swerve Odometry", "104mm Mecanum Wheel"), or null.
  function cadDrive(){const tree=model?.geometry?.userData?.parts;if(!tree)return null;const d=MECH.drivetrainFromNames(window.DeckKinematics.partIndex(tree).nodes.map(n=>String(n.name||'')));return d&&C.drives[d]?d:null;}
  // While placing: the wheel under the pointer lights up (the parts a click would take) and its name shows, so what a
  // click picks is seen before it is clicked. Worked out again only when the pointer moves onto another part.
  let hovered=null;
  // A model without part names (a mesh, not a STEP assembly) has nothing to measure: the point under the pointer is taken.
  function hoverWheel(hit){const leaf=hit&&Number.isFinite(hit.part)?Math.round(hit.part):null;if(hit&&leaf===null){hovered=null;mechPreview?.hoverMark?.(null);status('#mech-model-help',`${wheelLabel(wheelPlacing)}: click to place it here (${hit.x.toFixed(1)} in forward, ${hit.y.toFixed(1)} in left).`);return;}if(leaf===hovered?.leaf)return void mechPreview?.hoverMark?.(hovered.set);
    if(leaf===null){hovered=null;mechPreview?.hoverMark?.(null);status('#mech-model-help',wheelPlacing?`Click the ${wheelLabel(wheelPlacing).toLowerCase()} on the model.`:'');return;}
    const k=wheelPlacing,others=/^(pod|pinpoint):/.test(k)?[]:Object.entries(project.robot.wheelPos||{}).filter(([key,p])=>key!==k&&Number.isFinite(p.bottom)).map(([,p])=>p.bottom),w=joints.wheelAt(hit,{bottoms:others});hovered={leaf,w,set:new Set(w?.leaves?.length?w.leaves:[leaf])};
    // The wheel or pod a click takes lights up; with no round part there, the part under the pointer, whose middle a click takes.
    mechPreview?.hoverMark?.(hovered.set);status('#mech-model-help',w?`${wheelLabel(k)}: click to take “${w.name}”${w.box?'':`, ${(2*w.radius).toFixed(2)} in across`}.`:`${wheelLabel(k)}: no round part here. Click to place it at this point.`);}
  // A wheel, pod or Pinpoint pod clicked on the model: its centre (joints.wheelAt), the other wheels' heights deciding
  // between a wheel and a part above it (pods stand lower than the wheels, so they are not held to that). Then the next
  // wheel not placed yet waits for its click.
  const setOdometry=fn=>{const o=structuredClone(C.odometryOf(project.robot));fn(o);project.robot=C.robot({...project.robot,odometry:o},project.controller);save();mechanismsPanel();};
  function placeWheel(hit){const k=wheelPlacing;if(!k||!hit)return;hovered=null;const pos={...project.robot.wheelPos},wheel=!/^(pod|pinpoint):/.test(k),others=wheel?Object.entries(pos).filter(([key,p])=>key!==k&&Number.isFinite(p.bottom)).map(([,p])=>p.bottom):[];
    const w=joints.wheelAt(hit,{bottoms:others})||(Number.isFinite(hit.x)?{x:+hit.x.toFixed(3),y:+hit.y.toFixed(3),box:true,name:'the point clicked',radius:0}:null);if(!w){wheelsSaid='Click a part of the model.';return mechanismsPanel();}
    const label=wheelLabel(k),what=`“${w.name}”${w.box?' (no round part there, so the middle of that part)':`, ${(2*w.radius).toFixed(2)} in across`}`;
    if(!wheel){const chain=SENSE_PLACING[project.sensors.localization]||[],next=chain[chain.indexOf(k)+1]||null;wheelPlacing=next;status('#mech-model-help',next?`Click the ${wheelLabel(next).toLowerCase()} on the model.`:'');const [kind,which]=k.split(':');
      wheelsSaid=`${label}: ${what}, ${w.x.toFixed(2)} in forward and ${w.y.toFixed(2)} in left.${next?` Now click the ${wheelLabel(next).toLowerCase()}.`:''}`;if(next&&kind==='pod')garagePick=`chassis:${next}`;
      return setOdometry(o=>{if(kind==='pod')o.pods[which]={...o.pods[which],x:w.x,y:w.y};else if(which==='x')o.pinpoint.xOffset=w.y;else o.pinpoint.yOffset=w.x;});}
    pos[k]={x:w.x,y:w.y,from:'cad',...(w.box?{}:{bottom:w.bottom,r:w.radius})};const avg=others.length?others.reduce((a,b)=>a+b,0)/others.length:null;
    const off=avg!==null&&!w.box&&Math.abs(w.bottom-avg)>.5?` It stands ${Math.abs(w.bottom-avg).toFixed(2)} in ${w.bottom>avg?'higher':'lower'} than the other wheels: check it is a drive wheel.`:'';
    const next=wheelKeys().find(x=>x!==k&&!pos[x]);wheelPlacing=next||null;
    wheelsSaid=`${label}: ${what}, ${w.x.toFixed(2)} in forward and ${w.y.toFixed(2)} in left.${off}${next?` Now click the ${wheelLabel(next).toLowerCase()}.`:''}`;
    status('#mech-model-help',next?`Click the ${wheelLabel(next).toLowerCase()} on the model.`:'');setWheelPos(pos);}
  const wheelLabel=k=>{const card=document.querySelector(`#mech-drive-ports [data-module="${CSS.escape(k)}"]`)?.dataset.moduleTitle;if(card&&!k.includes(":"))return card;const pod={par:'Forward odometry pod',perp:'Strafe odometry pod',par_left:'Left forward odometry pod',par_right:'Right forward odometry pod'};if(k==='pinpoint:x')return 'Pinpoint X (forward) pod';if(k==='pinpoint:y')return 'Pinpoint Y (strafe) pod';if(k.startsWith('pod:'))return pod[k.slice(4)]||'Odometry pod';
    try{return (window.DeckWiring.state(project).rows.find(r=>r.key==='robot.'+k)?.label||k).replace(/ drive motor$/,'').replace(/, motor 1$/,'').replace(/ drive$/,'');}catch{return k;}};
  // + Add to Chassis: what tells the robot where it is, picked here as in Robot controller (the same setting). Each joins
  // the chassis as a part of its own, then its pods wait to be clicked on the model, one after the other.
  let chassisAdding=false;
  const CHASSIS_SENSE=[['fused','goBILDA Pinpoint','with its two odometry pods (X and Y) plugged into it'],['odometry','Two odometry pods','forward and strafe, on motor ports’ encoder inputs'],['odometry3','Three odometry pods','two forward and one strafe, on motor ports’ encoder inputs'],['optical','SparkFun OTOS','an optical sensor that watches the floor']];
  function chassisAddHtml(){if(project.controller!=='ftc')return '';const now=project.sensors.localization,has=CHASSIS_SENSE.find(([k])=>k===now);
    return `<div class="sim-chassis-add${chassisAdding?' on':''}" data-chassis-add><span class="sim-mech-label">Add to the chassis</span><p class="hint">What tells the robot where it is. The hub’s built-in IMU is always there. ${has?`This robot has ${escText(has[1].toLowerCase().replace('gobilda','goBILDA').replace('sparkfun','SparkFun'))}: it is under Chassis on the left.`:'Pick what is on your robot: it joins Chassis, and you click its pods on the model.'}</p>
      <div class="sim-chassis-add-list">${CHASSIS_SENSE.map(([k,name,what])=>`<button type="button" class="sim-mech-type" data-chassis-sense="${k}" aria-pressed="${k===now}"><strong>${escText(name)}</strong><small>${escText(what)}</small>${k===now?'<em>On this robot</em>':''}</button>`).join('')}</div>
      ${has?`<button type="button" class="text-button" data-chassis-sense="encoders">Take it off: the drive motors’ encoders and the IMU</button>`:''}</div>`;}
  // + Add to Chassis: a pop-up. First what kind of thing goes on the chassis (today: odometry and the IMU), then Robot
  // controller's own "How it knows where it is" and "What measures turning" (moved in while it shows and back after, so there
  // is one copy and one setting), without the drive encoders (each wheel's Encoder tick says those). Picking a position
  // sensor reads its pods' offsets from the CAD. Done opens it under Chassis, where its numbers are.
  const CHASSIS_KINDS=[{id:'odometry',name:'Odometry & IMU',blurb:'How the robot knows where it is and which way it faces.',art:'goBILDAPinpoint'}];
  // The pods in the CAD as the chosen sensor's offsets (robot inches from the robot's centre, as goBILDA's setOffsets takes
  // them). Returns what it set, or '' when the CAD shows no pods for it.
  function podsToOdometry(){const v=project.sensors.localization;if(!['fused','odometry','odometry3'].includes(v)||!model?.holder)return '';let pods=[];try{pods=joints.podsFromCad();}catch{}
    const X=pods.filter(p=>p.forward).sort((a,b)=>b.y-a.y),Y=pods.filter(p=>!p.forward),f=n=>`${n>=0?'':'−'}${Math.abs(n).toFixed(2)}`;if(!X.length||!Y.length)return '';
    setOdometry(o=>{if(v==='fused'){o.pinpoint.xOffset=X[0].y;o.pinpoint.yOffset=Y[0].x;}else if(v==='odometry'){o.pods.par={...o.pods.par,x:X[0].x,y:X[0].y};o.pods.perp={...o.pods.perp,x:Y[0].x,y:Y[0].y};}
      else{o.pods.par_left={...o.pods.par_left,x:X[0].x,y:X[0].y};if(X[1])o.pods.par_right={...o.pods.par_right,x:X[1].x,y:X[1].y};o.pods.perp={...o.pods.perp,x:Y[0].x,y:Y[0].y};}});
    return v==='fused'?`From your CAD: the X pod is ${f(X[0].y)} in left of centre, the Y pod ${f(Y[0].x)} in forward.`:`From your CAD: ${X.length+Y.length} pods placed.`;}
  function openChassisAdd(){let d=$('#mech-add-chassis');if(!d){d=document.createElement('dialog');d.id='mech-add-chassis';d.className='sim-add-dialog';d.setAttribute('aria-labelledby','mech-add-chassis-title');
      const art=tag=>{const a=globalThis.DeckDeviceArt;return tag?`<span class="ce-fig sim-pick-fig" data-fig="${tag}">${a?a.svg(tag,{title:false}):''}</span>`:'';};
      d.innerHTML=`<div class="sim-add-dialog-head"><button type="button" class="text-button" data-add-back hidden>← Back</button><h2 id="mech-add-chassis-title">Add to Chassis</h2><button type="button" class="icon-button" data-dialog-close aria-label="Close">×</button></div>
        <div class="sim-add-kinds sim-pick-cards" data-add-kinds>${CHASSIS_KINDS.map(k=>`<button type="button" class="sim-pick-card" data-add-kind="${k.id}">${art(k.art)}<b>${escText(k.name)}</b><small>${escText(k.blurb)}</small></button>`).join('')}</div>
        <div data-add-step="odometry" hidden><div class="sim-add-dialog-body" data-dialog-body></div><p class="hint sim-add-cad" data-add-said role="status"></p><p class="hint">Offsets are from the robot’s centre, not from the Pinpoint itself: it can sit anywhere.</p></div>
        <div class="button-row" data-add-done hidden><button type="button" class="primary" data-dialog-done>Done</button></div>`;
      $('[data-setup-page=mechanisms]').append(d);window.DeckPartPicker?.dress?.(d.querySelector('[data-add-kinds]'));
      const step=s=>{d.querySelector('[data-add-kinds]').hidden=!!s;d.querySelector('[data-add-step="odometry"]').hidden=s!=='odometry';d.querySelector('[data-add-done]').hidden=!s;d.querySelector('[data-add-back]').hidden=!s;d.querySelector('h2').textContent=s?CHASSIS_KINDS.find(k=>k.id===s).name:'Add to Chassis';};openChassisAdd.step=step;
      d.addEventListener('click',e=>{if(e.target.closest('[data-dialog-close],[data-dialog-done]'))return d.close(e.target.closest('[data-dialog-done]')?'done':'');if(e.target.closest('[data-add-back]'))return step(null);
        const k=e.target.closest('[data-add-kind]');if(k?.dataset.addKind==='controller'){garagePick='chassis:controller';return d.close('');}if(k){step(k.dataset.addKind);const said=podsToOdometry();d.querySelector('[data-add-said]').textContent=said;return;}
        // A position sensor picked: its pods from the CAD, once its own handler has set it.
        if(e.target.closest('#sim-sensor-cards [data-sensor-card]'))setTimeout(()=>{const said=podsToOdometry();d.querySelector('[data-add-said]').textContent=said||(model?.holder&&['fused','odometry','odometry3'].includes(project.sensors.localization)?'No pods found in your CAD: after Done, click each pod on the model.':'');},0);});
      d.addEventListener('close',()=>{const sec=$('#sim-ctl-sensors'),home=openChassisAdd.home;if(sec&&home?.parent)home.parent.insertBefore(sec,home.next&&home.next.parentNode===home.parent?home.next:null);
        const v=project.sensors.localization,first=SENSE_PLACING[v]?.[0],fromCad=/^From your CAD/.test(d.querySelector('[data-add-said]').textContent);
        if(d.returnValue==='done'&&['fused','optical','odometry','odometry3'].includes(v)){garagePick=`chassis:${v==='fused'?'pinpoint':v==='optical'?'otos':first}`;wheelPlacing=model?.holder&&first&&!fromCad?first:null;if(wheelPlacing){joints.warmWheels();status('#mech-model-help',`Click the ${wheelLabel(wheelPlacing).toLowerCase()} on the model.`);}}mechanismsPanel();});}
    const sec=$('#sim-ctl-sensors');if(!sec)return;openChassisAdd.home={parent:sec.parentNode,next:sec.nextSibling};d.querySelector('[data-dialog-body]').append(sec);$('#sim-odometry')?.setAttribute('open','');
    d.querySelector('[data-add-said]').textContent='';d.returnValue='';openChassisAdd.step(null);robotPanel();d.showModal();}
  // The pods to click one after the other once a sensor is added (and after one is placed).
  const SENSE_PLACING={fused:['pinpoint:x','pinpoint:y'],odometry:['pod:par','pod:perp'],odometry3:['pod:par_left','pod:par_right','pod:perp']};
  $('#mech-drive-ports').addEventListener('click',e=>{const b=e.target.closest('[data-chassis-sense]');if(!b)return;const v=b.dataset.chassisSense;chassisAdding=false;setLocalization(v);
    const first=SENSE_PLACING[v]?.[0],card=v==='fused'?'pinpoint':v==='optical'?'otos':first?.replace('pod:','pod:');
    if(card)garagePick=`chassis:${v==='fused'?'pinpoint':v==='optical'?'otos':first}`;wheelPlacing=model?.holder&&first?first:null;if(wheelPlacing)joints.warmWheels();
    wheelsSaid=v==='encoders'?'Taken off: the robot counts its drive wheels and reads the IMU.':`${CHASSIS_SENSE.find(([k])=>k===v)?.[1]} added to the chassis.${wheelPlacing?` Click the ${wheelLabel(wheelPlacing).toLowerCase()} on the model.`:''}`;
    status('#mech-model-help',wheelPlacing?`Click the ${wheelLabel(wheelPlacing).toLowerCase()} on the model.`:'');mechanismsPanel();});
  // With every wheel placed: how far the wheels' middle is from the robot's centre. On a kiwi or a swerve it turns about
  // that middle, so more than half an inch off is worth a look (the CAD placed off centre, or a wheel clicked wrong).
  function wheelCentre(){const keys=wheelKeys(),pos=project.robot.wheelPos||{};if(keys.length<2||!keys.every(k=>pos[k]))return '';const x=keys.reduce((a,k)=>a+pos[k].x,0)/keys.length,y=keys.reduce((a,k)=>a+pos[k].y,0)/keys.length,d=Math.hypot(x,y);
    return `<p class="${d>.5?'cal-sense-note bad':'hint'}" data-wheel-centre>${d>.5?`The wheels’ middle is ${x.toFixed(2)} in forward and ${y.toFixed(2)} in left of the robot’s centre: check the CAD’s placement in step 2, or a wheel clicked on the wrong part.`:`The wheels’ middle is on the robot’s centre (${d.toFixed(2)} in off).`}</p>`;}
  $('#mech-drive-ports').addEventListener('click',e=>{if(e.target.closest('[data-wheels-find]'))return void findWheels();const b=e.target.closest('[data-wheel-place]');if(!b)return;const k=b.dataset.wheelPlace;
    wheelPlacing=wheelPlacing===k?null:k;mechPlacing=null;if(wheelPlacing)joints.warmWheels();status('#mech-model-help',wheelPlacing?`Click the ${wheelLabel(k).toLowerCase()} on the model, anywhere on it. Drag to turn the view.`:'');mechanismsPanel();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&wheelPlacing){wheelPlacing=null;status('#mech-model-help','');mechanismsPanel();}});
  // A drive motor's Encoder tick: its own encoder (a motor-encoder sensor on it), which Calibrate → Electronics checks against Configure.
  $('#mech-drive-ports').addEventListener('change',e=>{const t=e.target.closest('[data-wire-encoder]');if(!t)return;e.stopPropagation();const W=window.DeckWiring,H=window.DeckHardware,st=W.state(project),row=st.rows.find(r=>r.key===t.dataset.wireEncoder);if(!row)return;
    const w=H.wiringOf({wiring:project.robot.wiring}),own=w.sensors.find(s=>s.for===row.key&&s.model==='motor-encoder');applyWiring(t.checked?(own?H.sanitizeWiring(w):W.addSensor(w,row,'motor-encoder')):own?W.removeSensor(w,own.id):H.sanitizeWiring(w));},true);
  $('#mech-drive-ports').addEventListener('change',e=>{const t=e.target.closest('[data-wheel-pos],[data-pod-pos],[data-pinpoint-pos]');if(!t)return;const axis=t.dataset.wheelAxis,v=parseFloat(t.value);
    if(t.dataset.podPos)return setOdometry(o=>{if(Number.isFinite(v))o.pods[t.dataset.podPos][axis]=v;});
    if(t.dataset.pinpointPos)return setOdometry(o=>{if(Number.isFinite(v))o.pinpoint[t.dataset.pinpointPos]=v;});
    const k=t.dataset.wheelPos,was=project.robot.wheelPos?.[k]||{x:0,y:0};
    const pos={...project.robot.wheelPos};if(!Number.isFinite(v)){delete pos[k];}else pos[k]={x:axis==='x'?v:was.x,y:axis==='y'?v:was.y};setWheelPos(pos);});
  $('#mech-chassis').addEventListener('change',e=>{const key=e.target.dataset?.chassisName;if(!key)return;const name=C.deviceName(e.target.value);if(!name){e.target.value=window.DeckWiring.state(project).rows.find(r=>r.key===key)?.name||'';return;}
    deviceName(key,name);save();e.target.blur();robotPanel();mechanismsPanel();reload();});
  $('#mech-chassis-edit').onchange=e=>{chassisEdit=e.target.checked;presetPanel();mechanismsPanel();};
  // The motors and servos the mechanisms use, against FTC's limit (BIOBUZZ R503: 8 motors and 8 servos, the drivetrain's
  // motors included; a linear servo counts as a servo).
  function mechCount(intakes,shooters){
    let motors=0,servos=0;const add=kind=>{if(kind==='motor'||kind==='dcmotor')motors++;else if(['servo','crservo','linear','pusher','gate'].includes(kind))servos++;};
    for(const i of intakes){if(i.kind!=='kicker'){add(i.device==='crservo'?'crservo':'motor');if(i.motor2)add(i.device==='crservo'?'crservo':'motor');}if(MECH.deploys(i.kind))add('servo');for(const x of i.more||[])add(x.device);}
    shooters.forEach((s,n)=>{add('motor');if(s.motor2)add('motor');add(s.indexerKind);if(s.hood)add('servo');if(s.type==='turret'&&!(n===1&&shooters[1]?.sharesTurret))add(project.mechanisms.turret.kind==='motor'?'motor':'servo');});
    for(const a of project.kinematics.actuators){add(a.kind);for(const x of window.DeckKinematics.extraDevices(a))add(a.kind);}
    // A motor or servo two mechanisms share (belted together: one name in the configuration) is one.
    if(project.controller==='ftc'){const rows=window.DeckWiring.state(project).rows.filter(r=>!['pod','sensor','imu','drive','steer'].includes(r.role)),extra=family=>{const seen=new Set();let n=0;for(const r of rows.filter(r=>r.family===family))if(seen.has(r.name))n++;else seen.add(r.name);return n;};motors-=extra('motor');servos-=extra('servo');}
    if(project.mechanisms.enabled)for(const o of project.mechanisms.others)add(o.kind);
    // Two servos on one gear are two.
    if(project.controller==='ftc'&&project.mechanisms.enabled){const seen=new Set();for(const r of window.DeckWiring.state(project).rows){const n=project.mechanisms.power[r.key]?.count||1;if(n<2||seen.has(r.name))continue;seen.add(r.name);if(r.family==='motor')motors+=n-1;else if(r.family==='servo')servos+=n-1;}}
    // The drivetrain's own motors (a swerve module's steering is counted by the team: a servo or a motor each).
    // What the CAD does not show is not counted as on the robot until the team picks it.
    const unsure=project.controller==='ftc'&&project.mechanisms.enabled?window.DeckWiring.state(project).rows.filter(r=>project.mechanisms.guessed.includes(r.key)&&!r.model):[],sure=(family,n)=>n-new Set(unsure.filter(r=>r.family===family).map(r=>r.name)).size;motors=sure('motor',motors);servos=sure('servo',servos);
    const d=project.robot.drivetrain,drive={tank2:2,kiwi:3,kiwiSwerve:3,diffSwerve:8}[d]??4,steer=['swerve','coaxSwerve','kiwiSwerve'].includes(d)?' plus its steering':'',all=motors+drive;
    const el=$('#mech-count');el.textContent=motors+servos+unsure.length?`Your robot uses ${all} motors (${drive} to drive${steer}, ${motors} in mechanisms) and ${servos} servo${servos===1?'':'s'}. FTC allows 8 motors and 8 servos (BIOBUZZ rule R503)${all>8||servos>8?`: this is ${[all>8?`${all-8} motor${all-8===1?'':'s'}`:'',servos>8?`${servos-8} servo${servos-8===1?'':'s'}`:''].filter(Boolean).join(' and ')} too many`:''}.${unsure.length?` Your CAD does not show what powers ${unsure.map(r=>r.label.replace(/^[A-Z](?![A-Z])/,c=>c.toLowerCase())).join(', ')}: pick a motor or servo for each.`:''}`:'';
    el.classList.toggle('over',servos>8||all>8);}
  // The robot model with each part marked; "Place on model" picks a part's position by clicking it.
  function mechModel(){
    const game=L().field==='biobuzz',show=!!model?.holder&&setupStep==='mechanisms';$('#mech-model-box').hidden=!show;
    if(!show){mechPreview?.pick(null);joints.hide();return;}
    if(!mechPreview)mechPreview=M().preview($('#mech-model-preview'));
    // The model is fitted to the chassis (not the intakes), so parts are placed from the chassis edges.
    const f=chassisFootprint(),m=game&&project.mechanisms.enabled?project.mechanisms:{intakes:[],shooters:[]},r=project.robot,cx=(f.front-f.rear)/2,hl=r.length/2,hw=r.width/2,h=(model.holder.userData.size?.height||12)*.7;
    mechPreview.update(mechRig(),chassisFootprint());
    // Intakes: see-through green boxes at their real size. Shooters: dots (yellow pollen, red nectar, orange both).
    const normal={front:[1,0],back:[-1,0],left:[0,1],right:[0,-1]},marks=[],colors={pollen:0xf2d14b,nectar:0xe5484d,both:0xf2994a};
    for(const i of m.intakes)if(i.pickup==='rollers'&&i.column)marks.push({from:[i.column.a[0]+cx,i.column.a[1],i.column.a[2]],to:[i.column.b[0]+cx,i.column.b[1],i.column.b[2]],radius:i.column.d/2,color:0x49cbb3});
    for(const i of m.intakes.filter(i=>!(i.pickup==='rollers'&&i.column)))for(const e of i.sides){const [nx,ny]=normal[e],dist=nx?hl:hw,edgeLen=nx?r.width:r.length,depth=Math.max(i.reach,1),span=i.width??edgeLen,c=dist+i.reach-depth/2;
      marks.push({x:cx+nx*c,y:ny*c,z:i.height/2,size:nx?[depth,span,i.height]:[span,depth,i.height],color:0x49cbb3});}
    for(const s of m.shooters){const [fx,fy]=MECH.MOUNT_AT[s.mount],p=s.at||{x:cx+fx*(hl-3),y:fy*(hw-3),z:h};marks.push({...p,z:p.z??h,color:colors[s.pieces],radius:1.4});}
    $('#mech-model-key').replaceChildren(...[...m.intakes.map((i,n)=>[0x49cbb3,`Intake ${n+1}`,`${MECH.INTAKES[i.kind]} on the ${i.sides.join(' + ')}: ${i.pickup==='rollers'&&i.column?'it picks up where a piece touches the rollers (the cylinder)':'the box is where it picks up'}`]),
      ...m.shooters.map((s,n)=>[colors[s.pieces],`Shooter ${n+1}`,`${s.type==='turret'?'turret':'fixed shooter'} at the ${MECH.MOUNTS[s.mount].toLowerCase()}, shoots ${MECH.PIECES[s.pieces].toLowerCase()}`])]
      .map(([color,name,text])=>{const li=document.createElement('li'),dot=document.createElement('i'),b=document.createElement('b');dot.style.background='#'+color.toString(16).padStart(6,'0');b.textContent=name;li.append(dot,b,' · '+text);return li;}));
    mechPreview.markers(marks);
    $('#mech-model-help').hidden=!game;
    const pickColumn=point=>{if(!point)return;const [,k,end]=mechPlacing.split(':'),n=+k,axle=joints.rollerColumn(n),i=project.mechanisms.intakes[n];if(!i)return;let p=[point.x-cx,point.y,point.z];
      if(axle){const d=axle.b.map((x,j)=>x-axle.a[j]),L=d[0]*d[0]+d[1]*d[1]+d[2]*d[2],t=L>0?((p[0]-axle.a[0])*d[0]+(p[1]-axle.a[1])*d[1]+(p[2]-axle.a[2])*d[2])/L:0;p=axle.a.map((x,j)=>x+t*d[j]);}
      p=p.map(x=>+x.toFixed(2));const d=i.column?.d??axle?.d??2;
      if(end==='a'){mechPlacing=`column:${n}:b`;setMech(m=>{m.intakes[n].column={a:p,b:p,d,by:'hand'};});status('#mech-model-help','Now click the other end wheel.');return;}
      mechPlacing=null;setMech(m=>{const c=m.intakes[n].column;m.intakes[n].column={a:c?.a||p,b:p,d,by:'hand'};m.intakes[n].pickup='rollers';});status('#mech-model-help',`Intake ${n+1} picks up only where a piece touches its rollers.`);};
    mechPreview.pick(wheelPlacing?placeWheel:mechPlacing?.startsWith('column:')?pickColumn:mechPlacing?point=>{if(!point)return;const [kind,n]=mechPlacing.split(':'),loc=MECH.locate({x:point.x-cx,y:point.y},2*hl,2*hw);mechPlacing=null;
      setMech(m=>{const part=m[kind==='intake'?'intakes':'shooters'][+n];if(!part)return;
        if(kind==='intake'){if(m.intakes.some((o,k)=>k!==+n&&o.sides.includes(loc.edge)))return status('#mech-model-help',`Another intake already covers the ${loc.edge}.`);part.sides=[loc.edge];part.at=point;status('#mech-model-help',`Intake ${+n+1}: ${loc.edge} of the robot.`);}
        else{part.mount=loc.mount;part.at=point;status('#mech-model-help',`Shooter ${+n+1}: ${MECH.MOUNTS[loc.mount].toLowerCase()} of the robot.`);}});}:joints.picker(),wheelPlacing?{hover:hoverWheel}:{});
    joints.render();mechGlow();
  }
  // ---- each mechanism's hardware (ui/sim-wiring.js) and what it is on the model ---------------------------------------
  // Every motor and servo on a mechanism. The CAD is every part's zero: encoders count from it, a servo's center holds it.
  // More motors and servos on one intake: each its own row (port, model, name), run with the intake's own. A motor or a
  // continuous servo is another roller; a servo moves with the kicker or ramp.
  function moreRow(r){const k=window.DeckHardware.parseKey(r.key);if(!k||!/^more[0-9]$/.test(k.field))return '';const e=+k.field.slice(4),x=project.mechanisms.intakes[k.index]?.more?.[e];if(!x)return '';const at=`${k.index}:${e}`;
    return `<div class="sim-more-row">${x.device==='servo'?'':`<label class="check"><input type="checkbox" data-intake-more-rev="${at}"${x.reversed?' checked':''}> Turns the other way</label>`}<button type="button" class="secondary sim-second" data-intake-more-off="${at}">Remove this ${x.device==='motor'?'motor':'servo'}</button></div>`;}
  function moreButtons(n,kind){const i=project.mechanisms.intakes[n];if(!i)return '';const full=(i.more||[]).length>=MECH.MORE_MAX,b=(what,label)=>`<button type="button" class="secondary sim-second" data-intake-more-add="${n}:${what}"${full?' disabled':''}>${label}</button>`;
    const rollers=kind!=='intakeRamp'&&i.kind!=='kicker',swing=kind==='intakeRamp'||kind==='intake'&&i.kind==='kicker';
    return `<div class="sim-more-add">${rollers?b('motor','+ Add a motor')+b('crservo','+ Add a servo'):''}${swing?b('servo',`+ Add a servo on the ${i.kind}`):''}<span class="hint">${full?`Up to ${MECH.MORE_MAX} more on one intake.`:rollers?'Each one runs with the rollers: a motor, or a continuous servo.':`It moves with the ${i.kind}’s own servo.`}</span></div>`;}
  function wireBlocks(){
    // Whether a Control Hub is there is looked for now and then while these cards are shown, so one plugged in unlocks Plugged into.
    if(project.controller==='ftc'&&Date.now()-(wireBlocks.looked||0)>15000){wireBlocks.looked=Date.now();void detectLink();}
    hubDefaults();const W=window.DeckWiring,ftc=project.controller==='ftc',st=ftc?W.state(project):null,focus=document.activeElement?.id;
    for(const box of $$('[data-wire-for]')){box.hidden=!ftc;if(!ftc){box.innerHTML='';box.dataset.html='';continue;}
      const [kind,id]=box.dataset.wireFor.split(':'),part={intakeRamp:'ramp',intakeRoller:'roller'}[kind],seen=new Set(),rows=st.rows.filter(r=>r.role!=='sensor'&&(kind==='feeder'?r.role==='feeder'&&!seen.has(r.name)&&seen.add(r.name):kind==='turret'?r.role==='turret':kind==='kin'?/^kin\./.test(r.key)&&r.joints?.includes(id):part?r.key.startsWith(`intakes.${id}.`)&&r.role===part:kind==='shooter'?r.key.startsWith(`shooters.${id}.`)&&!['feeder','turret'].includes(r.role):r.key.startsWith(`${kind}s.${id}.`)));
      const read=null,second=r=>{const k=window.DeckHardware.parseKey(r.key),word=project.mechanisms.turret.kind==='motor'?'motor':'servo';return k?.field==='turretMotor'&&!project.mechanisms.shooters[k.index]?.turretMotor2?`<button type="button" class="secondary sim-second" data-turret-second="${k.index}">+ Another ${word} on this gear train</button>`:k?.field==='turretMotor2'?`<button type="button" class="secondary sim-second" data-turret-second-off="${k.index}">Remove this ${word}</button>`:'';};
      const onIntake=['intake','intakeRoller','intakeRamp'].includes(kind);
      const html=rows.map(r=>W.mechRowHtml(kind==='feeder'?{...r,label:'Feeder'}:r,st,{read,model:kind!=='kin',ports:false})+(kind==='turret'?second(r):'')+(onIntake?moreRow(r):'')).join('')+(onIntake?moreButtons(+id,kind):'');
      if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;window.DeckPartPicker?.dress?.(box);}}
    {const box=$('#mech-drive-ports'),rows=ftc?st.rows.filter(r=>['drive','steer'].includes(r.role)):[],sense=ftc?st.rows.filter(r=>['pod','pinpoint','otos'].includes(r.role)):[],read=null,opts={placing:wheelPlacing,pick:!!model?.holder};
      // The wheels and modules, then what tells the robot where it is: each a part of the chassis, opened from its own tile under Chassis.
      const html=rows.length?`<div class="sim-chassis-find"><button type="button" class="text-button" data-wheels-find>Find every wheel in the CAD</button><span class="hint" data-wheels-said role="status">${W.esc(wheelsSaid)}</span></div>${W.chassisHtml(rows,st,read,opts)}${sense.length?W.senseHtml(sense,st,read,opts):''}${wheelCentre()}`:'';box.hidden=!html;if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;}drivePicker();}
    // The Control Hub's IMU: which I2C bus it is on.
    {const box=$('#mech-controller-imu'),html=ftc?W.imuHtml(st,null):'';if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;}}
    if(focus&&document.activeElement?.id!==focus)document.getElementById(focus)?.focus();}
  // What is being edited (a device or sensor row, a game part intake:N / shooter:N, or kin:<joint id>) glows on the
  // preview: on a click, focus or open in its card, or when its card scrolls to the middle of the page.
  let mechFocus=null,glowFrame=0;
  function mechGlow(){
    if(!mechPreview||joints.opened?.())return;const g=model?.geometry,ok=g&&!g.isObject3D&&g.userData?.parts&&project.kinematics.model===project.model?.id;let set=null;
    if(mechFocus&&ok){model.partIdx??=window.DeckKinematics.partIndex(g.userData.parts);set=model.partIdx.expand([...new Set([mechFocus].flat().flatMap(t=>window.DeckWiring.focusRefs(project,t)))]);}
    mechPreview.highlight(set?.size?set:null,0xffb224);}
  // target: one part, or a list (a parent tile lights itself and every part under it).
  function focusMech(target){if(!target||(Array.isArray(target)?!target.length:false)||JSON.stringify(target)===JSON.stringify(mechFocus))return;mechFocus=target;cancelAnimationFrame(glowFrame);glowFrame=requestAnimationFrame(mechGlow);}
  const focusOf=el=>el?.closest?.('[data-wire-row]')?.dataset.wireRow||el?.closest?.('[data-part]')?.dataset.part||(el?.closest?.('[data-mech]')?`kin:${el.closest('[data-mech]').dataset.mech}`:null);
  let mechCards=null;
  function observeMechCards(){
    if(typeof IntersectionObserver!=='function')return;mechCards?.disconnect();
    mechCards=new IntersectionObserver(list=>{if(setupStep!=='mechanisms'||document.activeElement?.closest?.('.sim-mech-main [data-part],.sim-mech-main [data-mech],#mech-feeder,#mech-turret'))return;
      const top=list.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(top)focusMech(focusOf(top.target));},{rootMargin:'-30% 0px -50% 0px'});
    for(const card of $$('.sim-mech-main [data-part],.sim-mech-main [data-mech],#mech-feeder [data-wire-row],#mech-turret [data-wire-row]'))mechCards.observe(card);}
  for(const host of ['#mech-intakes','#mech-feeder','#mech-shooters','#mech-turret','#mech-parts']){const box=$(host);
    window.DeckWiring.bind(box,{project:()=>project,apply:applyWiring,setKind:deviceKind,share:shareDevice,setRpm:deviceRpm,assign:deviceAssign});
    for(const type of ['focusin','pointerdown'])box.addEventListener(type,e=>focusMech(focusOf(e.target)));
    box.addEventListener('toggle',e=>{if(e.target.open)focusMech(focusOf(e.target));},true);}
  // Every leaf of the CAD with its name, its node's key and its box, for DeckHardware.driveTrain (belts, chains and gears).
  function cadLeaves(idx){
    const g=model?.geometry,pos=g?.attributes?.position?.array,part=g?.attributes?._part?.array;if(!pos||!part)return [];
    const boxes=[];for(let v=0;v<part.length;v++){const k=part[v];let b=boxes[k];if(!b)b=boxes[k]=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let a=0;a<3;a++){const x=pos[v*3+a];if(x<b[a])b[a]=x;if(x>b[a+3])b[a+3]=x;}}
    const out=[];for(const n of idx.nodes)for(const leaf of n.leaves)if(boxes[leaf])out.push({ref:'#'+leaf,key:n.key,name:n.name,box:boxes[leaf]});return out;}
  // A turret's gears from the CAD, servo side first, where their names give their teeth: the gear on the servo, the pinion it
  // meshes with, the gear on the pinion's shaft, and the turret's own gear from how much faster that shaft turns than the turret.
  function gearsFromCad(id,idx){const J=project.kinematics.joints,gears=J.filter(j=>String(j.id).startsWith(id+'gear'));if(gears.length<2)return null;
    const nameOf=r=>String(r).startsWith('#')?idx.nodes.find(n=>n.leaves?.includes(+String(r).slice(1)))?.name||'':idx.nodes.find(n=>n.key===r)?.name||'',teeth=n=>{const t=/(\d+)\s*t(?:\s|$)|\((\d+)\s*teeth\)|^(\d+)\s+pinion/i.exec(n);return t?+(t[1]||t[2]||t[3]):0;},pick=(j,re)=>(j.parts||[]).map(nameOf).filter(n=>re.test(n)).map(teeth).find(Boolean)||0;
    const shaft=project.kinematics.couplings.find(c=>c.from===id&&String(c.to).startsWith(id+'gear')),near=J.find(j=>j.id===shaft?.to),servo=gears.filter(j=>j!==near).map(j=>pick(j,/gear/i)).find(Boolean),pinion=near&&pick(near,/pinion/i),spur=near&&pick(near,/^(?!.*pinion).*(spur|gear)/i);if(!servo||!pinion||!spur||!finiteRatio(shaft?.ratio))return null;
    return [[servo,pinion],[spur,Math.round(spur*Math.abs(shaft.ratio))]];}
  const finiteRatio=r=>finite(r)&&r!==0;
  // Motors and servos named in the CAD (goBILDA, REV, Axon... part numbers and names): each goes to the mechanism it sits
  // in (DeckHardware.assignCad), setting that device's type and model. Drive motors all take the model found on one.
  function actuatorsFromCad(){
    const H=window.DeckHardware,W=window.DeckWiring,tree=model?.geometry?.userData?.parts;if(!tree||project.controller!=='ftc')return [];
    const idx=window.DeckKinematics.partIndex(tree),parts=[],clean=n=>String(n).replace(/\s*<\d+>$/,'');
    const inner=n=>{for(const c of n.children){const m=H.fromCadName(c.name);if(m?.model)return m;const d=inner(c);if(d)return d;}return null;};
    const visit=(n,path)=>{const m=H.fromCadName(n.name);if(m){const d=m.model?null:inner(n);parts.push({name:clean(n.name),key:n.key,path,...m,...(d&&(d.kind===m.kind||m.kind==='servo'&&d.kind==='crservo')?{kind:d.kind,model:d.model}:{})});return;}for(const c of n.children)visit(c,[...path,n.name]);};
    for(const n of idx.nodes.filter(n=>n.parent<0||!idx.nodes[n.parent]))visit(n,[]);
    if(!parts.length){project.mechanisms=MECH.sanitize({...project.mechanisms,others:[],power:{},traced:1,guessed:W.state(project).rows.filter(r=>(r.family==='motor'||r.family==='servo')&&!['pod','sensor','imu','drive','steer'].includes(r.role)).map(r=>r.key)});return [];}
    // A shooter whose hood the CAD shows moving gets its hood servo, so the hood's servo in the CAD has a device to go to.
    if(project.mechanisms.enabled&&project.mechanisms.shooters.some((s,i)=>!s.hood&&project.kinematics.joints.some(j=>j.drive?.signal==='hood'&&j.drive.of===`shooter:${i}`))){
      const m=structuredClone(project.mechanisms);m.shooters.forEach((s,i)=>{if(!s.hood&&project.kinematics.joints.some(j=>j.drive?.signal==='hood'&&j.drive.of===`shooter:${i}`))s.hood=i?`hood${i+1}`:'hood';});project.mechanisms=MECH.sanitize(m);}
    const st=W.state(project),chassis=(project.model?.parts||[]).filter(p=>p.role==='chassis'&&p.key).map(p=>p.key);
    const partOf=key=>{const k=H.parseKey(key);return k?.list?`${k.list==='intakes'?'intake':'shooter'}:${k.index}`:k?.kin?`kin:${project.kinematics.actuators.find(a=>a.id===k.kin)?.joint}`:null;};
    const devices=st.rows.filter(r=>(r.family==='motor'||r.family==='servo')&&!['pod','sensor','imu'].includes(r.role)&&!/turretMotor2$/.test(r.key))
      .map(r=>({key:r.key,role:r.role,family:r.family,scope:r.role==='drive'||r.role==='steer'?chassis:W.focusRefs(project,partOf(r.key)||r.key),own:W.focusRefs(project,r.key)}));
    const found=H.assignCad(parts,devices),drive=found.find(f=>st.rows.find(r=>r.key===f.key)?.role==='drive'&&f.model);
    for(const r of st.rows.filter(r=>r.role==='drive'))if(drive&&!found.some(f=>f.key===r.key))found.push({...drive,key:r.key});
    // A mechanism with no motor or servo of its own in the CAD: its pulleys and gears are followed through belts, chains and
    // shafts to the one that turns it ("Motor Part" in the chassis drives the intake through two belts). Two mechanisms
    // that reach one motor share it: one name in the configuration, counted once against the game's limit.
    const train=H.driveTrain(cadLeaves(idx)),roleOf=key=>st.rows.find(r=>r.key===key)?.role,familyOf=key=>st.rows.find(r=>r.key===key)?.family,familyOfKey=familyOf;
    const fits=(d,a)=>(d.family==='motor'?['dcmotor','crservo']:['servo','linear','crservo']).includes(a.kind);
    // The transmission first: from each moving part, through the gears geared to it, to the motors and servos on it. This is
    // the CAD's geometry, whatever its assemblies are called, so it replaces what the names said.
    const J=project.kinematics.joints,geared=ids=>{const set=ids.map(id=>J.find(j=>j.id===id)).filter(Boolean);for(let i=0;i<set.length;i++)for(const c of project.kinematics.couplings){const o=c.from===set[i].id?c.to:c.to===set[i].id?c.from:null,n=J.find(j=>j.id===o);if(n&&!set.includes(n))set.push(n);}for(const j of J)if(set[0]?.drive?.signal==='turret'&&String(j.id).startsWith(set[0].id+'gear')&&!set.includes(j))set.push(j);return set;};
    const carried=new Set((project.model?.parts||[]).map(p=>p.key).filter(Boolean)),ownRefs=set=>set.flatMap(j=>j.parts||[]).filter(r=>!carried.has(r)),can=(role,a)=>{const k=H.ROLES[role]?.kinds||[];return !k.length||k.includes(a.kind)||a.kind==='servo'&&k.includes('crservo');};
    // What a part shown as this device turns: what sits around the joint's axis. A strut holding a plate up may have been
    // taken into a joint because it touches it, but it does not turn with it, so it is not lit up with it.
    const leaves=cadLeaves(idx),aroundAxis=(j,box)=>{if(!Array.isArray(j.axis)||!Array.isArray(j.origin))return true;const c=[0,1,2].map(k=>(box[k]+box[k+3])/2-j.origin[k]),along=c[0]*j.axis[0]+c[1]*j.axis[1]+c[2]*j.axis[2],off=Math.hypot(...c.map((v,k)=>v-along*j.axis[k])),size=Math.max(...[0,1,2].map(k=>box[k+3]-box[k]));return off<=.2*size+.2;};
    const turning=set=>set.flatMap(j=>(j.parts||[]).filter(r=>!carried.has(r)&&leaves.some(l=>(l.ref===r||l.key===r||String(l.key).startsWith(r+'/'))&&aroundAxis(j,l.box))));
    const feederJoints=J.filter(j=>j.drive?.signal==='feeder'),feeders=feederJoints.map(j=>{const res=H.powerOf(train,geared([j.id]),ownRefs(geared([j.id])),a=>can('feeder',a));return {id:j.id,origin:j.origin,power:res?res.actuators.map(a=>a.id).join('+'):'none'};});
    const fed=H.feedersByShooter(feeders,project.mechanisms.shooters.map((s,n)=>J.find(j=>j.drive?.signal==='flywheel'&&j.drive.of===`shooter:${n}`)?.origin||null));
    for(const d of devices){if(['drive','steer'].includes(d.role))continue;const row=st.rows.find(r=>r.key===d.key),k=H.parseKey(d.key),ids=d.role==='feeder'&&k?.list==='shooters'&&fed[k.index]?.length?fed[k.index]:row?.joints||[];if(!ids.length)continue;
      const set=geared(ids),res=H.powerOf(train,set,ownRefs(set),a=>can(d.role,a));if(!res)continue;const a=res.actuators[0],n=res.actuators.length,where=String(a.key).split('/').slice(-2,-1)[0]||'your robot',at=found.findIndex(f=>f.key===d.key);if(at>=0)found.splice(at,1);
      const route=n>1?`${n} of them on one gear train`:res.how==='axis'?'on its axis':res.belts?`through ${res.belts} belt${res.belts===1?'':'s'} or chain${res.belts===1?'':'s'}`:'through its gears';
      found.push({key:d.key,part:a.name,ref:a.key,kind:a.kind,model:a.model,ids:res.actuators.map(x=>x.id),count:n,spins:set[0]?.type==='continuous',refs:[...new Set([...res.actuators.flatMap(x=>x.refs||[]),...res.refs,...turning(set)])],from:`“${clean(a.name)}” in “${clean(where)}”, ${route}${res.sure?'':' (its gears are spaced apart in the CAD: check this one)'}`});}
    // A mechanism belted to a motor another one is named on is chained to it too: they share it.
    const byActuator=new Map(),shares=[];for(const f of found)if(!['drive','steer'].includes(roleOf(f.key)))for(const a of train.actuators)if((f.ids?f.ids.includes(a.id):a.key===f.ref)){if(!byActuator.has(a.id))byActuator.set(a.id,f.key);else if(f.ids&&byActuator.get(a.id)!==f.key&&familyOfKey(byActuator.get(a.id))===familyOfKey(f.key)&&!shares.some(s=>s[0]===f.key))shares.push([f.key,byActuator.get(a.id)]);}
    for(const d of devices){if(found.some(f=>f.key===d.key)||['drive','steer'].includes(d.role))continue;const can=a=>fits(d,a)&&(!byActuator.has(a.id)||familyOf(byActuator.get(a.id))===d.family);
      const hit=(d.own.length?H.chainOf(train,d.own,can):null)||H.chainOf(train,d.scope,can);if(!hit)continue;
      const a=hit.actuator,where=String(a.key).split('/').slice(-2,-1)[0]||'your robot',mate=byActuator.get(a.id);if(mate)shares.push([d.key,mate]);else byActuator.set(a.id,d.key);
      found.push({key:d.key,part:a.name,ref:a.key,kind:a.kind,model:a.model,from:`“${clean(a.name)}” in “${clean(where)}”, through ${hit.belts} belt${hit.belts===1?'':'s'} or chain${hit.belts===1?'':'s'}`});}
    // A passive funnel: the CAD has no feeder wheels and nothing turns a shooter's feeder, so the intake's rollers push the
    // pieces up through it. The feeder then runs on the intake's motor: no feeder motor the robot does not have.
    if(!feederJoints.length){const roller=found.find(f=>roleOf(f.key)==='roller'&&familyOf(f.key)==='motor');
      if(roller)for(const d of devices)if(d.role==='feeder'&&d.family==='motor'&&!found.some(f=>f.key===d.key)&&!shares.some(s=>s[0]===d.key))shares.push([d.key,roller.key,'passive']);}
    const m=structuredClone(project.mechanisms),said=[];let wiring=project.robot.wiring;
    for(const f of found){const row=st.rows.find(r=>r.key===f.key),k=H.parseKey(f.key),part=k?.list?m[k.list]?.[k.index]:null;if(!row)continue;
      // An Axon MINI on swerve steering, which turns on past a servo's range through its gears, runs in continuous mode; its
      // feedback wire (the Axon's absolute encoder) then tells where it is.
      if(f.model==='axon-mini'&&row.role==='steer'&&H.ROLES[row.role].kinds.includes('crservo'))Object.assign(f,{kind:'crservo',model:'axon-mini-cr'});
      // A servo that keeps turning rollers around runs in continuous mode.
      if(f.kind==='servo'&&f.spins&&['roller','feeder'].includes(row.role)){const twin=`${f.model}-cr`;Object.assign(f,{kind:'crservo',model:H.MODELS[twin]?twin:null});}
      if(part&&row.role==='roller')part.device=f.kind==='crservo'?'crservo':'motor';
      if(part&&row.role==='feeder')part.indexerKind=f.kind==='dcmotor'?'motor':f.kind==='crservo'?'crservo':['pusher','gate'].includes(part.indexerKind)?part.indexerKind:'pusher';
      if(row.role==='turret'){m.turret.kind=f.kind==='dcmotor'?'motor':f.kind==='crservo'?'crservo':'servo';if(part&&k.field==='turretMotor'){if(f.count>1)part.turretMotor2=part.turretMotor2||`${part.turretMotor}b`.slice(0,40);else delete part.turretMotor2;}const g=gearsFromCad(row.joints?.[0],idx);if(g){m.turret.gears=g;if(m.turret.kind==='servo')m.turret.servoDegrees=Math.max(10,(H.MODELS[f.model]?.range||300)/gearRatio(g));}}
      if(f.model)wiring=W.setModel(wiring,f.key,f.model);
      else{const had=H.MODELS[H.wiringOf({wiring}).devices?.[f.key]?.model];if(had&&had.kind!==f.kind)wiring=W.setModel(wiring,f.key,'');}
      if(f.model&&row.role==='turret'&&f.count>1)wiring=W.setModel(wiring,f.key+'2',f.model);
      wiring=W.setFrom(wiring,f.key,f.from||'');
      const feedback=f.model==='axon-mini-cr'&&Object.hasOwn(H.ROLES[row.role]?.sensors||{},'axonFeedback')&&!H.wiringOf({wiring}).sensors.some(s=>s.for===f.key&&H.SENSOR_MODELS[s.model]?.kind==='axonFeedback');
      if(feedback)wiring=W.addSensor(wiring,row,'axon-feedback');
      said.push(`${row.label}: ${f.model?H.MODELS[f.model].short:{dcmotor:'a motor',servo:'a servo',crservo:'a continuous servo',linear:'a linear servo'}[f.kind]} (${f.from?`driven by ${f.from}`:`“${f.part}”`})${feedback?', with its feedback wire as the absolute encoder':''}`);}
    for(const [key,mateKey,why] of shares){const row=st.rows.find(r=>r.key===key),mate=st.rows.find(r=>r.key===mateKey),k=H.parseKey(key),own=k?.list?m[k.list]?.[k.index]:null;if(!row||!mate)continue;
      const name=mate.name;if(own)own[k.field]=name;else if(k?.kin){const kin=structuredClone(project.kinematics),act=kin.actuators.find(x=>x.id===k.kin);if(act){act.device=name;project.kinematics=window.DeckKinematics.sanitize(kin);}}
      said.push(why==='passive'?`${row.label}: none in your CAD (a passive funnel), so it runs with ${mate.label.toLowerCase()} “${name}”: the rollers push pieces up to the shooter`:`${row.label} and ${mate.label.toLowerCase()} share one ${row.family==='servo'?'servo':'motor'} “${name}”: your CAD shows them belted together`);}
    spinFromCad(train,idx,found,m);
    m.guessed=devices.filter(d=>!['drive','steer'].includes(d.role)&&!found.some(f=>f.key===d.key)&&!shares.some(s=>s[0]===d.key)).map(d=>d.key);m.traced=1;
    m.power=Object.fromEntries(found.filter(f=>f.refs).map(f=>[f.key,{refs:f.refs,count:f.count}]));
    m.others=H.cadOthers(parts,found);for(const o of m.others)said.push(`“${o.name}”${o.in?` in “${o.in}”`:''}: counted on the robot, but the simulation does not run it`);
    project.mechanisms=MECH.sanitize(m);project.robot=C.robot({...project.robot,wiring},project.controller);modelSpeeds();return said;}
  // Whatever a motor turns through the CAD's belts, gears and shafts turns in the simulation too. A shaft with a roller, feeder or
  // flywheel on it gives that part its ratio to the motor; every other shaft follows it at its own speed (DeckHardware.spinPlan
  // stops at a differential). Rollers with their feeder's wheels right behind them run with the feeder, even on a motor of their
  // own: the wheels that take a piece from them have to be turning. Adds to found's refs, so choosing a device lights all it turns.
  let trainSaid=[];
  function spinFromCad(train,idx,found,m){
    const H=window.DeckHardware,K=window.DeckKinematics,kin=structuredClone(project.kinematics),cache=new Map(),leavesOf=j=>{if(!cache.has(j.id))cache.set(j.id,new Set([...idx.expand(j.parts)].map(k=>'#'+k)));return cache.get(j.id);},plans=H.spinPlan(train,kin.joints,leavesOf);
    const byId=new Map(kin.joints.map(j=>[j.id,j])),spins=j=>['roller','feeder','flywheel','wheel'].includes(j?.drive?.signal)||/gear[0-9]*$/.test(j?.id||''),owner=new Map();for(const j of K.order(kin))for(const r of leavesOf(j))owner.set(r,j.id);
    let added=0;trainSaid=[];
    for(const plan of plans){
      for(const p of plan.primaries){const j=byId.get(p.joint.id);j.ratio=+Math.abs(p.speed).toFixed(4);const more=p.extra.filter(r=>!spins(byId.get(owner.get(r))));if(more.length){j.parts=[...new Set([...j.parts,...more])];for(const r of more)owner.set(r,j.id);}}
      let n=0;for(const f of plan.followers){const lead=byId.get(f.of),own=f.refs.filter(r=>!spins(byId.get(owner.get(r))));if(!own.length||kin.joints.length>=96||kin.couplings.length>=96)continue;
        const votes=new Map();for(const r of own){const o=owner.get(r);if(o)votes.set(o,(votes.get(o)||0)+1);}const carrier=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];
        let id;do{n++;id=`${lead.id}gear${n}`;}while(byId.has(id));const same=f.axis===f.leadAxis,ratio=+(f.ratio*(same?1:Math.sign(lead.axis[f.leadAxis])||1)).toFixed(4),clean=String(f.names[0]).replace(/\s*<\d+>$/,'');
        const j={id,name:`${lead.name} gear ${n}`,type:'continuous',parent:carrier||lead.parent||null,parts:own,origin:f.origin,axis:same?lead.axis:[0,1,2].map(k=>k===f.axis?1:0),source:'inferred',confidence:.7,note:`“${clean}” turns with “${lead.name}” through the CAD’s belts and gears: ${Math.abs(ratio).toFixed(2)}× as fast${ratio<0?', the other way':''}.`};
        kin.joints.push(j);byId.set(id,j);kin.couplings.push({kind:'gear',from:lead.id,to:id,ratio,offset:0});for(const r of own)owner.set(r,id);added++;}}
    for(const f of found){const plan=plans.find(p=>f.ids?.includes(p.actuator.id));if(plan&&f.refs)f.refs=[...new Set([...f.refs,...plan.followers.flatMap(x=>x.refs)])];}
    if(added)trainSaid.push(`${added} shaft${added===1?'':'s'} and gear${added===1?'':'s'} follow their motors`);
    // How near counts as right behind: a sixth of the robot, a piece's width on an FTC robot.
    const near=Math.max(project.robot.length||18,project.robot.width||18)/6,line=(j,o,a)=>Math.hypot(...[0,1,2].filter(k=>k!==a).map(k=>o[k]-j.origin[k]));
    m.intakes.forEach((intake,n)=>{const rollers=kin.joints.filter(j=>j.drive?.signal==='roller'&&j.drive.of===`intake:${n}`),mainAxis=j=>j.axis.findIndex(v=>Math.abs(v)>.7);delete intake.withFeeder;
      const with_=plans.some(p=>{const feeds=p.primaries.some(x=>x.joint.drive.signal==='feeder');if(!feeds)return false;if(p.primaries.some(x=>rollers.includes(byId.get(x.joint.id))))return true;return p.followers.some(f=>f.rides>2&&rollers.some(r=>mainAxis(r)===f.axis&&line(r,f.origin,f.axis)<=near));});
      if(with_){intake.withFeeder=true;trainSaid.push(`intake ${n+1} runs with the feeder`);}});
    project.kinematics=K.sanitize(kin);}
  // Configure from CAD: each mechanism added is looked for in the CAD by the names most like it. The game's intakes and
  // shooters take the CAD's named intake and shooter assemblies (their side, size, spot and parts; what the team chose
  // stays); then every moving mechanism added without parts is looked for (DeckMechanismTypes.likeness) and its pivot,
  // rails or axle found, and what the CAD's shapes show is set too (a plate swinging down on a servo makes an intake a
  // ramp or a kicker, whatever its name says). The rest of the CAD's moving parts come with them.
  // The hubs and position sensor the CAD shows (a goBILDA Pinpoint and its two pods, an Expansion Hub, REV's Servo Hub)
  // are set in Robot controller. Its other sensors (a break beam, an absolute encoder) are listed with the mechanism they
  // sit in, for the team to put on a port. Returns what it found, as short phrases.
  function sensorsFromCad(){
    const tree=model?.geometry?.userData?.parts;if(!tree||project.controller!=='ftc')return null;
    const idx=window.DeckKinematics.partIndex(tree),pathOf=n=>{const out=[];for(let p=idx.nodes[n.parent];p;p=idx.nodes[p.parent])out.unshift(p.name);return out;};
    const H=window.DeckHardware,W=window.DeckWiring,cad=H.cadSensors(idx.nodes.map(n=>({name:n.name,path:pathOf(n)}))),said=[];let wiring=project.robot.wiring;
    if(cad.localization&&C.sensorChoices('ftc').includes(cad.localization)&&project.sensors.localization!==cad.localization){project.sensors={...project.sensors,localization:cad.localization};}
    if(cad.localization)said.push(C.sensors[cad.localization].name);
    if(cad.expansion){wiring=W.setHub(wiring,'expansion',true);said.push('Expansion Hub');}
    if(cad.servoHub){wiring=W.setHub(wiring,'servoHub',true);said.push('Servo Hub');}
    project.robot=C.robot({...project.robot,wiring},project.controller);
    const bare=n=>String(n).replace(/\s*<\d+>$/,''),inMech=s=>bare(s.path.find((n,i)=>i>0&&(project.model?.parts||[]).some(p=>bare(p.name)===bare(n)))||s.path[1]||'');
    return {said,sensors:cad.sensors.map(s=>`${s.what} “${s.name}”${inMech(s)?` in “${bare(inMech(s))}”`:''}`)};}
  // Configure from CAD: one line on what it set up, and every detail in a list under it.
  $('#mech-from-cad').onclick=()=>configureFromCad();
  // Setup is optional. When it has read a Control Hub, what it read fills in the mechanisms and Robot controller.
  async function configureFromCad(){await readCadMechanisms();}
  async function readCadMechanisms(){
    if(project.model)placeModel.tracedId=`${project.model.id}:${project.mechanisms.intakes.length+project.mechanisms.shooters.length}`;
    if(!project.model)return status('#mech-list-status','Import your robot’s CAD in step 2 (CAD) first.');
    const said=[],game=L().field==='biobuzz',button=$('#mech-from-cad');button.disabled=true;
    try{
      if(game){const out=setUpFromCad({merge:true});if(out?.matched?.length)said.push(...out.matched);if(out?.extra?.length)said.push(`Also in your CAD: ${out.extra.join(', ')}; add it with + Add mechanism to set it up`);}
      save();robotPanel();mechanismsPanel();status('#mech-list-status','Looking through your CAD for each mechanism…');
      await placeModel();const r=await joints.discover({quiet:true,fromCad:true});
      if(r===false)said.push('Moving mechanisms are found in a STEP assembly whose parts are named (Lift, Claw, Arm…)');
      if(r?.matched?.length)said.push(...r.matched.map(x=>`${x.name} → “${x.cad}”`));
      if(r?.unmatched?.length)said.push(`Not found by name: ${r.unmatched.join(', ')}. Name its assembly like it in your CAD, or press Choose its parts on its card`);
      if(r?.told?.length)said.push(...r.told.map(t=>t.replace(/\.$/,'')));
      const hardware=actuatorsFromCad();if(hardware.length)said.push(...hardware);
      // The chassis: the drivetrain the CAD's names say, and where each of its wheels is.
      {const drive=cadDrive();if(drive&&drive!==project.robot.drivetrain){project.robot=C.robot({...project.robot,drivetrain:drive},project.controller);project.model.drivetrain=drive;said.push(`Drivetrain: ${C.drives[drive].name}, from your CAD’s names`);}
        const wheels=findWheels();if(wheels)said.push(`Chassis: ${wheels.replace(/\.$/,'')}`);}
      await new Promise(done=>requestAnimationFrame(done));const furthest=[];project.mechanisms.intakes.forEach((_,n)=>{const r=joints.fitIntake(n);if(r?.name)furthest.push(`intake ${n+1}’s box reaches “${r.name}” (${r.kind})`);const col=joints.fitColumn(n);if(col)furthest.push(`intake ${n+1} picks up on its rollers`);});
      const sensed=sensorsFromCad();if(sensed?.said.length)said.push(`Chassis: ${sensed.said.join(', ')}`);if(sensed?.sensors.length)said.push(...sensed.sensors.map(s=>`${s}: set its port under Chassis`));
      save();reload();mechanismsPanel();robotPanel();
      const m=project.mechanisms,n=(k,one,many=one+'s')=>k?`${k} ${k===1?one:many}`:'',moving=project.kinematics.joints.filter(j=>j.type!=='fixed'&&j.drive?.signal!=='wheel'&&!/gear[0-9]*$/.test(j.id)).length;
      const what=[n(m.enabled?m.intakes.length:0,'intake'),n(m.enabled?m.shooters.length:0,m.shooters.some(s=>s.type==='turret')?'turret shooter':'shooter'),n(moving,'moving part'),n(new Set(window.DeckWiring.state(project).rows.filter(r=>(r.family==='motor'||r.family==='servo')&&!['pod','sensor','imu'].includes(r.role)).map(r=>r.name)).size+(m.enabled?m.others.length:0),'motor and servo','motors and servos')].filter(Boolean);
      const extra=[...(sensed?.said||[]),...(sensed?.sensors.length?[n(sensed.sensors.length,'sensor')]:[])];
      status('#mech-list-status',said.length?`From your CAD: ${what.join(', ')||'nothing new'}${extra.length?` · ${extra.join(', ')}`:''}${furthest.length?` · ${furthest.join(', ')}`:''}${trainSaid.length?` · ${trainSaid.join(', ')}`:''}.`:'Nothing in your CAD is named like these mechanisms. Name the assemblies in your CAD (Intake, Lift, Claw…), or choose each one’s parts on the model.');
    }finally{button.disabled=!project.model;}}
  // Mechanisms are on while the robot has any part; adding the first part starts from that part alone.
  function setMech(change){const m=structuredClone(project.mechanisms);if(!m.enabled){m.intakes=[];m.shooters=[];}change(m);m.enabled=m.intakes.length>0||m.shooters.length>0;project.mechanisms=MECH.sanitize(m);save();mechanismsPanel();reload();}
  // + Add mechanism's game entries (BIOBUZZ): an intake of a kind on a free edge, or a turret or fixed shooter (the second
  // at the first one's partner spot). Returns its label, or null when the robot has as many as the game allows.
  function addGame(what,kind){let label=null;
    setMech(m=>{if(what==='intake'){const free=MECH.EDGES.find(e=>!m.intakes.some(i=>i.sides.includes(e)));if(!free||m.intakes.length>=4)return;const k=MECH.INTAKES[kind]?kind:'sweeper';m.intakes.push({kind:k,sides:[free]});label=`Intake ${m.intakes.length} (${MECH.INTAKES[k].toLowerCase()})`;return;}
      if(m.shooters.length>=MECH.MAX_SHOOTERS)return;const first=m.shooters[0],type=kind==='fixed'?'fixed':'turret';
      m.shooters.push(first?{type,pieces:'nectar',mount:MECH.PARTNER[first.mount==='center'?'front':first.mount]}:{type,pieces:'pollen',mount:type==='turret'?'center':'front',facing:'front'});label=`Shooter ${m.shooters.length} (${type==='turret'?'turret':'fixed'})`;});
    return label;}
  for(const host of ['#mech-intakes','#mech-shooters']){
    const box=$(host),partOf=el=>{const [kind,n]=el.closest('[data-part]').dataset.part.split(':');return {kind,n:+n};};
    box.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.mechRemove){const [kind,n]=b.dataset.mechRemove.split(':');if(mechPlacing?.startsWith(kind))mechPlacing=null;
        // The CAD parts it moved (its turret, flywheel, hood, ramp, rollers and their gears) go with it, so none stays behind as a mechanism of its own.
        {const names={};for(const [k,v] of Object.entries(project.railNames||{})){const x=new RegExp(`^${kind}:(\\d+)(:\\d)?$`).exec(k);if(!x)names[k]=v;else if(+x[1]>+n)names[`${kind}:${+x[1]-1}${x[2]||''}`]=v;else if(+x[1]<+n)names[k]=v;}project.railNames=names;}
        {const kin=window.DeckKinematics.reindex(project.kinematics,kind,+n),mine=project.kinematics.joints.filter(j=>j.drive?.of===`${kind}:${n}`).map(j=>j.id),gone=new Set(kin.joints.filter(j=>mine.some(id=>j.id===id||j.id.startsWith(id+'gear'))).map(j=>j.id));
          project.kinematics=window.DeckKinematics.sanitize({...kin,joints:kin.joints.filter(j=>!gone.has(j.id)),actuators:kin.actuators.filter(x=>!gone.has(x.joint))});}if(project.robot.wiring)project.robot.wiring=window.DeckHardware.reindex(project.robot.wiring,kind==='intake'?'intakes':'shooters',+n);return setMech(m=>{m[kind==='intake'?'intakes':'shooters'].splice(+n,1);m.power={};m.guessed=[];m.traced=0;});}
      if(b.dataset.intakeMoreAdd){const [n,device]=b.dataset.intakeMoreAdd.split(':');return setMech(m=>{const i=m.intakes[+n];if(!i)return;const taken=new Set([...window.DeckWiring.state(project).rows.map(r=>r.name),...m.intakes.flatMap(x=>(x.more||[]).map(y=>y.name))]);
        const base=`${i.motor||i.servo||'intake'}_${device==='motor'?'motor':'servo'}`;let c=2;while(taken.has(base+c))c++;i.more=[...(i.more||[]),{name:(base+c).slice(0,40),device}];});}
      if(b.dataset.intakeMoreOff){const [n,e]=b.dataset.intakeMoreOff.split(':').map(Number),w=project.robot.wiring;
        // The ones after it move up one: their ports and sensors go with them.
        if(w){const key=f=>`intakes.${n}.more${f}`,dev={...(w.devices||{})};delete dev[key(e)];for(let f=e+1;f<MECH.MORE_MAX;f++)if(dev[key(f)]){dev[key(f-1)]=dev[key(f)];delete dev[key(f)];}
          project.robot.wiring={...w,devices:dev,sensors:(w.sensors||[]).filter(s=>s.for!==key(e)).map(s=>{const f=/^intakes\.(\d)\.more(\d)$/.exec(s.for||'');return f&&+f[1]===n&&+f[2]>e?{...s,for:key(+f[2]-1)}:s;})};}
        return setMech(m=>{const i=m.intakes[n];if(i?.more)i.more.splice(e,1);});}
      if(b.dataset.column){const [what,k]=b.dataset.column.split(':'),n=+k;
        if(what==='cad'){const col=joints.fitColumn(n,{force:true});status('#mech-model-help',col?`Intake ${n+1}: ${col.wheels} roller wheel${col.wheels===1?'':'s'}, ${col.d} in across, ${columnLength(col)} in long.`:'No rollers found on that intake in the CAD.');mechanismsPanel();return;}
        wheelPlacing=null;mechPlacing=mechPlacing?.startsWith(`column:${n}:`)?null:`column:${n}:a`;status('#mech-model-help',mechPlacing?'Click one end wheel of the rollers, then the other. Drag to turn the view.':'');mechanismsPanel();return;}
      if(b.dataset.place){wheelPlacing=null;mechPlacing=mechPlacing===b.dataset.place?null:b.dataset.place;status('#mech-model-help',mechPlacing?'Click where that part is on the model. Drag to turn the view.':'');mechanismsPanel();return;}
      const field=b.dataset.field,value=b.dataset.value;if(!field||value===undefined)return;const {kind,n}=partOf(b);
      setMech(m=>{const part=m[kind==='intake'?'intakes':'shooters'][n];if(!part)return;
        if(field==='side'){const has=part.sides.includes(value);if(has&&part.sides.length===1)return;part.sides=has?part.sides.filter(s=>s!==value):[...part.sides,value];delete part.at;}
        else if(field==='sharesTurret'){part.sharesTurret=value==='true';delete part.at;
          // Back on its own turret: it moves to the first shooter's partner spot.
          if(!part.sharesTurret){const first=m.shooters[0];part.mount=MECH.PARTNER[first.mount==='center'?'front':first.mount];}}
        else if(field==='hood'){if(value==='on')part.hood=part.hood||(n?'hood2':'hood');else delete part.hood;}
        else{part[field]=value;if(field==='mount')delete part.at;}});});
    box.addEventListener('input',e=>{const el=e.target;if(el.dataset?.range===undefined||!finite(el.valueAsNumber))return;const j=deployJoint(+el.dataset.range);if(j)joints.pose(j.id,(j.states?.raised??0)+el.valueAsNumber);});
    box.addEventListener('change',e=>{const el=e.target;if(el.dataset?.intakeMoreRev){const [n,x]=el.dataset.intakeMoreRev.split(':').map(Number);return setMech(m=>{const d=m.intakes[n]?.more?.[x];if(d){if(el.checked)d.reversed=true;else delete d.reversed;}});}
      if(el.dataset?.range!==undefined)return swingTo(+el.dataset.range,el.valueAsNumber);if(!el.dataset?.field)return;const {kind,n}=partOf(el);
      setMech(m=>{const part=m[kind==='intake'?'intakes':'shooters'][n];if(!part)return;if(el.dataset.field==='fold'){if(finite(el.valueAsNumber))part.down=part.up=el.valueAsNumber;return;}if(el.dataset.field==='columnD'){if(part.column&&finite(el.valueAsNumber))part.column.d=el.valueAsNumber;return;}part[el.dataset.field]=el.type==='checkbox'?el.checked:el.type==='number'?(finite(el.valueAsNumber)?el.valueAsNumber:part[el.dataset.field]):el.value;});});
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mechPlacing){mechPlacing=null;status('#mech-model-help','');mechanismsPanel();}});
  const mechNumber=(id,apply)=>$(id).addEventListener('change',e=>{if(finite(e.target.valueAsNumber))setMech(m=>apply(m,e.target.valueAsNumber));});
  // What it starts with follows the capacity: full stays full when the capacity changes, and never more than it holds.
  mechNumber('#mech-cap-pollen',(m,v)=>{const full=m.preload.pollen>=Math.min(m.capacity.pollen,m.storage);m.capacity.pollen=v;if(full||m.preload.pollen>v)m.preload.pollen=Math.min(v,4);});mechNumber('#mech-cap-nectar',(m,v)=>m.capacity.nectar=v);mechNumber('#mech-preload',(m,v)=>m.preload.pollen=v);
  mechNumber('#mech-spinup',(m,v)=>m.shooter.spinUp=v);mechNumber('#mech-transfer',(m,v)=>m.transfer.seconds=v);mechNumber('#mech-index',(m,v)=>m.indexer.seconds=v);
  mechNumber('#mech-turret-speed',(m,v)=>m.turret.speed=v);mechNumber('#mech-turret-range',(m,v)=>{m.turret.min=-Math.abs(v);m.turret.max=Math.abs(v);});
  mechNumber('#mech-rpm',(m,v)=>m.shooter.rpm=v);
  $('#mech-with-intake').onchange=e=>setMech(m=>{for(const i of m.intakes){if(e.target.checked)i.withFeeder=true;else delete i.withFeeder;}});
  $('#mech-flywheel').addEventListener('change',e=>{if(!e.target.dataset.pidf)return;const vals=Object.fromEntries(['p','i','d','f'].map(k=>[k,$('#mech-pidf-'+k).valueAsNumber]));setMech(m=>{if(Object.values(vals).every(v=>!finite(v)||v===0))delete m.shooter.pidf;else m.shooter.pidf=Object.fromEntries(Object.entries(vals).map(([k,v])=>[k,finite(v)?v:0]));});});
  // How far a ramp swings, from 0 at the CAD's pose. A negative number turns it the other way, and that way becomes positive.
  let swingBack=0;
  function swingTo(n,v){if(!finite(v))return;const abs=Math.abs(v),now=deployJoint(n);if(now){const kin=structuredClone(project.kinematics),j=kin.joints.find(x=>x.id===now.id),was=(j.states?.lowered??0)-(j.states?.raised??0);let raised=j.states?.raised??0;
      if((v<0)!==(was<0)){j.axis=j.axis.map(a=>a?-a:0);raised=-raised;}j.states={...j.states,raised,lowered:raised+abs};if(finite(j.lower)||finite(j.upper)){j.lower=Math.min(raised,raised+abs);j.upper=Math.max(raised,raised+abs);}project.kinematics=window.DeckKinematics.sanitize(kin);}
    setMech(m=>{if(m.intakes[n])m.intakes[n].travel=abs;});joints.fitIntake(n);if(now){const id=now.id,raised=project.kinematics.joints.find(x=>x.id===id)?.states?.raised??0;joints.pose(id,raised+abs);clearTimeout(swingBack);swingBack=setTimeout(()=>joints.pose(id,raised),2500);}}
  // A second motor or servo chained to the first through the turret's gears, and the gear pairs from it to the turret.
  $('#mech-turret').addEventListener('click',e=>{const on=e.target.closest('[data-turret-second]'),off=e.target.closest('[data-turret-second-off]');
    if(on)return setMech(m=>{const s=m.shooters[+on.dataset.turretSecond];if(s)s.turretMotor2=`${s.turretMotor}b`.slice(0,40);});if(off)return setMech(m=>{const s=m.shooters[+off.dataset.turretSecondOff];if(s)delete s.turretMotor2;});
    const x=e.target.closest('[data-gear-remove]');if(x)setGears(g=>g.filter((_,i)=>i!==+x.dataset.gearRemove));});
  $('#mech-gear-add').onclick=()=>setGears(g=>[...g,[20,60]]);
  $('#mech-gears').addEventListener('change',e=>{const [i,side]=String(e.target.dataset.gear||'').split(':');if(side!==undefined&&e.target.valueAsNumber>0)setGears(g=>g.map((p,k)=>k===+i?(side==='0'?[e.target.valueAsNumber,p[1]]:[p[0],e.target.valueAsNumber]):p));});
  const gearRatio=g=>(g||[]).reduce((r,[a,b])=>r*b/a,1);
  function setGears(change){setMech(m=>{const g=change(m.turret.gears||[]);if(g.length)m.turret.gears=g;else delete m.turret.gears;if(m.turret.kind==='servo'){const md=window.DeckHardware.MODELS[project.robot.wiring?.devices?.['shooters.0.turretMotor']?.model];m.turret.servoDegrees=Math.max(10,(md?.range||300)/gearRatio(g));}});}
  function gearsPanel(){const g=project.mechanisms.turret.gears||[],box=$('#mech-gears'),html=g.map(([a,b],i)=>`<div class="sim-gear-row"><label for="mech-gear-${i}-0">Gear ${i+1} teeth</label><input id="mech-gear-${i}-0" data-gear="${i}:0" data-slider="off" type="number" min="1" max="2000" step="1" value="${a}"><span aria-hidden="true">→</span><label class="sr-only" for="mech-gear-${i}-1">Gear ${i+1} drives teeth</label><input id="mech-gear-${i}-1" data-gear="${i}:1" data-slider="off" type="number" min="1" max="2000" step="1" value="${b}"><button type="button" class="icon-button" data-gear-remove="${i}" aria-label="Remove gear pair ${i+1}" title="Remove">×</button></div>`).join('')+(g.length?`<p class="hint">${+gearRatio(g).toFixed(2)} turn${+gearRatio(g).toFixed(2)===1?'':'s'} of the ${project.mechanisms.turret.kind==='motor'?'motor':'servo'} turn the turret once.</p>`:'');if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;}}
  for(const b of $$('[data-alliance]'))b.onclick=()=>{const l=L(),next=b.dataset.alliance;if((l.alliance||'red')===next)return;
    // BIOBUZZ is point-symmetric: the other alliance runs the same route turned 180° about the centre.
    const route=l.field==='biobuzz'&&(l.start||l.pins.length||l.zones.length);if(route){Object.assign(l,planner.allianceRoute(l,{mode:'rotate',width:l.width,height:l.height}));if(l.start){start=l.start;preview={...start};if(native&&info)void api.sim('start',start).catch(()=>{});}}
    l.alliance=next;$('#sim-alliance-note').textContent=route?`Moved the starting pose${l.pins.length?`, ${l.pins.length} path${l.pins.length>1?'s':''}`:''}${l.zones.length?' and obstacles':''} to the ${next} side. Press ${next==='red'?'Blue':'Red'} to move them back.`:`Shots aim at the ${next} hive.`;
    changed('zones');layoutPanel();mechanismsPanel();reload();};
  // Moving parts: the CAD's joints, found and checked on the preview (sim-joints.js).
  const joints=window.DeckJointsPanel.create({host:$('#mech-joints'),api:{glow:()=>mechGlow(),
    kinematics:()=>project.kinematics,mechanisms:()=>L().field==='biobuzz'?project.mechanisms:window.DeckMechanisms.sanitize({}),model:()=>model,meta:()=>project.model,preview:()=>mechPreview,
    commit(next){project.kinematics=window.DeckKinematics.sanitize(next);save();mechanismsPanel();view3d?.setModel(fieldRig());reload();},
    setIntake(n,patch){setMech(m=>{if(m.intakes[n])Object.assign(m.intakes[n],patch);});},setShooting(patch){setMech(m=>{Object.assign(m.shooter,patch);});},footprint:()=>chassisFootprint(),
    hitboxes:()=>!!project.hitboxes,setHitboxes:showHitboxes,refreshPicker(){mechModel();}}});
  // The Mechanisms list (sim-mechanism-list.js): + Add mechanism, and each moving mechanism with what drives it.
  mechList=window.DeckMechanismList.create({host:$('#mech-parts'),picker:$('#mech-picker'),api:{
    kinematics:()=>project.kinematics,commit(next){project.kinematics=window.DeckKinematics.sanitize(next);save();mechanismsPanel();view3d?.setModel(fieldRig());reload();},
    joints:()=>joints,isMechanism:j=>joints.isMechanism(j),game:()=>L().field==='biobuzz',cad:()=>!!project.model&&!!model?.geometry,addGame,rows:()=>M()?.rows?.(project.model||{}),
    status:text=>status('#mech-list-status',text),adding:on=>{$('#mech-add').setAttribute('aria-expanded',String(on));mechAddDialog(on);},picking:()=>{garagePick='picker';garage();},decorate:()=>{wireBlocks();observeMechCards();garage();}}});
  // Range of motion test (sim-motion-test.js): each mechanism through its whole range, and what it runs into.
  // Each number can say what it is and how to measure it on the real robot, one press away.
  const HELP=[[/^sim-length$/,'The robot frame from front to back. It sets the hitbox for planning.','Tape measure at the widest point of the frame.'],[/^sim-width$/,'The robot frame from side to side, outside the wheels.','Tape measure across the widest point. FTC allows 18 in.'],[/^sim-height$/,'How tall the frame is. It decides what the robot fits under.','Measure from the floor to the top of the frame.'],[/^sim-mass$/,'The robot with its battery. Heavier robots speed up, brake and turn slower.','Stand on a scale with and without the robot, and subtract.'],
    [/^sim-rpm$/,'How fast the wheels turn at full power, after any gears or belts.','Motor RPM divided by the gear ratio: 435 RPM through 2:1 is about 217.'],[/^sim-wheel$/,'How wide the drive wheels are. With the RPM it sets top speed.','Measure across the wheel. goBILDA mecanum wheels are 96 or 104 mm.'],[/^sim-maxspeed$/,'The most power routes use unless a path says otherwise. 1 is full power.','Start at 0.8. Lower it if the robot slides or misses its stops.'],[/^sim-drive-style$/,'Robot-centric: forward is where the robot faces. Field-centric: forward is away from the driver.',''],
    [/^mech-intake-reach-/,'How far the intake reaches past the frame when it picks up.','Measure from the frame to the front of the intake.'],[/^mech-intake-width-/,'How wide a piece can enter the intake.','Measure across the opening.'],[/^mech-intake-height-/,'How tall a piece can enter the intake.','Measure from the floor to the top of the opening.'],[/^mech-deploy-time-/,'How long it takes to fold all the way, down or up.','Film it and count: at 30 frames a second, 9 frames is 0.3 s.'],[/^mech-intake-range-/,'How far it swings from where your CAD has it, in degrees. Negative turns it the other way.','Watch it on the model until it touches the floor.'],
    [/^mech-turret-speed$/,'How fast the turret turns while it aims.','Film a 90° turn and divide: 90° in 0.4 s is 225°/s.'],[/^mech-turret-range$/,'How far the turret may turn each way from facing forward.','Turn it by hand until a wire or a stop would catch.'],[/^mech-rpm$/,'How fast the flywheel spins when it shoots.','Read it from the motor’s velocity in telemetry.'],[/^mech-spinup$/,'How long the flywheel takes to reach its speed from a stop.','Time it from telemetry, or film it.'],[/^mech-pidf-/,'The numbers the Control Hub’s velocity control runs the flywheel on.','Press the guided check in Calibrate; it measures the flywheel and fills them in.'],[/^wire-rpm-/,'How fast this part turns at full power. It comes from the motor you chose and the belts and gears in your CAD. Change it if yours differs.','Read it from telemetry, or count turns on a slow-motion video.'],[/^mech-transfer$/,'How long a piece takes to travel from the intake to the shooter.','Film it and count frames.'],[/^mech-index$/,'The time between one shot and the next.','Film a few shots and divide by how many.'],[/^mech-cap-pollen$/,'The most pollen the robot can hold.',''],[/^mech-cap-nectar$/,'The most nectar the robot can hold.',''],[/^mech-preload$/,'The pollen in the robot when the match starts.','']];
  function helpFields(){for(const label of document.querySelectorAll('[data-setup-page=mechanisms] label[for],[data-setup-page=robot] .sim-hitbox label[for]')){const h=HELP.find(([re])=>re.test(label.htmlFor));if(!h||label.querySelector('[data-help]'))continue;const b=document.createElement('button');b.type='button';b.className='sim-help-btn';b.dataset.help=label.htmlFor;b.textContent='?';b.setAttribute('aria-label',`What is this? ${label.textContent.trim()}`);b.setAttribute('aria-expanded','false');label.append(b);}}
  $('#sim-panel-setup').addEventListener('click',e=>{const b=e.target.closest('[data-help]');if(!b)return;e.preventDefault();const place=b.closest('label').parentElement,had=place.querySelector(':scope>.sim-help');if(had){had.remove();b.setAttribute('aria-expanded','false');return;}const [,what,how]=HELP.find(([re])=>re.test(b.dataset.help)),p=document.createElement('p');p.className='sim-help';p.textContent=what;if(how){const m=document.createElement('b');m.textContent='Measure it: ';p.append(document.createElement('br'),m,how);}place.append(p);b.setAttribute('aria-expanded','true');});
  // Every card in Mechanisms can be folded away to its title, and stays folded.
  const FOLDED='torque-folded-cards';let folded=new Set();try{folded=new Set(JSON.parse(localStorage.getItem(FOLDED)||'[]'));}catch{}
  const foldKey=c=>{const h5=c.matches('.sim-mech-sub')?c.querySelector(':scope>h5')?.firstChild?.textContent||'':'';return `${c.closest('[data-part]')?.dataset.part||c.dataset.mech||c.id}${h5?'|'+h5:''}`;};
  function foldCards(){helpFields();const page=$('[data-setup-page=mechanisms]');for(const c of page.querySelectorAll('.sim-mech-sub')){const head=c.querySelector(':scope>.sim-mech-head,:scope>.sim-joints-head,:scope>h5,:scope>h3');if(!head)continue;let b=head.querySelector(':scope>[data-fold]');
      if(!b){b=document.createElement('button');b.type='button';b.className='icon-button sim-fold';b.dataset.fold='';const x=head.querySelector(':scope>[data-mech-remove],:scope>.icon-button:not([data-fold])');head.classList.add('sim-fold-head');head.insertBefore(b,x);}
      const on=folded.has(foldKey(c)),label=`${on?'Show':'Minimize'} ${(head.firstChild?.textContent||'this').trim()}`;c.toggleAttribute('data-folded',on);if(b.textContent!==(on?'+':'–'))b.textContent=on?'+':'–';if(b.getAttribute('aria-label')!==label){b.setAttribute('aria-label',label);b.title=on?'Show':'Minimize';}b.setAttribute('aria-expanded',String(!on));}}
  $('[data-setup-page=mechanisms]').addEventListener('click',e=>{const b=e.target.closest('[data-fold]');if(!b)return;const c=b.closest('[data-folded],.sim-mech-sub,.sim-mech-part'),key=foldKey(c);if(folded.has(key))folded.delete(key);else folded.add(key);try{localStorage.setItem(FOLDED,JSON.stringify([...folded]));}catch{}foldCards();});
  {let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;foldCards();});}).observe($('[data-setup-page=mechanisms]'),{childList:true,subtree:true});foldCards();}
  helpFields();
  $('#mech-add').onclick=()=>{mechList.open();garagePick='picker';garage();};
  // What Simulate's mechanisms say moves what, as Electronics' planned links: a motor with its encoder counts on it, and each
  // sensor a mechanism's motor or servo carries (Mechanisms → its card) changes when it moves. Names are the configuration's.
  function simLinks(){let st;try{st=window.DeckWiring.state(project);}catch{return [];}const out=[];
    for(const r of st.rows){if(['sensor','imu','pod','pinpoint','otos','drive','steer'].includes(r.role)||!['motor','servo'].includes(r.family))continue;const kind=r.family==='motor'?'motor':r.kind==='crservo'?'crservo':'servo';
      if(r.family==='motor'&&r.encoder)out.push({causes:[{name:r.name,kind,dir:1}],effect:{key:`m:${r.name}:pos`,dir:1},planned:true});
      for(const s of r.sensors||[]){if(s.kind==='motorEncoder')continue;const row=st.rows.find(x=>x.key==='sensor.'+s.id);if(!row)continue;
        const key=row.family==='encoder'?(row.via?`m:${row.via}:pos`:null):row.family==='analog'?`a:${row.name}`:row.family==='digital'?`d:${row.name}`:row.family==='i2c'?`i:${row.name}:${s.kind==='color'?'a':'d'}`:null;
        if(key)out.push({causes:[{name:r.name,kind,dir:1}],effect:{key,dir:1},planned:true});}}
    return out;}
  // + Add mechanism's library shows in a pop-up: the picker moves into it while it is open.
  function mechAddDialog(on){let d=$('#mech-add-dialog');if(!d){d=document.createElement('dialog');d.id='mech-add-dialog';d.className='sim-add-dialog sim-mech-add-dialog';d.setAttribute('aria-label','Add a mechanism');$('[data-setup-page=mechanisms]').append(d);
      d.addEventListener('close',()=>{if(mechList?.adding?.()!==null)mechList.close();const pk=$('#mech-picker');if(pk&&mechAddDialog.home?.parent&&pk.parentNode===d)mechAddDialog.home.parent.insertBefore(pk,mechAddDialog.home.next&&mechAddDialog.home.next.parentNode===mechAddDialog.home.parent?mechAddDialog.home.next:null);});}
    const pk=$('#mech-picker');if(!pk)return;if(on){if(pk.parentNode!==d){mechAddDialog.home={parent:pk.parentNode,next:pk.nextSibling};d.append(pk);}if(!d.open)d.showModal();}else if(d.open)d.close();}
  // ---- the garage: every part of the robot as a tile. One part shows at a time, with its numbers and what to do with it. ----
  const garageArt=i=>window.DeckMechArt.svg(i.icon,{tint:i.tint,drive:project.robot.drivetrain});
  // What a part runs on, from its first device row, and how many of its devices have a port.
  function garageLine(el,only){const rows=only||[...el.querySelectorAll('[data-wire-row]')];if(!rows.length)return '';const r=rows[0],text=sel=>{const o=r.querySelector(sel);return o?.selectedOptions?.[0]?.textContent||'';},kind=text('[id^="wire-type-"]'),model=text('[data-wire-model]');
    const wired=rows.filter(x=>x.querySelector('[data-wire-port],[data-wire-assign]')?.value).length;return `${[kind,model&&model!=='Not set'?model:'',rows.length>1?`${rows.length} devices`:''].filter(Boolean).join(' · ')}${project.controller==='ftc'?`<em data-wired="${wired===rows.length}">${wired}/${rows.length} plugged in</em>`:''}`;}
  function garageItems(){const m=project.mechanisms,items=[],add=(key,title,icon,el,extra={})=>{if(el&&!el.hidden)items.push({key,title,icon,el,...extra});};
    add('chassis','Chassis','chassis',$('#mech-drive'));
    // The chassis's own parts under it: the robot controller (always there, on top), each wheel or swerve module, then what
    // tells it where it is (odometry, a Pinpoint, an OTOS), added with + Add to Chassis.
    $('#mech-controller').toggleAttribute('data-unset',!project.controllerSet);const ctlOn=!$('#mech-drive').hidden&&!MECH.PRESETS[project.robotPreset]?.adjustable,addController=()=>{if(!ctlOn||items.some(i=>i.key==='chassis:controller'))return;const picked=project.controllerSet,motion=project.controller==='motionmodule';
      add('chassis:controller',!picked?'Robot controller':motion?'MotionModule':'Control Hub','part',$('#mech-controller'),{parent:'chassis',tint:'part',line:()=>!picked?'Pick Control Hub or MotionModule':motion?'Runs the robot':(()=>{const imu=window.DeckWiring.state(project).rows.find(r=>r.role==='imu');return `Runs the robot · IMU on ${imu?.hub&&imu.hub!=='control'?window.DeckHardware.portLabel(imu,'i2c',project.robot.wiring):`I2C bus ${imu?.bus??0}`}`;})()});};
    addController();
    if(!$('#mech-drive').hidden)for(const el of $$('#mech-drive-ports [data-module]')){const k=el.dataset.module,pos=k.startsWith('pod:')?null:project.robot.wheelPos?.[k],sense=/^(pod:|pinpoint$|otos$)/.test(k);
      add('chassis:'+k,el.dataset.moduleTitle||k,'chassis',$('#mech-drive'),{module:k,parent:'chassis',line:()=>{const wired=[...el.querySelectorAll('[data-wire-row] select')].filter(s=>/^wire-(chassis|port)-/.test(s.id)),on=wired.filter(s=>s.value).length;
        return `${sense?'Tells where the robot is':pos?'Placed':'Not placed yet'}${project.controller==='ftc'&&wired.length?`<em data-wired="${on===wired.length}">${on}/${wired.length} plugged in</em>`:''}`;}});}
    addController();
    let num=1;for(const el of $$('#mech-intakes>.sim-mech-part')){const n=+el.dataset.part.split(':')[1],kind=m.intakes[n]?.kind;
      // A deployable ramp and its rollers are one intake: both tiles carry that intake's number.
      if(kind==='ramp'){add(`intake:${n}:0`,`Intake ${num} · Ramp`,'ramp',el,{sub:0,tint:'intake',focus:`intakes.${n}.servo`});add(`intake:${n}:1`,`Intake ${num} · Rollers`,'rollers',el,{sub:1,tint:'intake',focus:`intakes.${n}.motor`});num++;}
      else{add(`intake:${n}`,`${kind==='kicker'?'Kicker':'Intake'} ${num}`,kind==='kicker'?'kicker':kind==='siderollers'?'siderollers':'sweeper',el,{tint:'intake',focus:`intake:${n}`});num++;}}
    add('feeder','Feeder','feeder',$('#mech-feeder'),{tint:'feeder',focus:[...new Set(m.shooters.map((s,n)=>`shooters.${n}.indexer`))]});
    // A turret carries its shooter: the turntable spins and the flywheel and hood ride on it. So the turret is the parent
    // tile and its shooter the child, as the CAD's joints say (the flywheel rides on that turret's joint); without them, as
    // the settings say (on its own turret, or on shooter 1's). A fixed shooter stands on its own. Each turret tile has its
    // own servos or motor; a turret carrying both shooters is one tile with both under it.
    const turretEl=$('#mech-turret'),turretRows=n=>[...turretEl.querySelectorAll('[data-wire-row]')].filter(r=>r.dataset.wireRow.startsWith(`shooters.${n}.`));
    const J=project.kinematics?.joints||[],turretJoint=n=>J.find(j=>j.drive?.signal==='turret'&&j.drive.of===`shooter:${n}`);
    const carrier=n=>{const s=m.shooters[n];if(s?.type!=='turret')return null;const fly=J.find(j=>j.drive?.signal==='flywheel'&&j.drive.of===`shooter:${n}`);
      let p=fly&&J.find(j=>j.id===fly.parent);for(let k=0;p&&k<12&&p.drive?.signal!=='turret';k++)p=J.find(j=>j.id===p.parent);
      const t=/^shooter:(\d)$/.exec(p?.drive?.of||'');if(t&&m.shooters[+t[1]]?.type==='turret')return +t[1];return n>0&&s.sharesTurret?0:n;};
    for(const el of $$('#mech-shooters>.sim-mech-part')){const n=+el.dataset.part.split(':')[1],s=m.shooters[n],c=carrier(n);
      if(c===n){const riders=m.shooters.map((_,k)=>k).filter(k=>carrier(k)===n),tj=turretJoint(n);
        add(`turret:${n}`,`Turret ${n+1} · ${riders.length>1?'both shooters':MECH.PIECES[s.pieces]||''}`,'turret',turretEl,{turretOf:n,carries:riders,tint:'turret',focus:[`shooters.${n}.turretMotor`,...(tj?[`kin:${tj.id}`]:[])],line:()=>garageLine(turretEl,turretRows(n))});}
      add(`shooter:${n}`,`Shooter ${n+1} · ${MECH.PIECES[s?.pieces]||''}`,'shooter',el,{tint:s?.pieces,focus:`shooter:${n}`,...(c!==null?{parent:`turret:${c}`,rides:c}:{})});}
    for(const el of $$('#mech-parts [data-mech]'))add('kin:'+el.dataset.mech,el.querySelector('h4,h3,h5')?.firstChild?.textContent?.trim()||'Mechanism','part',el,{tint:'part',focus:'kin:'+el.dataset.mech,...(el.dataset.parent?{parent:'kin:'+el.dataset.parent}:{})});
    add('preloads','Preloads','preload',$('#mech-preloads'),{tint:'pollen'});
    if(!$('#mech-joints').hidden)add('moving','Moving parts','moving',$('#mech-joints'),{tint:'turret',line:()=>`${project.kinematics.joints.filter(j=>j.drive?.signal!=='wheel'&&!/gear[0-9]*$/.test(j.id)).length} found in your CAD`});
    // A name given with right-click Rename.
    // An intake renamed before it got its ramp keeps that name on its Ramp and Rollers tiles.
    const names=project.railNames||{},named=k=>names[k]||(/^intake:\d+:[01]$/.test(k)&&names[k.slice(0,-2)]?`${names[k.slice(0,-2)]} · ${k.endsWith(':0')?'Ramp':'Rollers'}`:'');
    return groupItems(items).map(i=>named(i.key)?{...i,title:named(i.key)}:i);}
  // The Intake: one tile over every part that takes pieces in (each intake, its ramp and rollers, and the feeder), plus any
  // mechanism dragged onto it; one dragged off leaves it. Selecting it shows all its parts; each part's own tile shows that part.
  const GROUPABLE=/^(intake:|feeder$|kin:)/;
  // Only what takes pieces in can be part of the Intake: a slide, a lift, an arm or a hang stays a mechanism of its own (a
  // claw or an intake riding on a slide is still under the slide, not chained into the Intake through it).
  const intakeKind=key=>!/^kin:/.test(key)||window.DeckMechanismTypes?.of?.(project.kinematics.joints.find(j=>j.id===key.slice(4)))?.group==='intake';
  function groupItems(items){const g=project.railGroups||{},kinType=k=>window.DeckMechanismTypes?.of?.(project.kinematics.joints.find(j=>j.id===k.slice(4))),
      // By default: the game's intakes and the feeder, and any mechanism of an intake kind (a ramp, rollers, a claw…).
      own=i=>GROUPABLE.test(i.key)&&intakeKind(i.key)&&(Object.hasOwn(g,i.key)?g[i.key]==='group:intake':/^intake:/.test(i.key)||i.key==='feeder'||/^kin:/.test(i.key)&&kinType(i.key)?.group==='intake'),
      rootOf=i=>{let x=i;for(let n=0;n<20&&x?.parent&&/^kin:/.test(x.parent);n++)x=items.find(y=>y.key===x.parent)||null;return x||i;},
      inIntake=i=>own(rootOf(i));
    // The feeder alone (every intake deleted) is no Intake: it stands on its own unless it was dragged in.
    const members=items.filter(inIntake);if(!members.length||members.every(i=>i.key==='feeder')&&g.feeder!=='group:intake')return items;const at=items.indexOf(members[0]),rest=items.filter(i=>!members.includes(i));
    const group={key:'group:intake',title:'Intake',icon:'sweeper',tint:'intake',els:[...new Set(members.map(i=>i.el))],members:members.map(i=>i.key),line:()=>`${members.length} part${members.length>1?'s':''} · drag a mechanism here to add it`};
    rest.splice(Math.min(at,rest.length),0,group,...members.map(i=>i.parent&&/^kin:/.test(i.parent)&&members.some(m=>m.key===i.parent)?i:{...i,parent:'group:intake'}));return rest;}
  // One line on what to do here. Every number a part runs on is an input on its own tile.
  function garageStats(item){const m=project.mechanisms,r=project.robot,t=m.turret,k=item.key;let tip='';
    if(k==='chassis')tip=`The drivetrain and its numbers. Each wheel and sensor is under Chassis on the left. Top speed about ${Math.round(r.driveRpm/60*Math.PI*r.wheelDiameterMm/25.4)} in/s.`;
    else if(k==='group:intake')tip='Everything that takes pieces in, together. Open a part on the left to set it up alone, or drag a mechanism onto Intake to add it.';
    else if(k==='chassis:controller')tip=!project.controllerSet?'What runs your robot. Pick one: everything on the chassis plugs into it.':project.controller==='motionmodule'?'MotionModule runs this robot.':'How the hub is mounted, its device names and the robot’s configuration.';
    else if(k.startsWith('chassis:'))tip=/^chassis:(pinpoint|otos|pod:)/.test(k)?'Click it on the model, then pick its port.':'Click it on the model, then pick its ports.';
    else if(/^intake:\d+:0$/.test(k)||/^intake:\d+$/.test(k)&&SWINGS[m.intakes[+k.split(':')[1]]?.kind]){tip='Type a range and watch it turn on the model. A negative number turns it the other way.';}
    else if(/^intake:/.test(k))tip='Rollers only spin: say what drives them, and their speed follows the motor. Port can wait until the real robot is wired.';
    else if(k==='feeder')tip='The feeder moves pieces from the intake up to the shooters. The path planner times your auto with these.';
    else if(/^shooter:/.test(k)){const s=m.shooters[+k.split(':')[1]];tip=`${Number.isInteger(item.rides)?`Rides on Turret ${item.rides+1}: its flywheel and hood turn with it. `:''}Shoots ${MECH.PIECES[s?.pieces]?.toLowerCase()||'pieces'}. Speed and spin-up are below; the guided check in Calibrate can measure them.`;}
    else if(/^turret:/.test(k)){tip=(item.carries?.length?`Carries ${item.carries.map(x=>`shooter ${x+1}`).join(' and ')}: the whole shooter turns with it to aim. `:'')+(m.shooters.filter(s=>s.type==='turret'&&!s.sharesTurret).length>1?`Its own ${t.kind==='motor'?'motor is':'servos are'} below; speed, range and gearing are shared by both turrets. `:'')+(t.kind==='motor'?'Enter each gear pair from the motor to the turret. Calibrate measures its encoder counts.':'Enter each gear pair from the servo to the turret. Calibrate measures where it faces forward.');}
    else if(k==='preloads')tip='What the robot can carry, and what it starts the match with.';
    else if(k==='moving')tip='Press Play to watch everything move. Open a part only if it moves wrong on the model.';
    else if(k==='picker')tip='Pick what your robot has. It joins your robot on the left.';
    const box=$('#mech-stats'),off=item.el?.querySelector?.(':scope>.sim-mech-head [data-mech-remove],:scope>.sim-mech-head .icon-button:not([data-fold])'),inGroup=item.parent==='group:intake',canGroup=GROUPABLE.test(item.key)&&intakeKind(item.key)&&!(inGroup&&/^kin:/.test(garageItems().find(i=>i.key===item.key)?.parent||'')),
      html=`<div class="sim-hero"><span class="sim-hero-art">${garageArt(item)}</span><div class="sim-hero-text"><h3>${escText(item.title)}</h3>${tip?`<p>${escText(tip)}</p>`:''}${canGroup?`<button type="button" class="text-button" data-hero-group="${inGroup?'out':'in'}">${inGroup?'Take it out of the Intake':'Make it part of the Intake'}</button>`:''}</div>${off?`<button type="button" class="icon-button" data-hero-remove aria-label="${escText(off.getAttribute('aria-label')||'Remove')}" title="Remove">×</button>`:''}</div>`;box.hidden=false;if(box.dataset.html!==html){box.innerHTML=html;box.dataset.html=html;}}
  const escText=v=>String(v??'').replace(/[&<>"]/g,c=>`&#${c.charCodeAt(0)};`);
  // + Add to …: a small tile closing each family in the rail. Chassis always has one (position sensing: a Pinpoint and its
  // pods, odometry pods, an OTOS); a moving mechanism has one while it or a part of it is open (a mechanism riding on it).
  // Put before item (the first tile after the family), or at the end (item null).
  function addTileBefore(item,items){const at=item?items.indexOf(item):items.length,prev=items[at-1];if(!prev)return '';const fam=prev.parent||prev.key;if(item&&(item.parent||item.key)===fam)return '';if((project.railFolded||[]).includes(fam))return '';
    const open=garagePick===fam||items.some(i=>i.key===garagePick&&i.parent===fam);if(fam!=='chassis'&&!(fam.startsWith('kin:')&&open))return '';
    const name=items.find(i=>i.key===fam)?.title||'it',adding=mechList?.adding?.();
    return `<button type="button" class="sim-tile sim-tile-sub sim-tile-add" data-garage-add="${escText(fam)}" aria-pressed="${fam==='chassis'?String(garagePick==='chassis'&&chassisAdding):String(adding===fam.slice(4))}"><span class="sim-tile-text"><b>+ Add to ${escText(name)}</b><small>${fam==='chassis'?'Odometry & IMU: a Pinpoint, odometry pods, an OTOS':'A mechanism that rides on it'}</small></span></button>`;}
  // How finished each part is, as its tile's colour: done (green) when everything on it is set; warn (yellow) when
  // something is left that the simulation does without (a port not picked yet, a wheel not placed, the robot controller
  // not picked); bad (red) when something must be fixed (a value marked red, two devices on one port). Chassis is the
  // worst of its own and its parts'. Returns [state, why].
  const TILE_WHY={done:'Done: everything here is set.',warn:'Works in the simulation, but something is not set yet.',bad:'Needs fixing before it can run.'};
  function tileState(i,items){
    if(i.key==='picker')return ['',''];
    if(i.key==='chassis:controller')return project.controllerSet?['done',TILE_WHY.done]:['warn','Pick Control Hub or MotionModule.'];
    if(i.members){const kids=items.filter(x=>i.members.includes(x.key)).map(x=>tileState(x,items)[0]);return kids.includes('bad')?['bad','A part of it needs fixing.']:kids.includes('warn')?['warn','A part of it is not finished: it still works in the simulation.']:['done',TILE_WHY.done];}
    const scope=i.module?$(`#mech-drive-ports [data-module="${CSS.escape(i.module)}"]`):i.sub!==undefined?(i.el.querySelectorAll('.sim-mech-sub')[i.sub]||i.el):i.el;if(!scope)return ['',''];
    // Chassis's own colour leaves out its parts' fields (each wheel, module or sensor has its own tile, added in below), so
    // with every part green and its own numbers set it is green too.
    const mine=x=>i.key!=='chassis'||!x.closest('#mech-drive-ports [data-module],#mech-controller'),shown=x=>mine(x)&&(!x.closest('[hidden]')||x.closest('[hidden]')===scope);
    let state=[...scope.querySelectorAll('.sim-bad-input,.sim-wire-row.red,[data-wire-row].red')].some(shown)?'bad':'';let why=state?'Needs fixing: a value or port marked red.':'';
    if(!state){const ports=project.controller==='ftc'?[...scope.querySelectorAll('select[data-wire-port],select[data-wire-assign]')].filter(shown):[],open=ports.filter(s=>!s.value).length;
      const unplaced=i.module&&!/^(pod:|pinpoint$|otos$)/.test(i.module)&&!project.robot.wheelPos?.[i.module],pos=[...scope.querySelectorAll('[data-pod-pos],[data-pinpoint-pos],[data-wheel-pos]')].filter(shown).some(x=>x.value==='');
      const off=[...scope.querySelectorAll('[data-wheel-centre].bad')].some(shown);if(off&&!open&&!unplaced&&!pos){state='warn';why='The wheels’ middle is off the robot’s centre: check it. It still works in the simulation.';}
      else if(open||unplaced||pos){state='warn';why=[open?`${open} port${open>1?'s':''} not picked`:'',unplaced||pos?'not placed on the model':''].filter(Boolean).join(', ')+': it still works in the simulation.';why=why[0].toUpperCase()+why.slice(1);}}
    if(i.key==='chassis'){const kids=items.filter(x=>x.parent==='chassis').map(x=>tileState(x,items)[0]);if(state!=='bad'&&kids.includes('bad')){state='bad';why='A part of the chassis needs fixing.';}else if(!state&&kids.includes('warn')){state='warn';why='A part of the chassis is not finished: it still works in the simulation.';}}
    return state?[state,why]:['done',TILE_WHY.done];}
  function garage(){const items=garageItems(),keys=new Set(items.map(i=>i.key)),picking=garagePick==='picker'&&!$('#mech-picker').hidden;
    // A part just added opens by itself.
    const fresh=garageKeys?items.find(i=>!garageKeys.has(i.key)):null;garageKeys=keys;if(fresh&&garagePick==='picker')garagePick=fresh.key;
    if(!picking&&!keys.has(garagePick))garagePick=items[0]?.key||null;if(garagePick&&garagePick!=='picker'&&project.garageTile!==garagePick){project.garageTile=garagePick;clearTimeout(garage.saving);garage.saving=setTimeout(save,400);}
    const now=picking?{key:'picker',el:$('#mech-picker'),title:'Add a mechanism',icon:'part',tint:'part'}:items.find(i=>i.key===garagePick),rail=$('#mech-rail'),folded=new Set(project.railFolded||[]),parents=new Set(items.map(i=>i.parent).filter(Boolean)),html=items.map(i=>{if(i.parent&&folded.has(i.parent))return '';const line=i.line?i.line():garageLine(i.sub===undefined?i.el:i.el.querySelectorAll('.sim-mech-sub')[i.sub]||i.el);const [st,why]=tileState(i,items),fam=parents.has(i.key),drag=GROUPABLE.test(i.key);
      const tile=`<button type="button" class="sim-tile${i.parent?' sim-tile-sub':''}${fam?' sim-tile-parent':''}" data-garage="${escText(i.key)}" aria-pressed="${i.key===garagePick&&!picking}"${drag?' draggable="true"':''}${st?` data-state="${st}" title="${escText(why)}"`:''}><span class="sim-tile-icon">${garageArt(i)}</span><span class="sim-tile-text"><b>${escText(i.title)}</b><small>${line}</small></span></button>`;
      return `${addTileBefore(i,items)}${fam?`<div class="sim-tile-fam${i.parent?' sim-tile-fam-sub':''}">${tile}<button type="button" class="sim-tile-fold" data-garage-fold="${escText(i.key)}" aria-expanded="${!folded.has(i.key)}" aria-label="${folded.has(i.key)?'Show':'Hide'} the parts of ${escText(i.title)}" title="${folded.has(i.key)?'Show':'Hide'} its parts"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button></div>`:tile}`;}).join('');
    const tail=addTileBefore(null,items),full=html+tail;if(rail.dataset.html!==full){rail.innerHTML=full;rail.dataset.html=full;}
    for(const el of [$('#mech-drive'),...$$('#mech-intakes>.sim-mech-part'),$('#mech-feeder'),...$$('#mech-shooters>.sim-mech-part'),$('#mech-turret'),...$$('#mech-parts [data-mech]'),$('#mech-flywheel'),$('#mech-preloads'),$('#mech-joints'),$('#mech-picker'),$('#mech-controller')]){el.toggleAttribute('data-garage-off',!(now?.els||[now?.el]).includes(el)&&!(el.id==='mech-flywheel'&&/^shooter:/.test(now?.key||'')));if(now?.els&&now.els.includes(el)){el.toggleAttribute('data-garage-second',false);[...el.querySelectorAll(':scope>.sim-mech-sub')].forEach(c=>c.toggleAttribute('data-garage-off',false));}if(el===now?.el){const part=now.sub;el.toggleAttribute('data-garage-second',part===1);[...el.querySelectorAll(':scope>.sim-mech-sub')].forEach((c,n)=>c.toggleAttribute('data-garage-off',part!==undefined&&n!==part));}}
    $('#mech-empty').toggleAttribute('data-garage-off',now?.key!=='chassis');
    // A shooter's turret tile shows only that shooter's turret servos or motor.
    {const t=$('#mech-turret');if(now?.turretOf!==undefined)t.dataset.turretOf=now.turretOf;else delete t.dataset.turretOf;}
    // Chassis shows the drivetrain and its settings; a part of it (chassis:<module>) shows that wheel, module or pod alone.
    {const drive=$('#mech-drive'),one=now?.parent==='chassis'?now.module:null;if(one)drive.dataset.partOf=one;else delete drive.dataset.partOf;
      for(const el of $$('#mech-drive-ports [data-module]'))el.toggleAttribute('data-module-shown',el.dataset.module===one);}
    $('#mech-count').classList.toggle('sim-over',project.controller==='ftc'&&window.DeckWiring.state(project).problems.some(p=>p.level==='limit'));
    // A parent lights up on the model with everything under it: Intake its ramp, rollers and feeder; a shooter its turret.
    const lit=(i,seen=new Set())=>{if(!i||seen.has(i.key))return [];seen.add(i.key);return [i.focus,...items.filter(c=>c.parent===i.key||i.members?.includes(c.key)).flatMap(c=>lit(c,seen))].flat().filter(Boolean);};
    if(now)garageStats(now);{const f=[...new Set(lit(now))];if(f.length&&!$('#mech-joints').contains(document.activeElement))focusMech(f.length===1?f[0]:f);}}
  $('#mech-stats').addEventListener('click',e=>{const g=e.target.closest('[data-hero-group]');if(!g)return;const key=garagePick,into=g.dataset.heroGroup==='in';project.railGroups={...project.railGroups,[key]:into?'group:intake':''};save();garage();status('#mech-list-status',into?'Part of the Intake now.':'Taken out of the Intake.');});
  $('#mech-stats').addEventListener('click',e=>{if(!e.target.closest('[data-hero-remove]'))return;garageItems().find(i=>i.key===garagePick)?.el.querySelector(':scope>.sim-mech-head [data-mech-remove],:scope>.sim-mech-head .icon-button:not([data-fold])')?.click();});
  $('#mech-rail').addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;const list=[...$$('#mech-rail [data-garage]')],at=list.indexOf(document.activeElement);if(at<0)return;e.preventDefault();const to=e.key==='Home'?0:e.key==='End'?list.length-1:Math.max(0,Math.min(list.length-1,at+(e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1)));garagePick=list[to].dataset.garage;mechList.close();garage();$(`#mech-rail [data-garage="${CSS.escape(garagePick)}"]`)?.focus();$('.sim-mech-main').scrollTop=0;});
  // Folding a family (Chassis, Intake, a mechanism with parts on it) leaves its own tile, with its count, on the left.
  $('#mech-rail').addEventListener('click',e=>{const f=e.target.closest('[data-garage-fold]');if(!f)return;e.stopPropagation();const k=f.dataset.garageFold,list=new Set(project.railFolded||[]);list.has(k)?list.delete(k):list.add(k);project.railFolded=[...list];save();garage();},true);
  // Drag a mechanism onto Intake to make it part of it; drag one off (anywhere else on the left) to take it out.
  {let dragging=null;const rail=$('#mech-rail'),clear=()=>{for(const t of $$('#mech-rail .sim-drop-on'))t.classList.remove('sim-drop-on');rail.classList.remove('sim-dragging');};
    rail.addEventListener('dragstart',e=>{const t=e.target.closest?.('[data-garage][draggable]');if(!t)return;dragging=t.dataset.garage;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragging);rail.classList.add('sim-dragging');});
    rail.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();const g=e.target.closest?.('[data-garage="group:intake"]');for(const t of $$('#mech-rail .sim-drop-on'))if(t!==g)t.classList.remove('sim-drop-on');g?.classList.add('sim-drop-on');});
    rail.addEventListener('drop',e=>{if(!dragging)return;e.preventDefault();const into=!!e.target.closest?.('[data-garage="group:intake"]'),key=dragging;dragging=null;clear();
      if(into&&!intakeKind(key)){status('#mech-list-status',`${garageItems().find(i=>i.key===key)?.title||'It'} doesn’t take pieces in, so it stays a mechanism of its own.`);return;}
      project.railGroups={...project.railGroups,[key]:into?'group:intake':''};garagePick=into?'group:intake':key;save();garage();status('#mech-list-status',into?`${garageItems().find(i=>i.key===key)?.title||'It'} is part of the Intake now.`:'Taken out of the Intake.');});
    rail.addEventListener('dragend',()=>{dragging=null;clear();});}
  // Right-click a tile on the left for Delete. Everything comes off but the chassis itself: its wheels and modules are the
  // drivetrain's, and the robot controller is always there. A Pinpoint, an OTOS or odometry comes off the chassis (the
  // robot then counts its drive wheels); a turret leaves its shooters fixed; the Intake takes every part in it.
  const headRemove=el=>el?.querySelector?.(':scope>.sim-mech-head [data-mech-remove],:scope>.sim-mech-head .icon-button:not([data-fold])');
  function tileDelete(key){const items=garageItems(),item=items.find(i=>i.key===key);if(!item)return null;
    if(key==='chassis'||key==='chassis:controller'||key==='preloads'||key==='moving')return {why:key==='chassis:controller'?'The robot controller is always there':key==='chassis'?'Every robot has a chassis':'Comes with the field'};
    if(/^chassis:(pinpoint|otos|pod:)/.test(key))return {run:()=>{setLocalization('encoders');wheelsSaid='Taken off: the robot counts its drive wheels and reads the IMU.';garagePick='chassis';mechanismsPanel();}};
    if(key.startsWith('chassis:'))return {why:'Part of the drivetrain: change the drivetrain to change it'};
    if(key==='feeder')return {why:'The shooters need it: delete the shooters to take it off'};
    // A shooter's turret comes off that shooter (and a shooter riding on it); the other shooter keeps its own.
    if(/^turret:d+$/.test(key))return {run:()=>setMech(m=>{const n=+key.split(':')[1];m.shooters.forEach((s,k)=>{if(s.type==='turret'&&(k===n||n===0&&s.sharesTurret)){s.type='fixed';delete s.sharesTurret;delete s.turretMotor2;}});})};
    if(/^intake:\d+:0$/.test(key))return {run:()=>setMech(m=>{const i=m.intakes[+key.split(':')[1]];if(i){i.kind='sweeper';delete i.servo;delete i.rampKind;if(i.more)i.more=i.more.filter(x=>x.device!=='servo');}}),label:'Delete the ramp (keep the rollers)'};
    if(item.members){const parts=item.members.map(k=>items.find(i=>i.key===k)).filter(i=>i&&headRemove(i.el)&&i.key!=='feeder');if(!parts.length)return {why:'Nothing in it can come off'};
      // From the last one up, so the numbers of the ones before stay right; a ramp's two tiles are one intake.
      return {run:()=>{const keys=[...new Set(parts.map(i=>i.key.replace(/^(intake:\d+):\d$/,'$1')))].reverse();for(const k of keys)headRemove(garageItems().find(i=>i.key===k||i.key.startsWith(k+':'))?.el)?.click();}};}
    const b=headRemove(item.el);return b?{run:()=>b.click()}:{why:'It can’t come off'};}
  // Right-click Add: what can go on that part. Each {label, run}.
  function tileAdds(key){const items=garageItems(),item=items.find(i=>i.key===key);if(!item)return [];const out=[],pick=parent=>{mechList.open(parent?{parent}:{});garagePick='picker';garage();};
    const more=(n,device)=>()=>{const b=document.querySelector(`[data-intake-more-add="${n}:${device}"]`);if(b&&!b.disabled)b.click();else setMech(m=>{const i=m.intakes[n];if(!i)return;const base=`${i.motor||i.servo||'intake'}_${device==='motor'?'motor':'servo'}`;let c=2;const taken=new Set((i.more||[]).map(x=>x.name));while(taken.has(base+c))c++;i.more=[...(i.more||[]),{name:base+c,device}];});};
    if(key==='chassis')out.push({label:'Odometry & IMU…',run:()=>{mechList.close();openChassisAdd();}});
    const im=/^intake:(\d+)(?::(\d))?$/.exec(key);
    if(im){const n=+im[1],i=project.mechanisms.intakes[n];if(i){if(i.kind==='sweeper'||i.kind==='siderollers')out.push({label:'A deployable ramp',run:()=>setMech(m=>{const x=m.intakes[n];if(x)x.kind='ramp';})});
      if(i.kind!=='kicker'&&im[2]!=='0')out.push({label:'Another motor on the rollers',run:more(n,'motor')},{label:'Another servo on the rollers',run:more(n,'crservo')});if(MECH.deploys(i.kind)&&im[2]!=='1')out.push({label:`Another servo on the ${i.kind}`,run:more(n,'servo')});}}
    const sm=/^shooter:(\d+)$/.exec(key);if(sm){const s=project.mechanisms.shooters[+sm[1]];if(s&&!s.motor2)out.push({label:'A second flywheel motor',run:()=>setMech(m=>{const x=m.shooters[+sm[1]];if(x)x.motor2=`${x.motor}2`.slice(0,40);})});if(s&&!s.hood)out.push({label:'A hood servo',run:()=>setMech(m=>{const x=m.shooters[+sm[1]];if(x)x.hood=+sm[1]?'hood2':'hood';})});}
    if(key==='turret'){const s=project.mechanisms.shooters.find(x=>x.type==='turret'&&!x.turretMotor2),n=project.mechanisms.shooters.indexOf(s);if(s)out.push({label:'Another motor or servo on the turret',run:()=>setMech(m=>{const x=m.shooters[n];if(x)x.turretMotor2=`${x.turretMotor}b`.slice(0,40);})});}
    if(key.startsWith('kin:')){const id=key.slice(4),a=project.kinematics.actuators.find(x=>x.joint===id&&['dcmotor','servo','crservo','linear'].includes(x.kind));
      if(a&&(window.DeckKinematics.extraDevices(a).length<1+window.DeckKinematics.MORE_DEVICES))out.push({label:`Another ${a.kind==='dcmotor'?'motor':'servo'}`,run:()=>{const kin=structuredClone(project.kinematics),x=kin.actuators.find(y=>y.id===a.id),taken=new Set([x.device,x.device2,...(x.more||[]).map(y=>y.device)].filter(Boolean)),base=(x.device||window.DeckActuators?.camel?.(x.name)||'part').replace(/\d+$/,'');let c=2;while(taken.has(base+c))c++;
        if(!x.device2)x.device2=base+c;else x.more=[...(x.more||[]),{device:base+c}];project.kinematics=window.DeckKinematics.sanitize(kin);save();mechanismsPanel();reload();}});
      out.push({label:'A mechanism that rides on it…',run:()=>pick(id)});}
    if(key==='group:intake')out.push({label:'A mechanism in the Intake…',run:()=>pick(null)});
    if(item.key!=='chassis'&&!key.startsWith('chassis:')&&!item.members&&!key.startsWith('kin:'))out.push({label:'A sensor',run:()=>{garagePick=key;garage();const s=document.querySelector(`#${CSS.escape(item.el?.id||'')} [data-wire-sensor-add]`)||item.el?.querySelector?.('[data-wire-sensor-add]');s?.scrollIntoView({block:'center'});s?.focus();}});
    if(key.startsWith('kin:'))out.push({label:'A sensor',run:()=>{garagePick=key;garage();const s=document.querySelector(`[data-mech="${CSS.escape(key.slice(4))}"] [data-wire-sensor-add]`)||item.el?.querySelector?.('[data-wire-sensor-add]');s?.scrollIntoView({block:'center'});s?.focus();}});
    return out;}
  // Right-click Rename: a CAD mechanism takes the name itself (it is that part's name everywhere); any other tile keeps it as its tile's name.
  function tileRename(key,name){name=String(name||'').trim().slice(0,40);
    if(key.startsWith('kin:')){const id=key.slice(4),kin=structuredClone(project.kinematics),j=kin.joints.find(x=>x.id===id);if(!j||!name)return;const was=j.name;j.name=name;for(const a of kin.actuators)if(a.joint===id&&(a.name===was||!a.name))a.name=name;project.kinematics=window.DeckKinematics.sanitize(kin);save();mechanismsPanel();reload();return;}
    const names={...(project.railNames||{})};if(name)names[key]=name;else delete names[key];project.railNames=names;save();garage();}
  {const menu=document.createElement('div');menu.id='mech-tile-menu';menu.className='sim-setup-menu';menu.setAttribute('role','menu');menu.hidden=true;document.body.append(menu);let target=null;
    const hide=()=>{menu.hidden=true;target=null;};
    $('#mech-rail').addEventListener('contextmenu',e=>{const t=e.target.closest('[data-garage]');if(!t)return;e.preventDefault();target=t.dataset.garage;const d=tileDelete(target),title=garageItems().find(i=>i.key===target)?.title||'it';
      const adds=tileAdds(target);menu._adds=adds;
      menu.innerHTML=`<button type="button" role="menuitem" data-tile-act="rename">Rename…</button>${adds.length?`<span class="sim-mech-label" style="margin:6px 12px 2px">Add</span>${adds.map((a,n)=>`<button type="button" role="menuitem" data-tile-add="${n}">+ ${escText(a.label)}</button>`).join('')}`:''}<button type="button" role="menuitem" data-tile-act="delete" class="danger"${d?.run?'':' disabled'}>${escText(d?.label||`Delete ${title}`)}</button>${d?.why?`<p class="hint" style="margin:4px 12px 6px;max-width:220px">${escText(d.why)}.</p>`:''}`;menu.setAttribute('aria-label',`${title}: actions`);menu.hidden=false;
      const r=t.getBoundingClientRect(),x=e.clientX||r.left+16,y=e.clientY||r.bottom;menu.style.left=Math.max(4,Math.min(x,innerWidth-menu.offsetWidth-4))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-menu.offsetHeight-4))+'px';menu.querySelector('button:not(:disabled)')?.focus();});
    menu.addEventListener('click',e=>{const add=e.target.closest('[data-tile-add]');if(add){const a=menu._adds?.[+add.dataset.tileAdd];hide();a?.run();return;}
      if(e.target.closest('[data-tile-act=rename]')){const key=target,item=garageItems().find(i=>i.key===key);menu.innerHTML=`<form data-tile-rename style="display:grid;gap:6px;padding:6px 8px"><label class="sim-mech-label" for="mech-tile-name">Name</label><input id="mech-tile-name" maxlength="40" autocomplete="off" value="${escText(item?.title||'')}"><div class="button-row"><button type="submit" class="primary">Save</button>${key.startsWith('kin:')?'':`<button type="button" class="secondary" data-tile-reset>Reset</button>`}</div></form>`;menu.dataset.key=key;const inp=menu.querySelector('input');inp.focus();inp.select();return;}
      if(e.target.closest('[data-tile-reset]')){const key=menu.dataset.key;hide();tileRename(key,'');return;}
      if(!e.target.closest('[data-tile-act=delete]'))return;const key=target,d=tileDelete(key);hide();if(d?.run){d.run();status('#mech-list-status','Deleted.');}});
    menu.addEventListener('submit',e=>{e.preventDefault();const key=menu.dataset.key,v=menu.querySelector('#mech-tile-name')?.value;hide();tileRename(key,v);status('#mech-list-status','Renamed.');});
    // F2 renames the focused tile.
    $('#mech-rail').addEventListener('keydown',e=>{if(e.key!=='F2')return;const t=e.target.closest('[data-garage]');if(!t)return;e.preventDefault();t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));menu.querySelector('[data-tile-act=rename]')?.click();});
    document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target))hide();},true);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden)hide();});
    // The Delete key does the same on a focused tile.
    $('#mech-rail').addEventListener('keydown',e=>{if(e.key!=='Delete')return;const t=e.target.closest('[data-garage]');const d=t&&tileDelete(t.dataset.garage);if(d?.run){e.preventDefault();d.run();}});}
  $('#mech-rail').addEventListener('click',e=>{const a=e.target.closest('[data-garage-add]');if(a){const fam=a.dataset.garageAdd;
      if(fam==='chassis'){mechList.close();openChassisAdd();return;}
      mechList.open({parent:fam.slice(4)});garagePick='picker';garage();return;}});
  $('#mech-rail').addEventListener('click',e=>{const b=e.target.closest('[data-garage]');if(b)chassisAdding=false;if(!b)return;garagePick=b.dataset.garage;mechList.close();garage();$('.sim-mech-main').scrollTop=0;});
  mechanismsPanel();presetPanel();
  // Setup runs in order like Path planning: 1 Field, 2 Robot, 3 Mechanisms, 4 Robot controller (its sensing and the
  // ports of everything set up before it, so Set up from the Control Hub can match every device at once).
  // Mechanisms on every field: what the robot has, each with what drives it. Picking up and shooting pieces (the game's
  // intakes and shooters, their timing and preloads) belong to BIOBUZZ; elsewhere every mechanism moves by route actions.
  // What runs the robot is a part of Chassis (Mechanisms → Chassis → Robot controller), so it has no step of its own; a kit,
  // whose Mechanisms is closed, keeps its ports and hub mounting on a page of its own, named Chassis.
  function stepHidden(step){const p=project.robotPreset&&MECH.PRESETS[project.robotPreset];return step==='controller'?!p?.adjustable:!!p&&step==='mechanisms';}
  // A ready-made robot has no CAD to import, so its step stays Robot.
  const stepName=s=>s==='robot'&&project.robotPreset?'Robot':SETUP_NAMES[s];
  function setupSteps(){const game=L().field==='biobuzz',page=document.querySelector('[data-setup-page=mechanisms]');
    const shown=SETUP_ORDER.filter(s=>!stepHidden(s));for(const s of SETUP_ORDER){const b=$(`#sim-setup-step-${s}`);b.hidden=stepHidden(s);b.textContent=`${shown.indexOf(s)+1} · ${stepName(s)}`;}
    const after=s=>shown[shown.indexOf(s)+1]||'plan',before=s=>shown[shown.indexOf(s)-1]||'field';
    for(const [s,dir] of [['field','next'],['robot','next'],['mechanisms','next'],['mechanisms','back'],['controller','back']]){const b=document.querySelector(`[data-setup-page=${s}] .sim-setup-nav ${dir==='next'?'.primary':'.secondary'}[data-setup-go]`);if(!b)continue;const to=dir==='next'?after(s):before(s);b.dataset.setupGo=to;b.textContent=dir==='next'?(to==='plan'?'Next: path planning →':`Next: ${stepName(to)==='CAD'?'CAD':stepName(to).toLowerCase()} →`):'← Back';}
    page.querySelector('h2+.hint').textContent='Everything on your robot that moves. Your CAD is where each part starts: that pose is 0.';
    page.dataset.game=String(game);for(const id of ['#mech-flywheel','#mech-preloads'])if(!game)$(id).hidden=true;
  }
  // Asked by the main process before the window closes: the setup being set up (Setup open, Path planning not yet), or null.
  window.deckUnfinishedSetup=()=>active&&tab==='setup'&&!project.setupDone?project.setupName:null;
  function setupStepPanel(){setupSteps();for(const p of $$('[data-setup-page]'))p.hidden=p.dataset.setupPage!==setupStep;queueMicrotask(()=>{presetPanel();setupStep==='mechanisms'?mechanismsPanel():mechModel();if(setupStep==='mechanisms')joints.shown();});for(const b of $$('[data-setup-step]')){const on=b.dataset.setupStep===setupStep;b.setAttribute('aria-selected',String(on));b.setAttribute('aria-pressed',String(on));b.tabIndex=on?0:-1;}}
  function showSetupStep(step){if(step==='plan')return $('#sim-setup-next').click();if(stepHidden(step))step=SETUP_ORDER.filter(s=>!stepHidden(s)&&SETUP_ORDER.indexOf(s)<SETUP_ORDER.indexOf(step)).at(-1)||'robot';const held=setupGate();if(held&&SETUP_ORDER.indexOf(step)>SETUP_ORDER.indexOf(held))step=held;setupStep=step;project.setupStep=step;project.setupFocus='';setupStepPanel();setupGate();window.scrollTo(0,0);save();}
  for(const b of $$('[data-setup-step]'))b.onclick=()=>showSetupStep(b.dataset.setupStep);
  for(const b of $$('[data-setup-go]'))b.onclick=()=>showSetupStep(b.dataset.setupGo);
  $('#sim-panel-setup').addEventListener('input',e=>{if(e.target.type==='number')stageMarks();});
  setupStepPanel();
  $('#sim-setup-next').onclick=()=>{if(setupGate())return showSetupStep(setupGate());selectTab('plan');setStep('start');void setView('2d');};$('#sim-step-start').onclick=()=>setStep('start');$('#sim-step-zones').onclick=()=>setStep('zones');$('#sim-step-pins').onclick=()=>setStep('pins');$('#sim-zones-next').onclick=()=>setStep('pins');$('#sim-plan-next').onclick=()=>selectTab('run');
  $('#sim-start-next').onclick=()=>{try{commit(tool==='start'?preview:start);setStep(hasObstacleStep()?'zones':'pins');}catch(e){status('#start-status',e.message);}};
  $('#sim-run-sensors').onclick=()=>{selectTab('setup');$('#sim-localization').focus();};$('#sim-run-plan').onclick=()=>{const b=routeBlocked();if(b?.pin!=null)return editPath(b.pin);selectTab('plan');setStep(L().start?'pins':'start');};
  // + Add path ends a new path one tile from the last point, toward the middle of the field
  // (or across it, from the middle).
  $('#sim-add-path').onclick=()=>{const from=L().pins.at(-1)||start,b=geometry().bounds,c={x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2},d=Math.hypot(c.x-from.x,c.y-from.y),reach=24;
    addPin(d>reach?{x:from.x+(c.x-from.x)/d*reach,y:from.y+(c.y-from.y)/d*reach}:{x:from.x,y:from.y+(from.y<c.y?reach:-reach)});$('#sim-pin-list .selected')?.scrollIntoView({block:'nearest'});};
  $('#sim-obstacle-step').append($('#sim-zone-editor'),$('#sim-clear-zones'));
  function settingsViews(parent,groups){
    const nav=document.createElement('div');nav.className='sim-settings-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Settings view');
    const panes=[];for(const [label,nodes] of groups){const pane=document.createElement('section');pane.className='sim-settings-page';pane.id='sim-settings-'+Math.random().toString(36).slice(2);pane.setAttribute('role','tabpanel');
      for(const node of nodes)if(node)pane.append(node);const button=document.createElement('button');button.type='button';button.textContent=label;button.className='secondary';button.setAttribute('role','tab');button.setAttribute('aria-controls',pane.id);button.onclick=()=>choose(panes.findIndex(p=>p.pane===pane));nav.append(button);parent.append(pane);panes.push({pane,button});}
    function choose(index){panes.forEach(({pane,button},i)=>{pane.hidden=i!==index;button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;if(i===index)button.classList.remove('has-news');});}
    nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const i=panes.findIndex(p=>p.button===document.activeElement),next=(i+(event.key==='ArrowRight'?1:-1)+panes.length)%panes.length;choose(next);panes[next].button.focus();});parent.prepend(nav);choose(0);
    return {choose,shown:()=>panes.findIndex(p=>!p.pane.hidden),panes};
  }
  for(const [id,tools] of [['#sim-obstacle-step',['rect','circle','triangle','shape']],['#sim-route-step',['pin','draw']]]){const group=document.createElement('div');group.className='segmented sim-seg sim-edit-tools';group.setAttribute('role','group');group.setAttribute('aria-label',id.includes('obstacle')?'Add obstacle':'Add paths');for(const tool of tools)group.append($(`[data-tool=${tool}]`));if(id==='#sim-route-step')$('.sim-path-bar').prepend(group);else $(id).insertBefore(group,$(id).children[1]);}
  const routeStep=$('#sim-route-step'),routeChildren=[...routeStep.children],routeSettings=routeChildren.indexOf($('[data-style]').parentElement.previousElementSibling),routeExport=routeChildren.findIndex(n=>n.tagName==='H3');
  const nextRun=$('#sim-plan-next'),exportNodes=routeChildren.slice(routeExport).filter(n=>n!==nextRun);nextRun.remove();
  const routeHelp=n=>n.matches('.sim-legend,.sim-shortcuts')||n.tagName==='P'&&n.textContent.startsWith('Each path');
  // Two views: the paths themselves, and the options for the whole route. Route checks open under the status line
  // above, and the editing help opens over the list from the ? beside + Add path.
  settingsViews(routeStep,[['Paths',routeChildren.slice(0,routeSettings).filter(n=>!routeHelp(n))],['Route options',routeChildren.slice(routeSettings,routeExport)]]);routeStep.append(nextRun);
  liveStatus.after(diagnosticBox('sim-plan-diagnostics'));
  const helpButton=document.createElement('button'),helpPop=document.createElement('div'),helpHead=document.createElement('div'),helpClose=document.createElement('button');
  Object.assign(helpButton,{type:'button',className:'secondary sim-help-button',textContent:'?',title:'How to edit paths, and the keyboard shortcuts'});helpButton.setAttribute('aria-label','Path editing help');helpButton.setAttribute('aria-controls','sim-path-help');helpButton.setAttribute('aria-expanded','false');
  Object.assign(helpPop,{id:'sim-path-help',className:'sim-help-pop',hidden:true});helpPop.setAttribute('role','dialog');helpPop.setAttribute('aria-label','Path editing help');
  Object.assign(helpClose,{type:'button',className:'text-button',textContent:'Close'});helpHead.className='sim-help-head';helpHead.append(Object.assign(document.createElement('h3'),{textContent:'Editing paths'}),helpClose);
  helpPop.append(helpHead,...routeChildren.slice(0,routeSettings).filter(routeHelp));$('.sim-path-bar').append(helpButton);$('.sim-path-bar').after(helpPop);
  const showHelp=open=>{helpPop.hidden=!open;helpButton.setAttribute('aria-expanded',String(open));if(open)helpPop.style.maxHeight=Math.max(160,innerHeight-helpPop.getBoundingClientRect().top-12)+'px';};
  helpButton.onclick=()=>showHelp(helpPop.hidden);helpClose.onclick=()=>{showHelp(false);helpButton.focus();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!helpPop.hidden){e.stopPropagation();showHelp(false);if(helpPop.contains(document.activeElement))helpButton.focus();}},true);
  document.addEventListener('pointerdown',e=>{if(!helpPop.hidden&&!helpPop.contains(e.target)&&!helpButton.contains(e.target))showHelp(false);});
  const runPanel=$('#sim-panel-run'),runChildren=[...runPanel.children],timers=runPanel.querySelector('.sim-grid3'),clock=$('#sim-practice-clock'),programButtons=$('[data-program]').parentElement;
  const programNodes=[programButtons,$('#sim-program-note'),$('#sim-program-preview'),$('#sim-source-box')],outputNodes=runChildren.filter(n=>n.matches('.sim-log,.sim-credit'));
  const timing=document.createElement('section');timing.id='sim-run-timing';timing.className='sim-run-timing';timing.hidden=true;timing.setAttribute('aria-label','Practice timing');
  // Run & review runs the practice from a column beside the field: clock, mode and Run stay in
  // view, and the period lengths and live readout scroll under them on short screens. Both
  // workspace tabs share one field row and fixed-height footer, so the field is the same size.
  const runControls=document.createElement('div'),runDetails=document.createElement('div');runControls.className='sim-run-controls';runDetails.className='sim-run-details';
  // What Run will do, or what to fix first, stays under Run. The controller help and the live readout scroll below,
  // and the period lengths, the same every FTC match, fold into one line.
  const periods=Object.assign(document.createElement('details'),{id:'sim-period-fold',className:'sim-fold sim-period-fold'});periods.append(Object.assign(document.createElement('summary'),{id:'sim-period-summary'}),timers);
  // The column holds the controls and the period lengths, open under the speed; how the run went is in the run report,
  // so the column says something only when there is a problem (the routine lines and the live readout stay hidden).
  periods.open=true;
  runControls.append(clock,$('[data-practice]').parentElement,$('#sim-run').parentElement,periods,$('#sim-run-status'),$('#sim-error'),$('#sim-run-readiness'),$('#sim-run-plan'),$('#sim-run-sensors'));
  runDetails.append($('#sim-practice-help'),$('#sim-telemetry'));
  {const line=runControls.querySelector('#sim-run-status'),routine=/^(Starting|Running|Finished|Practice complete|Stopped|Back at the starting pose|Teleop practice started|Compiling and starting|Simulation closed)/;
    new MutationObserver(()=>line.classList.toggle('sim-routine',!line.textContent||routine.test(line.textContent))).observe(line,{childList:true,characterData:true,subtree:true});line.classList.add('sim-routine');}
  timing.append(runControls,runDetails);
  const fieldRow=document.createElement('div'),fieldFooter=document.createElement('div');fieldRow.className='sim-field-row';fieldFooter.className='sim-field-footer';
  $('#sim-stage').before(fieldRow);fieldRow.append(timing,$('#sim-stage'));fieldRow.after(fieldFooter);fieldFooter.append($('#field-coordinates'),$('#field-help'));practicePanel(null);
  const dataBox=document.createElement('div'),graphsBox=document.createElement('section');dataBox.className='sim-data';graphsBox.className='sim-data sim-run-graphs';
  resultsReady=Object.assign(document.createElement('section'),{id:'sim-results-ready',className:'sim-results-ready'});replayBox=Object.assign(document.createElement('section'),{id:'sim-replay',className:'sim-replay',hidden:true});
  runData=window.DeckSimData.create({panelHost:dataBox,graphsHost:graphsBox,settings:()=>({mechanisms:project.mechanisms,robot:project.robot}),onScrub:f=>{glideStop();frame=f||liveFrame;paint();telemetry();}});
  // The recorded run as a WPILOG file, for sharing or comparing with logs from the real robot.
  const logButton=document.createElement('button'),logStatus=document.createElement('p');logButton.type='button';logButton.className='secondary';logButton.textContent='Save run log (.wpilog)…';logStatus.className='hint';logStatus.setAttribute('role','status');
  logButton.onclick=async()=>{const frames=runData.frames();if(!frames.length){logStatus.textContent='Run the route first; the run is recorded while it plays.';return;}if(!native){logStatus.textContent='Saving run logs needs the installed app.';return;}
    try{const bytes=window.DeckWpilog.fromFrames(frames,{alliance:L().alliance,mechanisms:project.mechanisms,robot:project.robot,name:L().name});logStatus.textContent=(await api.simFile('log-save',{name:L().name,bytes}))?.message||'';}catch(e){logStatus.textContent=e.message;}};
  // A real robot's log on the field beside the plan: where it actually drove and how far it strayed.
  // It folds away under Results until it is wanted; it works before any simulated run.
  const robotLog={data:null,name:''},compareBox=document.createElement('details');compareBox.className='sim-log-compare sim-fold';compareBox.id='sim-log-compare';
  compareBox.innerHTML=`<summary>Compare with a robot log</summary><p class="hint">Open a log from your real robot to draw where it drove (orange) next to the plan and see how far it strayed. WPILOG: a Pose2d entry such as /RealOutputs/Odometry/Robot (FTC field frame, like Deck’s own run logs). CSV: x, y and heading columns.</p>
    <label for="sim-log-origin">CSV coordinates</label><select id="sim-log-origin"><option value="corner">Inches from the bottom-left corner (Deck, Pedro Pathing)</option><option value="center">Inches from the field centre (FTC SDK)</option></select>
    <div class="button-row"><button type="button" class="secondary" id="sim-log-open">Open robot log…</button><button type="button" class="text-button" id="sim-log-clear" hidden>Hide</button></div><dl id="sim-log-result" class="sim-telemetry"></dl><p id="sim-log-status" class="hint" role="status"></p>`;
  const drawRobotLog=()=>{const g=$('#sim-log-path');if(!robotLog.data){g.replaceChildren();return;}g.replaceChildren(svg('polyline',{class:'sim-log-path',points:pts(robotLog.data.poses)}));
    const r=L().route?(()=>{try{return window.DeckRobotLog.compare(robotLog.data,L().route);}catch{return null;}})():null,box=$('#sim-log-result'),row=(k,v)=>box.append(Object.assign(document.createElement('dt'),{textContent:k}),Object.assign(document.createElement('dd'),{textContent:v}));box.replaceChildren();
    row('Log',`${robotLog.name} · ${robotLog.data.key}`);row('Poses',`${robotLog.data.poses.length} over ${(robotLog.data.poses.at(-1).t-robotLog.data.poses[0].t).toFixed(2)} s`);
    if(r){row('From the plan',`average ${r.meanError.toFixed(2)} in · worst ${r.maxError.toFixed(2)} in at (${field.round(r.worst.x)}, ${field.round(r.worst.y)})${r.worstPath!==null?` on path ${r.worstPath+1}`:''}`);row('Stopped',`${r.endError.toFixed(2)} in from the last end point`);if(r.worst)g.append(svg('circle',{class:'sim-log-worst',cx:r.worst.x,cy:r.worst.y,r:1.6}));}
    else row('From the plan','Plan a route to compare');$('#sim-log-clear').hidden=false;};
  compareBox.querySelector('#sim-log-open').onclick=async()=>{const status=compareBox.querySelector('#sim-log-status');if(!native){status.textContent='Opening robot logs needs the installed app.';return;}
    try{const file=await api.simFile('robot-log-open');if(!file)return;robotLog.data=window.DeckRobotLog.parse(file,{origin:$('#sim-log-origin').value});robotLog.name=file.name;drawRobotLog();status.textContent=robotLog.data.others.length?`Also in this log: ${robotLog.data.others.slice(0,4).join(', ')}.`:'';}catch(e){status.textContent=e.message;}};
  compareBox.querySelector('#sim-log-clear').onclick=()=>{robotLog.data=null;drawRobotLog();$('#sim-log-result').replaceChildren();$('#sim-log-clear').hidden=true;};
  compareBox.querySelector('#sim-log-origin').onchange=()=>{if(robotLog.data?.format==='csv')compareBox.querySelector('#sim-log-status').textContent='Open the CSV again to use these coordinates.';};
  const logNodes=[Object.assign(document.createElement('h3'),{textContent:'Run log'}),Object.assign(document.createElement('p'),{className:'hint',textContent:'The last run with every value, in the WPILOG format FTC and FRC log viewers read.'}),logButton,logStatus];
  // Run videos, filmed by a camera of their own rather than from the window: 2D looks straight down at the whole
  // field; 3D follows the robot and turns to the goal while it shoots, with the whole field in a corner. Record
  // beside Run films the next run (or the one playing) with the camera of the view on screen, 2D or 3D. When the
  // run ends the take plays under Run with Save and Discard. Export → Run video films one period of the last run
  // again by replaying it at real speed.
  const Video=window.DeckSimVideo,video={armed:false,live:false,ending:false,preparing:false,began:0,exportView:'3d'};
  const viewNow=()=>project.view==='3d'?'3d':'2d',elapsedText=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  // The last take, kept until it is discarded or replaced: {blob, url, view, section, seconds}.
  let take=null,liveTimer=0;
  root.querySelector('.simulation-layout').after(Object.assign(document.createElement('section'),{id:'sim-panel-video',className:'sim-studio',hidden:true}));
  $('#sim-panel-video').dataset.panel='video';$('#sim-panel-video').setAttribute('role','tabpanel');$('#sim-panel-video').setAttribute('aria-labelledby','sim-tab-video');
  // What the video films: the run frame and trail now, the view, and when its clock starts.
  let videoShow=null,videoCam=null;
  async function videoCamera(){
    await three();await script('sim-3d.js');const key=JSON.stringify([info?.field,info?.bounds]);
    if(videoCam?.key!==key){videoCam?.cam.dispose();videoCam={key,cam:window.DeckSim3D.create(document.createElement('div'),{video:true,style:$('#sim-stage')})};}
    await videoCam.cam.setField(info,L());videoCam.cam.setModel(fieldRig());videoCam.cam.size(1280,720);return videoCam.cam;
  }
  // Where each shooter is and the goals it can aim at, so the video can draw its aim.
  function videoAim(){const m=MECH.sanitize(project.mechanisms);if(L().field!=='biobuzz'||!m.enabled||!m.shooters.length)return null;
    return {shooters:m.shooters,dims:{length:project.robot.length,width:project.robot.width},targets:['start','other'].map(cell=>MECH.target(m,L().field,L().alliance,cell))};}
  // What the video cameras know of the robot (sim-cameras.js): its size, mechanisms and CAD parts, the aim, and the
  // turrets drawn as stand-ins on its top (the cameras ride on them and keep out of them).
  const cameraBase=aim=>({footprint:info?.footprint,bounds:info?.bounds,robot:project.robot,aim,mechanisms:MECH.sanitize(project.mechanisms),parts:project.model?.parts,turrets:fieldRig()?.userData?.kin?.turrets||[]});
  // A replay can hand each picture its camera pose (videoShow.pose); live filming works the camera out as it goes.
  const videoRec=Video.create({frame:()=>videoShow?.frame(),name:()=>L().name,start:()=>videoShow?.start??runData.frames()[0]?.time??0,
    shoot:dt=>{const f=videoShow.frame();return videoCam.cam.shoot(f,{...state3d(),trail:videoShow.trail(),aim:videoShow.aim},dt,videoShow.view==='2d'?'top':'chase',videoShow.pose?.(f));}});
  const recordButton=$('#sim-record'),recordStatus=Object.assign(document.createElement('p'),{id:'sim-record-status',className:'hint'}),videoSection=document.createElement('select'),videoButton=document.createElement('button'),videoStatus=document.createElement('p');
  const takeBox=Object.assign(document.createElement('section'),{id:'sim-record-result',className:'sim-record-result',hidden:true,innerHTML:`<div class="sim-record-result-text"><strong id="sim-record-title">Recording ready</strong><span id="sim-record-meta"></span><p id="sim-record-note" class="hint">It is open in the Video editor tab. Not saved yet: recording again or closing the app discards it.</p></div>
    <div class="sim-record-actions"><button id="sim-record-edit" class="primary" type="button">Edit video</button><button id="sim-record-discard" class="secondary" type="button">Discard</button></div>`});
  takeBox.setAttribute('aria-labelledby','sim-record-title');
  const videoView=Object.assign(document.createElement('div'),{innerHTML:segmented('videoview',Video.VIEWS,'Video camera')}).firstElementChild;videoView.id='sim-video-view';
  // The take opens at the top of the column's scrolling part, so a short window scrolls to Save rather than cutting it off.
  recordStatus.setAttribute('role','status');recordStatus.hidden=true;recordButton.parentElement.after(recordStatus);runDetails.prepend(takeBox);
  videoSection.id='sim-video-section';videoSection.innerHTML=options(Video.SECTIONS,'auto');videoButton.type='button';videoButton.className='secondary';videoButton.id='sim-video-save';videoStatus.className='hint';videoStatus.setAttribute('role','status');
  const videoSay=text=>{videoStatus.textContent=recordStatus.textContent=text;recordStatus.hidden=!text;};
  // The button says what it will do: which camera it films with, that it is waiting for Run, or how long it has filmed.
  const videoButtons=()=>{const v=video.live?videoShow?.view||viewNow():viewNow(),name=v.toUpperCase();
    recordButton.setAttribute('aria-pressed',String(video.armed||video.live));recordButton.classList.toggle('recording',video.live);recordButton.classList.toggle('armed',video.armed&&!video.live);
    recordButton.textContent=video.ending?'Finishing the video…':video.live?`Stop recording · ${elapsedText((performance.now()-video.began)/1000)}`:video.armed?`Armed · ${name} · press Run`:video.preparing?'Getting the camera ready…':`Record ${name} video`;
    recordButton.title=video.live?'Stop filming now. The video is ready to save under Run.':video.armed?'The next run is filmed. Click to cancel.':`Film the next run ${v==='2d'?'top-down (2D)':'following the robot (3D)'}. Switch 2D / 3D above the field to change the camera.`;
    recordButton.disabled=!native||!!videoReplay||video.ending||video.preparing;
    pressedIn(videoView,'videoview',video.exportView);videoButton.textContent=videoReplay?'Cancel video':'Save video of the last run…';};
  videoRefresh=videoButtons;
  // The Video editor tab is there after any run that ended, problems and all (a run that touched something replays
  // each contact in the video), and while a recording is open: opening it edits the run's own cameras; a recording
  // also keeps its filmed take. Autonomous, teleop or a full match: a run has ended once nothing is running, or once
  // the robot finishes in an autonomous on its own, whose clock only holds it still.
  let studioRun=null;
  let openAfterRun=false;
  const runEnded=()=>{const F=runData.frames();return F.length>1&&F.at(-1).time-F[0].time>.05&&(runState==='idle'||project.practice.mode==='autonomous'&&!!lastReport);};
  const runReady=()=>!!take||runEnded();
  // Where the run touched a wall, a field structure or a no-go zone, for the video's contact replays: the run report's
  // contacts (seconds from the first frame), each at the point of the robot's outline that is in or against what it
  // touched. A second touch of the same thing within 2 s is the same contact.
  const CONTACT_LABEL={wall:'the field wall',field:'a field structure',zone:'a no-go zone'};
  function videoCrashes(frames){
    const clamp=(v,a,z)=>Math.max(a,Math.min(z,v));let report=null;try{report=window.DeckSimReport.build(frames,{pins:L().pins,whole:true});}catch{}if(!report?.contacts?.length||!info)return [];
    const t0=frames[0].time,zones=[...(info.fieldZones||[]),...(L().zones||[])],b=info.bounds||{x0:0,y0:0,x1:144,y1:144},out=[],last={};
    for(const c of report.contacts){if(last[c.id]!==undefined&&c.time-last[c.id]<2){last[c.id]=c.time;continue;}last[c.id]=c.time;
      const f=frames[Math.max(0,frames.findIndex(x=>x.time-t0>=c.time-1e-6))],p=f?.truth;if(!p)continue;
      const corners=planner.body({x:p.x,y:p.y,heading:p.heading},info.footprint),edge=[];
      corners.forEach((a,n)=>{const z=corners[(n+1)%4];for(let k=0;k<10;k++)edge.push({x:a.x+(z.x-a.x)*k/10,y:a.y+(z.y-a.y)*k/10});});
      let hit=[];
      if(c.id==='field-wall')hit=edge.filter(q=>q.x<=b.x0+.5||q.x>=b.x1-.5||q.y<=b.y0+.5||q.y>=b.y1-.5).map(q=>({x:clamp(q.x,b.x0,b.x1),y:clamp(q.y,b.y0,b.y1)}));
      else{const zone=zones.find(z=>z.id===c.id);let poly=null;try{poly=zone&&planner.polygon(zone);}catch{}
        if(poly?.length){hit=edge.filter(q=>planner.contains(q,poly));
          if(!hit.length){const away=q=>Math.min(...poly.map((a,n)=>{const z=poly[(n+1)%poly.length],dx=z.x-a.x,dy=z.y-a.y,l=dx*dx+dy*dy,k=l?clamp(((q.x-a.x)*dx+(q.y-a.y)*dy)/l,0,1):0;return Math.hypot(q.x-a.x-dx*k,q.y-a.y-dy*k);}));
            hit=[edge.reduce((m,q)=>away(q)<away(m)?q:m)];}}}
      const at=hit.length?{x:hit.reduce((s,q)=>s+q.x,0)/hit.length,y:hit.reduce((s,q)=>s+q.y,0)/hit.length}:{x:p.x,y:p.y};
      out.push({at:c.time,x:at.x,y:at.y,label:CONTACT_LABEL[c.kind]||'something'});if(out.length>=8)break;}
    return out;
  }
  function videoTab(){$('#sim-tab-video').hidden=false;$('#sim-tab-video').dataset.state=runReady()?'done':'';if(!runReady()&&tab==='video')selectTab('run');
    if(openAfterRun&&runReady()&&!video.live){openAfterRun=false;videoSay('');void editRun();}}
  async function editRun(){
    if(!runReady()&&runState!=='idle'){openAfterRun=true;videoSay('The Video editor opens when this run ends.');return;}
    if(!runReady()){const d=$('#sim-video-run'),what={autonomous:'the autonomous',teleop:'teleop',match:'the full match'}[project.practice.mode];$('#sim-video-run-title').textContent=`Run ${what} first`;d.querySelector('p').textContent=`The Video editor films a run. Run ${what} now and the editor opens on it when it ends.`;d.returnValue='';d.addEventListener('close',()=>{if(d.returnValue!=='run')return;if(setupGate()){selectTab('setup');return showSetupStep(setupGate());}openAfterRun=true;selectTab('run');$('#sim-run').click();},{once:true});d.showModal();$('#sim-video-run-yes').focus();return;}
    const first=runData.frames()[0];if(take||studioRun===first&&studio)return selectTab('video');try{await openStudio(runData.frames(),viewNow());studioRun=first;}catch(e){status('#sim-run-status',e.message);}}
  function dropTake(){take=null;takeBox.hidden=true;studio?.clear();studioRun=null;videoTab();}
  // A finished take opens in the Video editor, with the run it filmed, so it can be cut between cameras and exported.
  function showTake(blob,view,section,seconds,frames){
    dropTake();if(!blob?.size){videoSay('Nothing was filmed.');return;}
    take={blob,view,section,seconds};
    takeBox.querySelector('#sim-record-meta').textContent=`${view.toUpperCase()} · ${elapsedText(seconds)} · ${(blob.size/1048576).toFixed(1)} MB`;takeBox.hidden=false;videoSay('');
    void openStudio(frames,view).catch(e=>videoSay(e.message||'The Video editor could not open.'));
  }
  takeBox.querySelector('#sim-record-edit').onclick=()=>{if(!take)return;$('#sim-tab-video').hidden=false;selectTab('video');};
  takeBox.querySelector('#sim-record-discard').onclick=()=>{dropTake();videoSay('Recording discarded.');};
  async function openStudio(frames,view){
    if(!frames?.length)throw Error('The run was not recorded, so it cannot be edited.');
    frames=Video.editable(frames);await script('sim-edit.js');await script('sim-encode.js');await script('sim-studio.js');
    studio=studio||window.DeckStudio.create({host:$('#sim-panel-video'),camera:videoCamera,
      save:async(bytes,ext,name)=>{if(!native)return 'Saving videos needs the installed app.';const r=await api.simFile('video-save',{name:`${String(name||'').replace(/[^\w -]+/g,'').replace(/\s+/g,' ').trim().slice(0,60)||'Deck run'} - edited`,ext,bytes});return r?.message||'The video was not saved.';},
      saveOriginal:async()=>{if(!take)return 'The recording is gone.';await saveVideo(take.blob,take.section,take.view);return videoStatus.textContent;},
      discard:()=>{dropTake();videoSay('Recording discarded.');}});
    $('#sim-tab-video').hidden=false;selectTab('video');const aim=videoAim();
    await studio.load({frames,view,name:L().name,ctx:cameraBase(aim),crashes:videoCrashes(frames),
      state:{layout:L(),start,info,hitboxes:false,preview:null,aim}});
  }
  const videoFrames=()=>Video.editable(runData.frames());
  // The parts this run has; a part it does not have (the autonomous of a teleop run) gives way to one it does.
  const videoSections=()=>{const s=Video.sections(videoFrames());for(const o of videoSection.options)o.disabled=!s[o.value];if(s.all&&!s[videoSection.value])videoSection.value=s.auto?'auto':s.teleop?'teleop':'all';return s;};
  async function saveVideo(blob,section,view){
    if(!blob?.size){videoSay('Nothing was filmed.');return;}
    videoSay('Choose where to save the video…');
    try{const r=await api.simFile('video-save',{name:Video.title(L().name,section,view),ext:videoRec.ext(),bytes:new Uint8Array(await blob.arrayBuffer())});videoSay(r?.message||'The video was not saved.');}catch(e){videoSay(e.message);}
  }
  async function endLive(wait){
    clearInterval(liveTimer);video.ending=true;openAfterRun=false;videoButtons();if(wait)await new Promise(r=>setTimeout(r,wait));
    const blob=await videoRec.stop(),view=videoShow?.view||viewNow(),seconds=(performance.now()-video.began)/1000,from=videoShow?.from,all=runData.frames(),filmed=all.filter(f=>!(from>f.time+1e-6));
    videoRec.close();videoShow=null;Object.assign(video,{armed:false,live:false,ending:false});videoButtons();
    showTake(blob,view,{autonomous:'auto',teleop:'teleop'}[project.practice.mode]||'all',seconds,(filmed.length>1?filmed:all).slice());
  }
  // Called with every transport update: filming starts when the run does and ends shortly after it stops.
  // The camera is the view on screen when filming starts. Autonomous practice stops a second after the robot's
  // autonomous finishes rather than waiting out the period's clock.
  videoCheck=event=>{
    if(video.armed&&!video.live&&!video.ending&&runState==='running'){
      // The camera films the picture on screen: the glide's while the robot moves, so the video moves as smoothly.
      const view=viewNow();videoShow={view,aim:videoAim(),start:null,from:frame?.time,frame:()=>glide.shown||frame,trail:()=>trail};
      try{videoRec.begin();Object.assign(video,{live:true,began:performance.now()});liveTimer=setInterval(videoButtons,250);
        videoSay(`Recording in ${view.toUpperCase()}. It stops when ${project.practice.mode==='autonomous'?'the autonomous finishes':project.practice.mode==='teleop'?'the teleop period ends':'the match ends'}, or press Stop recording.`);}
      catch(e){videoRec.close();videoShow=null;video.armed=false;videoSay(e.message);}videoButtons();}
    else if(video.live&&!video.ending&&(runState==='idle'||event==='finished'&&project.practice.mode==='autonomous'))void endLive(event==='finished'?1000:700);
    // A run event: the run may just have ended, whichever period it was, so the tab and the parts catch up.
    if(event){if(event==='error')openAfterRun=false;videoSections();videoTab();}
  };
  // One press arms Record with the camera of the view on screen (the field model loads once); Run starts filming.
  recordButton.onclick=async()=>{
    if(video.live){void endLive(0);return;}
    if(video.armed){video.armed=false;videoSay('Recording cancelled.');videoButtons();return;}
    video.preparing=true;videoButtons();
    try{await videoCamera();}catch(e){video.preparing=false;videoSay(e.message||'Recording could not start.');videoButtons();return;}
    Object.assign(video,{preparing:false,armed:true});videoSay(runState==='running'?'':'Record is on. Press Run and the run is filmed with the camera of the view on screen; switch 2D / 3D above the field to change it.');videoButtons();videoCheck();
  };
  for(const b of videoView.querySelectorAll('[data-videoview]'))b.onclick=()=>{video.exportView=b.dataset.videoview;videoButtons();};
  videoSection.onfocus=videoSections;
  videoButton.onclick=async()=>{
    if(videoReplay){videoReplay.cancel=true;return;}
    const frames=videoFrames().slice(),parts=videoSections(),section=videoSection.value,range=parts[section],view=video.exportView;
    if(!frames.length)return videoSay('Run the robot first; every run is recorded while it plays.');
    if(!range)return videoSay(`The last run has no ${Video.SECTIONS[section].toLowerCase()} period. Choose another part.`);
    if(!native)return videoSay('Saving videos needs the installed app.');
    if(runState==='starting'||frame?.playing||video.armed||video.preparing)return videoSay('Stop the run (and Record) first, then save its video.');
    // The replay plays on the video's camera only; the field in the window is left as it is.
    const list=frames.slice(range[0],range[1]+1),t0=list[0].time,span=list.at(-1).time-t0,replay={cancel:false,i:0,began:0,trail:trailAdd([],list[0])};
    videoReplay=replay;videoButtons();videoSay(`Getting the ${view.toUpperCase()} camera ready…`);
    const elapsed=()=>replay.began?(performance.now()-replay.began)/1000:0;
    let finished=false,failed=false;
    try{
      await videoCamera();if(replay.cancel)throw null;
      videoShow={view,aim:videoAim(),start:t0,trail:()=>replay.trail,frame:()=>{const t=elapsed();while(replay.i<list.length-1&&list[replay.i+1].time-t0<=t){replay.i++;replay.trail=trailAdd(replay.trail,list[replay.i]);}return list[replay.i];}};
      // In 3D the replay films with the Video editor's camera 1, worked out over the whole part: it moves clear of the
      // field before it gets there (live Record has only the run so far).
      if(view==='3d'){const K=window.DeckCameras,base=cameraBase(videoShow.aim),track=K.path('main',list,{...base,rig:K.rig(base),field:K.field(info)});videoShow.pose=f=>K.poseAt(track,list,f.time);}
      replay.began=performance.now();videoRec.begin();
      await new Promise(resolve=>{const timer=setInterval(()=>{const t=elapsed();if(replay.cancel){clearInterval(timer);return resolve();}
        const shown=`Filming the ${Video.SECTIONS[section].toLowerCase()} in ${view.toUpperCase()}… ${Math.min(t,span).toFixed(0)} of ${span.toFixed(0)} s`;if(videoStatus.textContent!==shown)videoSay(shown);
        if(t>=span+.6){finished=true;clearInterval(timer);resolve();}},100);});
    }catch(e){if(e){failed=true;videoSay(e.message);}}
    const blob=await videoRec.stop();videoRec.close();videoShow=null;videoReplay=null;videoButtons();
    if(finished)await saveVideo(blob,section,view);else if(!failed)videoSay('Video cancelled.');
  };
  const videoNodes=[Object.assign(document.createElement('h3'),{textContent:'Run video'}),Object.assign(document.createElement('p'),{className:'hint',textContent:'Replays the last run at real speed with the clock and points on it. 2D shows the whole field; 3D follows the robot. To film while you drive, press Record beside Run.'}),
    Object.assign(document.createElement('label'),{textContent:'Camera'}),videoView,Object.assign(document.createElement('label'),{htmlFor:'sim-video-section',textContent:'Part of the run'}),videoSection,videoButton,videoStatus];
  videoButtons();
  // Diagnostics: two cards to pick from, each with its own count, the route's checks and warnings or the last run's
  // output, then the one picked.
  const diagViews={checks:{title:'Route checks',text:'Whether every path keeps the robot clear, and warnings about this setup.',nodes:[diagnosticBox('sim-run-diagnostics')]},
    output:{title:'Run output',text:'What the last run did, step by step, and anything your Java program prints.',nodes:outputNodes}};
  const diagPick=Object.assign(document.createElement('div'),{className:'sim-diag-pick'});diagPick.setAttribute('role','group');diagPick.setAttribute('aria-label','Diagnostics view');
  for(const [key,{title,text}] of Object.entries(diagViews)){const b=Object.assign(document.createElement('button'),{type:'button',className:'sim-diag-card',title:text});b.dataset.diagview=key;
    b.append(Object.assign(document.createElement('span'),{className:'sim-diag-title',textContent:title}),Object.assign(document.createElement('strong'),{className:'sim-diag-value'}));diagPick.append(b);}
  const showDiag=view=>{pressedIn(diagPick,'diagview',view);for(const [key,{nodes}] of Object.entries(diagViews))for(const n of nodes)n.hidden=key!==view;};
  for(const b of diagPick.querySelectorAll('[data-diagview]'))b.onclick=()=>showDiag(b.dataset.diagview);showDiag('checks');
  // Export: Send to robot (FTC), then the files to save with their options, what Run plays, and saving the last run.
  // The on-robot checklist is in Calibrate.
  const exportCard=(id,title,nodes)=>{const c=Object.assign(document.createElement('section'),{id,className:'sim-export-card'});if(title)c.append(Object.assign(document.createElement('h3'),{textContent:title}));c.append(...nodes.filter(Boolean));return c;};
  const saveTiles=Object.assign(document.createElement('div'),{className:'sim-save-tiles'});saveTiles.append(exportCard('sim-run-log-tile','',logNodes),exportCard('sim-run-video-tile','',videoNodes));
  const sendHome=Object.assign(document.createElement('div'),{id:'sim-send-home'});sendHome.append($('#sim-send'));
  const exportView=[$('#sim-export-title'),sendHome,exportCard('sim-export-files','Save to a file',[$('.sim-export-buttons'),$('#sim-execution-note'),$('#sim-export-status'),$('#sim-export-options')]),
    exportCard('sim-run-program','What Run plays',programNodes),exportCard('sim-run-save','Save this run',[saveTiles])];
  // Results first: before any run it says what Run will show, after one the run report leads with what to do next,
  // then the replay and graphs; the robot-log comparison folds away below. Then the code to export, with what Run
  // plays; then the checks and the run's output.
  replayBox.append(Object.assign(document.createElement('h3'),{textContent:'Replay the run'}),dataBox);
  runViews=settingsViews(runPanel,[['Results',[resultsReady,replayBox,$('#sim-run-analysis'),graphsBox,compareBox]],['Export',exportView],['Diagnostics',[diagPick,...diagViews.checks.nodes,...diagViews.output.nodes]]]);runViews.panes[1].button.addEventListener('click',()=>void crossCheck());outputSummary();
  const obstacleStep=$('#sim-obstacle-step');$('#sim-zone-editor').hidden=true;const obstacleHelp=document.createElement('p');obstacleHelp.className='hint';obstacleHelp.textContent='Drag an existing obstacle to move it. Double-click it to edit its dimensions and corners, then press Done to save.';obstacleStep.append(obstacleHelp);
  // Paginate settings blocks when a short viewport cannot fit a whole settings view.
  // No fields are discarded, and the field itself stays in the same viewport.
  const sectionPages=[];
  // Run & review views scroll instead: graphs and logs are one block each.
  for(const pane of $$('.sim-settings-page,#sim-start-controls').filter(p=>!p.closest('#sim-panel-run'))){
    const nodes=[...pane.children],units=[];for(let i=0;i<nodes.length;i++){
      const unit=document.createElement('div');unit.className='sim-settings-unit';unit.append(nodes[i]);
      if(nodes[i].tagName==='LABEL'&&nodes[i+1]&&!nodes[i+1].matches('label,h2,h3'))unit.append(nodes[++i]);
      pane.append(unit);units.push(unit);
    }
    const bar=document.createElement('div');bar.className='sim-section-pages';bar.hidden=true;const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');prev.type=next.type='button';prev.className=next.className='secondary';prev.textContent='← Back';next.textContent='More →';bar.append(prev,label,next);pane.append(bar);
    const entry={pane,units,bar,prev,next,label,page:0};prev.onclick=()=>{entry.page--;fitSettings();};next.onclick=()=>{entry.page++;fitSettings();};sectionPages.push(entry);
  }
  function fitSettings(){
    if(!active||tab==='setup'||tab==='video')return;const shown=sectionPages.filter(e=>!e.pane.closest('[hidden]'));if(!shown.length)return;const bottom=Math.min(innerHeight-12,$('.sim-panel').getBoundingClientRect().bottom);
    for(const e of shown){if(!e.pane.getClientRects().length)continue;for(const unit of e.units)unit.hidden=false;e.bar.hidden=true;
      const footer=e.pane.closest('#sim-route-step')?$('#sim-plan-next'):e.pane.id==='sim-start-controls'?$('#sim-start-next'):null;
      // The path list is never paged away: it scrolls in the height the rest of its view leaves.
      const list=e.pane.querySelector('#sim-pin-list');if(list){e.page=0;const at=e.units.findIndex(unit=>unit.contains(list)),after=e.units.slice(at+1).reduce((sum,unit)=>sum+unit.getBoundingClientRect().height,0);
        list.style.maxHeight=Math.max(150,bottom-list.getBoundingClientRect().top-(footer?footer.getBoundingClientRect().height+14:0)-after-12)+'px';continue;}
      const available=Math.max(90,bottom-e.pane.getBoundingClientRect().top-(footer?footer.getBoundingClientRect().height+14:0)-8),heights=e.units.map(unit=>unit.getBoundingClientRect().height);
      if(heights.reduce((a,b)=>a+b,0)<=available){e.page=0;continue;}
      const pages=[[]];let used=0;for(let i=0;i<e.units.length;i++){const h=heights[i];if(used+h>available-38&&pages.at(-1).length){pages.push([]);used=0;}pages.at(-1).push(i);used+=h;}
      e.page=Math.max(0,Math.min(pages.length-1,e.page));const focused=e.units.findIndex(unit=>unit.contains(document.activeElement));if(focused>=0)e.page=pages.findIndex(page=>page.includes(focused));
      e.units.forEach((unit,i)=>unit.hidden=!pages[e.page].includes(i));e.bar.hidden=false;e.prev.disabled=e.page===0;e.next.disabled=e.page===pages.length-1;const text=`${e.page+1} / ${pages.length}`;if(e.label.textContent!==text)e.label.textContent=text;
    }
  }
  let fitting=false;const scheduleFit=()=>{if(fitting)return;fitting=true;requestAnimationFrame(()=>{fitting=false;fitSettings();});};
  root.addEventListener('click',scheduleFit);root.addEventListener('change',scheduleFit);addEventListener('resize',scheduleFit);
  // Only changes inside a paged section change its pages; the run's graphs and readouts change many times a second
  // and must not make every frame lay out the page again.
  new MutationObserver(list=>{if(list.some(m=>sectionPages.some(e=>e.pane.contains(m.target))))scheduleFit();}).observe($('.sim-panel'),{childList:true,subtree:true,characterData:true});
  for(const b of $$('[data-tab]'))b.onclick=()=>b.dataset.tab==='video'?void editRun():selectTab(b.dataset.tab);
  $('#start-form').addEventListener('submit',event=>{event.preventDefault();try{const pose=Object.fromEntries(['x','y','heading'].map(key=>[key,$('#start-'+key).valueAsNumber]));
    // A heading-only change (X/Y untouched or showing the live turn preview) turns along the wall.
    const same=q=>Math.abs(pose.x-q.x)<1e-6&&Math.abs(pose.y-q.y)<1e-6;
    const typed=$('#start-x').dataset.typed||$('#start-y').dataset.typed;
    commit(!typed&&finite(pose.heading)&&field.heading(pose.heading)!==start.heading&&(same(start)||same(preview))?turnStart(pose.heading):pose);}catch(error){status('#start-status',error.message);}});
  // Typing a heading previews the robot turned along the wall, unless X or Y were typed too: those win.
  for(const key of ['x','y'])$('#start-'+key).addEventListener('input',e=>{e.target.dataset.typed='1';});
  $('#start-heading').addEventListener('input',event=>{event.target.dataset.typed='1';const h=event.target.valueAsNumber;if(!finite(h))return;
    if($('#start-x').dataset.typed||$('#start-y').dataset.typed){const x=$('#start-x').valueAsNumber,y=$('#start-y').valueAsNumber;if(finite(x)&&finite(y))preview={x,y,heading:field.heading(h)};draw();return;}
    preview=turnStart(h);inputValue('#start-x',String(preview.x));inputValue('#start-y',String(preview.y));draw();});
  // Start at edge places the robot at a clear spot by the left wall immediately; drag it from there.
  const startAtEdge=()=>{const next={...(clearStart(geometry())||field.edgePose(start.heading,geometry())),heading:start.heading};try{commit(next);status('#start-status','At a clear spot by the left wall. Drag the robot to move it.');}catch(e){status('#start-status',e.message);}};
  $('#start-edge').onclick=startAtEdge;$('#start-edge-plan').onclick=startAtEdge;
  addEventListener('resize',()=>{paint();pinPanel();});
  function refreshAll(){setupPanel();layoutPanel();inputs();robotPanel();mechanismsPanel();programPanel();practicePanel(null);modelUi();zonePanel();pinPanel();tested();void exportPanel();pressed('view',project.view);draw();transport();calRender();}
  save();selectTab('setup');refreshAll();ensurePresetSetups();
  // ------------------------------------------------------------------ calibrate
  // Calibrate holds the saved-setup bar (moved there while it shows, so setups are picked, made, opened and saved there
  // too) and two tabs. Electronics: reading the Control Hub, this setup's Send
  // to robot panel (moved there while it shows) and the guided check on the left; what the hub reported, port by port, and
  // every motor, servo and sensor on them on the right, once it has been read. Mechanisms: the settings each mechanism runs on
  // (the flywheel's speed and what each shot costs it, the hood angle by flywheel speed, the turret, feeder, intakes and
  // moving parts); the simulation runs on them. What the check measures is read from the check TeleOp generated for the
  // setup: one line for each step it asks about.
  // calTop: Debug is step 3 and Calibrate step 4; both are this page. Calibrate's row is Electronics, Mechanisms and Camera (calTop 'camera': a panel of its own, shown under that row).
  let calibrating=false,calTop='debug',calTab='electronics',camPicked=false;
  window.DeckPartPicker?.install({photo:native?tag=>api.devicePhoto(tag):null});
  const setupBar=$('.sim-setup-bar'),setupHome=setupBar?.nextElementSibling,reliable=document.createElement('div');reliable.id='sim-reliable';reliable.className='sim-reliable';reliable.setAttribute('role','status');reliable.hidden=true;reliable.innerHTML='<span></span><button type="button" class="secondary">Go to Setup &amp; Calibrate</button><button type="button" class="sim-reliable-close" aria-label="Close this note" title="Close">×</button>';setupBar?.after(reliable);
  const RELIABLE_CLOSED='torque-reliable-closed',reliableClosed=()=>{try{return new Set(JSON.parse(localStorage.getItem(RELIABLE_CLOSED)||'[]'));}catch{return new Set();}};
  reliable.querySelector('button').onclick=()=>void api.page('setup');
  reliable.querySelector('.sim-reliable-close').onclick=()=>{const closed=reliableClosed();closed.add(project.setupId);try{localStorage.setItem(RELIABLE_CLOSED,JSON.stringify([...closed]));}catch{}reliableNote();};
  // The simulation stands on its own; Setup and Calibrate only make it more accurate, so this note says so and holds nothing back.
  // It is for a team's own robot: the demos that ship with Torque have no real electronics to set up. A team can close it, for that setup.
  function reliableNote(){const box=document.getElementById('sim-reliable');if(!box)return;const hub=project.calibration?.hub,done=!!hub?.config,tuned=Object.keys(project.calibration?.mechs||{}).length>0;box.hidden=project.controller!=='ftc'||builtin(project.setupId)||!!project.robotPreset||(done&&tuned)||reliableClosed().has(project.setupId);
    box.querySelector('span').textContent=done?'Estimate: your electronics are set up, but nothing is calibrated yet. The real mechanisms may not match this.':'Estimate only: this shows how the robot and its mechanisms should move, with no promise the real robot will. For reliable data, finish Setup & Calibrate so Torque knows what is connected to what.';}
  const calEsc=v=>window.DeckWiring.esc(v);
  const MEASURES=[[/top speed/i,'Top speed, for the flywheel velocity PIDF'],[/^IMU/,'How the hub is mounted, and which way it turns'],[/Pinpoint|OTOS|odometry/i,'Where the pods sit and which way they count'],[/turret/i,'Its zero and how far it turns'],[/kicker|ramp|pusher|gate|servo|arm|claw/i,'Its servo positions'],[/./,'Which way it turns']];
  const calNote=text=>Object.assign(document.createElement('li'),{className:'hint',textContent:text});
  async function calibrateShow(){
    void detectLink();calSelect(calTop==='calibrate'?calTab:calTop);calRender();}
  function calTabs(attr,panel,key){for(const b of $$(`[data-${attr}]`)){const on=b.getAttribute(`data-${attr}`)===key;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}for(const p of $$(`[data-${panel}]`))p.hidden=p.getAttribute(`data-${panel}`)!==key;}
  // Debug comes first and has no tabs. Calibrate is the next step: Electronics, Mechanisms or Camera opens it. Camera is the hub's camera, or the simulated webcam when it has none.
  // What Auto-configure said goes with the first tab change.
  const camHere=()=>{const u=hubUsb();if(Array.isArray(u?.devices))return u.devices.some(r=>r.config==='webcam'||r.config==='limelight');return Array.isArray(u)&&u.some(d=>d.type==='WEBCAM');};
  function camTab(){const b=$('#cal-tab-camera');if(!b)return;const on=camHere()||camPicked,tabs=$('[data-cal-top-tabs]');if(tabs)tabs.hidden=true;const sim=$('#cal-sim-cam');if(sim)sim.hidden=camHere();if(!on&&calTop==='camera')calSelect('debug');}
  function calSelect(key){const was=calTop;if(key==='camera')camPicked=camPicked||!camHere();if(['camera','debug','calibrate'].includes(key))calTop=key;else{calTop='calibrate';calTab=key;}if(calTop!==was)calTold('');calTabs('cal-top','cal-top-panel',calTop);calTabs('cal-tab','cal-panel',calTab);
    // On Camera neither Electronics nor Mechanisms is the tab picked; the row shows for all three, and not on Debug.
    if(calTop==='camera')for(const b of $$('[data-cal-tab]')){b.setAttribute('aria-selected','false');b.tabIndex=-1;}const sub=$('#cal-subtabs');if(sub)sub.hidden=calTop==='debug';camTab();flowMarks();if(calTop==='debug')liveDebug?.recheck?.();usbDevices?.refresh();usbLive?.refresh();}
  for(const attr of ['cal-top','cal-tab'])for(const b of $$(`[data-${attr}]`)){b.onclick=()=>calSelect(b.getAttribute(`data-${attr}`));b.onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const row=[...b.parentElement.querySelectorAll('[role=tab]')].filter(x=>!x.hidden),other=row[(row.indexOf(b)+(e.key==='ArrowRight'?1:row.length-1))%row.length];calSelect(other.dataset.calTop||other.dataset.calTab);other.focus();};}
  // Both tabs follow the setup (another one picked, a device changed in Simulate), only while Calibrate shows.
  let calLayout='';
  function calRender(){if(!calRoot||calRoot.hidden)return;calMechSim();calElectronics();calMechanisms();chassisCal?.refresh();calGates();mechRail();const h=calHubHash();if(liveDebug&&h!==calLayout){calLayout=h;liveDebug.layout();}}
  // Mechanisms' physical calibration measures the robot Simulate describes, so it waits for Simulate's Setup to have nothing in red, and shows only that until then; Electronics never waits.
  function calMechSim(){const box=$('#cal-mech-sim'),body=$('.cal-mech-body'),hub=$('#cal-hub-card');if(!box||!body)return;let red=false;try{red=window.DeckWiring.state(project).problems.some(x=>x.level==='red');}catch{}
    box.hidden=!red;body.hidden=red;if(hub)hub.closest('.cal-mech2').hidden=red;const t=red?'Fix what Simulate → Setup marks in red.':'',q=box.querySelector('[data-mech-sim]');if(q.textContent!==t)q.textContent=t;}
  // Sets a box's HTML only when it changed, keeping the focused control.
  function calHtml(box,html){if(box.dataset.html===html)return;const focus=document.activeElement?.id;box.innerHTML=html;box.dataset.html=html;if(focus)document.getElementById(focus)?.focus();}
  // ---- Electronics: the hub's read-out, then each device (its model, the port it reported and its sensors), drive first.
  function calElectronics(){
    flowMarks();const W=window.DeckWiring,st=W.state(project),ftc=project.controller==='ftc',hub=project.calibration.hub,read=ftc?hub?.readout||null:null;$('#cal-hub-setup').disabled=!ftc;
    // What is plugged in where shows only once it was read from the Control Hub: the port Deck would pick says nothing about the robot.
    const from=read?`<p class="hint">Read from “${calEsc(hub.name||'the configuration')}”${hub.serial?` on Control Hub ${calEsc(hub.serial)}`:''}, ${calEsc(new Date(hub.at).toLocaleString())}. This is what the configuration says, not what is plugged in: Debug shows which I2C and analog devices are really there.</p>`:'';
    sensorCal?.refresh();linksCal?.refresh();const match=$('#cal-hub-match'),same=!!read&&hub.hash===calHubHash();match.hidden=!ftc;match.className=`rs-pill ${!read?'':same?'ok':'warn'}`;match.textContent=!read?'Not read yet':same?'Matches Simulate':'Simulate changed: read it again';
    if($('#cal-hubs'))calHtml($('#cal-hubs'),!ftc?'<p class="hint">This setup runs on a MotionModule, which has no hub ports. Choose FTC Control Hub in Simulate → Setup to set up a Control Hub.</p>':read?from+W.readoutHtml(read,st):'<p class="hint" data-cal-unread>Nothing read yet. Plug the Control Hub in by USB-C and press Set up from the Control Hub: what its configuration has on each port shows here, with the motors, servos and sensors.</p>');
    
  }
  // A model or sensor picked here is not a change to what the hub reported, so a read that was current stays current.
  function calKeepRead(change){const hub=project.calibration.hub,fresh=!!hub&&hub.hash===calHubHash();change();if(fresh){hub.hash=calHubHash();calSave();}else calRender();}
  // Heading and position sensing, measured on the floor (ui/sim-sensor-cal.js); what it measures goes into the robot's odometry.
  sensorCal=window.DeckSensorCal&&calRoot?window.DeckSensorCal.create({box:$('#cal-sensors'),debug:{values:()=>liveDebug?.values()||{},running:()=>!!liveDebug?.running(),listen:fn=>liveDebug?liveDebug.listen(fn):()=>{},start:()=>liveDebug?.start()},project:()=>project,save:()=>{save();calRender();},odometry:()=>C.odometryOf(project.robot),podTicks:2000/(Math.PI*32/25.4),podTypes:Object.fromEntries(Object.entries(C.POD_TYPES).map(([k,t])=>[k,t.ticksPerMm]))}):null;
  // "If this, then this": which motors and servos move each sensor, for any robot, from what the hub and Torque Debug report (ui/sim-links.js).
  linksCal=window.DeckLinks&&calRoot?window.DeckLinks.create({box:$('#cal-links'),debug:{running:()=>!!liveDebug?.running(),start:()=>liveDebug?.start(),send:line=>liveDebug?liveDebug.send(line):Promise.resolve(false),listen:fn=>liveDebug?liveDebug.listen(fn):()=>{},latest:()=>liveDebug?.latest()||{},found:()=>liveDebug?.found?.()||[],state:()=>({...(liveDebug?.state?.()||{}),problem:calAutoText})},
    encoder:name=>encoderNote(name),simLinks:()=>simLinks(),simEncoder:name=>{try{const r=window.DeckWiring.state(project).rows.find(x=>x.role==='drive'&&x.name===name);if(!r)return undefined;return project.sensors.localization==='encoders'||(project.robot.wiring?.sensors||[]).some(s=>s.for===r.key&&s.model==='motor-encoder');}catch{return undefined;}},drives:Object.fromEntries(Object.entries(C.drives).map(([k,v])=>[k,v.name])),toConfigure:()=>$('#calibrate-view [data-flow=configure]')?.click(),toCamera:()=>calSelect('camera'),camera:()=>({done:Object.keys(project.calibration?.lens||{}).length>0,here:camHere()}),
    // The chassis picked here is Simulate's: its drivetrain, and the names of its drive motors.
    setChassis:({type,devices})=>{if(type&&type!==project.robot.drivetrain){const sel=$('#sim-drivetrain');sel.value=type;sel.dispatchEvent(new Event('change'));}if(devices)chassisToSimulate(devices);},project:()=>project,readout:()=>project.controller==='ftc'?configReadout():[],config:()=>project.calibration?.hub?.name||setupRead?.active?.name||'',save:()=>calSave()}):null;
  // Mechanisms starts with the chassis Simulate describes, checked on the real robot with Electronics' links (ui/sim-chassis-cal.js).
  chassisCal=window.DeckChassisCal&&calRoot?window.DeckChassisCal.create({box:$('#cal-chassis'),debug:{running:()=>!!liveDebug?.running(),start:()=>liveDebug?.start(),send:line=>liveDebug?liveDebug.send(line):Promise.resolve(false),values:()=>liveDebug?.values()||{},listen:fn=>liveDebug?liveDebug.listen(fn):()=>{}},project:()=>project,C,save:()=>calSave(),
    devices:()=>window.DeckLinks.devices(project.controller==='ftc'?project.calibration?.hub?.readout||[]:[],liveDebug?.latest()?.manifest||null),cpr:()=>{const r=window.DeckWiring.state(project).rows.find(x=>x.role==='drive');return window.DeckHardware.MODELS[r?.model]?.cpr||537.7;},
    toElectronics:()=>{calSelect('electronics');$('#cal-links').scrollIntoView({block:'start'});},toSimulate:()=>$('#cal-open-sim').click(),config:()=>project.calibration?.hub?.name||'',
    // Each steering module's absolute encoder, and where its zero is kept: with the sensor, in Simulate's wiring.
    steerEncoders:()=>{const st=window.DeckWiring.state(project);return st.rows.filter(r=>r.role==='steer').map(r=>{const e=st.rows.find(x=>x.role==='sensor'&&x.for===r.key&&x.family==='analog');return e?{key:r.key,label:r.label,servo:r.name,name:e.name,volts:window.DeckHardware.SENSOR_MODELS[e.model]?.voltage||3.3}:null;}).filter(Boolean);},
    // A drive motor that rolled its wheel backwards: reversed in Simulate, where the simulation and every export read it.
    // The chassis TeleOp goes to the robot the way Send to robot's code does: saved in OnBot Java and built there.
    sendTeleop:async t=>{const sel=$('#sim-send-robot'),host=sel?.value||'usb',r=await api.robotLink('send',{host,files:{[t.file]:t.source}});
      if(!r?.built)throw Error(`the robot could not build it. ${String(r?.log||r?.error||'').split('\n').find(l=>/error/i.test(l))||''}`.trim());
      return `On the robot. Open Drive and pick “${t.opMode}” under TeleOp.`;},
    setReversed:(key,on)=>{project.robot.devices={...project.robot.devices,[key]:{...project.robot.devices?.[key],reversed:!!on}};calKeepRead(()=>applyWiring(structuredClone(project.robot.wiring)));},
    setSteerZero:zero=>{const st=window.DeckWiring.state(project),w=structuredClone(project.robot.wiring);for(const x of w.sensors||[]){const row=st.rows.find(q=>q.key==='sensor.'+x.id);if(row&&Number.isFinite(zero[row.name]))x.zeroVolts=zero[row.name];}calKeepRead(()=>applyWiring(w));}}):null;
  window.DeckWiring.bind($('#cal-electronics'),{project:()=>project,apply:next=>calKeepRead(()=>applyWiring(next)),setKind:(key,kind)=>calKeepRead(()=>deviceKind(key,kind))});
  if($('#cal-gates'))window.DeckWiring.bind($('#cal-gates'),{project:()=>project,apply:next=>calKeepRead(()=>applyWiring(next)),assign:(key,value)=>calKeepRead(()=>deviceAssign(key,value))});
  $('#cal-hub-setup').onclick=async()=>{await hubSetup('calibrate');calRender();};
  $('#cal-gate-sim').onclick=()=>$('#cal-open-sim').click();
  $('[data-mech-sim-open]').onclick=()=>$('#cal-open-sim').click();
  $('#cal-save').onclick=()=>{save();status('#cal-saved',`Saved at ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`);};
  // ---- Mechanisms. Each number is a path into project.mechanisms (scale: what the box shows per stored unit, 100 for a %).
  const calGet=(o,path)=>path.split('.').reduce((a,k)=>a?.[k],o);
  function calField(path,label,{min,max,step=1,unit='',scale=1,note='',value}={}){
    const v=value??calGet(project.mechanisms,path),id='cal-m-'+path.replace(/\W/g,'-');
    return `<div class="cal-field"><label for="${id}">${calEsc(label)}${unit?` <span>${calEsc(unit)}</span>`:''}</label><input id="${id}" type="number" inputmode="decimal" data-cal-set="${path}" data-cal-scale="${scale}"${finite(min)?` min="${min}"`:''}${finite(max)?` max="${max}"`:''} step="${step}" value="${finite(v)?+(v*scale).toFixed(4):''}">${note?`<small>${calEsc(note)}</small>`:''}</div>`;}
  const calCard=(title,hint,body)=>`<section class="cal-card"><h2>${calEsc(title)}</h2>${hint?`<p class="hint">${calEsc(hint)}</p>`:''}${body}</section>`;
  // The stored pieces fired as fast as the robot can: each shot's flywheel speed, the hood angle (and servo position) for
  // it, and how long the robot waits for the next piece to index and the flywheel to come back up to a speed it may fire at.
  function shotSeries(m){
    const s=m.shooter,need=MECH.readyAt(m),rise=s.spinUp>0?1/s.spinUp:Infinity,out=[];let f=1,wait=0;
    for(let k=0;k<Math.max(1,m.storage);k++){const h=MECH.hoodAt(m,f*s.rpm);out.push({rpm:f*s.rpm,deg:h.deg,pos:h.pos,wait});f=Math.max(0,f-(s.dropPerShot||0));
      let t=m.indexer.seconds;f=Math.min(1,f+t*rise);if(f<need-1e-9){t+=(need-f)/rise;f=need;}wait=t;}
    return out;}
  function calMechanisms(){
    const m=project.mechanisms,s=m.shooter,H=window.DeckHardware,st=window.DeckWiring.state(project),cards=[];
    const modelOf=key=>H.MODELS[st.rows.find(r=>r.key===key)?.model];
    if(m.enabled&&m.shooters.length){
      const motor=modelOf('shooters.0.motor'),top=motor?.rpm,map=s.hoodMap||[];
      const motorLine=motor?`<p class="cal-fact">Flywheel motor: <b>${calEsc(motor.short)}</b>${top?`, ${top} RPM free speed`:''}${motor.cpr?`, ${+motor.cpr.toFixed(2)} encoder ticks a turn`:''}. Change it in Electronics.</p>`:'<p class="cal-fact">Pick the flywheel motor\'s model in Electronics for its free speed and encoder ticks.</p>';
      const over=top&&s.rpm>top?`<p class="cal-note">The target speed is above the motor's free speed (${top} RPM): the flywheel never gets there.</p>`:'';
      const rows=map.map((p,i)=>`<tr><td><input type="number" aria-label="Point ${i+1} flywheel RPM" data-cal-hood="${i}|rpm" id="cal-hood-${i}-rpm" min="100" max="6000" step="10" value="${p.rpm}"></td><td><input type="number" aria-label="Point ${i+1} hood angle" data-cal-hood="${i}|deg" id="cal-hood-${i}-deg" min="70" max="85" step="0.1" value="${p.deg}"></td><td><input type="number" aria-label="Point ${i+1} hood servo position" data-cal-hood="${i}|pos" id="cal-hood-${i}-pos" min="0" max="1" step="0.01" value="${finite(p.pos)?p.pos:''}" placeholder="—"></td><td><button type="button" class="icon-button" data-cal-hood-remove="${i}" aria-label="Remove point ${i+1}" title="Remove">×</button></td></tr>`).join('');
      const shots=shotSeries(m).map((x,i)=>`<tr><td>${i+1}</td><td>${Math.round(x.rpm)} RPM</td><td>${x.deg.toFixed(1)}°</td><td>${finite(x.pos)?x.pos.toFixed(3):'—'}</td><td>${i?`${x.wait.toFixed(2)} s`:'—'}</td></tr>`).join('');
      cards.push(calCard('Shooter','The flywheel slows a little with every shot: the piece takes its energy. Set how much, then give the hood angle that lands a shot at each speed, and the robot fires again as soon as the hood has an angle for the speed it is at.',
        `${motorLine}${over}<div class="cal-fields">${calField('shooter.rpm','Target speed',{min:100,max:6000,step:10,unit:'RPM'})}${calField('shooter.ticksPerRev','Encoder ticks a turn',{min:1,max:10000,step:.1})}${calField('shooter.spinUp','Spin-up time',{min:0,max:10,step:.05,unit:'s',note:'Stopped to full speed'})}${calField('shooter.tolerance','At speed within',{min:1,max:50,step:.5,unit:'%',scale:100})}${calField('shooter.dropPerShot','Speed lost each shot',{min:0,max:60,step:.5,unit:'%',scale:100,value:s.dropPerShot||0})}${calField('shooter.hood','Hood angle',{min:70,max:85,step:.1,unit:'°',note:map.length?'Used only without calibrated points':'The fixed hood angle'})}</div>
        <h3 class="cal-group-title">Hood angle by flywheel speed</h3><p class="hint">${map.length>1?`Fires from ${map[0].rpm} RPM up, the hood following the speed between the points.`:map.length?'One point holds the hood there. Add a second to follow the speed.':'No points: the hood stays at its angle and the robot waits for the flywheel to come back up to speed.'}</p>
        ${map.length?`<table class="cal-table"><thead><tr><th>Flywheel RPM</th><th>Hood angle °</th><th>Servo position</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:''}<div class="button-row"><button type="button" class="secondary" data-cal-hood-add${map.length>=8?' disabled':''}>Add a point</button></div>
        <h3 class="cal-group-title">Firing every stored piece</h3><table class="cal-table cal-shots"><thead><tr><th>Shot</th><th>Flywheel</th><th>Hood</th><th>Servo</th><th>Waits</th></tr></thead><tbody>${shots}</tbody></table>`));
      if(MECH.hasTurret(m))cards.push(calCard('Turret','How fast it turns and how far it may go each way from the front.',`<div class="cal-fields">${calField('turret.speed','Turn speed',{min:5,max:2000,step:5,unit:'°/s'})}${calField('turret.min','Furthest right',{min:-180,max:0,unit:'°'})}${calField('turret.max','Furthest left',{min:0,max:180,unit:'°'})}${m.turret.kind==='motor'?calField('turret.ticksPerDegree','Encoder ticks a degree',{min:.01,max:10000,step:.01}):calField('turret.servoCenter','Servo position facing the front',{min:0,max:1,step:.01})+calField('turret.servoDegrees','Servo travel, 0 to 1',{min:10,max:3600,unit:'°'})}</div>`));
      const feeders=m.shooters.map((sh,k)=>MECH.servoFeeder(sh.indexerKind)?calField(`shooters.${k}.feedPos`,`Shooter ${k+1} feeder: feed position`,{min:0,max:1,step:.01})+calField(`shooters.${k}.restPos`,`Shooter ${k+1} feeder: rest position`,{min:0,max:1,step:.01}):'').join('');
      cards.push(calCard('Transfer and feeder','From a piece touching the intake to sitting in the shooter, and moving the next one up after a shot.',`<div class="cal-fields">${calField('transfer.seconds','Intake to shooter',{min:0,max:10,step:.05,unit:'s'})}${calField('indexer.seconds','Next piece up',{min:0,max:5,step:.05,unit:'s'})}${calField('indexer.power','Feeder power',{min:5,max:100,unit:'%',scale:100})}${m.shooters.some(sh=>MECH.servoFeeder(sh.indexerKind))?calField('indexer.pushSeconds','Push time',{min:.05,max:2,step:.05,unit:'s'}):''}${feeders}</div>`));}
    if(m.enabled)m.intakes.forEach((it,k)=>cards.push(calCard(`Intake ${k+1} · ${MECH.INTAKES[it.kind]}`,'',`<div class="cal-fields">${it.kind!=='kicker'?calField(`intakes.${k}.power`,'Roller power',{min:5,max:100,unit:'%',scale:100}):''}${MECH.deploys(it.kind)?calField(`intakes.${k}.down`,'Time to go down',{min:0,max:3,step:.05,unit:'s'})+calField(`intakes.${k}.up`,'Time to come up',{min:0,max:3,step:.05,unit:'s'})+calField(`intakes.${k}.downPos`,'Servo position down',{min:0,max:1,step:.01})+calField(`intakes.${k}.upPos`,'Servo position up',{min:0,max:1,step:.01}):''}</div>`)));
    // Moving parts (lifts, linear slides, arms, claws…): their stops, speed and named positions.
    const K=window.DeckKinematics,unitOf=j=>(K.TYPES[j.type]?.dof||[])[0]==='in'?'in':'°',parts=(project.kinematics.joints||[]).filter(j=>j.type!=='fixed'&&!['wheel','steer','flywheel','roller','turret','hood','feeder'].includes(j.drive?.signal));
    const jointBox=(j,field,label,value,unit)=>{const id=`cal-j-${j.id}-${field}`.replace(/\W/g,'-');return `<div class="cal-field"><label for="${id}">${calEsc(label)}${unit?` <span>${unit}</span>`:''}</label><input id="${id}" type="number" inputmode="decimal" data-cal-joint="${calEsc(j.id)}|${calEsc(field)}" step="0.1" value="${finite(value)?value:''}" placeholder="—"></div>`;};
    if(parts.length)cards.push(calCard('Moving parts','Lifts, linear slides, arms and claws: where each one stops, how fast it moves and the positions route actions send it to.',parts.map(j=>{const u=unitOf(j);
      return `<h3 class="cal-group-title">${calEsc(j.name)} · ${calEsc(K.TYPES[j.type]?.name||j.type)}</h3><div class="cal-fields">${['revolute','prismatic'].includes(j.type)?jointBox(j,'lower','Low stop',j.lower,u)+jointBox(j,'upper','High stop',j.upper,u):''}${jointBox(j,'speed','Speed',j.speed,u+'/s')}${Object.entries(j.states||{}).map(([n,v])=>jointBox(j,'state:'+n,n.charAt(0).toUpperCase()+n.slice(1),v,u)).join('')}</div>`;}).join('')));
    calHtml($('#cal-mechs'),cards.length?`<div class="cal-mech-grid">${cards.join('')}</div>`:`<div class="cal-card"><h2>No mechanisms yet</h2><p class="hint">Mechanisms come from Simulate: add intakes, shooters and moving parts in Simulate → Setup → Mechanisms, each with the motor or servo it runs on and its feedback sensor, then calibrate them here.</p></div>`);
  }
  // ---- Mechanisms' list, the same list and pane as Electronics: the Control Hub, the chassis' steps, the heading and position
  // checks, then each mechanism, in the order they are done. One shows at a time. The parts are read from what the pane
  // drew (ui/sim-chassis-cal.js, ui/sim-sensor-cal.js and the gates draw themselves), so the list cannot disagree with it.
  let mechPick=null,mechWasDone=null,mechQueued=false;
  function mechParts(){const pane=$('#cal-mech-pane'),out=[],txt=el=>el?.textContent.trim()||'';if(!pane)return out;
    const match=$('#cal-hub-match'),g0=pane.querySelector('.cal-g0'),read=!!project.calibration?.hub;
    out.push({key:'hub',group:'Robot',badge:'HUB',title:'Control Hub',sub:read?txt(match):'Read it first',done:read&&!!match?.classList.contains('ok'),counts:true,els:[$('#cal-hub-card'),...(g0&&g0.dataset.state!=='pass'?[g0]:[])]});
    for(const li of pane.querySelectorAll('.cal-chassis-step')){const st=li.dataset.state;out.push({key:'chassis-'+li.dataset.chassisStep,group:'Chassis',badge:({code:'{ }',drive:'▶'})[li.dataset.chassisStep]||li.dataset.chassisStep,title:txt(li.querySelector('h4')).replace(/^\d+\s·\s/,''),sub:st==='info'?(li.dataset.chassisStep==='drive'?'A TeleOp, sent to the robot':'The numbers, as a Java class'):st==='pass'?'Done':st==='locked'?'After the step before it':'To do',done:st==='pass',locked:st==='locked',counts:st!=='info',els:[$('#cal-chassis'),li]});}
    const need=pane.querySelector('.cal-sense-live');
    [...pane.querySelectorAll('#cal-sensors>section:not(.cal-sense-live)')].forEach((sec,i)=>{const steps=sec.querySelectorAll('.cal-sense-step').length,got=sec.querySelectorAll('.cal-sense-result,.cal-sense-step .cal-sense-rows').length,[title,what]=txt(sec.querySelector('h2')).split(' · ');
      if(!steps){if(!sec.hidden)sec.hidden=true;return;}out.push({key:'sense-'+i,group:'Chassis',badge:title==='Heading'?'IMU':'XY',title,sub:steps?(got?`${got} of ${steps} measured`:`${steps} checks, by hand`):'Nothing to calibrate',done:steps>0&&got>=steps,els:[sec,...(need&&steps?[need]:[])]});});
    for(const k of ['chassis-code','chassis-drive']){const i=out.findIndex(x=>x.key===k);if(i>=0)out.push(...out.splice(i,1));}
    const hint=pane.querySelector('.cal-gates-hint'),bare=pane.querySelector('[data-cal-bare]'),none=pane.querySelector('[data-cal-none]');
    for(const sec of pane.querySelectorAll('.cal-mech')){const chips=[...sec.querySelectorAll('.cal-chip')],ok=chips.filter(c=>c.dataset.state==='pass').length;
      out.push({key:'mech:'+sec.dataset.calMechRow,group:'Mechanisms',badge:`${ok}/${chips.length}`,title:txt(sec.querySelector('h3')?.firstChild),sub:txt(sec.querySelector('.cal-mech-head small')).split(' · ')[0],done:sec.classList.contains('done'),counts:true,els:[sec,...(hint?[hint]:[]),...(bare?[bare]:[])]});}
    if(none)out.push({key:'none',group:'Mechanisms',badge:'+',title:'Add mechanisms',sub:'None in Simulate yet',els:[none,...(bare?[bare]:[])]});
    if($('#cal-mechs .cal-mech-grid'))out.push({key:'sim',group:'Simulation',badge:'⛭',title:'Simulation settings',sub:'Speeds, times and positions',els:[pane.querySelector('.cal-sim-settings')]});
    return out;}
  function mechRail(){const rail=$('#cal-mech-rail'),pane=$('#cal-mech-pane');if(!rail||!pane)return;const parts=mechParts(),todo=x=>x.counts&&!x.done&&!x.locked;
    let cur=parts.find(x=>x.key===mechPick);
    // A step just finished moves on to the next one to do; reading the hub stays, so what it matched can be read.
    if(cur&&cur.key!=='hub'&&mechWasDone===false&&cur.done){const next=parts.slice(parts.indexOf(cur)+1).find(todo);if(next)cur=next;}
    if(!cur)cur=parts.find(todo)||parts[0];if(!cur)return;mechPick=cur.key;mechWasDone=cur.done;
    const show=new Set(cur.els),all=new Set([...parts.flatMap(x=>x.els),pane.querySelector('.cal-g0'),pane.querySelector('.cal-sim-settings')]);for(const el of all)if(el&&el.hidden===show.has(el))el.hidden=!show.has(el);
    for(const id of ['#cal-sensors','#cal-gates']){const b=$(id),on=[...b.children].some(c=>!c.hidden);if(b.hidden===on)b.hidden=!on;}
    const counted=parts.filter(x=>x.counts),n=counted.filter(x=>x.done).length;let group='';
    calHtml(rail,`<div class="cal-elec-listhead"><b>${calEsc(project.calibration?.hub?.name||'This robot')}</b><span class="rs-pill ${n===counted.length?'ok':''}">${n} of ${counted.length} done</span></div><p class="hint cal-elec-saved">In order, top to bottom.</p>`+parts.map(x=>{const head=x.group!==group?`${group?'</div>':''}<h3>${calEsc(group=x.group)}</h3><div class="sim-garage-rail">`:'';
      return `${head}<button type="button" class="sim-tile cal-elec-tile${x.done?' done':''}${x.locked?' locked':''}" data-mech-pick="${calEsc(x.key)}" aria-pressed="${x.key===cur.key}"><span class="cal-elec-badge" aria-hidden="true">${calEsc(x.badge)}</span><span class="sim-tile-text"><b>${x.done?'<i class="cal-elec-tick" aria-label="done">✓</i> ':''}${calEsc(x.title)}</b><small>${calEsc(x.sub)}</small></span></button>`;}).join('')+'</div>');}
  // Opens a part; a mechanism opens on its first step still to do.
  function mechGo(key){mechPick=key;mechWasDone=null;mechRail();const sec=key.startsWith('mech:')&&[...$$('#cal-gates .cal-mech')].find(x=>'mech:'+x.dataset.calMechRow===key);
    if(sec&&!sec.querySelector('.cal-chip[aria-pressed=true]'))sec.querySelector('.cal-chip:not([disabled]):not([data-state=pass])')?.click();}
  $('#cal-mech-rail')?.addEventListener('click',e=>{const b=e.target.closest('[data-mech-pick]');if(b){mechGo(b.dataset.mechPick);$('#cal-mech-pane').scrollIntoView({block:'nearest'});}});
  // The chassis and the sensor checks redraw themselves as the robot moves; the list follows once a frame.
  if($('#cal-mech-pane'))new MutationObserver(()=>{if(mechQueued)return;mechQueued=true;requestAnimationFrame(()=>{mechQueued=false;mechRail();});}).observe($('#cal-mech-pane'),{childList:true,subtree:true});
  const calMech=change=>{setMech(change);calRender();};
  $('#cal-mechs').addEventListener('change',e=>{const el=e.target,d=el.dataset,v=el.valueAsNumber;
    if(d.calSet){if(!finite(v))return calRender();const scale=+d.calScale||1,keys=d.calSet.split('.'),last=keys.pop();calMech(m=>{const o=keys.reduce((a,k)=>a?.[k],m);if(o)o[last]=v/scale;});}
    else if(d.calHood){const [i,field]=d.calHood.split('|');calMech(m=>{const map=(m.shooter.hoodMap||[]).map(p=>({...p}));if(!map[+i])return;if(finite(v))map[+i][field]=v;else if(field==='pos')delete map[+i].pos;m.shooter.hoodMap=map;});}
    else if(d.calJoint){const [id,field]=d.calJoint.split('|'),next=structuredClone(project.kinematics),j=next.joints.find(x=>x.id===id);if(!j)return;
      if(field.startsWith('state:')){if(finite(v))j.states={...j.states,[field.slice(6)]:v};}else if(finite(v))j[field]=v;else delete j[field];
      if(['inferred','metadata','standin'].includes(j.source))j.source='user';project.kinematics=window.DeckKinematics.sanitize(next);save();mechanismsPanel();view3d?.setModel(fieldRig());reload();calRender();}});
  $('#cal-mechs').addEventListener('click',e=>{const add=e.target.closest('[data-cal-hood-add]'),remove=e.target.closest('[data-cal-hood-remove]');
    if(add)calMech(m=>{const map=m.shooter.hoodMap||[],rpm=map.length?Math.max(100,Math.round(map[0].rpm*.9/10)*10):m.shooter.rpm;m.shooter.hoodMap=[...map,{rpm,deg:MECH.hoodAt(m,rpm).deg}];});
    else if(remove)calMech(m=>{const map=(m.shooter.hoodMap||[]).filter((_,i)=>i!==+remove.dataset.calHoodRemove);if(map.length)m.shooter.hoodMap=map;else delete m.shooter.hoodMap;});});
  // ---- Live debug (ui/sim-debug.js): the robot's ports, read live; outputs driven hold-to-run. Its device list read
  // from the robot counts as reading the Control Hub (gate G0) for this setup.
  // The active configuration's devices, port by port: as the Control Hub was last read for Calibrate, or as Setup read it.
  function configReadout(){const r=project.calibration?.hub?.readout;if(Array.isArray(r)&&r.length)return r;const n=setupRead?.active?.name||setupRead?.configurations?.[0],xml=n?setupRead?.files?.[n]:null;try{return xml?window.DeckHubSetup.readout(RobotConfig.parse(xml)):[];}catch{return [];}}
  // Calibrate's chassis into Simulate: each drive motor and steering servo (by Simulate's key) gets its configuration name and
  // the hub and port it is on, and an Expansion Hub the configuration does not have is not added.
  function chassisToSimulate(devices){const read=configReadout(),devs={...project.robot.devices},wiring=JSON.parse(JSON.stringify(project.robot.wiring||{hubs:{},devices:{},sensors:[]}));wiring.hubs??={};wiring.devices??={};
    for(const [key,name] of Object.entries(devices)){devs[key]={...devs[key],name};const d=read.find(x=>x.name===name);if(d?.hub&&Number.isInteger(d.port))wiring.devices['robot.'+key]={...wiring.devices['robot.'+key],hub:d.hub,port:d.port};}
    if(read.length&&!read.some(x=>x.hub&&x.hub!=='control')&&!wiring.hubs.expansion)wiring.hubs.expansion=false;
    project.robot.devices=devs;applyWiring(wiring);}
  // Configure's wiring notes for the active configuration: whether each motor's encoder cable is plugged in (false when not).
  function wiringNotes(){const n=setupRead?.active?.name||setupRead?.configurations?.[0],xml=n?setupRead?.files?.[n]:null;try{return xml?RobotConfig.notesOf(xml):{};}catch{return {};}}
  function encoderNote(name){const v=wiringNotes()[name]?.encoder;return typeof v==='boolean'?v:undefined;}
  const liveDebug=window.DeckLiveDebug&&calRoot?window.DeckLiveDebug.create({host:$('#cal-debug'),api,native,project:()=>project,encoder:encoderNote,alsoWanted:()=>calibrating&&calTop==='calibrate',
    link:()=>({host:$('#sim-send-robot').value||'usb',label:$('#sim-send-robot').selectedOptions[0]?.textContent||'the robot'}),
    onChange:()=>{const m=liveDebug?.latest().manifest;if(m&&calHubHash()!==project.calibration.hub?.hash)calHubRead({source:'live',devices:(m.motors?.length||0)+(m.servos?.length||0)+(m.crservos?.length||0)+(m.digital?.length||0)+(m.touch?.length||0)+(m.analog?.length||0)+(m.i2c?.length||0)});else calRender();}}):null;
  // ---- Mechanisms: a gate stepper per mechanism (docs/CALIBRATION.md, ui/sim-tune.js). Nothing shows until the Control
  // Hub's devices are read (G0); then each mechanism Setup knows, with the devices it runs on, walks its template's gates:
  // identify, bind and direction, units, zero, range, feedforward, feedback, sensor thresholds, commit. Gates that drive
  // the robot use Live debug; what they find is kept in project.calibration.mechs by mechanism id, with the hash of what
  // each gate depended on, so a changed device, port or ratio makes the gates after it stale.
  const TU=window.DeckTune,calOpen={},calTemp={};
  const calWait=ms=>new Promise(r=>setTimeout(r,ms));
  function calHubHash(){const st=window.DeckWiring.state(project);return TU.hash(st.rows.map(r=>[r.name,r.family,r.hub??'',r.port??r.bus??'',r.model??'']).sort());}
  function calHubRead(info){const {readout,config,scan}=project.calibration.hub||{};project.calibration.hub={...(readout?{readout}:{}),...(config?{config}:{}),...(scan?{scan}:{}),...info,at:new Date().toISOString(),hash:calHubHash()};calSave();}
  const calRec=id=>(project.calibration.mechs[id]??={gates:{}});
  function calSave(){project.calibration=TU.sanitize(project.calibration);save();calRender();reliableNote();}
  function calPass(m,gate,extra){const rec=calRec(m.id);Object.assign(rec,extra||{});rec.gates={...rec.gates,[gate]:{at:new Date().toISOString(),dep:calDeps(m,rec)[gate]}};calSave();}
  // The mechanisms Setup knows, each with the device that moves it, the sensors on that device and its template.
  function calMechList(){
    const m=project.mechanisms,st=window.DeckWiring.state(project),out=[],TYm=window.DeckMechanismTypes;
    const add=(id,name,type,key)=>{const row=st.rows.find(r=>r.key===key);if(!row)return;const fb=TU.feedbackOf(row),sensors=st.rows.filter(r=>r.role==='sensor'&&r.for===key);
      out.push({id,name,type,key,row,sensors,feedback:fb,template:sensors.length&&!fb?'T6':TU.templateOf(type,fb),label:TYm?.TYPES[type]?.name||type});};
    if(m.enabled){m.shooters.forEach((s,k)=>{add(`shooter:${k}:flywheel`,`Shooter ${k+1} flywheel`,'flywheel',`shooters.${k}.motor`);
        if(s.type==='turret'&&!s.sharesTurret)add(`shooter:${k}:turret`,`Shooter ${k+1} turret`,'turret',`shooters.${k}.turretMotor`);
        if(s.hood)add(`shooter:${k}:hood`,`Shooter ${k+1} hood`,'hood',`shooters.${k}.hood`);
        add(`shooter:${k}:feeder`,`Shooter ${k+1} feeder`,{pusher:'kicker',gate:'gate'}[s.indexerKind]||'feeder',`shooters.${k}.indexer`);});
      m.intakes.forEach((it,k)=>{if(it.kind!=='kicker')add(`intake:${k}:roller`,`Intake ${k+1} rollers`,'roller-intake',`intakes.${k}.motor`);if(MECH.deploys(it.kind))add(`intake:${k}:deploy`,`Intake ${k+1} ${it.kind}`,it.kind==='ramp'?'ramp':'kicker',`intakes.${k}.servo`);});}
    const K=project.kinematics;for(const a of K.actuators||[]){const j=(K.joints||[]).find(x=>x.id===a.joint);if(j?.drive&&j.drive.signal!=='action')continue;
      add(`kin:${a.id}`,j?.name||a.name||a.id,j?.kind||{prismatic:'custom-slide',continuous:'custom-spin'}[j?.type]||'custom-pivot',`kin.${a.id}`);}
    // The drivetrain is the Chassis card above these (ui/sim-chassis-cal.js), always first.
    return out;}
  // What each gate depended on when it passed: the devices (G1, G2, GT), and the units too (G3 on).
  function calDeps(m,rec){const dev=TU.hash([m.row.name,m.row.hub,m.row.port,m.row.model,m.sensors.map(s=>[s.name,s.model,s.hub,s.port,s.bus])]),units=TU.hash([dev,rec?.transform||{}]);
    return {G0:calHubHash(),G1:dev,G2:dev,G3:units,G4:units,G5:units,G6:units,G7:units,GT:dev,G8:units,threshold:m.sensors.some(s=>['piece','home'].includes(s.use)||['color','distance','touch','limit','magnetic'].includes(s.kind))};}
  // The reading a mechanism is calibrated on (bound in G2): its encoder, or the analog sensor on it.
  function calKey(m,rec){if(rec?.bind)return rec.bind;const a=m.sensors.find(s=>s.family==='analog'&&s.use==='position');if(a)return `a:${a.name}`;return m.row.family==='motor'?`m:${m.row.name}:${m.template==='T3'?'vel':'pos'}`:'';}
  const calCmd=m=>m.row.family==='motor'?'M':m.row.kind==='crservo'?'C':'S';
  const calUnit=(m,rec)=>m.template==='T3'?'RPM':rec?.transform?.unit==='mm'?'mm':'°';
  const liveCamera=window.DeckCamera&&calRoot?window.DeckCamera.create({host:$('#cal-camera'),api,native,debug:liveDebug,configured:()=>(project.calibration?.hub?.config?.devices||[]).filter(d=>d.tag==='Webcam').map(d=>({name:d.name,serial:d.serial})),plugged:hubUsb,active:()=>{const n=project.calibration?.hub?.config?.name;return n&&n!=='no configuration'?n:null;},toConfigure:serial=>void configureUsb(serial),autoConfigure:()=>autoConfigure(),autoNow:()=>{if(window.deckHoldAuto||autoBusy||configEditor?.edited?.())return false;void autoConfigure();return true;},conn:()=>setupConn,busy:()=>!!robotSending||!!checking?.running||!!hubTest||setupBusy||autoBusy,limelights:()=>(project.calibration?.hub?.config?.devices||[]).filter(d=>d.tag==='EthernetDevice'),lens:{all:()=>project.calibration?.lens,save:lens=>{project.calibration.lens=lens;calSave();}}}):null;
  // ---- Camera's list, the same list and pane as Electronics and Mechanisms: each camera, then its lens. It is read from what
  // ui/sim-camera.js drew, and a camera picked here presses that camera's own button.
  let camQueued=false;
  function camRail(){const rail=$('#cal-cam-rail'),host=$('#cal-camera');if(!rail||!host?.firstChild)return;const picks=[...host.querySelectorAll('[data-cam-choice]')],lens=host.querySelector('[data-cam-lens]'),measured=Object.keys(project.calibration?.lens||{}).length>0;
    const cams=picks.length?picks.map(b=>({key:b.dataset.camChoice,title:b.textContent,on:b.getAttribute('aria-pressed')==='true'})):[{key:'',title:host.querySelector('[data-cam-name]')?.textContent||'Camera',on:true}];
    const tile=(attr,badge,title,sub,on,done)=>`<button type="button" class="sim-tile cal-elec-tile${done?' done':''}" ${attr} aria-pressed="${on}"><span class="cal-elec-badge" aria-hidden="true">${badge}</span><span class="sim-tile-text"><b>${done?'<i class="cal-elec-tick" aria-label="done">✓</i> ':''}${calEsc(title)}</b><small>${calEsc(sub)}</small></span></button>`;
    calHtml(rail,`<div class="cal-elec-listhead"><b>${cams.length===1?'Camera':`${cams.length} cameras`}</b></div><h3>Picture</h3><div class="sim-garage-rail">${cams.map(c=>tile(`data-cam-rail="${calEsc(c.key)}"`,'CAM',c.title,c.on?'Showing now':'Show this one',c.on,false)).join('')}</div>${lens&&!lens.hidden?`<h3>Measure</h3><div class="sim-garage-rail">${tile('data-cam-rail-lens','LENS','Lens',measured?'Measured':'To do, with a printed tag',false,measured)}</div>`:''}`);}
  $('#cal-cam-rail')?.addEventListener('click',e=>{const host=$('#cal-camera'),b=e.target.closest('[data-cam-rail]');
    if(b){[...host.querySelectorAll('[data-cam-choice]')].find(x=>x.dataset.camChoice===b.dataset.camRail)?.click();return;}
    if(e.target.closest('[data-cam-rail-lens]')){const lens=host.querySelector('[data-cam-lens]');lens.open=true;lens.scrollIntoView({block:'center'});}});
  if($('#cal-camera')){new MutationObserver(()=>{if(camQueued)return;camQueued=true;requestAnimationFrame(()=>{camQueued=false;camRail();});}).observe($('#cal-camera'),{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','hidden']});camRail();}
  const usbToCamera=serial=>{camPicked=true;calSelect('camera');liveCamera?.select(serial);};
  const usbDevices=window.DeckUsbDevices&&calRoot?window.DeckUsbDevices.create({host:$('#cal-usb'),api,native,usb:hubUsb,toCamera:usbToCamera,toI2c:tag=>void configureI2c(tag),toAxon:axonTab}):null;
  // Debug's list of the same devices, above the check and the hubs' ports, which run long, with what each is doing now.
  const usbLive=(()=>{const box=$('#cal-debug');if(!window.DeckUsbDevices||!box)return null;const host=document.createElement('section');host.className='cal-usb-live';host.dataset.debugUsb='';box.append(host);const sim=document.createElement('p');sim.id='cal-sim-cam';sim.className='hint cal-sim-cam';sim.innerHTML='No camera on the hub? <button type="button" class="link" data-sim-cam>Try the camera tools on a simulated webcam</button>';sim.querySelector('button').onclick=()=>{camPicked=true;calSelect('camera');};box.append(sim);return window.DeckUsbDevices.createLive({host,api,native,usb:hubUsb,debug:liveDebug,configured:()=>(project.calibration?.hub?.config?.devices||[]).filter(d=>!d.module),toCamera:usbToCamera,auto:()=>void autoConfigure()});})();
  function calUnitsNow(m,rec){const v=liveDebug?.values()||{},raw=v[calKey(m,rec)];return TU.toUnits(raw,rec?.transform||{});}
  const calFix=(v,d=2)=>finite(v)?(+v).toFixed(d):'—';
  const calNeedLive=()=>`<p class="cal-note">This step moves the robot. Start Live debug in the Debug tab first (robot on blocks).</p><div class="button-row"><button type="button" class="secondary" data-cal-act="to-live">Go to Live debug</button></div>`;
  function calGates(){
    const box=$('#cal-gates');if(!box)return;const hub=project.calibration.hub,hashNow=calHubHash(),fresh=!!hub&&hub.hash===hashNow,live=!!liveDebug?.running();
    const when=hub?new Date(hub.at).toLocaleString():'';
    const g0=!hub?`<section class="cal-card cal-g0" data-state="todo"><h2>First, read your Control Hub</h2><p class="hint">Every mechanism Simulate lists is calibrated here, starting with linking its motor, servo and feedback sensor to the ports they are really on. Those ports come from the robot’s configuration: read it (Set up from the Control Hub, plugged in by USB-C), or start Live debug.</p><div class="button-row"><button type="button" class="primary" data-cal-act="to-hub">Read the Control Hub</button><button type="button" class="secondary" data-cal-act="to-live">Start Live debug</button></div></section>`
      :`<section class="cal-card cal-g0" data-state="${fresh?'pass':'stale'}"><h2>${fresh?'Control Hub read':'The configuration changed'}</h2><p class="hint">${fresh?`Read ${hub.source==='live'?'by Live debug':`from ${calEsc(hub.name||'the Control Hub')}`} on ${calEsc(when)}.`:`Devices, names or ports changed since it was read on ${calEsc(when)}: read it again, and steps that depended on what changed are marked to redo.`}</p>${fresh?'':'<div class="button-row"><button type="button" class="primary" data-cal-act="to-hub">Read the Control Hub again</button></div>'}</section>`;
    if(!hub){calHtml(box,g0);return;}
    const list=calMechList(),W=window.DeckWiring,st=W.state(project),read=configReadout(),H=window.DeckHardware;
    // A moving part Simulate has with nothing to run it cannot be calibrated: it says so, and where to add one.
    const bare=(project.kinematics.joints||[]).filter(j=>j.type!=='fixed'&&!j.drive?.signal&&!(project.kinematics.actuators||[]).some(a=>a.joint===j.id)).map(j=>j.name||j.id);
    const missing=bare.length?`<p class="cal-note" data-cal-bare>${calEsc(bare.join(', '))} ${bare.length>1?'have':'has'} no motor or servo in Simulate yet, so ${bare.length>1?'they are':'it is'} not listed here. Give ${bare.length>1?'each':'it'} one in Simulate → Setup → Mechanisms.</p>`:'';
    const rows=list.map(m=>{const rec=project.calibration.mechs[m.id]||{gates:{}},deps=calDeps(m,rec),states=TU.gateStates(m.template,{...rec,gates:{...rec.gates,G0:{dep:hub.hash}}},deps);
      const chips=Object.keys(TU.GATES).filter(g=>states[g]!=='na').map(g=>`<button type="button" class="cal-chip" data-state="${states[g]}" data-cal-gate="${g}" data-cal-mech="${calEsc(m.id)}"${states[g]==='locked'||g==='G0'?' disabled':''} aria-pressed="${calOpen[m.id]===g}" title="${calEsc(TU.GATES[g].name)}: ${states[g]}">${calEsc(TU.GATES[g].short)}</button>`).join('');
      const open=calOpen[m.id],panel=open&&states[open]!=='locked'&&states[open]!=='na'?calPanel(m,open,rec,states[open],live):'';
      const done=Object.values(states).every(s=>s==='pass'||s==='na');
      return `<section class="cal-mech${done?' done':''}" data-cal-mech-row="${calEsc(m.id)}"><div class="cal-mech-head"><div><h3>${calEsc(m.name)}${TU.ILLEGAL.has(m.type)?' <span class="cal-badge danger">Not FTC-legal: simulation only</span>':''}</h3>
        <small>${calEsc(m.label)} · ${m.row.family==='servo'?'Servo':'Motor'} ${W.linked(m.row,st,read)?`<code>${calEsc(m.row.name)}</code> ${calEsc(m.row.portLabel||'')}`:'<span class="cal-unlinked">not linked to its port yet</span>'} · Feedback: ${calEsc((m.row.sensors||[]).map(x=>H.SENSOR_MODELS[x.model]?.short).filter(Boolean).join(', ')||'none')} · ${calEsc(m.feedback?TU.KINDS[m.feedback.kind].name:'Sensors only')}</small></div><div class="cal-chips">${chips}</div></div>${panel}</section>`;}).join('');
    calHtml(box,g0+(list.length?`<p class="hint cal-gates-hint">These are the mechanisms Simulate lists. Each starts with Link: which real motor, servo and sensor it is. The steps after follow what measures it. A step unlocks once the one before it passes, and goes back to redo when something it depended on changes.</p>${rows}${missing}`:'<div class="cal-card" data-cal-none><h2>No mechanisms in Simulate yet</h2><p class="hint">Only what Simulate lists can be calibrated. Add each intake, shooter and moving part in Simulate → Setup → Mechanisms with the motor or servo it runs on and the sensor that measures it; it then shows here to be linked to its real ports.</p><div class="button-row"><button type="button" class="primary" data-cal-act="to-setup">Open Simulate</button></div></div>')+missing);
    calPlots();}
  // One gate's panel: what it does, what passes it, and its controls.
  function calPanel(m,g,rec,state,live){
    const G=TU.GATES[g],t=rec.transform||{},u=calUnit(m,rec),need=['G2','G4','G5','G6'].includes(g)&&!live&&m.template!=='T7'?calNeedLive():'',id=calEsc(m.id);
    const liveOut=`<p class="cal-live">Now: <output data-cal-live="${id}">${calFix(calUnitsNow(m,rec))}</output> ${u}</p>`;
    let body='';
    if(g==='G1'){const W=window.DeckWiring,st=W.state(project),read=configReadout(),ok=W.linked(m.row,st,read);
      body=read.length?`<p>Simulate lists <b>${calEsc(m.name)}</b> as a ${calEsc(m.label.toLowerCase())} with the parts below. Pick which device of the robot’s configuration each one is: it takes that name and port, and what is measured here goes back into the simulation.</p><div class="cal-mech-link">${W.linkHtml(m.row,st,read)}</div><p class="hint">${calEsc(TU.TEMPLATES[m.template].note)}</p>
        <div class="button-row"><button type="button" class="primary" data-cal-act="pass" data-cal-mech="${id}" data-cal-gate="G1"${ok?'':' disabled'}>${ok?'These are its ports':'Link each one first'}</button><button type="button" class="secondary" data-cal-act="to-setup">Change what it runs on in Simulate</button><button type="button" class="secondary" data-cal-act="to-configure">Add a device in Configure</button></div>`
        :`<p class="cal-note">The Control Hub’s configuration has not been read yet, so there are no ports to link this to.</p><div class="button-row"><button type="button" class="primary" data-cal-act="to-hub">Read the Control Hub</button></div>`;}
    else if(g==='G2'){const p=calTemp[m.id]?.pulse,blind=m.template==='T5'||m.template==='T7';
      body=need||`${m.template==='T7'?'<p class="hint">The guided check (Electronics, step 2) turns each wheel and asks which way it went, and checks the pods and IMU.</p>':`<div class="button-row"><button type="button" class="secondary" data-cal-act="g2-pulse" data-cal-mech="${id}">${calCmd(m)==='S'?'Move it a little and watch':'Run it briefly and watch'}</button></div>`}
        ${p?`<ul class="cal-debug-pulse">${p.changes.length?p.changes.map(c=>`<li${c.key===p.bind?' class="cal-bound"':''}>${calEsc(c.text)}${c.key===p.bind?' · its sensor':''}</li>`).join(''):`<li class="hint">${calEsc(p.error||'No input changed.')}</li>`}</ul>
          ${p.changes.some(c=>!c.key.startsWith(`m:${m.row.name}:`)&&c.key!==p.bind)?`<p class="cal-note">Another input answered too: check the wiring if it belongs to another mechanism.</p>`:''}
          <p>Which way did it move?</p><div class="button-row"><button type="button" class="primary" data-cal-act="g2-sign" data-sign="1" data-cal-mech="${id}">That's its positive way (${m.template==='T1'?'up':m.template==='T3'?'spinning to shoot or take in':'out, open or left'})</button><button type="button" class="secondary" data-cal-act="g2-sign" data-sign="-1" data-cal-mech="${id}">That was backwards</button></div>`:m.template==='T7'?`<div class="button-row"><button type="button" class="primary" data-cal-act="pass" data-cal-mech="${id}" data-cal-gate="G2">The guided check passed</button></div>`:blind?'<p class="hint">Nothing measures it: you are the sensor. Run it and say which way it went.</p>':''}`;}
    else if(g==='G3'){const analog=calKey(m,rec).startsWith('a:'),md=window.DeckHardware.MODELS[m.row.model],sensorMd=m.sensors.map(s=>window.DeckHardware.SENSOR_MODELS[s.model]).find(x=>x?.cpr);
      const cpr=t.cpr??sensorMd?.cpr??md?.cpr,field=(k,label,v,extra='')=>`<div class="cal-field"><label for="cal-t-${id}-${k}">${label}</label><input id="cal-t-${id}-${k}" type="number" data-cal-t="${k}" data-cal-mech="${id}" value="${finite(v)?v:''}" ${extra}></div>`;
      body=analog?`<p class="hint">Two readings make the line from volts to ${u}: move it to a known angle, type the angle, and capture; then a second one well apart.</p><div class="cal-fields">${field('u0','First angle',t.u0??0)}${field('u1','Second angle',t.u1??90)}</div><p class="hint">Captured: ${calFix(t.v0,3)} V and ${calFix(t.v1,3)} V.</p>
          <div class="button-row"><button type="button" class="secondary" data-cal-act="g3-v" data-which="0" data-cal-mech="${id}"${live?'':' disabled'}>Capture the first</button><button type="button" class="secondary" data-cal-act="g3-v" data-which="1" data-cal-mech="${id}"${live?'':' disabled'}>Capture the second</button></div>`
        :`<p class="hint">The motor model says ${md?.cpr?`${+md.cpr.toFixed(2)} counts a turn at its output shaft`:'nothing about its counts a turn: type them'}. The ratio is how many turns the sensor makes for one turn of the mechanism (a 2:1 belt down to it is 2). ${m.template==='T3'?'Speed reads in RPM of the mechanism.':''}</p>
          <div class="cal-fields">${field('cpr','Counts a sensor turn',cpr,'min="1" step="0.1"')}${field('ratio','Sensor turns per mechanism turn',t.ratio??1,'min="0.001" step="0.001"')}${m.template==='T3'?'':`<div class="cal-field"><label for="cal-t-${id}-unit">Units</label><select id="cal-t-${id}-unit" data-cal-t="unit" data-cal-mech="${id}"><option value="deg"${t.unit!=='mm'?' selected':''}>Degrees (it turns)</option><option value="mm"${t.unit==='mm'?' selected':''}>Millimetres (it slides)</option></select></div>${t.unit==='mm'?field('spoolMm','Spool or pulley diameter (mm)',t.spoolMm,'min="1" step="0.1"')+field('stages','Cascade stages (1 for continuous)',t.stages??1,'min="1" max="6" step="1"'):''}`}</div>
          ${m.template==='T3'?'':`<p class="hint">Check it with a known move: mark here, move it a distance you can measure, type how far it really went.</p><div class="cal-fields">${field('actual','It really moved',calTemp[m.id]?.actual)}</div><div class="button-row"><button type="button" class="secondary" data-cal-act="g3-mark" data-cal-mech="${id}"${live?'':' disabled'}>Mark here</button><button type="button" class="secondary" data-cal-act="g3-check" data-cal-mech="${id}"${live&&finite(calTemp[m.id]?.mark)?'':' disabled'}>Check</button></div>${calTemp[m.id]?.check?`<p class="${Math.abs(calTemp[m.id].check.error)<=.02?'hint':'cal-note'}">Read ${calFix(calTemp[m.id].check.read)} ${u} for ${calFix(calTemp[m.id].check.actual)} ${u}: ${calFix(calTemp[m.id].check.error*100,1)} % off.${Math.abs(calTemp[m.id].check.error)>.02?' <button type="button" class="text-button" data-cal-act="g3-scale" data-cal-mech="'+id+'">Use the measured ratio</button>':''}</p>`:''}`}`;
      body+=`${live?liveOut:''}<div class="button-row"><button type="button" class="primary" data-cal-act="g3-pass" data-cal-mech="${id}">${calTemp[m.id]?.check&&Math.abs(calTemp[m.id].check.error)<=.02?'Units checked':'Use these units'}</button></div>`;}
    else if(g==='G4'){const homes=m.sensors.filter(s=>s.use==='home'||['touch','limit','magnetic'].includes(s.kind)),z=rec.zeros||[];
      body=need||`<p class="hint">${homes.length?`Its home switch (${homes.map(s=>`<code>${calEsc(s.name)}</code>`).join(', ')}) marks zero: move it onto the switch.`:calKey(m,rec).startsWith('a:')?'Its sensor is absolute: put it where 0 should be.':'With only a motor encoder, zero is where it is when the op mode starts (or a gentle stall against its stop): put it there.'} Then set zero; doing it three times shows how repeatable it is.</p>${liveOut}
        <div class="button-row"><button type="button" class="secondary" data-cal-act="g4-set" data-cal-mech="${id}">Set zero here</button>${z.length?`<button type="button" class="primary" data-cal-act="pass" data-cal-mech="${id}" data-cal-gate="G4">Zero is good</button>`:''}</div>${z.length>1?`<p class="hint">Last ${z.length} zeroings spread over ${calFix(Math.max(...z)-Math.min(...z),2)} ${u}.</p>`:''}`;}
    else if(g==='G5'){const r=rec.range||{};
      body=need||`<p class="hint">Jog it to each end (hold its slider in Live debug, slowly) and set the limit a little inside the hard stop.</p>${liveOut}<p>Low ${calFix(r.lo)} ${u} · high ${calFix(r.hi)} ${u}</p>
        <div class="button-row"><button type="button" class="secondary" data-cal-act="g5-set" data-which="lo" data-cal-mech="${id}">Set low limit here</button><button type="button" class="secondary" data-cal-act="g5-set" data-which="hi" data-cal-mech="${id}">Set high limit here</button>${finite(r.lo)&&finite(r.hi)&&r.lo<r.hi?`<button type="button" class="primary" data-cal-act="pass" data-cal-mech="${id}" data-cal-gate="G5">Range is right</button>`:''}</div>`;}
    else if(g==='G6'){const f=rec.ff,run=calTemp[m.id]?.ramp;const kind=TU.TEMPLATES[m.template].ff;
      body=need||`<p class="hint">${kind==='velocity'?'Torque runs it at five powers and fits the speed each gives: kS (the power before it moves) and kV (power per RPM).':kind==='gravity'?'Torque raises the power slowly until it starts moving up, then lowers it until it starts down: gravity is the middle, friction half the gap.':'Torque raises the power slowly until it moves one way, then the other: kS is the power it takes.'} Keep clear; it stops at its limits.</p>
        <div class="button-row"><button type="button" class="secondary" data-cal-act="g6-run" data-cal-mech="${id}"${run?.running?' disabled':''}>${run?.running?'Running…':'Run the ramp'}</button></div>${run?.text?`<p class="hint">${calEsc(run.text)}</p>`:''}
        ${f?`<p>kS ${calFix(f.kS,3)} · kG ${calFix(f.kG,3)} · kV ${calFix(f.kV,5)}${finite(f.r2)?` · fit R² ${calFix(f.r2,3)}`:''}</p><div class="button-row"><button type="button" class="primary" data-cal-act="pass" data-cal-mech="${id}" data-cal-gate="G6"${finite(f.r2)&&f.r2<.95?' disabled':''}>Use these</button></div>`:''}`;}
    else if(g==='G7'){const p=calPid(m,rec),step=calTemp[m.id]?.step,vel=m.template==='T3',servo=m.template==='T4';
      const box=(k,label,v,s='any')=>`<div class="cal-field"><label for="cal-p-${id}-${k}">${label}</label><input id="cal-p-${id}-${k}" type="number" step="${s}" data-cal-p="${k}" data-cal-mech="${id}" value="${finite(v)?v:''}"></div>`;
      body=servo?`<p class="hint">The servo runs its own loop: Torque sends it two positions and checks its feedback arrives within the tolerance.</p><div class="cal-fields">${box('tolerance',`Tolerance (${u})`,p.tolerance)}</div><div class="button-row"><button type="button" class="secondary" data-cal-act="g7-arrive" data-cal-mech="${id}"${live?'':' disabled'}>Check arrival</button></div>${step?.text?`<p class="hint">${calEsc(step.text)}</p>`:''}${step?.ok?`<div class="button-row"><button type="button" class="primary" data-cal-act="g7-pass" data-cal-mech="${id}">It arrives</button></div>`:''}`
        :`<p class="hint">Gains are power per ${u}${vel?'':' of error'}; the plot is the simulation on what the ramps measured${step?', with the robot\'s run over it':''}.</p><div class="cal-fields">${box('kP','kP',p.kP)}${box('kI','kI',p.kI)}${box('kD','kD',p.kD)}${vel?box('kF','kF (power per RPM)',p.kF):''}${box('kS','kS',p.kS)}${m.template==='T1'?box('kG','kG',p.kG):''}${box('tolerance',`Tolerance (${u})`,p.tolerance)}${box('from',`Step from (${u})`,p.from)}${box('target',`Step to (${u})`,p.target)}</div>
          <svg class="cal-plot" data-cal-plot="${id}" viewBox="0 0 400 140" preserveAspectRatio="none" role="img" aria-label="Step response"></svg><p class="hint" data-cal-plot-note="${id}"></p>
          <div class="button-row"><button type="button" class="secondary" data-cal-act="g7-suggest" data-cal-mech="${id}">Suggest gains</button><button type="button" class="secondary" data-cal-act="g7-run" data-cal-mech="${id}"${live?'':' disabled'}>Run the step on the robot</button>${step?.info?.holds?`<button type="button" class="primary" data-cal-act="g7-pass" data-cal-mech="${id}">It settles: use these</button>`:''}</div>${step?.text?`<p class="hint">${calEsc(step.text)}</p>`:''}`;}
    else if(g==='GT'){const keys=calSensorKeys(m),c=calTemp[m.id]?.thr||{},th=rec.threshold;
      body=`<p class="hint">Pick what it reads, then capture a second of readings without a piece (or released) and with one (or pressed).</p><div class="cal-fields"><div class="cal-field"><label for="cal-gt-${id}">Reading</label><select id="cal-gt-${id}" data-cal-gt="${id}">${keys.map(k=>`<option value="${calEsc(k)}"${(c.key||th?.key)===k?' selected':''}>${calEsc(k.replace(/^[a-z]:/,''))}</option>`).join('')}</select></div></div>
        <div class="button-row"><button type="button" class="secondary" data-cal-act="gt-cap" data-which="a" data-cal-mech="${id}"${live?'':' disabled'}>Capture without (${c.a?.length||0})</button><button type="button" class="secondary" data-cal-act="gt-cap" data-which="b" data-cal-mech="${id}"${live?'':' disabled'}>Capture with (${c.b?.length||0})</button></div>
        ${c.result?`<p class="${c.result.overlap?'cal-note':'hint'}">${c.result.overlap?'The two overlap: the sensor cannot tell them apart here (move it closer, or change its gain).':`Threshold ${calFix(c.result.value,3)}, gap ${calFix(c.result.gap,3)}.`}</p>${c.result.overlap?'':`<div class="button-row"><button type="button" class="primary" data-cal-act="gt-pass" data-cal-mech="${id}">Use this threshold</button></div>`}`:th?`<p class="hint">Saved: ${calEsc(th.key)} at ${calFix(th.value,3)}.</p>`:''}`;}
    else if(g==='G8'){const lines=[rec.transform?.cpr?`Units: ${calFix(rec.transform.cpr,1)} counts a turn, ratio ${calFix(rec.transform.ratio??1,3)}${rec.transform.unit==='mm'?`, ${calFix(rec.transform.perTurn,1)} mm a turn`:''}`:'',rec.range?`Range ${calFix(rec.range.lo)} to ${calFix(rec.range.hi)} ${u}`:'',rec.ff?`kS ${calFix(rec.ff.kS,3)}, kG ${calFix(rec.ff.kG,3)}, kV ${calFix(rec.ff.kV,5)}`:'',rec.pid?`kP ${calFix(rec.pid.kP,4)}, kI ${calFix(rec.pid.kI,4)}, kD ${calFix(rec.pid.kD,4)}, tolerance ${calFix(rec.pid.tolerance)} ${u}`:'',rec.threshold?`Threshold ${calFix(rec.threshold.value,3)} on ${rec.threshold.key}`:''].filter(Boolean);
      body=`<ul class="cal-summary">${lines.map(l=>`<li>${calEsc(l)}</li>`).join('')||'<li class="hint">Nothing measured: its positions are commands.</li>'}</ul><div class="button-row"><button type="button" class="primary" data-cal-act="g8-commit" data-cal-mech="${id}">Save as calibrated</button><button type="button" class="secondary" data-cal-act="g8-java">Show the constants file</button></div>${calTemp.java?`<pre class="cal-java">${calEsc(calTemp.java)}</pre><div class="button-row"><button type="button" class="secondary" data-cal-act="g8-copy">Copy</button></div>`:''}`;}
    return `<div class="cal-gate" data-state="${state}"><h4>${calEsc(G.name)}${state==='stale'?' · redo: something it depended on changed':''}</h4><p class="hint">${calEsc(G.what)} <b>Passes when:</b> ${calEsc(G.pass)}</p>${body}</div>`;}
  // The gains a mechanism's G7 starts from: what was saved, else a suggestion from the ramps (or its motor model).
  function calFree(m,rec){if(rec.ff?.kV>0)return 1/rec.ff.kV;const md=window.DeckHardware.MODELS[m.row.model],t=rec.transform||{};if(md?.rpm){const raw=md.rpm*(t.cpr||md.cpr||28)/60;return Math.abs(TU.toUnits(raw,{...t,offset:0})-TU.toUnits(0,{...t,offset:0}))||300;}return m.template==='T3'?3000:300;}
  function calPid(m,rec){const vel=m.template==='T3',s=TU.suggest({kind:vel?'velocity':'position',freeSpeed:calFree(m,rec),kS:rec.ff?.kS}),r=rec.range;
    return {...s,kG:rec.ff?.kG??0,tolerance:vel?Math.max(20,calFree(m,rec)*.02):2,from:vel?0:finite(r?.lo)?r.lo+(r.hi-r.lo)*.25:0,target:vel?(project.mechanisms.shooter.rpm||calFree(m,rec)*.7):finite(r?.lo)?r.lo+(r.hi-r.lo)*.6:45,...rec.pid,...calTemp[m.id]?.pid};}
  function calSensorKeys(m){const v=liveDebug?.values()||{},names=m.sensors.map(s=>s.name);return Object.keys(v).filter(k=>names.some(n=>k===`d:${n}`||k===`a:${n}`||k.startsWith(`i:${n}:`)));}
  // Step plots: the simulated loop on the measured feedforward, and the robot's run on top.
  function calPlots(){
    for(const svg of $$('[data-cal-plot]')){const m=calMechList().find(x=>x.id===svg.dataset.calPlot);if(!m)continue;const rec=calRec(m.id),p=calPid(m,rec),vel=m.template==='T3';
      const sim=TU.simulate({kind:vel?'velocity':'position',from:p.from,target:p.target,kP:p.kP,kI:p.kI,kD:p.kD,kF:p.kF,kS:p.kS,kG:p.kG,tolerance:p.tolerance,freeSpeed:calFree(m,rec),tau:.08,gravity:m.template==='T1'?(rec.ff?.kG||0):0,friction:rec.ff?.kS??.04,wrap:m.feedback?.wrap,seconds:2.5});
      const robot=calTemp[m.id]?.step?.samples||[],all=[...sim.samples.map(s=>s.value),...robot.map(s=>s.value),p.from,p.target];let lo=Math.min(...all),hi=Math.max(...all);if(hi-lo<1e-9){hi+=1;lo-=1;}
      const X=t=>t/2.5*400,Y=v=>136-(v-lo)/(hi-lo)*132,line=pts=>pts.map((s,i)=>`${i?'L':'M'}${X(s.t).toFixed(1)},${Y(s.value).toFixed(1)}`).join('');
      svg.innerHTML=`<rect class="cal-plot-band" x="0" width="400" y="${Y(p.target+p.tolerance).toFixed(1)}" height="${Math.max(1,Y(p.target-p.tolerance)-Y(p.target+p.tolerance)).toFixed(1)}"/><path class="cal-plot-target" d="M0,${Y(p.target).toFixed(1)}H400"/><path class="cal-plot-sim" d="${line(sim.samples)}"/>${robot.length?`<path class="cal-plot-robot" d="${line(robot)}"/>`:''}`;
      const note=$(`[data-cal-plot-note="${CSS.escape(m.id)}"]`);if(note)note.textContent=`Simulated: ${sim.holds?`settles in ${calFix(sim.settle,2)} s`:'does not settle within the tolerance'}, swings ${calFix(sim.overshoot,1)} past.${robot.length?' Robot: the darker line.':''}`;}}
  // Live readouts in open panels follow the robot.
  liveDebug?.listen(()=>{for(const o of $$('[data-cal-live]')){const m=calMechList().find(x=>x.id===o.dataset.calLive);if(m)o.textContent=calFix(calUnitsNow(m,calRec(m.id)));}});
  // The ramps (G6): power commands signed so + is the mechanism's positive way, speed from its reading in units a second.
  async function calRamp(m){
    const rec=calRec(m.id),key=calKey(m,rec),cmd=calCmd(m),sign=rec.motorSign===-1?-1:1,kind=TU.TEMPLATES[m.template].ff,r=rec.range,state=calTemp[m.id]??={};state.ramp={running:true,text:'Running…'};calRender();
    const hist=[],off=liveDebug.listen((f,v)=>{hist.push({t:f.t/1000,u:TU.toUnits(v[key],rec.transform||{})});if(hist.length>40)hist.shift();});
    const speed=()=>{const h=hist.filter(x=>finite(x.u));if(h.length<3)return 0;const a=h[h.length-4]||h[0],b=h.at(-1);return (b.u-a.u)/Math.max(1e-3,b.t-a.t);};
    const out=p=>liveDebug.send(`${cmd}\t${m.row.name}\t${(p*sign).toFixed(3)}`),inRange=()=>!finite(r?.lo)||(()=>{const u=hist.at(-1)?.u;return !finite(u)||u>r.lo&&u<r.hi;})();
    try{
      if(kind==='velocity'){const pts=[];for(const p of [.2,.35,.5,.65,.8]){const t0=performance.now();while(performance.now()-t0<800){out(p);await calWait(100);}pts.push({power:p,velocity:hist.slice(-6).reduce((a,x)=>a+x.u,0)/Math.max(1,hist.slice(-6).length)});}
        out(0);const f=TU.velocityFit(pts);if(!f)throw Error('The speed did not change with power: is its encoder plugged in?');rec.ff={kS:f.kS,kG:0,kV:f.kV,r2:f.r2};state.ramp={text:`Fit over ${pts.length} speeds; top speed about ${calFix(f.top,0)} RPM.`};}
      else{const thr=Math.max(.5,finite(r?.lo)?(r.hi-r.lo)*.02:1);let up=null,down=null;
        for(let p=0;p<=.8&&inRange();p+=.01){out(p);await calWait(80);if(speed()>thr){up=p;break;}}out(0);await calWait(500);
        for(let p=kind==='gravity'&&up!==null?up:0;p>=-.8&&inRange();p-=.01){out(p);await calWait(80);if(speed()<-thr){down=p;break;}}out(0);
        if(up===null||down===null)throw Error('It did not start moving both ways before the power cap or its limits.');const hb=TU.holdBand(up,down);rec.ff={kS:hb.kS,kG:kind==='gravity'?hb.kG:0,kV:rec.ff?.kV??0};state.ramp={text:`Started up at ${calFix(up,2)} power and down at ${calFix(down,2)}.`};}
      calSave();}
    catch(e){state.ramp={text:e.message};out(0);calRender();}
    finally{off();}}
  // The robot-side step test (G7): Torque Debug's own loop on the raw reading, the gains turned from units into raw counts.
  async function calStep(m){
    const rec=calRec(m.id),p=calPid(m,rec),t=rec.transform||{},key=calKey(m,rec),vel=m.template==='T3',per=Math.abs(TU.toUnits(1,{...t,offset:0})-TU.toUnits(0,{...t,offset:0}))||1,g=(t.sign===-1?-1:1)*(rec.motorSign===-1?-1:1);
    const sensor=key.startsWith('a:')?`ana:${key.slice(2)}`:`enc:${key.split(':')[1]}`,state=calTemp[m.id]??={};state.step={text:'Moving to the start…'};calRender();
    const send=(target)=>liveDebug.send(['Q',m.row.name,sensor,vel?'vel':'pos',TU.toRaw(target,t).toFixed(3),p.kP*per*g,p.kI*per*g,p.kD*per*g,(p.kF||0)*per*g,(p.kS||0)*g,(p.kG||0)*(rec.motorSign===-1?-1:1),(p.tolerance/per).toFixed(3),m.feedback?.wrap?(360/per).toFixed(3):0].join('\t'));
    try{if(!vel){send(p.from);await calWait(1500);}const got=liveDebug.record(3000);send(p.target);const frames=await got;liveDebug.send(`${calCmd(m)}\t${m.row.name}\t0`);
      const t0=frames[0]?.t??0,samples=frames.map(f=>({t:f.t-t0,value:TU.toUnits(f.v[key],t)})).filter(s=>finite(s.value)),info=TU.stepInfo(samples,vel?0:p.from,p.target,p.tolerance);
      state.step={samples,info,text:info?`Robot: ${info.holds?`settled in ${calFix(info.settle,2)} s`:'did not settle within the tolerance'}, swung ${calFix(info.overshoot*100,0)} % past${finite(info.rise)?`, rise ${calFix(info.rise,2)} s`:''}.`:'No readings came back.'};}
    catch(e){state.step={text:e.message};liveDebug.send(`${calCmd(m)}\t${m.row.name}\t0`);}
    calRender();}
  // Panel actions.
  $('#cal-gates')?.addEventListener('click',e=>{
    const chip=e.target.closest('[data-cal-gate]:not([data-cal-act])');if(chip){const id=chip.dataset.calMech;calOpen[id]=calOpen[id]===chip.dataset.calGate?null:chip.dataset.calGate;calGates();return;}
    const b=e.target.closest('[data-cal-act]');if(!b)return;const act=b.dataset.calAct,m=calMechList().find(x=>x.id===b.dataset.calMech),rec=m&&calRec(m.id),state=m&&(calTemp[m.id]??={});
    if(act==='to-configure'){$('#calibrate-view [data-flow=configure]')?.click();return;}
    if(act==='to-hub'){calSelect('mechanisms');mechGo('hub');$('#cal-hub-setup').scrollIntoView({block:'center'});$('#cal-hub-setup').focus();return;}
    if(act==='to-live'){calSelect('debug');$('#cal-debug').scrollIntoView({block:'start'});$('[data-debug-start]')?.focus();return;}
    if(act==='to-setup'){void api.page?.('simulation');return;}
    if(act==='g8-java'){const list=calMechList().filter(x=>project.calibration.mechs[x.id]?.gates?.G8);calTemp.java=TU.constants(list.map(x=>({name:x.name,template:x.template,rec:project.calibration.mechs[x.id]})),{when:new Date().toLocaleDateString(),lens:project.calibration.lens});calGates();return;}
    if(act==='g8-copy'){void navigator.clipboard?.writeText(calTemp.java||'');return;}
    if(!m)return;
    if(act==='pass'){calPass(m,b.dataset.calGate);return;}
    if(act==='g2-pulse'){b.disabled=true;const kind=calCmd(m);void liveDebug.pulse(kind,m.row.name,kind==='S'?.6:.25,.4).then(r=>{const own=calKey(m,{}),best=r.changes.find(c=>c.key===own)||r.changes.filter(c=>/^(m:.*:pos|m:.*:vel|a:)/.test(c.key)).sort((a,c)=>Math.abs(c.delta)/c.noise-Math.abs(a.delta)/a.noise)[0];state.pulse={...r,bind:best?.key,delta:best?.delta};calGates();});return;}
    if(act==='g2-sign'){const ms=+b.dataset.sign,p=state.pulse,t={...(rec.transform||{})};if(p?.bind){t.sign=Math.sign(p.delta||1)*ms>0?1:-1;}calPass(m,'G2',{motorSign:ms,...(p?.bind?{bind:p.bind.startsWith('m:')?`m:${p.bind.split(':')[1]}:${m.template==='T3'?'vel':'pos'}`:p.bind}:{}),transform:t});return;}
    if(act==='g3-v'){const v=liveDebug.values()[calKey(m,rec)];if(!finite(v))return;rec.transform={...(rec.transform||{}),analog:true,['v'+b.dataset.which]:v};calSave();return;}
    if(act==='g3-mark'){state.mark=calUnitsNow(m,rec);state.check=null;calGates();return;}
    if(act==='g3-check'){const read=calUnitsNow(m,rec)-state.mark,actual=state.actual;if(!finite(actual)||!actual)return;state.check={read,actual,error:(read-actual)/actual};calGates();return;}
    if(act==='g3-scale'){const c=state.check;if(!c?.read)return;rec.transform={...rec.transform,ratio:(rec.transform.ratio||1)*c.read/c.actual};state.check=null;calSave();return;}
    if(act==='g3-pass'){const t={...(rec.transform||{})};if(!t.analog){t.cpr=t.cpr||+$(`#cal-t-${CSS.escape(m.id)}-cpr`)?.value||window.DeckHardware.MODELS[m.row.model]?.cpr||28;t.ratio=t.ratio||1;t.perTurn=m.template==='T3'?60:TU.perTurnOf(t);t.unit=m.template==='T3'?'rpm':t.unit||'deg';}
      calPass(m,'G3',{transform:t});return;}
    if(act==='g4-set'){const t={...(rec.transform||{})},u=TU.toUnits(liveDebug.values()[calKey(m,rec)],{...t,offset:0});if(!finite(u))return;t.offset=u;rec.zeros=[...(rec.zeros||[]),u].slice(-3);rec.transform=t;calSave();return;}
    if(act==='g5-set'){const u=calUnitsNow(m,rec);if(!finite(u))return;rec.range={...(rec.range||{}),[b.dataset.which]:u};calSave();return;}
    if(act==='g6-run'){void calRamp(m);return;}
    if(act==='g7-suggest'){state.pid=null;rec.pid=undefined;calSave();return;}
    if(act==='g7-run'){void calStep(m);return;}
    if(act==='g7-arrive'){void (async()=>{const key=calKey(m,rec),tol=calPid(m,rec).tolerance,res=[];for(const pos of [.3,.7]){liveDebug.send(`S\t${m.row.name}\t${pos}`);await calWait(1200);const a=calUnitsNow(m,rec);liveDebug.send(`S\t${m.row.name}\t${pos}`);await calWait(300);res.push([pos,a,calUnitsNow(m,rec)]);}
      const ok=res.every(([,a,b])=>finite(a)&&Math.abs(a-b)<=tol);state.step={ok,text:res.map(([p,a])=>`At ${p}: ${calFix(a)} ${calUnit(m,rec)}`).join(' · ')+(ok?' · steady':' · still moving or no reading')+(key?'':' · no feedback bound')};calGates();})();return;}
    if(act==='g7-pass'){calPass(m,'G7',{pid:{...calPid(m,rec)}});return;}
    if(act==='gt-cap'){const key=$(`#cal-gt-${CSS.escape(m.id)}`)?.value;if(!key)return;b.disabled=true;void liveDebug.record(1000).then(got=>{const th=state.thr=state.thr||{};if(th.key&&th.key!==key){th.a=null;th.b=null;}th.key=key;th[b.dataset.which]=got.map(f=>f.v[key]).filter(finite);th.result=th.a?.length&&th.b?.length?TU.threshold(th.a,th.b):null;calGates();});return;}
    if(act==='gt-pass'){const th=state.thr;if(!th?.result||th.result.overlap)return;calPass(m,'GT',{threshold:{key:th.key,value:th.result.value,hysteresis:th.result.hysteresis,pieceAbove:th.result.above==='b'}});return;}
    if(act==='g8-commit'){const f=liveDebug?.latest().frame;calPass(m,'G8',{committed:{at:new Date().toISOString(),battery:f?.v??null,source:liveDebug?.running()?'robot':'setup'}});return;}});
  $('#cal-gates')?.addEventListener('change',e=>{const el=e.target,d=el.dataset,m=calMechList().find(x=>x.id===d.calMech);if(!m)return;const rec=calRec(m.id),v=el.type==='number'?el.valueAsNumber:el.value,state=calTemp[m.id]??={};
    if(d.calT==='actual'){state.actual=v;calGates();return;}
    if(d.calT){const t={...(rec.transform||{}),[d.calT]:el.type==='number'?(finite(v)?v:undefined):v};if(!t.analog&&m.template!=='T3')t.perTurn=TU.perTurnOf(t);rec.transform=t;calSave();return;}
    if(d.calP){state.pid={...(state.pid||{}),[d.calP]:finite(v)?v:undefined};calGates();}});
  // The setup bar's right-click menu works here too.
  calRoot?.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-setup-id],#sim-setup');if(!b)return;e.preventDefault();const r=b.getBoundingClientRect();setupMenu(b.dataset.setupId||project.setupId,e.clientX||r.left+16,e.clientY||r.bottom);});
  $('#cal-open-sim').onclick=()=>void api.page?.('simulation');
  gateLive=true;
  return {flow(step){if(step==='debug')calSelect('debug');else if(step==='calibrate')calSelect(calTab);else{flowStep=step;setupRender();}flowMarks();hubWatch();axonShown();},setup(value){const was=setupShown;setupShown=!!value&&!!setupRoot;if(setupShown&&!was)setupRender();hubWatch();axonShown();if(!setupShown&&was){if(hubTest){hubTest=null;void liveDebug?.stop();}}},
    calibrate(value){const was=calibrating;calibrating=!!value&&!!calRoot;if(calibrating&&!was)void calibrateShow();if(was&&!calibrating)calTold('');hubWatch();clearInterval(gateTimer);gateTimer=calibrating?setInterval(calGate,1000):null;calGate();},
    activate(value){
    if(value)reliableNote();
    if(value){sendHome.append($('#sim-send'));if(setupBar&&setupHome)setupHome.before(setupBar);}
    if(active&&!value){glideStop();pointer=null;drag=null;status('#sim-run-status',runState==='running'?'Simulation closed. The running program was stopped.':'');if(tool==='start')preview={...start};frame=null;info=null;runState='idle';trail=[];draw();}
    const was=active;active=value;document.body.classList.toggle('sim-workspace',active&&tab!=='setup');
    if(value&&!was){if(!L().start)tool='start';draw();void load().then(()=>{if(project.view==='3d')void setView('3d');void placeModel();});}
  }};
}};
