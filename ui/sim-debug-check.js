(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckDebugCheck=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Live debug's device check: the parameters set before Torque Debug goes on the robot, and how an input proves it is
  // connected. Nothing here touches the page or the robot.
  const MOTOR_SAFE=[20,25,30,35,40],MOTOR_OVER=[50,60,70,80,90,100],SERVO_SPAN=270,MIN_APART=20;
  const DEFAULTS={motor:20,over:false,servoA:125,servoB:145};
  const motorChoices=over=>over?[...MOTOR_SAFE,...MOTOR_OVER]:MOTOR_SAFE;
  const servoChoices=()=>Array.from({length:SERVO_SPAN/5+1},(_,i)=>i*5);
  function sanitize(p){const over=p?.over===true,angle=(v,d)=>Number.isFinite(+v)&&v!==null&&v!==''&&+v>=0&&+v<=SERVO_SPAN?Math.round(+v):d;
    return {motor:motorChoices(over).includes(+p?.motor)?+p.motor:DEFAULTS.motor,over,servoA:angle(p?.servoA,DEFAULTS.servoA),servoB:angle(p?.servoB,DEFAULTS.servoB)};}
  // What is wrong with these parameters, or ''.
  function problem(p){return Math.abs(p.servoA-p.servoB)<MIN_APART?`The two servo angles must be at least ${MIN_APART}° apart.`:'';}
  // A positional servo's command for an angle: 0-1 over its range.
  const position=angle=>Math.max(0,Math.min(1,angle/SERVO_SPAN));
  // Which way a continuous servo turns first follows the two angles.
  const direction=p=>p.servoB>=p.servoA?1:-1;
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
  // A short, quiet double tone, to get the attention of someone looking at the robot.
  let audio=null;function chime(){try{audio||=new AudioContext();void audio.resume();const t=audio.currentTime;for(const [at,hz] of [[0,660],[.2,880]]){const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=hz;g.gain.setValueAtTime(0,t+at);g.gain.linearRampToValueAtTime(.05,t+at+.02);g.gain.exponentialRampToValueAtTime(.0005,t+at+.18);o.connect(g).connect(audio.destination);o.start(t+at);o.stop(t+at+.2);}}catch{}}
  return {DEFAULTS,MIN_APART,SERVO_SPAN,motorChoices,servoChoices,sanitize,problem,position,direction,digitalStart,digitalStep,digitalPrompt,analogStart,analogStep,analogPrompt,chime};
});
