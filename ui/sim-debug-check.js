(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckDebugCheck=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Live debug's device check: what each device is checked with, set on its own box, and how an input proves it is
  // connected. Nothing here touches the page or the robot.
  const SPEEDS=[5,10,15,20,25,30,35,40,50,60,70,80,90,100],SAFE_SPEED=40,SERVO_RANGES=[90,180,270,300,355],SERVO_SPAN=270,MIN_APART=20;
  const DEFAULTS={speed:20,a:125,b:145};
  const speeds=()=>SPEEDS,servoChoices=(range=SERVO_SPAN)=>Array.from({length:Math.floor(range/5)+1},(_,i)=>i*5);
  // One device's settings, whatever was saved. speed: how hard something that spins runs, in percent. a, b: the two angles a positional servo moves between. range: the degrees its whole travel covers.
  function deviceParams(kind,p){if(kind==='motor'||kind==='crservo')return {speed:SPEEDS.includes(+p?.speed)?+p.speed:DEFAULTS.speed};if(kind!=='servo')return {};
    const range=SERVO_RANGES.includes(+p?.range)?+p.range:SERVO_SPAN,angle=(v,d)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(+v)&&+v>=0&&+v<=range?Math.round(+v):Math.min(d,range);
    return {range,a:angle(p?.a,DEFAULTS.a),b:angle(p?.b,DEFAULTS.b)};}
  // What is wrong with a servo's two angles, or ''.
  function problem(p){return Math.abs(p.a-p.b)<MIN_APART?`The two angles must be at least ${MIN_APART}° apart.`:'';}
  // A positional servo's command for an angle: 0-1 over its range.
  const position=(angle,range=SERVO_SPAN)=>Math.max(0,Math.min(1,angle/range));
  // ---- digital: it has to change and come back. A device already held has to let go, be held and let go again.
  // heldNow: known to be held (a touch sensor says so); otherwise where it reads now counts as let go.
  const digitalStart=(value,heldNow=false)=>({need:heldNow?3:2,held:heldNow,seen:0,last:value,done:false});
  function digitalStep(s,value){if(value===undefined||value===s.last)return s;const seen=s.seen+1;return {...s,seen,last:value,held:!s.held,done:seen>=s.need};}
  const digitalPrompt=s=>s.done?'It works: it changed and came back.':s.held?'Let go of it now.':s.seen?'Press or trigger it again, then let go.':'Press or trigger it now.';
  // ---- analog: it reads, it changes when turned, and it stays where it is left.
  const TURNED=.15,HOLD_MS=3000;
  const analogStart=()=>({stage:'read',base:null,mark:null,at:0,value:null});
  function analogStep(s,value,now){if(!Number.isFinite(value))return s;
    if(s.stage==='read')return {...s,stage:'turn',base:value,value};
    if(s.stage==='turn')return Math.abs(value-s.base)>=TURNED?{...s,stage:'stop',mark:value,at:now,value}:{...s,value};
    // Told to stop, the team has 3 s to let go; where it reads then is where it stays.
    if(s.stage==='stop')return now-s.at>=HOLD_MS?{...s,stage:'done',value}:{...s,value};
    return s;}
  const analogPrompt=s=>{const v=Number.isFinite(s.value)?` Reading ${s.value.toFixed(2)} V.`:'';return s.stage==='read'?'Waiting for a reading…':s.stage==='turn'?`Rotate it until you are told to stop.${v}`:s.stage==='stop'?`Stop and let go.${v}`:`It works: it rests at ${s.value.toFixed(2)} V.`;};
  return {DEFAULTS,MIN_APART,SERVO_SPAN,SERVO_RANGES,SAFE_SPEED,speeds,servoChoices,deviceParams,problem,position,digitalStart,digitalStep,digitalPrompt,analogStart,analogStep,analogPrompt};
});
