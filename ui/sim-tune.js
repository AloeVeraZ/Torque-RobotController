(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckTune=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate follows feedback (docs/CALIBRATION.md). A device can only be tuned against something that measures what it
  // did: a motor's encoder counts its speed or position, an Axon's feedback wire or an absolute encoder tells a servo's
  // angle, a limit switch marks zero. Calibration is a chain of gates, each a test the robot passes before the next may
  // drive it harder: G0 the Control Hub's devices read, G1 each mechanism confirmed, G2 its actuator and sensor bound and
  // signed, G3 sensor units turned into mechanism units, G4 zero, G5 range, G6 feedforward, G7 feedback, GT sensor
  // thresholds, G8 committed. Which gates a mechanism gets follows one of seven templates, picked from its type and then
  // from the feedback its wiring actually has (a servo with no feedback wire is blind, whatever it moves).
  // Pure functions only: simulation.js keeps the records (project.calibration) and drives the robot through Live debug.
  const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // ---- feedback, by device ------------------------------------------------------------------------------------------
  const KINDS={
    velocity:{name:'Speed loop',tune:'Velocity PIDF: F holds the set speed, P pushes back when it sags (a shot, a piece), and the tolerance is when it counts as at speed.'},
    position:{name:'Position loop',tune:'PID and a tolerance: it drives the error to zero, may swing past a few times, and holds once it stays within ± the tolerance.'},
    servo:{name:'Servo with feedback',tune:'The servo runs its own loop. Its feedback tells where it really got to: set the reading at two positions so angles read true, and how close counts as there.'},
    home:{name:'Homing switch',tune:'A switch marks zero and positions count from it. Nothing reads where it is in between, so it cannot hold a position.'},
    endpoints:{name:'Set positions',tune:'Nothing measures it, so there is nothing to tune: set where 0 is, how far full travel goes and which way it turns.'},
    timed:{name:'Power and time',tune:'Nothing measures it: it runs at a power for a time. Add an encoder or a sensor to calibrate it.'}};
  // Sensors that read a position, and the ones read in inches rather than degrees.
  const POSITION=['motorEncoder','throughBore','analogAbs','axonFeedback','potentiometer','octoquad','distance'],LINEAR=['distance'];
  const SKIP=['sensor','pod','imu','pinpoint','otos'];
  // {kind, sensor (the reading one, or null), wrap (it turns all the way round: the shortest way is taken), unit}
  function feedbackOf(row,{wrap=false,unit}={}){
    if(!row||SKIP.includes(row.role))return null;
    const sensors=Array.isArray(row.sensors)?row.sensors:[],pos=sensors.find(s=>s.use==='position'&&POSITION.includes(s.kind)),vel=sensors.find(s=>s.use==='velocity'),home=sensors.find(s=>s.use==='home');
    const own={kind:'motorEncoder'},servo=row.kind==='servo'||row.kind==='linear',u=unit||(pos&&LINEAR.includes(pos.kind)?'in':'deg');
    if(row.role==='flywheel'||vel||row.role==='drive'&&row.encoder)return {kind:'velocity',sensor:vel||own,wrap:false,unit:'rpm'};
    if(servo)return pos?{kind:'servo',sensor:pos,wrap:false,unit:u}:{kind:home?'home':'endpoints',sensor:home||null,wrap:false,unit:u};
    if(pos||row.encoder&&row.role!=='roller')return {kind:'position',sensor:pos||own,wrap:wrap||row.role==='steer',unit:u};
    if(row.role==='roller'&&row.kind==='dcmotor')return {kind:'velocity',sensor:own,wrap:false,unit:'rpm'};
    if(home)return {kind:'home',sensor:home,wrap:false,unit:u};
    return {kind:'timed',sensor:null,wrap:false,unit:u};}
  // ---- templates and gates -------------------------------------------------------------------------------------------
  const GATES={
    G0:{name:'Control Hub',short:'Hub',what:'Every device in the configuration read from the Control Hub (Set up from the Control Hub, or Live debug).',pass:'The devices are read, and the configuration has not changed since.'},
    G1:{name:'Link to the robot',short:'Link',what:'Simulate lists what this mechanism runs on and what measures it. Say which motor, servo and sensor of the robot’s configuration each one is.',pass:'Its motor or servo and every sensor Simulate lists on it is on a port the configuration has.'},
    G2:{name:'Bind and direction',short:'Direction',what:'Run it briefly and watch every input: only its own sensor should move, and + should mean the way you call positive.',pass:'Its sensor answered and you confirmed which way is positive.'},
    G3:{name:'Units',short:'Units',what:'Turn sensor counts or volts into the mechanism’s own units: the gear or belt ratio between sensor and output, the spool or the angle a turn makes.',pass:'A known move reads within 2 % (or two readings agree).'},
    G4:{name:'Zero',short:'Zero',what:'Where 0 is: a switch, a gentle stall against a stop, an absolute sensor, or where it starts.',pass:'Three zeroings agree within 0.5° or 2 counts.'},
    G5:{name:'Range',short:'Range',what:'How far it may go each way: jog to each stop and keep a margin inside it.',pass:'Both limits set inside the hard stops.'},
    G6:{name:'Feedforward',short:'Feedforward',what:'The power it needs before any correction: against friction (kS), against gravity (kG) and per unit of speed (kV), measured by ramps on the robot.',pass:'The fit explains the readings (R² ≥ 0.95), or the hold ramp found kG and kS.'},
    G7:{name:'Feedback',short:'Feedback',what:'PID gains and a tolerance: step it to a target and score how fast it gets there, how far it swings past and when it settles.',pass:'It settles within the tolerance and holds there.'},
    GT:{name:'Sensor thresholds',short:'Thresholds',what:'Read the sensor with and without a game piece (or pressed and released); the threshold sits between, with a margin.',pass:'The two groups of readings do not overlap.'},
    G8:{name:'Commit',short:'Commit',what:'Keep the values with this setup and put them in the code: the constants file, and the settings the hardware forgets re-sent each op mode.',pass:'Saved, with the battery voltage and date they were measured at.'}};
  const ALL=['G0','G1','G2','G3','G4','G5','G6','G7','G8'];
  const TEMPLATES={
    T1:{name:'Gravity-loaded position',gates:ALL,ff:'gravity',note:'kG is constant for a lift; for an arm it is kG·cos(angle), with 0 at horizontal.'},
    T2:{name:'Free or wrapping position',gates:ALL,ff:'friction',note:'No gravity: kS in each direction matters. A turret has soft limits; a swerve pod or spindexer takes the shortest way round.'},
    T3:{name:'Velocity',gates:['G0','G1','G2','G3','G6','G7','G8'],ff:'velocity',note:'Speed from the encoder: hub readings step in 20 ticks/s and wrap past 32767 ticks/s.'},
    T4:{name:'Servo with feedback',gates:['G0','G1','G2','G3','G4','G5','G7','G8'],ff:null,note:'The servo closes its own loop; its feedback wire tells where it really got to, so arrival and stalls can be checked.'},
    T5:{name:'Blind actuator',gates:['G0','G1','G2','G5','G8'],ff:null,note:'Nothing measures it: its positions are commands and its timing is the only calibration.'},
    T6:{name:'Threshold sensing',gates:['G0','G1','GT','G8'],ff:null,note:'A colour, distance or limit sensor that says yes or no: a piece is in, the slide is home.'},
    T7:{name:'Drivetrain and localization',gates:['G0','G1','G2','G8'],ff:null,note:'Drive motors, odometry pods, Pinpoint, OTOS and the IMU: the guided check measures them, as Road Runner and Pedro Pathing tune them.'}};
  // Each mechanism type's template by what usually moves it and reads it (the research's table); feedback can move it.
  const TYPE_TEMPLATE={};
  for(const [t,ids] of Object.entries({
    T1:'lift scissor-lift lead-screw rack-pinion dr4b tape-measure forklift arm pivot-extension elbow four-bar v4b capper shooter-pivot transfer cone-righter hang-hook winch self-lift catapult custom-pivot',
    T2:'linear-slide turret base-yaw spindexer geneva-indexer swerve-steer gantry scara delta-arm custom-slide',
    T3:'flywheel roller-intake feeder conveyor spinner spindle custom-spin roller-claw propeller',
    T4:'claw parallel-gripper deploy-intake wrist wrist-roll diffy-wrist hood mini-turret linkage-slide flip-out-arm kicker gate finger neck stewart-leg',
    T5:'dropper drone-launcher ratchet ramp diverter goal-grabber bucket sweeper-arm knocker-arm odo-retract pto-shifter drop-wheels steering hip knee ankle hopper pole-guide button-pusher suction-gripper piston',
    T6:'passive-gripper',T7:'drive-wheel odometry-pod camera-mount'}))for(const id of ids.split(' '))TYPE_TEMPLATE[id]=t;
  // Banned in FTC (pneumatics R801, suction R204/R801): calibrated only in the simulator.
  const ILLEGAL=new Set(['piston','propeller','suction-gripper']);
  // The template a mechanism gets: its type's, unless its feedback says otherwise.
  function templateOf(type,feedback){
    const base=TYPE_TEMPLATE[type]||'T2',k=feedback?.kind;if(!k||base==='T6'||base==='T7')return base;
    if(['T1','T2','T3'].includes(base)&&(k==='timed'||k==='endpoints'||k==='home'))return 'T5';
    if(base==='T4')return k==='servo'?'T4':k==='position'?'T2':'T5';
    if(base==='T5')return k==='servo'?'T4':k==='position'?'T2':'T5';
    if(base==='T3'&&k==='position')return 'T3';
    return base;}
  // Where each gate stands for one mechanism: pass, stale (passed, then something it depends on changed), todo, locked
  // (an earlier gate is not passed) or na (not in its template). rec.gates[id] = {at, dep}; dep the inputs' hash then.
  function gateStates(template,rec,deps={}){
    const list=(TEMPLATES[template]||TEMPLATES.T5).gates,hasThreshold=!!deps.threshold,out={};let open=true;
    for(const id of [...Object.keys(GATES)]){
      const inList=list.includes(id)||id==='GT'&&hasThreshold;if(!inList){out[id]='na';continue;}
      const g=rec?.gates?.[id],dep=deps[id]??deps.all??'';const state=!g?'todo':g.dep!==undefined&&g.dep!==dep?'stale':'pass';
      out[id]=open?state:'locked';if(state!=='pass')open=false;}
    return out;}
  // ---- units ----------------------------------------------------------------------------------------------------------
  // A sensor reading to mechanism units. Counts: raw / counts a sensor turn / (sensor turns per output turn) × units an
  // output turn (360° for a pivot, the spool's circumference × cascade stages for a slide), signed, less the zero offset.
  // Volts: two captured points (volts and units) define a line; the REV potentiometer has its own curve.
  function toUnits(raw,t={}){
    if(!finite(raw))return NaN;const s=t.sign===-1?-1:1;
    if(t.analog){if(t.curve==='rev-pot'){const v=raw,a=v,b=-270*v-445.5,c=-36450*v+120285,d=b*b-4*a*c;if(!a||d<0)return NaN;return s*((-b-Math.sqrt(d))/(2*a))-(t.offset||0);}
      const {v0=0,v1=3.3,u0=0,u1=360}=t;if(v1===v0)return NaN;return s*(u0+(raw-v0)*(u1-u0)/(v1-v0))-(t.offset||0);}
    const cpr=t.cpr>0?t.cpr:1,ratio=t.ratio>0?t.ratio:1,per=finite(t.perTurn)?t.perTurn:360;return s*raw/cpr/ratio*per-(t.offset||0);}
  function toRaw(units,t={}){
    if(!finite(units))return NaN;const s=t.sign===-1?-1:1,u=(units+(t.offset||0))*s;
    if(t.analog){const {v0=0,v1=3.3,u0=0,u1=360}=t;return u1===u0?NaN:v0+(u-u0)*(v1-v0)/(u1-u0);}
    const cpr=t.cpr>0?t.cpr:1,ratio=t.ratio>0?t.ratio:1,per=finite(t.perTurn)&&t.perTurn?t.perTurn:360;return u*cpr*ratio/per;}
  // Units an output turn makes: a pivot's 360°, or a spool's circumference (diameter in mm) times its cascade stages.
  const perTurnOf=({unit='deg',spoolMm,stages=1})=>unit==='mm'&&spoolMm>0?Math.PI*spoolMm*Math.max(1,stages):360;
  // ---- fits -----------------------------------------------------------------------------------------------------------
  function fitLine(xs,ys){const n=Math.min(xs.length,ys.length);if(n<2)return null;let mx=0,my=0;for(let i=0;i<n;i++){mx+=xs[i];my+=ys[i];}mx/=n;my/=n;
    let sxx=0,sxy=0,syy=0;for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}if(!sxx)return null;
    const slope=sxy/sxx,intercept=my-slope*mx,r2=syy?sxy*sxy/(sxx*syy):1;return {slope,intercept,r2};}
  // The hold-band ramp: the power at which it starts moving up, and down. Up needs gravity plus friction, down gravity less
  // friction, so kG = (up + down) / 2 and kS = (up − down) / 2.
  const holdBand=(up,down)=>({kG:(up+down)/2,kS:(up-down)/2});
  // A velocity ramp: steady speed at each power. power = kS·sign(v) + kV·v, fit on the moving points.
  function velocityFit(points){const moving=points.filter(p=>finite(p.power)&&finite(p.velocity)&&Math.abs(p.velocity)>1e-6);const f=fitLine(moving.map(p=>Math.abs(p.velocity)),moving.map(p=>Math.abs(p.power)));
    return f?{kV:f.slope,kS:f.intercept,r2:f.r2,top:f.slope>0?(1-f.intercept)/f.slope:null}:null;}
  // Two encoders on one mechanism (the motor's own and one on the output): their counts' ratio, and how straight a line.
  function ratioFit(motor,sensor){const f=fitLine(motor,sensor);return f?{ratio:f.slope,r2:f.r2}:null;}
  // A step response scored as MATLAB's stepinfo does: rise 10 % → 90 %, overshoot past the target as a fraction of the
  // step, settling the last time it came within the tolerance and stayed. samples: [{t (s), value}].
  function stepInfo(samples,from,target,tol){
    const step=target-from,dir=Math.sign(step)||1,frac=s=>(s.value-from)/(step||1);if(!samples.length)return null;
    const t10=samples.find(s=>frac(s)>=.1)?.t,t90=samples.find(s=>frac(s)>=.9)?.t;
    const peak=Math.max(...samples.map(s=>(s.value-target)*dir));let settle=null;for(let k=samples.length-1;k>=0&&Math.abs(samples[k].value-target)<=tol;k--)settle=samples[k].t;
    return {rise:finite(t10)&&finite(t90)?t90-t10:null,overshoot:Math.max(0,peak)/Math.abs(step||1),settle,holds:settle!==null,final:samples[samples.length-1].value-target};}
  // A threshold between two groups of readings (without and with a piece; released and pressed), with how far apart they are.
  function threshold(a,b){if(!a.length||!b.length)return null;const [lo,hi]=Math.max(...a)<Math.min(...b)?[a,b]:Math.max(...b)<Math.min(...a)?[b,a]:[null,null];
    if(!lo){const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;return {value:(ma+mb)/2,gap:0,overlap:true,above:mb>ma?'b':'a'};}
    const top=Math.max(...lo),bottom=Math.min(...hi);return {value:(top+bottom)/2,gap:bottom-top,hysteresis:(bottom-top)/4,overlap:false,above:hi===b?'b':'a'};}
  // ---- loops, simulated -----------------------------------------------------------------------------------------------
  // The shortest signed way from a to b on a circle (degrees): from 90 to 0 is −90, not +270.
  const shortest=(a,b)=>((b-a)%360+540)%360-180;
  // A step test of a loop on a motor model. The motor's speed follows power with a time constant (tau, seconds) up to its
  // free speed (units a second at full power), less a little friction; the loop runs every period on the sensor's reading
  // (rounded to its resolution), so a gain too high swings past and back like the real mechanism. Gains are in power per
  // unit, as Live debug's robot-side loop takes them; kG holds against gravity.
  function simulate(o){
    const vel=o.kind==='velocity',dt=.001,period=clamp(finite(o.period)?o.period:.02,.002,.2),seconds=clamp(finite(o.seconds)?o.seconds:2.5,.2,20);
    const free=Math.max(1e-6,o.freeSpeed||1),tau=clamp(finite(o.tau)?o.tau:.08,.005,5),res=Math.max(0,o.resolution||0),friction=clamp(finite(o.friction)?o.friction:.04,0,.5),gravity=o.gravity||0;
    const kP=o.kP||0,kI=o.kI||0,kD=o.kD||0,kF=o.kF||0,kS=o.kS||0,kG=o.kG||0,tol=Math.abs(o.tolerance||0),target=o.target||0;
    let x=vel?0:o.from||0,v=vel?(o.from||0):0,u=0,integral=0,prev=null,next=0;const samples=[],every=Math.max(1,Math.round(seconds/dt/240));
    const read=()=>{const raw=vel?v:x;return res?Math.round(raw/res)*res:raw;};
    const error=m=>o.wrap&&!vel?shortest(m,target):target-m;
    const first=error(read());
    for(let i=0,n=Math.round(seconds/dt);i<=n;i++){const t=i*dt;
      if(t>=next-1e-9){next+=period;const m=read(),e=error(m);integral=clamp(integral+e*period,-1e6,1e6);const d=prev===null?0:(e-prev)/period;prev=e;
        u=kP*e+kI*integral+kD*d+kG+(vel?kF*target+kS*Math.sign(target):Math.abs(e)>tol?kS*Math.sign(e):0);u=clamp(u,-1,1);}
      const push=u-gravity,eff=Math.sign(push)*Math.max(0,Math.abs(push)-friction);v+=(eff*free-v)/tau*dt;x+=v*dt;
      if(i%every===0)samples.push({t,value:vel?v:o.wrap?((x%360)+540)%360-180:x,error:error(vel?v:x)});}
    let settle=null;for(let k=samples.length-1;k>=0&&Math.abs(samples[k].error)<=tol;k--)settle=samples[k].t;
    const after=samples.filter(s=>Math.sign(s.error)!==Math.sign(first)&&s.error!==0),overshoot=after.length?Math.max(...after.map(s=>Math.abs(s.error))):0;
    const tail=samples.filter(s=>s.t>=seconds*.8).map(s=>s.error);
    return {samples,first,overshoot,settle,holds:settle!==null,band:tail.length?[Math.min(...tail),Math.max(...tail)]:[0,0],final:samples[samples.length-1]?.error??0};}
  // Gains that settle on most FTC mechanisms, as a place to start: full power until within a quarter second of travel,
  // damped by the motor's own time constant, and kS (the measured one, else 0.05) so friction cannot stall it just short
  // of the target. Velocity: feedforward 1/top speed and a small P.
  function suggest({kind,freeSpeed,tau=.08,kS}){
    if(kind==='velocity'){const f=1/Math.max(1e-6,freeSpeed);return {kF:+f.toPrecision(3),kP:+(f*2).toPrecision(3),kI:0,kD:0,kS:finite(kS)?kS:0};}
    const p=4/Math.max(1e-6,freeSpeed);return {kP:+p.toPrecision(3),kI:0,kD:+(p*Math.max(.02,tau)*.8).toPrecision(3),kS:finite(kS)?kS:.05};}
  // ---- records --------------------------------------------------------------------------------------------------------
  // A short stable hash of what a gate depended on.
  function hash(value){const s=JSON.stringify(value)??'';let h=5381;for(let i=0;i<s.length;i++)h=(h*33^s.charCodeAt(i))>>>0;return h.toString(36);}
  // project.calibration as stored: plain numbers, short strings, booleans, small arrays and objects, nothing else.
  function clean(v,depth=0){
    if(typeof v==='number')return finite(v)?+clamp(v,-1e9,1e9).toPrecision(8):undefined;if(typeof v==='boolean')return v;
    if(typeof v==='string')return v.length<=200?v:v.slice(0,200);if(depth>5||v===null||typeof v!=='object')return undefined;
    if(Array.isArray(v))return v.slice(0,64).map(x=>clean(x,depth+1)).filter(x=>x!==undefined);
    const out={};for(const [k,x] of Object.entries(v).slice(0,200)){if(!/^[\w.:-]{1,80}$/.test(k))continue;const c=clean(x,depth+1);if(c!==undefined)out[k]=c;}return out;}
  const sanitize=raw=>{const c=clean(raw&&typeof raw==='object'?raw:{});return {...(c.hub&&typeof c.hub==='object'?{hub:c.hub}:{}),...(c.lens&&typeof c.lens==='object'&&!Array.isArray(c.lens)?{lens:c.lens}:{}),mechs:c.mechs&&typeof c.mechs==='object'&&!Array.isArray(c.mechs)?c.mechs:{},...(Array.isArray(c.links)?{links:c.links.filter(linkOk)}:{}),...(c.chassis&&typeof c.chassis==='object'&&!Array.isArray(c.chassis)?{chassis:c.chassis}:{}),...(c.electronics&&typeof c.electronics==='object'&&!Array.isArray(c.electronics)?{electronics:c.electronics}:{})};};
  // Calibrate → Electronics' "if this, then this" links (ui/sim-links.js): only whole ones are kept.
  const linkOk=l=>!!l&&typeof l==='object'&&typeof l.id==='string'&&Array.isArray(l.causes)&&l.causes.every(c=>c&&typeof c.name==='string'&&['motor','crservo','servo','piece'].includes(c.kind)&&(c.dir===1||c.dir===-1))&&!!l.effect&&typeof l.effect.key==='string'&&[1,-1,0].includes(l.effect.dir);
  // The constants file for the team's code: each calibrated mechanism's units, zero, limits and gains, as Java.
  // lens: project.calibration.lens, {camera: {size: {fx, fy, cx, cy}}}, one-tag estimates from Calibrate → Camera. The simulated webcam's are left out.
  function constants(list,{packageName='org.firstinspires.ftc.teamcode',className='DeckCalibration',when='',lens}={}){
    const id=s=>String(s).replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').toUpperCase()||'MECHANISM',n=v=>finite(v)?String(+(+v).toPrecision(6)):'0';
    const body=list.map(({name,template,rec})=>{const p=id(name),t=rec?.transform||{},lines=[`    // ${name}: ${TEMPLATES[template]?.name||template}`];
      if(finite(t.cpr))lines.push(`    public static final double ${p}_COUNTS_PER_UNIT = ${n(toRaw(1,{...t,offset:0})-toRaw(0,{...t,offset:0}))};`,`    public static final double ${p}_ZERO_OFFSET = ${n(t.offset||0)};`,`    public static final int ${p}_DIRECTION = ${t.sign===-1?-1:1};`);
      if(rec?.range)lines.push(`    public static final double ${p}_MIN = ${n(rec.range.lo)}, ${p}_MAX = ${n(rec.range.hi)};`);
      if(rec?.ff)lines.push(`    public static final double ${p}_KS = ${n(rec.ff.kS)}, ${p}_KG = ${n(rec.ff.kG)}, ${p}_KV = ${n(rec.ff.kV)};`);
      if(rec?.pid)lines.push(`    public static final double ${p}_KP = ${n(rec.pid.kP)}, ${p}_KI = ${n(rec.pid.kI)}, ${p}_KD = ${n(rec.pid.kD)}, ${p}_TOLERANCE = ${n(rec.pid.tolerance)};`);
      if(rec?.threshold)lines.push(`    public static final double ${p}_THRESHOLD = ${n(rec.threshold.value)}, ${p}_HYSTERESIS = ${n(rec.threshold.hysteresis)};`);
      if(rec?.positions)for(const [k,v] of Object.entries(rec.positions))lines.push(`    public static final double ${p}_${id(k)} = ${n(v)};`);
      return lines.join('\n');}).join('\n\n');
    const lenses=Object.entries(lens||{}).filter(([k])=>k!=='sim').flatMap(([k,sizes])=>Object.entries(sizes||{}).map(([size,l])=>{const p=`LENS_${id(k)}_${id(size)}`;return `    // ${k} at ${size}: a one-tag estimate. new AprilTagProcessor.Builder().setLensIntrinsics(${p}_FX, ${p}_FY, ${p}_CX, ${p}_CY)\n    public static final double ${p}_FX = ${n(l.fx)}, ${p}_FY = ${n(l.fy)}, ${p}_CX = ${n(l.cx)}, ${p}_CY = ${n(l.cy)};`;})).join('\n\n');
    return `package ${packageName};\n\n/** Calibrated in Torque${when?` (${when})`:''}. Units are each mechanism's own (degrees or mm); gains are power per unit. */\npublic final class ${className} {\n    private ${className}() {}\n\n${[body,lenses].filter(Boolean).join('\n\n')}\n}\n`;}
  return {KINDS,GATES,TEMPLATES,TYPE_TEMPLATE,ILLEGAL,feedbackOf,templateOf,gateStates,toUnits,toRaw,perTurnOf,fitLine,holdBand,velocityFit,ratioFit,stepInfo,threshold,shortest,simulate,suggest,hash,sanitize,constants};
});
