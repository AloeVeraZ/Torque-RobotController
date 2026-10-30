(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckKinematics=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // How a robot's parts move, kept apart from what they are for. Five ideas, each its own list:
  //   geometry    the CAD body's parts (leaves of its assembly tree), named by `parts` refs;
  //   joints      how a link (some parts) moves relative to its parent link: revolute, continuous, prismatic,
  //               cylindrical, screw, universal, ball, planar, floating, pin-slot or fixed (URDF/SDF/MJCF's set);
  //   actuators   what commands a joint: position, velocity, effort or named states, through a transmission (gearbox,
  //               belt, spool, rack, screw), moving ideally (speed, acceleration), as a DC motor against a load, or as
  //               a pneumatic cylinder that rests at its ends; sensors read how they actually moved;
  //   couplings   motion passed on: gears, belts, racks, screws, cables, mimic, differentials, planetary sets, tendons
  //               (several inputs), cams and linkages (a table), stages that move one after another;
  //   loops       closed chains (four-bars, slider-cranks, parallel arms): a point on one link must stay on a point
  //               of another, and the free joints are solved so it does;
  //   actions     named, timed steps that command actuators (together, in sequence, after a delay), wait for a sensor
  //               or joint, or run another action.
  // A joint's origin and axes are in the CAD file's own frame at the pose the CAD was exported in (the rest pose),
  // like assembly mates. A link's motion is then W(child) = W(parent) · M(joint, q), every M expressed in that one
  // frame, so nested joints compose without local frames. Angles are degrees; distances are inches.
  // Nothing here knows about intakes or shooters: a game binds a joint to one of its signals with `drive`.
  const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),DEG=Math.PI/180;
  const TYPES={
    fixed:{name:'Fixed',dof:[]},
    revolute:{name:'Pivot (limited)',dof:['deg']},
    continuous:{name:'Spin (unlimited)',dof:['deg']},
    prismatic:{name:'Slide',dof:['in']},
    cylindrical:{name:'Turn and slide',dof:['deg','in']},
    screw:{name:'Screw (turning moves it along)',dof:['deg']},
    universal:{name:'Universal (two pivots)',dof:['deg','deg']},
    ball:{name:'Ball (turns any way)',dof:['deg','deg','deg']},
    planar:{name:'Planar (slides on a plane and turns)',dof:['in','in','deg']},
    floating:{name:'Floating (free)',dof:['in','in','in','deg','deg','deg']},
    pinslot:{name:'Pin in a slot',dof:['deg','in']}};
  const ACTUATORS={servo:'Servo (to a position)',crservo:'Continuous servo',dcmotor:'DC motor',bldc:'Brushless motor',stepper:'Stepper',linear:'Linear actuator',pneumatic:'Pneumatic cylinder',hydraulic:'Hydraulic cylinder',spring:'Spring',none:'Nothing (moves with others)'};
  const MODES={position:'Position',velocity:'Speed',effort:'Effort',states:'Named positions'};
  // How an actuator's motion is worked out: ideal follows its speed and acceleration exactly; motor uses a DC motor's
  // torque–speed line (free speed, stall torque) against the inertia and load entered; pneumatic rests only at its ends.
  const RESPONSES={ideal:'Ideal (its speed and acceleration)',motor:'Motor model (torque and load)',pneumatic:'Pneumatic (rests at its ends)'};
  // What sits between an actuator and its joint. Each stage multiplies how far the actuator turns per unit of joint
  // motion; spools, racks and screws turn degrees into inches.
  const STAGES={gearbox:'Gearbox',belt:'Belt, chain or gear pair',spool:'Spool (winds cable)',rack:'Rack and pinion',screw:'Lead screw'};
  const SENSORS={encoder:'Encoder',limit:'Limit switch',potentiometer:'Angle or distance sensor',velocity:'Speed sensor'};
  // A coupling sets one joint value from others: offset + f(first input) + Σ ratio·other inputs, f being a ratio (and
  // optional x², x³, x⁴ terms, MuJoCo's polycoef) or a table (cams, linkages, stages that move one after another).
  const COUPLINGS={gear:'Gears',belt:'Belt or chain',rack:'Rack and pinion',screw:'Lead screw',cable:'Cable or spool',mimic:'Follows another joint',
    differential:'Differential (sum or difference)',planetary:'Planetary gearset',tendon:'Tendon (several joints)',cam:'Cam (follows a profile)',sequence:'Stages one after another',linkage:'Linkage (follows a table)'};
  // What a game can drive a joint with. The simulator's mechanism model gives these each tick.
  const SIGNALS={turret:'Turret angle',hood:'Hood (rest / shooting)',flywheel:'Flywheel speed',roller:'Intake rollers',deploy:'Deploys while intaking',float:'Floats over pieces',feeder:'Feeder',wheel:'Drive wheel',steer:'Swerve steering',action:'Route actions'};
  // Spinning parts are drawn turning at most this fast (degrees a second) so a 3000 rpm flywheel does not strobe.
  const SHOW_SPIN=5400,shownRate=rpm=>{const r=Math.abs(rpm),show=r<=300?r:300*(r/300)**.37;return Math.min(SHOW_SPIN,show*6)*Math.sign(rpm);};
  // ---------------------------------------------------------------- vectors and 4×4 matrices (column-major, as three.js)
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=a=>Math.hypot(a[0],a[1],a[2]);
  const unit=a=>{const l=len(a);return l>1e-12?scale(a,1/l):[0,0,1];};
  // A unit vector at right angles to a (the world axis least along it, crossed).
  const perpendicular=a=>{const u=unit(a),w=Math.abs(u[0])<.6?[1,0,0]:Math.abs(u[1])<.6?[0,1,0]:[0,0,1];return unit(cross(u,w));};
  const I4=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
  const apply=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
  const applyDir=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
  const trans=v=>[1,0,0,0,0,1,0,0,0,0,1,0,v[0],v[1],v[2],1];
  // Rotation by deg about a unit axis through the origin (Rodrigues).
  function rot(axis,deg){const [x,y,z]=unit(axis),a=deg*DEG,c=Math.cos(a),s=Math.sin(a),t=1-c;
    return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0, t*x*y-s*z,t*y*y+c,t*y*z+s*x,0, t*x*z+s*y,t*y*z-s*x,t*z*z+c,0, 0,0,0,1];}
  const about=(o,axis,deg)=>mul(trans(o),mul(rot(axis,deg),trans(scale(o,-1))));
  // General 4×4 inverse (placements may scale).
  function invert(m){
    const [a00,a01,a02,a03,a10,a11,a12,a13,a20,a21,a22,a23,a30,a31,a32,a33]=m;
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(!det)return I4();det=1/det;
    return [(a11*b11-a12*b10+a13*b09)*det,(a02*b10-a01*b11-a03*b09)*det,(a31*b05-a32*b04+a33*b03)*det,(a22*b04-a21*b05-a23*b03)*det,(a12*b08-a10*b11-a13*b07)*det,(a00*b11-a02*b08+a03*b07)*det,(a32*b02-a30*b05-a33*b01)*det,(a20*b05-a22*b02+a23*b01)*det,
      (a10*b10-a11*b08+a13*b06)*det,(a01*b08-a00*b10-a03*b06)*det,(a30*b04-a31*b02+a33*b00)*det,(a21*b02-a20*b04-a23*b00)*det,(a11*b07-a10*b09-a12*b06)*det,(a00*b09-a01*b07+a02*b06)*det,(a31*b01-a30*b03-a32*b00)*det,(a20*b03-a21*b01+a22*b00)*det];}
  // ---------------------------------------------------------------- a joint's own frame and motion
  // Axis a, a second axis b at right angles to it (the slot of a pin-slot, the second pivot of a universal joint, a
  // planar joint's first slide) and c = a × b.
  function frame(j){const a=unit(j.axis||[0,0,1]);let b=j.axis2?sub(j.axis2,scale(a,dot(j.axis2,a))):null;b=b&&len(b)>1e-6?unit(b):perpendicular(a);return {a,b,c:cross(a,b)};}
  const dofOf=j=>(TYPES[j?.type]||TYPES.fixed).dof;
  const valuesOf=(j,q)=>{const n=dofOf(j).length,v=Array.isArray(q)?q:[q];return Array.from({length:n},(_,i)=>finite(v[i])?v[i]:0);};
  // The joint's motion at q, in the rest frame. unit: inches per CAD unit (distances in q are inches).
  function motion(j,q,unitIn=1){
    const v=valuesOf(j,q),o=j.origin||[0,0,0],{a,b,c}=frame(j),d=x=>x/(unitIn||1);
    switch(j.type){
      case 'revolute':case 'continuous':return about(o,a,v[0]);
      case 'prismatic':return trans(scale(a,d(v[0])));
      case 'cylindrical':return mul(trans(scale(a,d(v[1]))),about(o,a,v[0]));
      case 'screw':return mul(trans(scale(a,d((j.lead||0)*v[0]/360))),about(o,a,v[0]));
      case 'universal':return mul(trans(o),mul(rot(a,v[0]),mul(rot(b,v[1]),trans(scale(o,-1)))));
      case 'ball':return mul(trans(o),mul(rot(a,v[0]),mul(rot(b,v[1]),mul(rot(c,v[2]),trans(scale(o,-1))))));
      case 'planar':return mul(trans(add(scale(b,d(v[0])),scale(c,d(v[1])))),about(o,a,v[2]));
      case 'floating':return mul(trans(add(add(scale(a,d(v[0])),scale(b,d(v[1]))),scale(c,d(v[2])))),mul(trans(o),mul(rot(a,v[3]),mul(rot(b,v[4]),mul(rot(c,v[5]),trans(scale(o,-1)))))));
      case 'pinslot':return mul(trans(scale(b,d(v[1]))),about(o,a,v[0]));
      default:return I4();}
  }
  // ---------------------------------------------------------------- the stored model
  const ID=/^[A-Za-z][\w-]{0,31}$/;
  // Points keep 9 decimals of the CAD unit: a nanometre in a metre CAD (URDF, SDFormat, MJCF), as fine as a millimetre one.
  const vec=(v,d)=>Array.isArray(v)&&v.length===3&&v.every(finite)?v.map(x=>+x.toFixed(9)):d;
  const text=(v,n=80)=>typeof v==='string'?v.trim().slice(0,n):'';
  const num=(v,d,a=-1e6,b=1e6)=>finite(v)?clamp(v,a,b):d;
  // Part refs: an assembly node's key (every part under it) or "#n" for one part instance (a leaf).
  const refs=v=>Array.isArray(v)?[...new Set(v.filter(r=>typeof r==='string'&&r&&r.length<=400))].slice(0,4000):[];
  // standin: a game mechanism the CAD has no parts for yet; the software knows it moves, nothing is drawn for it.
  const PROVENANCE={metadata:'From the file',inferred:'Found in your CAD',user:'Set by you',standin:'Not in your CAD yet'};
  function sanitizeJoint(raw,ids){
    if(!raw||typeof raw!=='object'||!ID.test(raw.id)||ids.has(raw.id))return null;ids.add(raw.id);
    const type=Object.hasOwn(TYPES,raw.type)?raw.type:'revolute',n=TYPES[type].dof.length,axis=unit(vec(raw.axis,[0,0,1]));
    const states={};if(raw.states&&typeof raw.states==='object')for(const [k,v] of Object.entries(raw.states).slice(0,8)){const name=text(k,24);if(name&&finite(v))states[name]=+v.toFixed(4);}
    const drive=raw.drive&&Object.hasOwn(SIGNALS,raw.drive.signal)?{signal:raw.drive.signal,...(typeof raw.drive.of==='string'&&/^(intake|shooter):[0-3]$|^any$/.test(raw.drive.of)?{of:raw.drive.of}:{})}:null;
    return {id:raw.id,name:text(raw.name)||raw.id,type,parent:typeof raw.parent==='string'&&ID.test(raw.parent)?raw.parent:null,parts:refs(raw.parts),
      origin:vec(raw.origin,[0,0,0]),axis:axis.map(x=>+x.toFixed(6)),...(vec(raw.axis2)?{axis2:vec(raw.axis2)}:{}),
      ...(finite(raw.lower)?{lower:raw.lower}:{}),...(finite(raw.upper)?{upper:raw.upper}:{}),
      ...(n&&Array.isArray(raw.home)&&raw.home.some(finite)?{home:valuesOf({type},raw.home)}:{}),
      ...(type==='screw'?{lead:num(raw.lead,.3,-100,100)}:{}),
      // End stops of the other joint types, one [low, high] (or null) per value: a pin's travel along its slot, a
      // cylinder's stroke, a universal joint's two angles. (A ball joint's per-angle stops approximate a cone.)
      ...(n&&type!=='revolute'&&type!=='prismatic'&&Array.isArray(raw.limits)?(l=>l.some(Boolean)?{limits:l}:{})(Array.from({length:n},(_,i)=>{const x=raw.limits[i];return Array.isArray(x)&&finite(x[0])&&finite(x[1])&&x[0]<=x[1]?[+x[0],+x[1]]:null;})):{}),
      ...(Object.keys(states).length?{states}:{}),...(drive?{drive}:{}),
      // The team says it goes all the way round (a turret on a slip ring), past what its game aims it through.
      ...(raw.free===true?{free:true}:{}),
      // What the part is (a claw, a lift, a turret: DeckMechanismTypes), for its defaults and the panel's labels.
      ...(typeof raw.kind==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(raw.kind)?{kind:raw.kind}:{}),
      // How fast it moves to a position (units a second), or how fast it spins at full speed (rpm).
      ...(finite(raw.speed)&&raw.speed>0?{speed:clamp(raw.speed,.01,1e5)}:{}),...(finite(raw.rpm)&&raw.rpm>0?{rpm:clamp(raw.rpm,.1,60000)}:{}),
      // Turns for each turn of its motor, from the CAD's belts and gears: the motor's model then sets rpm.
      ...(finite(raw.ratio)&&raw.ratio>0?{ratio:clamp(raw.ratio,.001,1000)}:{}),
      // A turret's heading in the CAD (degrees counterclockwise from the robot's front, seen from above).
      ...(finite(raw.zero)?{zero:+(((raw.zero%360)+540)%360-180).toFixed(3)}:{}),
      // A hood's launch angle as the CAD has it (degrees above level); it tilts by the difference to the game's.
      ...(finite(raw.launch)?{launch:+clamp(raw.launch,0,90).toFixed(2)}:{}),
      ...(finite(raw.radius)&&raw.radius>0?{radius:+raw.radius.toFixed(4)}:{}),
      // How a drive wheel rolls: a plain wheel only forward and back; a mecanum wheel's rollers also take sideways motion.
      ...(['mecanum','omni'].includes(raw.roll)?{roll:raw.roll}:{}),
      source:Object.hasOwn(PROVENANCE,raw.source)?raw.source:'user',...(finite(raw.confidence)?{confidence:clamp(+raw.confidence.toFixed(2),0,1)}:{}),...(text(raw.note,300)?{note:text(raw.note,300)}:{}),
      // A mechanism the team added and Configure from CAD found: the CAD assembly it was matched to.
      ...(text(raw.matched,120)?{matched:text(raw.matched,120)}:{}),
      ...(Array.isArray(raw.alternatives)?{alternatives:raw.alternatives.slice(0,3).filter(a=>a&&vec(a.origin)&&vec(a.axis)).map(a=>({origin:vec(a.origin),axis:unit(vec(a.axis)),note:text(a.note,200)}))}:{})};
  }
  function sanitize(raw){
    const r=raw&&typeof raw==='object'?raw:{},ids=new Set();
    const joints=(Array.isArray(r.joints)?r.joints:[]).slice(0,96).map(j=>sanitizeJoint(j,ids)).filter(Boolean);
    // A parent must exist and must not lead back to the joint itself.
    const byId=new Map(joints.map(j=>[j.id,j]));for(const j of joints)if(j.parent&&!byId.has(j.parent))j.parent=null;
    for(const j of joints){const seen=new Set([j.id]);for(let p=j.parent;p;p=byId.get(p)?.parent){if(seen.has(p)){j.parent=null;break;}seen.add(p);}}
    const jointRef=v=>typeof v==='string'&&byId.has(v)?v:null,aid=new Set();
    const actuators=(Array.isArray(r.actuators)?r.actuators:[]).slice(0,96).map(a=>{if(!a||!ID.test(a.id)||aid.has(a.id)||!jointRef(a.joint))return null;aid.add(a.id);const j=byId.get(a.joint),n=Math.max(1,dofOf(j).length);
      const states={};if(a.states&&typeof a.states==='object')for(const [k,v] of Object.entries(a.states).slice(0,8)){const name=text(k,24);if(name&&finite(v))states[name]=v;}
      const transmission=sanitizeStages(a.transmission),response=Object.hasOwn(RESPONSES,a.response)?a.response:'ideal',motor=response==='motor'?sanitizeMotor(a.motor):null;
      return {id:a.id,name:text(a.name)||a.id,kind:Object.hasOwn(ACTUATORS,a.kind)?a.kind:'servo',joint:a.joint,index:Math.round(num(a.index,0,0,n-1)),mode:Object.hasOwn(MODES,a.mode)?a.mode:'position',
        speed:num(a.speed,90,.001,1e5),accel:num(a.accel,0,0,1e7),ratio:transmission?stagesRatio(transmission):num(a.ratio,1,-1e4,1e4)||1,...(finite(a.home)?{home:a.home}:{}),...(Object.keys(states).length?{states}:{}),...(finite(a.effort)?{effort:clamp(a.effort,-1,1)}:{}),
        ...(transmission?{transmission}:{}),...(response!=='ideal'&&(response!=='motor'||motor)?{response,...(motor?{motor}:{})}:{}),...hardwareOf(a)};}).filter(Boolean);
    const term=t=>t&&jointRef(t.from)?{from:t.from,ratio:num(t.ratio,1,-1e4,1e4),...(finite(t.fromIndex)?{fromIndex:Math.max(0,Math.round(t.fromIndex))}:{})}:null;
    const couplings=(Array.isArray(r.couplings)?r.couplings:[]).slice(0,96).map(c=>{if(!c||!jointRef(c.from)||!jointRef(c.to)||c.from===c.to)return null;
      const plus=(Array.isArray(c.plus)?c.plus:[]).slice(0,7).map(term).filter(t=>t&&t.from!==c.to),curve=curveOf(c.curve),poly=Array.isArray(c.poly)?c.poly.slice(0,3).map(v=>finite(v)?v:0):[];while(poly.length&&!poly.at(-1))poly.pop();
      return {kind:Object.hasOwn(COUPLINGS,c.kind)?c.kind:'mimic',from:c.from,to:c.to,ratio:num(c.ratio,1,-1e4,1e4),offset:num(c.offset,0),
        ...(finite(c.fromIndex)?{fromIndex:Math.max(0,Math.round(c.fromIndex))}:{}),...(finite(c.toIndex)?{toIndex:Math.max(0,Math.round(c.toIndex))}:{}),
        ...(plus.length?{plus}:{}),...(curve?{curve,...(finite(c.period)&&c.period>0?{period:+c.period}:{})}:poly.length?{poly}:{})};}).filter(Boolean);
    // One coupling per driven joint (the first wins), so a joint is never set twice.
    const driven=new Set(),kept=[];for(const c of couplings){const key=c.to+':'+(c.toIndex||0);if(driven.has(key))continue;driven.add(key);kept.push(c);}
    const end=e=>e&&vec(e.point)&&(e.joint===null||e.joint===undefined||jointRef(e.joint))?{joint:jointRef(e.joint),point:vec(e.point)}:null;
    // A loop with `along` (a direction fixed to a's link) is a pin in a slot: b's point stays on the line through a's.
    const loops=(Array.isArray(r.loops)?r.loops:[]).slice(0,48).map(l=>{const a=end(l?.a),b=end(l?.b),along=vec(l?.along);return a&&b&&a.joint!==b.joint?{a,b,...(along&&len(along)>1e-9?{along:unit(along).map(x=>+x.toFixed(6))}:{})}:null;}).filter(Boolean);
    const movable=new Set([...actuators.map(a=>a.id),...joints.filter(j=>j.drive?.signal==='action'&&dofOf(j).length===1).map(j=>j.id)]),actuatorRef=v=>typeof v==='string'&&aid.has(v)?v:null,sid=new Set();
    // Sensors read the simulated (not the commanded) motion: an encoder counts an actuator's or a joint's turns, a limit
    // switch closes within `band` of `at`, an angle or distance sensor reads the value, a speed sensor its rate.
    const sensors=(Array.isArray(r.sensors)?r.sensors:[]).slice(0,48).map(s=>{if(!s||!ID.test(s.id)||sid.has(s.id)||aid.has(s.id)||byId.has(s.id)||!Object.hasOwn(SENSORS,s.kind))return null;const on=actuatorRef(s.actuator)?{actuator:s.actuator}:jointRef(s.joint)?{joint:s.joint}:null;if(!on||s.kind==='velocity'&&!on.actuator)return null;sid.add(s.id);
      const n=on.joint?Math.max(1,dofOf(byId.get(on.joint)).length):1;
      return {id:s.id,name:text(s.name)||s.id,kind:s.kind,...on,...(on.joint&&n>1?{index:Math.round(num(s.index,0,0,n-1))}:{}),...(s.kind==='encoder'?{cpr:num(s.cpr,537.7,.01,1e7)}:{}),...(s.kind==='limit'?{at:num(s.at,0),band:num(s.band,.5,0,1e4)}:{})};}).filter(Boolean);
    const actions=(Array.isArray(r.actions)?r.actions:[]).slice(0,48).map(sanitizeAction(movable,{sensors:sid,joints:new Set(byId.keys()),actuators:aid})).filter(Boolean);
    const out={version:1,model:typeof r.model==='string'&&/^[0-9a-f]{32}\.glb$|^builtin:[a-z]+$/.test(r.model)?r.model:null,unit:num(r.unit,1,1e-6,1e6),joints,actuators,couplings:kept,loops,actions};
    if(sensors.length)out.sensors=sensors;
    // Named poses: values for several movers at once ("Home", "Above the bin"), reached together.
    const poses=(Array.isArray(r.poses)?r.poses:[]).slice(0,32).map(p=>{if(!p||typeof p.name!=='string'||!p.name.trim())return null;const values={};
      for(const [k,v] of Object.entries(p.values&&typeof p.values==='object'?p.values:{}).slice(0,32))if(movable.has(k)&&finite(v))values[k]=+v;return Object.keys(values).length?{name:text(p.name,40),values}:null;}).filter(Boolean);
    if(poses.length)out.poses=poses;
    // The CAD the team says has every mechanism at zero (the range of motion test measures from it).
    if(typeof r.zeroed==='string'&&r.zeroed.length<=80)out.zeroed=r.zeroed;
    if(r.discovered===true)out.discovered=true;if(finite(r.finder))out.finder=Math.round(r.finder);return out;
  }
  // An action: steps that command actuators. Each step starts `delay` seconds after the step it follows ends (or after
  // the action starts), so steps run together, in sequence or staggered. A position step ends when its actuator gets
  // there; a speed step ends after its `seconds`.
  // Two more kinds of step: another action by name (a reusable preset, ending when it ends), and a wait that ends once
  // a sensor, joint or actuator reads above or below a value or a switch is (or is not) closed, or after its timeout.
  const sanitizeAction=(actuatorIds,refs={})=>raw=>{
    if(!raw||typeof raw.name!=='string'||!raw.name.trim())return null;const steps=[];
    for(const s of (Array.isArray(raw.steps)?raw.steps:[]).slice(0,48)){if(!s)continue;
      const base={after:Number.isInteger(s.after)&&s.after>=0&&s.after<steps.length?s.after:null,delay:num(s.delay,0,0,600)};
      if(typeof s.action==='string'&&text(s.action,40)){steps.push({action:text(s.action,40),...base});continue;}
      // A named pose, or a point on a link to bring to a target (and directions to aim): every mover goes together.
      if(typeof s.pose==='string'&&text(s.pose,40)){steps.push({pose:text(s.pose,40),...base});continue;}
      if(s.reach&&typeof s.reach==='object'){const g=s.reach,aim=(Array.isArray(g.aim)?g.aim:[]).slice(0,2).filter(x=>x&&vec(x.local)&&vec(x.target)).map(x=>({local:vec(x.local),target:vec(x.target)}));
        if(refs.joints?.has(g.joint)&&vec(g.point)&&vec(g.target))steps.push({reach:{joint:g.joint,point:vec(g.point),target:vec(g.target),...(aim.length?{aim}:{})},...base});continue;}
      if(s.wait&&typeof s.wait==='object'){const w=s.wait,on=refs.sensors?.has(w.sensor)?{sensor:w.sensor}:refs.actuators?.has(w.actuator)?{actuator:w.actuator}:refs.joints?.has(w.joint)?{joint:w.joint,...(finite(w.index)?{index:Math.max(0,Math.round(w.index))}:{})}:{};
        const cond={...(finite(w.above)?{above:w.above}:{}),...(finite(w.below)?{below:w.below}:{}),...(typeof w.is==='boolean'?{is:w.is}:{})},timed=finite(s.timeout)?{timeout:clamp(s.timeout,0,600)}:{};
        if(Object.keys(on).length&&Object.keys(cond).length)steps.push({wait:{...on,...cond},...base,...timed});else if(timed.timeout!==undefined)steps.push({wait:{},...base,...timed});continue;}
      if(!actuatorIds.has(s.actuator))continue;const c=s.command||{};
      const command=typeof c.state==='string'?{state:text(c.state,24)}:finite(c.target)?{target:c.target}:finite(c.velocity)?{velocity:c.velocity}:finite(c.effort)?{effort:clamp(c.effort,-1,1)}:null;if(!command)continue;
      steps.push({actuator:s.actuator,command,after:Number.isInteger(s.after)&&s.after>=0&&s.after<steps.length?s.after:null,delay:num(s.delay,0,0,600),...(finite(s.seconds)?{seconds:clamp(s.seconds,0,600)}:{})});}
    return steps.length?{name:text(raw.name,40),steps,...(Number.isInteger(raw.repeat)&&raw.repeat>1?{repeat:Math.min(100,raw.repeat)}:{})}:null;};
  const EMPTY=()=>sanitize({});
  const statesOf=(model,a)=>a.states||model.joints.find(x=>x.id===a.joint)?.states||{};
  // Transmission stages from actuator to joint. A stage's factor is how far its input turns per unit of its output.
  function sanitizeStages(v){if(!Array.isArray(v))return null;
    const out=v.slice(0,8).map(s=>{if(!s||!Object.hasOwn(STAGES,s.kind))return null;const rev=s.reverse===true?{reverse:true}:{};
      if(s.kind==='gearbox')return finite(s.ratio)&&s.ratio>0?{kind:'gearbox',ratio:+s.ratio,...rev}:null;
      if(s.kind==='belt')return finite(s.driver)&&s.driver>0&&finite(s.driven)&&s.driven>0?{kind:'belt',driver:+s.driver,driven:+s.driven,...rev}:null;
      if(s.kind==='screw')return finite(s.lead)&&s.lead>0?{kind:'screw',lead:+s.lead,...rev}:null;
      return finite(s.diameter)&&s.diameter>0?{kind:s.kind,diameter:+s.diameter,...rev}:null;}).filter(Boolean);
    return out.length?out:null;}
  const LINEAR_STAGES=new Set(['spool','rack','screw']);
  const stageFactor=s=>(s.reverse?-1:1)*(s.kind==='gearbox'?s.ratio:s.kind==='belt'?s.driven/s.driver:s.kind==='screw'?360/s.lead:360/(Math.PI*s.diameter));
  // Actuator units per joint unit through every stage: a 20:1 gearbox then a 1.5 in spool turns 20·360/(π·1.5)° per inch.
  const stagesRatio=v=>+(v||[]).reduce((r,s)=>r*stageFactor(s),1).toPrecision(12);
  // The unit an actuator moves in: degrees when a stage turns its rotation into the joint's travel, else the joint's.
  // A motor model in its joint's units: free speed divided by the ratio, stall torque multiplied by it (in SI, so a
  // spool's N·m becomes N), times the number of motors. Power is conserved through an ideal transmission.
  function motorAtJoint(a,j){if(a.response!=='motor'||!a.motor)return null;const r=Math.abs(a.ratio)||1,si=u=>u==='in'?.0254:DEG,rSI=r*si(actuatorUnit(a,j))/si(dofOf(j)[a.index]||'deg');
    return {...a.motor,free:a.motor.free/r,stall:a.motor.stall*rSI*(a.motor.count||1)};}
  const actuatorUnit=(a,j)=>(a.transmission||[]).some(s=>LINEAR_STAGES.has(s.kind))?'deg':dofOf(j)[a.index||0]||'deg';
  // A DC motor (brushed or brushless) as WPILib models one: torque falls linearly from stall at rest to nothing at free
  // speed, in proportion to the voltage. The motor's own figures, at its shaft before the transmission: free (degrees
  // a second at full voltage; inches a second for a linear motor), stall (N·m; N), count (motors sharing the load).
  // At the joint: load, a steady torque (N·m, or N on a slide) against positive motion, such as gravity on an arm or a
  // lift; inertia (kg·m², or kg), else what gives a 0.05 s motor time constant. p, i, d: the position controller, as a
  // fraction of full voltage per unit of error (per unit·s, per unit/s); power: the most voltage it may use.
  function sanitizeMotor(m){if(!m||!finite(m.free)||!(m.free>0)||!finite(m.stall)||!(m.stall>0))return null;
    return {free:clamp(+m.free,.01,1e7),stall:clamp(+m.stall,1e-6,1e6),...(Number.isInteger(m.count)&&m.count>1?{count:Math.min(8,m.count)}:{}),...(finite(m.load)?{load:clamp(+m.load,-1e6,1e6)}:{}),...(finite(m.inertia)&&m.inertia>0?{inertia:+m.inertia}:{}),
      ...['p','i','d'].reduce((o,k)=>finite(m[k])&&m[k]>=0?{...o,[k]:+m[k]}:o,{}),...(finite(m.power)?{power:clamp(+m.power,0,1)}:{})};}
  // What the robot code needs to drive an actuator (DeckActuators): the motor or servo model it is, its name in the robot
  // configuration and whether it turns the other way; a servo's positions (0–1: the lowest and highest it may go to, and
  // the one that holds its part where the CAD has it), the degrees (inches for a linear servo) it turns across its rated
  // pulses and the pulses the hub sends for 0 and 1; a DC motor's encoder counts per turn of its output and its power.
  const DEVICE=/^[A-Za-z][\w .-]{0,39}$/,unitNum=v=>finite(v)?clamp(+v,0,1):null;
  function hardwareOf(a){
    const out={};if(typeof a.model==='string'&&/^[a-z0-9][a-z0-9-]{0,47}$/.test(a.model))out.model=a.model;
    if(typeof a.device==='string'&&DEVICE.test(a.device.trim()))out.device=a.device.trim();if(a.reversed===true)out.reversed=true;
    // A second motor or servo on the same part (a lift's other side, a mirrored wrist servo), driven with the first.
    if(typeof a.device2==='string'&&DEVICE.test(a.device2.trim())){out.device2=a.device2.trim();if(a.reversed2===true)out.reversed2=true;}
    const s=a.servo;if(s&&typeof s==='object'){const pulses=v=>Array.isArray(v)&&v.length===2&&v.every(finite)&&v[0]>=100&&v[1]<=3000&&v[1]-v[0]>=50?[+v[0],+v[1]]:null;
      let lo=unitNum(s.min)??0,hi=unitNum(s.max)??1;if(lo>hi)[lo,hi]=[hi,lo];
      out.servo={min:lo,max:hi,center:clamp(unitNum(s.center)??.5,lo,hi),range:num(s.range,300,1,7200),...(pulses(s.pwm)?{pwm:pulses(s.pwm)}:{}),...(pulses(s.pulse)?{pulse:pulses(s.pulse)}:{})};}
    if(finite(a.cpr)&&a.cpr>0)out.cpr=clamp(+a.cpr,.01,1e7);if(finite(a.power)&&a.power>0)out.power=clamp(+a.power,.01,1);
    return out;}
  // A table of [input, output] points, sorted, one output per input.
  const curveOf=v=>{if(!Array.isArray(v))return null;const pts=v.filter(p=>Array.isArray(p)&&finite(p[0])&&finite(p[1])).map(p=>[+p[0],+p[1]]).sort((a,b)=>a[0]-b[0]).filter((p,i,a)=>!i||p[0]>a[i-1][0]).slice(0,256);return pts.length>=2?pts:null;};
  // What an action step moves: an actuator (its named positions, else its joint's), or a part moved by route actions.
  function mover(model,id){const a=model.actuators.find(x=>x.id===id);if(a){const j=model.joints.find(x=>x.id===a.joint),l=limitsOf(j)[a.index],states=statesOf(model,a),st=Object.values(states).filter(finite);
      return {...a,states,home:finite(a.home)?a.home:valuesOf(j,j?.home||0)[a.index]??0,...(a.response==='pneumatic'?{ends:st.length>=2?[Math.min(...st),Math.max(...st)]:l&&l.every(finite)?l:null}:{})};}
    const j=model.joints.find(x=>x.id===id);return j?{id,speed:j.speed||90,accel:0,states:j.states||{},home:valuesOf(j,j.home||0)[0]??0,joint:id}:null;}
  // ---------------------------------------------------------------- part refs against the CAD's assembly tree
  // tree: the stored body's parts ({nodes:[{name,parent}], leaf:[node index of each leaf]}).
  function partIndex(tree){
    const nodes=(tree?.nodes||[]).map((n,i)=>({i,name:n.name,parent:n.parent,children:[],leaves:[]}));
    for(const n of nodes)if(n.parent>=0&&nodes[n.parent])nodes[n.parent].children.push(n);
    (tree?.leaf||[]).forEach((at,leaf)=>nodes[at]?.leaves.push(leaf));
    const keyOf=n=>n.key??=(n.parent>=0&&nodes[n.parent]?keyOf(nodes[n.parent])+'/':'')+n.name;for(const n of nodes)keyOf(n);
    const byKey=new Map(nodes.map(n=>[n.key,n])),under=new Map();
    const leavesUnder=n=>{if(under.has(n.i))return under.get(n.i);const out=[...n.leaves];for(const c of n.children)out.push(...leavesUnder(c));under.set(n.i,out);return out;};
    const leafCount=(tree?.leaf||[]).length;
    return {nodes,byKey,leafCount,leavesUnder,
      // The leaves a list of refs names.
      expand(list){const out=new Set();for(const r of list||[]){if(r[0]==='#'){const k=+r.slice(1);if(Number.isInteger(k)&&k>=0&&k<leafCount)out.add(k);}else{const n=byKey.get(r);if(n)for(const k of leavesUnder(n))out.add(k);}}return out;},
      // The fewest refs for a set of leaves: whole assemblies where every leaf under one is in the set.
      compress(set){const out=[],taken=new Set();const visit=n=>{const all=leavesUnder(n);if(!all.length)return;if(all.every(k=>set.has(k))){out.push(n.key);for(const k of all)taken.add(k);return;}for(const c of n.children)visit(c);};
        for(const n of nodes.filter(n=>n.parent<0||!nodes[n.parent]))visit(n);for(const k of set)if(!taken.has(k))out.push('#'+k);return out;},
      name:leaf=>nodes[tree.leaf[leaf]]?.name||'Part '+(leaf+1),key:leaf=>nodes[tree.leaf[leaf]]?.key||''};
  }
  // ---------------------------------------------------------------- forward kinematics
  // Joints ordered parents first.
  function order(model){const byId=new Map(model.joints.map(j=>[j.id,j])),out=[],seen=new Set();const visit=j=>{if(seen.has(j.id))return;seen.add(j.id);if(j.parent&&byId.has(j.parent))visit(byId.get(j.parent));out.push(j);};model.joints.forEach(visit);return out;}
  // Every joint's value: given (actuated, from the engine or a preview), else set by a coupling, else its home. Limits
  // hold each value at its end stops.
  function resolve(model,given={}){
    const q={};
    for(const j of model.joints){const g=given[j.id];q[j.id]=valuesOf(j,g!==undefined&&g!==null?g:j.home||0);}
    applyCouplings(model,q);for(const j of model.joints)hold(j,q[j.id]);
    return q;
  }
  // Each value's end stops ([low, high] or null): a revolute or prismatic joint's lower and upper, others' limits.
  function limitsOf(j){const out=Array.from({length:dofOf(j).length},(_,i)=>Array.isArray(j?.limits?.[i])?j.limits[i]:null);
    if((j?.type==='revolute'||j?.type==='prismatic')&&(finite(j.lower)||finite(j.upper)))out[0]=[finite(j.lower)?j.lower:-Infinity,finite(j.upper)?j.upper:Infinity];return out;}
  const hold=(j,v)=>{limitsOf(j).forEach((l,i)=>{if(l)v[i]=clamp(v[i],l[0],l[1]);});return v;};
  // A coupling's value: offset + f(x) + Σ ratio·input, x its first input; f is its table (held at its ends beyond it),
  // or with a period, the table repeated every period and each period adding the table's rise (none for a cam, a
  // quarter turn for a four-slot Geneva wheel); else f is ratio·x + poly[0]·x² + poly[1]·x³ + poly[2]·x⁴.
  function couple(c,q){const x=q[c.from]?.[c.fromIndex||0]??0;let y;
    if(c.curve){const P=c.period,turns=P?Math.floor(x/P):0;y=interpolate(c.curve,P?x-turns*P:x)+turns*(P?c.curve.at(-1)[1]-c.curve[0][1]:0);}else{y=c.ratio*x;(c.poly||[]).forEach((p,k)=>{y+=p*x**(k+2);});}
    for(const t of c.plus||[])y+=t.ratio*(q[t.from]?.[t.fromIndex||0]??0);return y+c.offset;}
  function interpolate(pts,x){const n=pts.length;if(x<=pts[0][0])return pts[0][1];if(x>=pts[n-1][0])return pts[n-1][1];let lo=0,hi=n-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(pts[mid][0]<=x)lo=mid;else hi=mid;}
    const [x0,y0]=pts[lo],[x1,y1]=pts[hi];return y0+(y1-y0)*(x-x0)/(x1-x0);}
  // Couplings in dependency order (a chain of gears; a differential after both its inputs). Couplings that wait on each
  // other in a ring are left out: nothing can set them first.
  const couplingOrders=new WeakMap();
  function couplingOrder(model){let out=couplingOrders.get(model.couplings);if(out)return out;out=[];const pending=[...model.couplings],inputs=c=>[c.from,...(c.plus||[]).map(t=>t.from)];
    for(let pass=0;pass<model.couplings.length+1&&pending.length;pass++)for(let i=0;i<pending.length;i++){const c=pending[i];if(pending.some(o=>o!==c&&inputs(c).includes(o.to)))continue;out.push(c);pending.splice(i--,1);}
    couplingOrders.set(model.couplings,out);return out;}
  function applyCouplings(model,q){for(const c of couplingOrder(model)){const to=q[c.to];if(to&&q[c.from])to[c.toIndex||0]=couple(c,q);}return q;}
  // World motion of each joint's link (rest frame), parents first.
  function worlds(model,q,list=order(model)){const W=new Map(),u=model.unit||1;for(const j of list){const parent=j.parent&&W.get(j.parent)||I4();W.set(j.id,mul(parent,motion(j,q[j.id],u)));}return W;}
  // ---------------------------------------------------------------- closed loops
  // A loop says point A (on joint A's link, or the base) and point B (on joint B's link) are one point. The joints
  // that nothing else sets (no actuator, coupling or given value) along either chain are solved, by damped least
  // squares, so the points meet. From the rest pose (where the CAD has them meeting) the driven joints are moved in
  // steps, so the linkage stays on the branch the CAD was assembled in. When every input has moved less than one step
  // since the last pose of the same model (a run, an animation), it continues from that pose instead, as the real
  // linkage would; a jump (a scrub) starts from the rest pose again. Unchanged inputs give the last answer at once.
  const lastLoops=new WeakMap();
  const chain=(byId,id)=>{const out=[];for(let p=id;p;p=byId.get(p)?.parent)out.push(p);return out;};
  function solveLoops(model,q,{given={},fixed=new Set()}={}){
    if(!model.loops.length)return {q,error:0,solved:[]};
    const byId=new Map(model.joints.map(j=>[j.id,j])),coupled=new Set(model.couplings.map(c=>c.to));
    const free=[];for(const l of model.loops)for(const id of [...chain(byId,l.a.joint),...chain(byId,l.b.joint)]){const j=byId.get(id);
      if(!j||given[id]!==undefined||coupled.has(id)||fixed.has(id)||j.drive||free.includes(id)||!dofOf(j).length)continue;free.push(id);}
    if(!free.length)return {q,error:residualNorm(model,q),solved:[]};
    // Only the loops' own chains are posed while solving, and only the inputs that reach them (directly or through
    // couplings) step the homotopy: a turret turning elsewhere on the robot costs the linkage nothing.
    const chains=new Set(model.loops.flatMap(l=>[...chain(byId,l.a.joint),...chain(byId,l.b.joint)]));for(let grew=true;grew;){grew=false;for(const c of model.couplings)if(chains.has(c.to))for(const id of [c.from,...(c.plus||[]).map(t=>t.from)])if(!chains.has(id)){chains.add(id);grew=true;}}
    const list=order(model).filter(j=>chains.has(j.id)),slots=free.flatMap(id=>dofOf(byId.get(id)).map((u,i)=>({id,i,unit:u})));
    const read=()=>slots.map(s=>q[s.id][s.i]),write=x=>{slots.forEach((s,k)=>{q[s.id][s.i]=x[k];});};
    // In inches whatever the CAD unit, so the damping and the stopping point mean the same for a metre or a millimetre CAD.
    const u=model.unit||1,residual=()=>{applyCouplings(model,q);const W=worlds(model,q,list),r=[];for(const l of model.loops)r.push(...scale(gap(l,W),u));return r;};
    // Homotopy: the given joints move from home to their values in steps of at most 10° (or 0.5 in).
    const inputs=Object.keys(given).filter(id=>chains.has(id)&&q[id]),target=Object.fromEntries(inputs.map(id=>[id,q[id].slice()])),stepOf=(id,i)=>dofOf(byId.get(id))[i]==='in'?.5:10;
    const memo=lastLoops.get(model),same=memo&&memo.free===free.join()&&inputs.length===Object.keys(memo.target).length&&inputs.every(id=>memo.target[id]);
    if(same&&inputs.every(id=>target[id].every((v,i)=>v===memo.target[id][i]))){write(memo.x);applyCouplings(model,q);return {q,error:memo.error,solved:free};}
    const close=same&&inputs.every(id=>target[id].every((v,i)=>Math.abs(v-memo.target[id][i])<=stepOf(id,i)));
    const home=close?memo.target:Object.fromEntries(inputs.map(id=>[id,valuesOf(byId.get(id),byId.get(id).home||0)]));
    let span=0;for(const id of inputs)target[id].forEach((v,i)=>{span=Math.max(span,Math.abs(v-home[id][i])/stepOf(id,i));});
    const steps=Math.max(1,Math.min(72,Math.ceil(span)));if(close)write(memo.x);else for(const id of free)q[id]=valuesOf(byId.get(id),byId.get(id).home||0);
    let x=read(),err=Infinity;
    for(let s=1;s<=steps;s++){
      for(const id of inputs)q[id]=target[id].map((v,i)=>home[id][i]+(v-home[id][i])*s/steps);
      let lambda=1e-3;
      for(let it=0;it<40;it++){
        write(x);const r=residual();err=Math.sqrt(r.reduce((a,v)=>a+v*v,0));if(err<1e-7)break;
        // Numerical Jacobian, columns per free value.
        const J=slots.map((sl,k)=>{const h=sl.unit==='in'?1e-4:1e-3,xs=x.slice();xs[k]+=h;write(xs);const rp=residual();write(x);return rp.map((v,m)=>(v-r[m])/h);});
        const n=slots.length,A=Array.from({length:n},(_,a)=>Array.from({length:n},(_,b)=>J[a].reduce((t,v,m)=>t+v*J[b][m],0))),g=Array.from({length:n},(_,a)=>J[a].reduce((t,v,m)=>t+v*r[m],0));
        let improved=false;
        for(let tries=0;tries<8&&!improved;tries++){
          const M=A.map((row,a)=>row.map((v,b)=>v+(a===b?lambda*(1+row[a]):0))),dx=solve(M,g.map(v=>-v));if(!dx)break;
          const xn=x.map((v,k)=>v+dx[k]);write(xn);const rn=residual(),en=Math.sqrt(rn.reduce((a,v)=>a+v*v,0));
          if(en<err){x=xn;err=en;lambda=Math.max(1e-9,lambda/3);improved=true;}else lambda*=4;}
        write(x);if(!improved)break;}
    }
    applyCouplings(model,q);lastLoops.set(model,{free:free.join(),target,x,error:err});return {q,error:err,solved:free};
  }
  function residualNorm(model,q){const W=worlds(model,q);let s=0;for(const l of model.loops){const d=gap(l,W);s+=dot(d,d);}return Math.sqrt(s)*(model.unit||1);}
  // How far apart a loop's points are (CAD units): all of it, or for a pin in a slot only the part across the slot.
  function gap(l,W){const Wa=l.a.joint?W.get(l.a.joint):I4(),d=sub(apply(l.b.joint?W.get(l.b.joint):I4(),l.b.point),apply(Wa,l.a.point));if(!l.along)return d;const s=unit(applyDir(Wa,l.along));return sub(d,scale(s,dot(d,s)));}
  // Gaussian elimination with partial pivoting (small systems).
  function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-14)return null;[M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];if(f)for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return M.map((r,i)=>r[n]/r[i]);}
  // The whole pose: values, solved loops, and each link's motion. given: {jointId: q} for the joints commanded.
  // loopError: how far apart (inches) the points of the loops still are.
  function pose(model,given={}){const q=resolve(model,given),loop=solveLoops(model,q,{given});return {q,W:worlds(model,q),loopError:loop.error,solved:loop.solved};}
  // ---------------------------------------------------------------- actuators
  // An actuator moves its joint toward a target at up to `speed` units a second, speeding up and slowing down at
  // `accel` (none: at full speed at once): a trapezoid. Deterministic: the same steps give the same motion.
  // `command` is what it was told (a position, a speed or an effort); q and v are how it actually moves. Responses:
  //   motor      a DC motor's torque–speed line turns the inertia against the load (sanitizeMotor), closed on position
  //              by p, i and d; a speed command is held by a controller that knows the load, an effort is open loop.
  //              The speed over each sub-step is the exact solution of J·dω/dt = τs·(u − ω/ωf) − τL for u held.
  //   pneumatic  rests only at its two ends: a target goes to the nearer end, a speed or effort to the end it points at.
  class Axis{
    constructor(q=0,{speed=90,accel=0,lower=-Infinity,upper=Infinity,wrap=false,response='ideal',motor=null,si=DEG,ends=null}={}){
      Object.assign(this,{q,v:0,target:q,velocity:null,effort:null,speed,accel,vmax:speed,amax:accel,lower,upper,wrap,response:'ideal',command:{mode:'position',value:q}});
      if(response==='pneumatic'&&ends&&ends.every(finite))Object.assign(this,{response,ends:[Math.min(...ends),Math.max(...ends)]});
      if(response==='motor'&&motor){const m={i:0,d:0,power:1,load:0,...motor};m.inertia??=m.stall*.05/(m.free*si);
        // tau: the motor's time constant. The default p closes an error at full speed in T = 4·tau (at least 0.05 s), which
        // with the motor's own back-EMF damping makes the loop critically damped: s² + s/tau + 1/(tau·T) = 0, ζ = √(T/tau)/2.
        const tau=m.inertia*m.free*si/m.stall,T=Math.max(.05,4*tau);m.p??=1/(m.free*T);Object.assign(this,{response,motor:m,tau,T,sum:0,still:0});}
    }
    // A move to a target, at its own speed and acceleration or at those given for this move (a coordinated move).
    to(target,{speed,accel}={}){this.vmax=speed??this.speed;this.amax=accel??this.accel;if(this.response==='pneumatic'){const [lo,hi]=this.ends;target=Math.abs(target-lo)<=Math.abs(target-hi)?lo:hi;}this.target=target;this.velocity=null;this.effort=null;this.sum=0;this.still=0;this.command={mode:'position',value:target};}
    spin(velocity){if(this.response==='pneumatic'){this.to(velocity>=0?this.ends[1]:this.ends[0]);}else{this.velocity=velocity;this.effort=null;}this.command={mode:'velocity',value:velocity};}
    push(effort){effort=clamp(effort,-1,1);if(this.response==='motor'){this.effort=effort;this.velocity=null;}else if(this.response==='pneumatic')this.to(effort>=0?this.ends[1]:this.ends[0]);else{this.velocity=effort*this.speed;this.effort=null;}this.command={mode:'effort',value:effort};}
    get done(){if(this.velocity!==null||this.effort!==null)return false;
      // A motor is done once it has stopped near its target, or has stood still for a quarter second (held off it by a load).
      if(this.response==='motor')return (Math.abs(this.target-this.q)<.05&&Math.abs(this.v)<.01*this.motor.free)||this.still>=.25;
      return Math.abs(this.target-this.q)<1e-6&&Math.abs(this.v)<1e-6;}
    step(dt){
      if(this.response==='motor')this.stepMotor(dt);
      else if(this.velocity!==null){const want=clamp(this.velocity,-this.speed,this.speed),dv=this.accel>0?clamp(want-this.v,-this.accel*dt,this.accel*dt):want-this.v;this.v+=dv;this.q+=this.v*dt;}
      else{const d=this.target-this.q;if(Math.abs(d)<1e-9&&Math.abs(this.v)<1e-9){this.q=this.target;this.v=0;}
        else if(!(this.amax>0)){const move=Math.sign(d)*Math.min(Math.abs(d),this.vmax*dt);this.q+=move;this.v=dt>0&&Math.abs(this.target-this.q)>1e-9?move/dt:0;}
        else this.trapezoid(dt);}
      if(this.q<this.lower){this.q=this.lower;this.v=0;}if(this.q>this.upper){this.q=this.upper;this.v=0;}
      if(this.wrap)this.q=((this.q%360)+360)%360;
    }
    // The quickest move to the target within the speed and acceleration limits, followed exactly through dt: speed up,
    // cruise, brake, each phase for exactly as long as it lasts (one may end inside the tick), so ticking takes the time
    // moveSeconds() works out at any tick length and lands on the target at rest.
    trapezoid(dt){const a=this.amax,vm=this.vmax;let h=dt;
      for(let n=0;n<12&&h>1e-12;n++){const d=this.target-this.q;if(Math.abs(d)<1e-12&&Math.abs(this.v)<1e-9){this.q=this.target;this.v=0;return;}
        // v: speed toward the target (negative while moving away from it).
        const dir=d!==0?Math.sign(d):-Math.sign(this.v),v=this.v*dir,dist=Math.abs(d),stop=v*v/(2*a),tol=1e-12*Math.max(1,dist);let acc,t,landing=false;
        if(v<0){acc=a;t=-v/a;}
        else if(v>vm+1e-12){acc=-a;t=(v-vm)/a;}
        else if(stop>=dist-tol){acc=-a;t=v/a;landing=stop<=dist+1e-9*Math.max(1,dist);}
        else{const peak=Math.sqrt(a*dist+v*v/2);if(peak<=vm){acc=a;t=(peak-v)/a;}else if(v<vm-1e-12){acc=a;t=(vm-v)/a;}else{acc=0;t=(dist-stop)/vm;}}
        const s=Math.min(h,t);h-=s;
        if(landing&&s>=t){this.q=this.target;this.v=0;continue;}
        this.q+=dir*(v*s+acc*s*s/2);this.v=dir*(v+acc*s);}
    }
    stepMotor(dt){
      const m=this.motor,n=Math.min(400,Math.max(1,Math.ceil(8*dt/Math.min(this.tau,this.T)))),h=dt/n,decay=Math.exp(-h/this.tau);
      for(let i=0;i<n;i++){let u;
        if(this.effort!==null)u=this.effort;
        else if(this.velocity!==null)u=this.velocity/m.free+m.load/m.stall+3*(this.velocity-this.v)/m.free;
        else{const e=this.target-this.q;if(m.i)this.sum=clamp(this.sum+e*h,-1/m.i,1/m.i);u=m.p*e+m.i*this.sum-m.d*this.v;}
        u=clamp(u,-m.power,m.power);
        // Steady speed for this voltage and load, then the exact exponential approach to it over h.
        const vinf=(u-m.load/m.stall)*m.free,v0=this.v;this.v=vinf+(v0-vinf)*decay;this.q+=vinf*h+(v0-vinf)*this.tau*(1-decay);
        if(this.q<=this.lower&&this.v<0||this.q>=this.upper&&this.v>0){this.q=clamp(this.q,this.lower,this.upper);this.v=0;}}
      this.still=Math.abs(this.v)<.002*m.free?this.still+dt:0;
    }
  }
  // ---------------------------------------------------------------- what a hub's ports read of a part
  // A part's value is degrees or inches from where the CAD has it (zero). An encoder counts value · countsPerUnit (else
  // its cpr a turn); a switch is closed within band of at (a home switch at the CAD pose: at 0, band 0.5); an analog
  // port reads volts: zeroVolts at zero plus voltsPerUnit per unit, within 0–3.3 V (an Axon's feedback wire or a
  // potentiometer; by default the middle of its range at zero and 3.3 V a turn, or 0.1 V an inch); a speed sensor its
  // speed; anything else the value itself.
  const VOLTS=3.3;
  const volts=(value,{zeroVolts,voltsPerUnit,unit='deg'}={})=>finite(value)?clamp((finite(zeroVolts)?zeroVolts:VOLTS/2)+(finite(voltsPerUnit)?voltsPerUnit:unit==='in'?.1:VOLTS/360)*value,0,VOLTS):null;
  function reading(kind,value,o={}){if(!finite(value))return null;
    if(kind==='encoder')return Math.round(value*(finite(o.countsPerUnit)?o.countsPerUnit:(finite(o.cpr)?o.cpr:537.7)/(o.unit==='in'?1:360)));
    if(kind==='limit'||kind==='touch'||kind==='digital')return Math.abs(value-(finite(o.at)?o.at:0))<=(finite(o.band)?o.band:.5);
    if(kind==='analog'||kind==='potentiometer')return volts(value,o);
    return value;}
  // Seconds a trapezoid takes to move d from rest to rest.
  function moveSeconds(d,speed,accel=0){d=Math.abs(d);if(!d)return 0;if(!(speed>0))return Infinity;if(!(accel>0))return d/speed;return d>=speed*speed/accel?d/speed+speed/accel:2*Math.sqrt(d/accel);}
  // ---------------------------------------------------------------- driving joints from a game and from actions
  // What a route action's name means for this robot, read the same way by the simulator and the exported code: an
  // action's steps ({kind:'steps', action, steps}), or a part sent to a value ({kind:'move', actuator or joint, value}):
  // a part's name and one of its named positions ("Lift up", state: its name), or "Lift to 30°" / "Slide to 4 in" in
  // its own units (degrees or inches) within its end stops. A part is an actuator (named as itself or its joint) or a
  // joint moved by route actions with no actuator of its own. null when the name means neither.
  function resolveAction(model,name){const key=String(name).trim().toLowerCase(),action=model.actions.find(a=>a.name.toLowerCase()===key);
    if(action)return {kind:'steps',action,steps:action.steps};
    const range=(lo,hi)=>[finite(lo)?lo:-Infinity,finite(hi)?hi:Infinity];
    const named=[...model.joints.filter(j=>j.drive?.signal==='action'&&dofOf(j).length===1&&!model.actuators.some(a=>a.joint===j.id)).map(j=>{const lim=j.type==='revolute'||j.type==='prismatic';return {ref:{joint:j.id},names:[j.name],states:j.states||{},range:lim?range(j.lower,j.upper):range()};}),
      ...model.actuators.map(a=>{const j=model.joints.find(x=>x.id===a.joint);return {ref:{actuator:a.id},names:[a.name,j?.name].filter(Boolean),states:statesOf(model,a),range:limitsOf(j)[a.index]||range()};})];
    for(const {ref,names,states,range:[lo,hi]} of named)for(const n of names){const own=n.toLowerCase();if(!key.startsWith(own+' '))continue;
      const rest=key.slice(own.length+1).trim(),to=/^to\s+(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees|in|inches)?$/.exec(rest);
      if(to)return {kind:'move',...ref,value:clamp(Number(to[1]),lo,hi)};
      const state=Object.keys(states).find(k=>k.toLowerCase()===rest);if(state!==undefined)return {kind:'move',...ref,value:states[state],state};}
    return null;}
  // The engine runs one Driver per simulation. Each tick it reads the game's signals and steps the actuators, and
  // values() gives every driven joint's value (what the 3D view draws and recordings keep).
  //   signals: {turrets:[deg], flywheel:0..1, kick:[0..1|null per intake], lift:[0..1 per intake], intake, spin, aim, feed, rpm}
  class Driver{
    constructor(model){
      this.model=model;this.q={};this.axes=new Map();this.time=0;this.running=[];
      for(const j of model.joints){const v=valuesOf(j,j.home||0);this.q[j.id]=v.length===1?v[0]:v;}
      // Actuators move in their joint's units (targets, named positions and speeds as the team thinks of them: degrees or
      // inches), within its end stops; a motor model's own free speed and stall torque come through the transmission.
      for(const a of model.actuators){const j=model.joints.find(x=>x.id===a.joint),home=valuesOf(j,j.home||0)[a.index]??0,l=limitsOf(j)[a.index]||[-Infinity,Infinity];
        const st=Object.values(statesOf(model,a)).filter(finite),ends=st.length>=2?[Math.min(...st),Math.max(...st)]:l.every(finite)?l:null;
        this.axes.set(a.id,new Axis(finite(a.home)?a.home:home,{speed:a.speed,accel:a.accel,lower:l[0],upper:l[1],response:a.response,motor:motorAtJoint(a,j),si:dofOf(j)[a.index]==='in'?.0254:DEG,ends}));}
      // The joints this driver moves; values() gives only these.
      this.driven=new Set([...model.joints.filter(j=>j.drive).map(j=>j.id),...model.actuators.map(a=>a.joint)]);
      // Hoods move between their positions at their speed; a joint run by route actions moves to its named positions.
      for(const j of model.joints){const lim=j.type==='revolute'||j.type==='prismatic';
        if(j.drive?.signal==='hood')this.axes.set('hood:'+j.id,new Axis(j.states?.rest??0,{speed:j.speed||180}));
        // A feeder that swings or slides (a servo kicker or pusher) goes to its feed position while feeding and back to
        // rest; a feeder wheel spins.
        if(j.drive?.signal==='feeder'&&lim&&finite(j.states?.feed))this.axes.set('feeder:'+j.id,new Axis(j.states.rest??0,{speed:j.speed||(j.type==='prismatic'?30:720)}));
        if(j.drive?.signal==='action'&&dofOf(j).length===1&&!model.actuators.some(a=>a.joint===j.id))this.axes.set('joint:'+j.id,new Axis(valuesOf(j,j.home||0)[0],{speed:j.speed||90,lower:lim&&finite(j.lower)?j.lower:-Infinity,upper:lim&&finite(j.upper)?j.upper:Infinity}));}
      this.moves=[];
    }
    // Starts an action by name; its steps run as the ticks go by. A name that is a joint's name and one of its named
    // positions ("Lift up") moves that joint there. Returns false when the name means neither.
    start(name){const r=resolveAction(this.model,name);if(!r)return false;
      if(r.kind==='steps'){const run=this.run(r.action);this.running.push(run);this.stepAction(run);return true;}
      const axis=this.axes.get(r.actuator??'joint:'+r.joint);if(!axis)return false;axis.to(r.value);this.moves.push({key:String(name).trim().toLowerCase(),axis});return true;}
    busy(name){const key=String(name).trim().toLowerCase();return this.running.some(r=>r.action.name.toLowerCase()===key)||this.moves.some(m=>m.key===key&&!m.axis.done);}
    tick(dt,s={}){
      this.time+=dt;const m=this.model;
      // Hoods head for their shooting position while the shooter spins up, aims or feeds, and back to rest after. A hood
      // whose CAD launch angle is known tilts by the difference to the game's launch angle (s.hood), within its limits.
      for(const j of m.joints)if(j.drive?.signal==='hood')this.axes.get('hood:'+j.id).to((s.spin||s.aim||s.feed)?(finite(j.launch)&&finite(s.hood)?clamp(s.hood-j.launch,j.lower??-180,j.upper??180):j.states?.shoot??0):j.states?.rest??0);
      // Rollers and a feeder chained to one motor (s.chained) turn together.
      const rolling=s.intake||s.chained&&s.feed,feeding=s.feed||s.chained&&s.intake;
      for(const j of m.joints)this.axes.get('feeder:'+j.id)?.to(feeding?j.states.feed:j.states.rest??0);
      for(const [,axis] of this.axes)axis.step(dt);this.moves=this.moves.filter(m=>!m.axis.done);
      for(const j of m.joints){const axis=this.axes.get('joint:'+j.id);if(axis)this.q[j.id]=axis.q;}
      for(const a of m.actuators){const axis=this.axes.get(a.id),j=m.joints.find(x=>x.id===a.joint),v=valuesOf(j,this.q[j.id]);v[a.index]=axis.q;this.q[j.id]=v.length===1?v[0]:v;}
      // A joint others follow keeps counting past a turn, or its followers would jump when it wrapped.
      const led=new Set(m.couplings.map(c=>c.from));
      for(const j of m.joints){const d=j.drive;if(!d)continue;const n=+String(d.of||'').split(':')[1]||0,rate=shownRate,turn=v=>led.has(j.id)?v:wrap360(v);
        if(d.signal==='turret')this.q[j.id]=(s.turrets?.[n]??0)-(j.zero||0);
        else if(d.signal==='deploy'){const f=clamp(s.kick?.[n]??0,0,1),up=j.states?.raised??0,down=j.states?.lowered??0;this.q[j.id]=up+(down-up)*f;}
        // A roller on a swing arm rests where it sits and rides up over a piece as the intake takes it in.
        else if(d.signal==='float'){const f=clamp(s.lift?.[n]??0,0,1),rest=j.states?.rest??0,top=j.states?.up??rest;this.q[j.id]=rest+(top-rest)*f;}
        else if(d.signal==='hood')this.q[j.id]=this.axes.get('hood:'+j.id).q;
        else if(d.signal==='flywheel')this.q[j.id]=turn(this.q[j.id]+rate((s.flywheel||0)*Math.min(s.rpm||3000,j.rpm||Infinity))*dt);
        else if(d.signal==='roller')this.q[j.id]=turn(this.q[j.id]+rate(rolling?(j.rpm||300):0)*dt);
        else if(d.signal==='feeder')this.q[j.id]=this.axes.get('feeder:'+j.id)?.q??turn(this.q[j.id]+rate(feeding?(j.rpm||200):0)*dt);}
      // Steps end, and the steps after them start, once this tick's motion is done: a step that follows another starts
      // the moment it ends, and its command moves the next tick.
      for(const r of this.running)this.stepAction(r);this.running=this.running.filter(r=>r.steps.some(x=>x.end===null));
    }
    // An action run: when each step started and ended. A step that runs another action holds that run as `child`;
    // `names` are the actions above it, so an action that names itself (or an action above it) cannot run forever.
    run(action,depth=0,names=[]){return {action,t0:this.time,depth,cycle:1,names:[...names,action.name.toLowerCase()],steps:action.steps.map(()=>({start:null,end:null}))};}
    stepAction(r){
      const steps=r.action.steps;
      steps.forEach((s,i)=>{const st=r.steps[i];
        if(st.start===null){const ready=s.after===null?r.t0:r.steps[s.after].end;if(ready!==null&&this.time>=ready+s.delay-1e-9){st.start=this.time;
          if(s.action!==undefined){const sub=this.model.actions.find(a=>a.name.toLowerCase()===s.action.toLowerCase());
            if(sub&&r.depth<6&&!r.names.includes(sub.name.toLowerCase()))st.child=this.run(sub,r.depth+1,r.names);else st.end=this.time;}
          else if(s.pose!==undefined||s.reach!==undefined){const goal=s.pose!==undefined?findPose(this.model,s.pose):this.reachGoal(s.reach);st.movers=goal?this.together(goal):[];if(!st.movers.length)st.end=this.time;}
          else if(s.wait===undefined)this.command(s.actuator,s.command);}}
        if(st.start===null||st.end!==null)return;
        if(st.child){this.stepAction(st.child);if(st.child.steps.every(x=>x.end!==null))st.end=this.time;return;}
        if(st.movers){if(st.movers.every(id=>(this.axes.get(id)||this.axes.get('joint:'+id)).done))st.end=this.time;return;}
        if(s.wait!==undefined){if(this.met(s.wait)||finite(s.timeout)&&this.time-st.start>=s.timeout-1e-9)st.end=this.time;return;}
        const axis=this.axes.get(s.actuator)||this.axes.get('joint:'+s.actuator);if(!axis){st.end=this.time;return;}
        const timed=finite(s.seconds)||axis.velocity!==null||axis.effort!==null;if(timed?this.time-st.start>=(s.seconds??0)-1e-9:axis.done){st.end=this.time;if((axis.velocity!==null||axis.effort!==null)&&finite(s.seconds))axis.spin(0);}});
      if(r.cycle<(r.action.repeat||1)&&r.steps.every(x=>x.end!==null)){r.cycle++;r.t0=this.time;r.steps=steps.map(()=>({start:null,end:null}));this.stepAction(r);}
    }
    // Sends every mover of a goal ({moverId: value}) to its value so all arrive together: each trapezoid is the slowest
    // one's, time-scaled (speed × k, acceleration × k²). Motor and pneumatic movers are sent as they are.
    together(goal){const plan=coordinate(this.model,goal,id=>(this.axes.get(id)||this.axes.get('joint:'+id))?.q);
      for(const p of plan){const axis=this.axes.get(p.id)||this.axes.get('joint:'+p.id);axis.to(p.to,axis.response==='ideal'?{speed:p.speed,accel:p.accel}:{});}return plan.map(p=>p.id);}
    // The movers' values that bring a point on a link to a target, solved from where the robot is now.
    reachGoal(r){return reachGoal(this.model,r,this.values());}
    command(id,c){const a=mover(this.model,id),axis=this.axes.get(id)||this.axes.get('joint:'+id);if(!a||!axis)return;
      if(c.state!==undefined){const v=a.states?.[c.state];if(finite(v))axis.to(v);}else if(finite(c.target))axis.to(c.target);else if(finite(c.velocity))axis.spin(c.velocity);else if(finite(c.effort))axis.push(c.effort);}
    // Only the joints this driver moves. pose() sets the rest: coupled joints from their inputs, and the joints a closed
    // loop leaves free solved so it closes (a value for every joint would hold every loop open).
    values(){const out={};for(const id of this.driven){const v=this.q[id];out[id]=Array.isArray(v)?v.map(x=>+x.toFixed(4)):+v.toFixed(4);}return out;}
    // A joint value as the robot would have it now, couplings and loops included (worked out once a tick, when asked).
    jointValue(id,i=0){if(this.posedAt!==this.time){this.posed=(this.model.loops.length?pose(this.model,this.values()).q:resolve(this.model,this.values()));this.posedAt=this.time;}return this.posed[id]?.[i];}
    // A sensor's reading of the simulated motion: encoder counts, a limit switch (true when closed), a value or a speed.
    read(id){const s=(this.model.sensors||[]).find(x=>x.id===id);if(!s)return null;
      const axis=s.actuator?this.axes.get(s.actuator):null,a=s.actuator?this.model.actuators.find(x=>x.id===s.actuator):null,j=this.model.joints.find(x=>x.id===(a?a.joint:s.joint));
      if(s.kind==='velocity')return axis?axis.v:null;
      const value=axis?axis.q:this.jointValue(s.joint,s.index||0);if(!finite(value))return null;
      if(s.kind==='encoder')return Math.round(value*(a?a.ratio:1)/((a?actuatorUnit(a,j):dofOf(j)[s.index||0])==='deg'?360:1)*s.cpr);
      if(s.kind==='limit')return Math.abs(value-s.at)<=s.band;
      return value;}
    // Every sensor of the model as a hub port reads it: an encoder's counts, a limit switch closed (pressed) or not, an
    // angle or distance sensor's value and the volts it would put on an analog port, a speed sensor's speed.
    readings(){const out={};for(const s of this.model.sensors||[]){const r=this.read(s.id);
      out[s.id]=s.kind==='encoder'?{kind:s.kind,counts:r}:s.kind==='limit'?{kind:s.kind,pressed:r}:s.kind==='potentiometer'?{kind:s.kind,value:r,volts:r===null?null:volts(r,{unit:this.unitOf(s)})}:{kind:s.kind,value:r};}
      return out;}
    // Where a part is and how fast it moves, in its own units: an actuator ({actuator}) or a joint's value ({joint, index}).
    measure(src){const a=src?.actuator?this.model.actuators.find(x=>x.id===src.actuator):null,axis=a&&this.axes.get(a.id);
      if(axis)return {value:axis.q,velocity:axis.v,unit:this.unitOf({actuator:a.id})};
      if(!src?.joint)return null;const i=src.index||0,value=this.jointValue(src.joint,i);if(!finite(value))return null;
      const own=['joint:','hood:','feeder:'].map(k=>this.axes.get(k+src.joint)).find(Boolean)||this.axes.get(this.model.actuators.find(x=>x.joint===src.joint&&(x.index||0)===i)?.id);
      return {value,velocity:own?own.v:0,unit:this.unitOf({joint:src.joint,index:i})};}
    // What a hub sensor on a part reads now (src as measure takes it; o its kind and numbers, as reading() takes them).
    sense(src,o={}){const m=this.measure(src);if(!m)return null;return o.kind==='velocity'?m.velocity:reading(o.kind,m.value,{unit:m.unit,...o});}
    unitOf(src){const a=src.actuator?this.model.actuators.find(x=>x.id===src.actuator):null,j=this.model.joints.find(x=>x.id===(a?a.joint:src.joint));return dofOf(j)[a?a.index||0:src.index||0]||'deg';}
    // Whether a wait's condition holds: the reading at or above `above`, at or below `below`, a switch closed or open.
    met(w){if(!('above' in w||'below' in w||'is' in w))return false;
      const r=w.sensor?this.read(w.sensor):w.actuator?this.axes.get(w.actuator)?.q:w.joint?this.jointValue(w.joint,w.index||0):null;if(r===null||r===undefined)return false;const x=+r;
      return (!finite(w.above)||x>=w.above-1e-9)&&(!finite(w.below)||x<=w.below+1e-9)&&(w.is===undefined||!!r===w.is);}
    // What each actuator was told and how it actually moves: the commanded motion beside the simulated response.
    state(){const out={};for(const a of this.model.actuators){const x=this.axes.get(a.id);out[a.id]={command:{...x.command},q:+x.q.toFixed(4),v:+x.v.toFixed(4),done:x.done};}return out;}
  }
  const wrap360=v=>((v%360)+360)%360;
  // ---------------------------------------------------------------- action timeline
  // When each step of an action starts and ends, worked out ahead from the actuators' speeds (no ticking), so the
  // Setup preview can scrub it and a route knows how long it takes. from: {actuatorId: value} where they start. A step
  // that runs another action is followed by that action's steps, one `depth` deeper. Waits and motor-model actuators
  // depend on how the motion unfolds, so an action with either is timed by running the driver itself (every 1/240 s)
  // and sampled from what it recorded (`track`); either way the same inputs give the same timeline.
  function timeline(model,action,from={}){
    if(needsTicking(model,action,[]))return tickedTimeline(model,action,from);
    const at={...from},out=[];
    const run=(act,t0,depth,names)=>{let end=t0;for(let cycle=1;cycle<=(act.repeat||1);cycle++)end=once(act,end,depth,names,cycle);return end;};
    const once=(act,t0,depth,names,cycle)=>{const local=[],from=out.length;
      act.steps.forEach(s=>{const begin=(s.after===null?t0:local[s.after].end)+s.delay;
        if(s.pose!==undefined||s.reach!==undefined){const now=id=>at[id]??mover(model,id)?.home,values={};for(const id of Object.keys(at))values[id]=at[id];
          const goal=s.pose!==undefined?findPose(model,s.pose):reachGoal(model,s.reach,values),plan=goal?coordinate(model,goal,now):[],T=plan[0]?.seconds||0,rec={[s.pose!==undefined?'pose':'reach']:s.pose??s.reach,start:begin,end:begin+T,velocity:null,...(depth?{depth}:{})};
          local.push(rec);out.push(rec);for(const p of plan){out.push({actuator:p.id,start:begin,end:begin+T,from:p.from,to:p.to,velocity:null,speed:p.speed,accel:p.accel,depth:depth+1});at[p.id]=p.to;}return;}
        if(s.action!==undefined){const sub=findAction(model,s.action),rec={action:s.action,start:begin,end:begin,velocity:null,...(depth?{depth}:{})};local.push(rec);out.push(rec);
          if(sub&&depth<6&&!names.includes(sub.name.toLowerCase()))rec.end=run(sub,begin,depth+1,[...names,sub.name.toLowerCase()]);return;}
        const a=mover(model,s.actuator),c=s.command;if(at[a.id]===undefined)at[a.id]=a.home;
        let target=at[a.id],seconds=0,velocity=finite(c.velocity)?c.velocity:finite(c.effort)?c.effort*a.speed:null;
        if(c.state!==undefined&&finite(a.states?.[c.state]))target=a.states[c.state];else if(finite(c.target))target=c.target;
        // A pneumatic cylinder goes to an end: the nearer one for a position, the one a speed or effort points at.
        if(a.ends){target=velocity!==null?(velocity>=0?a.ends[1]:a.ends[0]):Math.abs(target-a.ends[0])<=Math.abs(target-a.ends[1])?a.ends[0]:a.ends[1];velocity=null;}
        if(velocity!==null)seconds=s.seconds??0;else seconds=Math.max(s.seconds??0,moveSeconds(target-at[a.id],a.speed,a.accel));
        const rec={actuator:a.id,start:begin,end:begin+seconds,from:at[a.id],to:target,velocity,...(depth?{depth}:{})};local.push(rec);out.push(rec);if(velocity===null)at[a.id]=target;});
      if(cycle>1)for(let k=from;k<out.length;k++)out[k].cycle=cycle;return Math.max(t0,...local.map(x=>x.end));};
    run(action,0,0,[action.name.toLowerCase()]);
    return {steps:out,duration:Math.max(0,...out.map(s=>s.end))};
  }
  const findAction=(model,name)=>model.actions.find(a=>a.name.toLowerCase()===String(name).toLowerCase());
  const findPose=(model,name)=>(model.poses||[]).find(p=>p.name.toLowerCase()===String(name).toLowerCase())?.values||null;
  // A coordinated move: for each mover, where it goes and the speed and acceleration that make it take as long as the
  // slowest (scaling a trapezoid's speed by k and its acceleration by k² scales its time by 1/k, keeping its shape).
  function coordinate(model,goal,now){const out=[];for(const [id,to] of Object.entries(goal)){const m=mover(model,id),from=now(id);if(!m||!finite(from)||!finite(to))continue;out.push({id,from,to,m,T:moveSeconds(to-from,m.speed,m.accel)});}
    const T=Math.max(0,...out.map(p=>p.T));return out.map(p=>{const k=T>0&&p.T>0?p.T/T:1;return {id:p.id,from:p.from,to:p.to,seconds:T,speed:p.m.speed*k,accel:(p.m.accel||0)*k*k};});}
  // Movers for each joint value: the actuator on it (its value index), or the joint itself when route actions move it.
  function moversOf(model){const out=new Map();for(const a of model.actuators){const k=a.joint+':'+(a.index||0);if(!out.has(k))out.set(k,a.id);}
    for(const j of model.joints)if(j.drive?.signal==='action'&&dofOf(j).length===1&&!out.has(j.id+':0'))out.set(j.id+':0',j.id);return out;}
  // Inverse kinematics over the joints of the chain that something can move, from the values given (movers' and joints').
  function reachGoal(model,r,values){const movers=moversOf(model),byId=new Map(model.joints.map(j=>[j.id,j])),given={};
    for(const [id,v] of Object.entries(values)){const a=model.actuators.find(x=>x.id===id);if(a){const q=valuesOf(byId.get(a.joint),given[a.joint]??byId.get(a.joint).home??0);q[a.index||0]=v;given[a.joint]=q;}else if(byId.has(id))given[id]=v;}
    const joints=chain(byId,r.joint).filter(id=>dofOf(byId.get(id)).some((_,i)=>movers.has(id+':'+i)));if(!joints.length)return null;
    const sol=reach(model,{joint:r.joint,point:r.point,target:r.target,aim:r.aim||[],given,joints}),goal={};
    for(const id of joints)dofOf(byId.get(id)).forEach((_,i)=>{const m=movers.get(id+':'+i);if(m)goal[m]=sol.q[id][i];});return goal;}
  function needsTicking(model,action,names){if(names.length>6||names.includes(action.name.toLowerCase()))return false;
    return action.steps.some(s=>s.wait!==undefined||(s.action!==undefined?(a=>a&&needsTicking(model,a,[...names,action.name.toLowerCase()]))(findAction(model,s.action)):mover(model,s.actuator)?.response==='motor'));}
  // The timeline of an action as the driver runs it: steps (start, end, and where each actuator was then) and the
  // position of every actuator it moves at each tick.
  function tickedTimeline(model,action,from={},dt=1/240){
    const d=new Driver(model),axisOf=id=>d.axes.get(id)||d.axes.get('joint:'+id);
    for(const [id,v] of Object.entries(from)){const x=axisOf(id);if(x&&finite(v)){x.q=v;x.target=v;x.command={mode:'position',value:v};}}
    const r=d.run(action),movers=new Set(),values={},record=()=>{for(const id of movers)(values[id]??=[]).push(axisOf(id).q);};
    const collect=act=>{for(const s of act.steps){if(s.actuator&&axisOf(s.actuator))movers.add(s.actuator);}};collect(action);for(const a of model.actions)collect(a);
    d.running.push(r);d.stepAction(r);record();
    for(let k=0;k<144000&&r.steps.some(x=>x.end===null);k++){d.tick(dt,{});record();}
    const at=t=>Math.min(Math.round(t/dt),Object.values(values)[0]?.length-1||0),out=[];
    const flat=(run,depth)=>run.action.steps.forEach((s,i)=>{const st=run.steps[i],start=st.start??d.time,end=st.end??d.time,extra=depth?{depth}:{};
      if(s.action!==undefined){out.push({action:s.action,start,end,velocity:null,...extra});if(st.child)flat(st.child,depth+1);}
      else if(s.wait!==undefined)out.push({wait:s.wait,start,end,met:st.end!==null&&d.met(s.wait),velocity:null,...extra});
      else out.push({actuator:s.actuator,start,end,from:values[s.actuator]?.[at(start)],to:values[s.actuator]?.[at(end)],velocity:null,...extra});});
    flat(r,0);
    return {steps:out,duration:Math.max(0,...out.map(s=>s.end)),track:{dt,values}};
  }
  // Actuator values at time t of a timeline (positions eased along each step's trapezoid; speeds integrated; a ticked
  // timeline read from its track).
  function sampleTimeline(model,tl,t){const v={};
    if(tl.track){const {dt,values}=tl.track;for(const s of tl.steps){if(!s.actuator||v[s.actuator]!==undefined||t<s.start)continue;const arr=values[s.actuator];if(!arr?.length)continue;
      const x=clamp(t/dt,0,arr.length-1),i=Math.floor(x),j=Math.min(arr.length-1,i+1);v[s.actuator]=arr[i]+(arr[j]-arr[i])*(x-i);}return v;}
    for(const s of tl.steps){if(!s.actuator)continue;const a=mover(model,s.actuator);if(t<s.start)continue;
    if(s.velocity!==null){v[a.id]=(v[a.id]??s.from)+s.velocity*(Math.min(t,s.end)-s.start);continue;}
    const total=s.end-s.start,u=total>0?clamp((t-s.start)/total,0,1):1;v[a.id]=s.from+(s.to-s.from)*profile(u,s.speed!==undefined?{speed:s.speed,accel:s.accel}:a,Math.abs(s.to-s.from));}
    return v;}
  // Fraction of the distance covered at fraction u of a trapezoid's time.
  function profile(u,a,d){if(!(a.accel>0)||!d)return u;const T=moveSeconds(d,a.speed,a.accel),ta=Math.min(a.speed/a.accel,T/2),vmax=a.accel*ta,t=u*T;
    if(t<ta)return .5*a.accel*t*t/d;if(t>T-ta){const r=T-t;return 1-.5*a.accel*r*r/d;}return (.5*a.accel*ta*ta+vmax*(t-ta))/d;}
  // ---------------------------------------------------------------- inverse kinematics
  // Moves the free joints of a chain so a point on its last link reaches a target and, optionally, so directions fixed
  // to that link point along world directions (aim: [{local, target}]: one aims a tool, two fix its orientation).
  // Damped least squares on the same forward kinematics, limits kept. error: how far the point ended from the target
  // (CAD units); aimError: the largest angle (degrees) left between an aimed direction and its target.
  function reach(model,{joint,point,target,aim=[],given={},joints:chainIds}={}){
    const byId=new Map(model.joints.map(j=>[j.id,j])),coupled=new Set(model.couplings.map(c=>c.to)),ids=(chainIds||chain(byId,joint)).filter(id=>byId.has(id)&&dofOf(byId.get(id)).length&&!coupled.has(id));
    const q=resolve(model,given),slots=ids.flatMap(id=>dofOf(byId.get(id)).map((u,i)=>({id,i,unit:u}))),list=order(model);
    // Residuals in inches; a radian of aim error weighs as much as 5 in of position error.
    const u=model.unit||1,w=5,aims=aim.map(a=>({local:unit(a.local),target:unit(a.target)})),goal=[...scale(target,u),...aims.flatMap(a=>scale(a.target,w))];
    const now=()=>{applyCouplings(model,q);const W=worlds(model,q,list).get(joint)||I4();return [...scale(apply(W,point),u),...aims.flatMap(a=>scale(unit(applyDir(W,a.local)),w))];};
    const residual=v=>goal.map((g,k)=>g-v[k]),norm=r=>Math.sqrt(r.reduce((s,x)=>s+x*x,0));
    const limit=sl=>{const l=limitsOf(byId.get(sl.id))[sl.i];if(l)q[sl.id][sl.i]=clamp(q[sl.id][sl.i],l[0],l[1]);};
    let v=now(),e=norm(residual(v)),lambda=.05;
    for(let it=0;it<300&&e>1e-6;it++){const r=residual(v);
      const J=slots.map(sl=>{const h=sl.unit==='in'?1e-4:1e-3,old=q[sl.id][sl.i];q[sl.id][sl.i]=old+h;const d=now().map((x,k)=>(x-v[k])/h);q[sl.id][sl.i]=old;return d;});
      const n=slots.length,A=Array.from({length:n},(_,a)=>Array.from({length:n},(_,b)=>J[a].reduce((t,x,k)=>t+x*J[b][k],0)+(a===b?lambda:0))),g=J.map(c=>c.reduce((t,x,k)=>t+x*r[k],0)),dx=solve(A,g);if(!dx)break;
      const before=slots.map(sl=>q[sl.id][sl.i]);slots.forEach((sl,k)=>{q[sl.id][sl.i]+=dx[k];limit(sl);});const vn=now(),en=norm(residual(vn));
      if(en<e){e=en;v=vn;lambda=Math.max(1e-6,lambda*.5);}else{slots.forEach((sl,k)=>{q[sl.id][sl.i]=before[k];});lambda*=3;if(lambda>1e6)break;}}
    applyCouplings(model,q);const W=worlds(model,q,list).get(joint)||I4();
    return {q,error:len(sub(apply(W,point),target)),aimError:Math.max(0,...aims.map(a=>Math.acos(clamp(dot(unit(applyDir(W,a.local)),a.target),-1,1))/DEG))};
  }
  // ---------------------------------------------------------------- couplings for common transmissions
  // A multi-stage slide's couplings. stages: prismatic joints from the bottom stage up, each moving on the one below;
  // lengths: each stage's travel. Cascade rigging moves every stage the same amount on the one below, all at once (the
  // first stage is driven; the top rides n times as far). Continuous rigging moves the top stage first and each stage
  // below once the one above it reaches its stop (gm0's description), set here from `from`, the total travel (a cable
  // spool's joint, or a joint with no parts that stands for the travel).
  function rigging(kind,stages,{lengths=[],from}={}){
    if(kind==='cascade')return stages.slice(1).map(to=>({kind:'cable',from:stages[0],to,ratio:1}));
    return stages.map((to,i)=>{const above=lengths.slice(i+1).reduce((s,l)=>s+l,0),L=lengths[i]||0;return {kind:'sequence',from,to,ratio:1,curve:[[above,0],[above+L,L]]};});
  }
  // A planetary gearset (Willis): Ns·ωsun + Nr·ωring = (Ns + Nr)·ωcarrier. Returns the coupling that sets `out` (one of
  // sun, ring, carrier) from the other two members' joints.
  function planetary({sun,ring,carrier,sunTeeth:Ns,ringTeeth:Nr,out='carrier'}){
    if(out==='carrier')return {kind:'planetary',from:sun,to:carrier,ratio:Ns/(Ns+Nr),plus:[{from:ring,ratio:Nr/(Ns+Nr)}]};
    if(out==='sun')return {kind:'planetary',from:carrier,to:sun,ratio:(Ns+Nr)/Ns,plus:[{from:ring,ratio:-Nr/Ns}]};
    return {kind:'planetary',from:carrier,to:ring,ratio:(Ns+Nr)/Nr,plus:[{from:sun,ratio:-Ns/Nr}]};
  }
  // ---------------------------------------------------------------- when the mechanism list changes
  // A game part was removed: joints driven by it lose that drive, and those of later parts move down one.
  function reindex(model,kind,removed){const out=structuredClone(model);for(const j of out.joints){const d=j.drive;if(!d?.of?.startsWith(kind+':'))continue;const n=+d.of.split(':')[1];
    if(n===removed){delete j.drive;j.note=(j.note?j.note+' ':'')+'Its mechanism was removed.';}else if(n>removed)d.of=kind+':'+(n-1);}return sanitize(out);}
  // What the engine needs: the joints with a drive, actuators and actions, without part lists.
  function forEngine(model){const m=sanitize(model);return {...m,joints:m.joints.map(({parts,alternatives,note,...j})=>j)};}
  return {TYPES,ACTUATORS,MODES,COUPLINGS,SIGNALS,PROVENANCE,RESPONSES,STAGES,SENSORS,SHOW_SPIN,shownRate,sanitize,EMPTY,mover,partIndex,order,resolve,worlds,motion,frame,dofOf,valuesOf,limitsOf,couple,applyCouplings,solveLoops,pose,reach,Axis,moveSeconds,Driver,resolveAction,reading,volts,VOLTS,timeline,sampleTimeline,reindex,forEngine,
    stagesRatio,actuatorUnit,motorAtJoint,rigging,planetary,
    math:{sub,add,scale,dot,cross,len,unit,perpendicular,I4,mul,apply,applyDir,trans,rot,about,invert}};
});
