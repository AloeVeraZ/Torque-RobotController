'use strict';
// Simulation-time practice clock. It never talks to a real robot or a controller.
const DEFAULTS={autoSeconds:30,transitionSeconds:8,teleopSeconds:120};
function timing(raw={}){return Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,typeof raw[k]==='number'&&Number.isFinite(raw[k])?Math.max(k==='transitionSeconds'?0:.000001,raw[k]):v]));}
class PracticeClock{
  constructor(mode,options){this.mode=mode==='teleop'?'teleop':mode==='match'?'match':'autonomous';this.timing=timing(options);this.phase=this.mode==='teleop'?'teleop':'auto';this.elapsed=0;this.neutralRequired=true;}
  get duration(){return this.phase==='auto'?this.timing.autoSeconds:this.phase==='transition'?this.timing.transitionSeconds:this.phase==='teleop'?this.timing.teleopSeconds:0;}
  get remaining(){return Math.max(0,this.duration-this.elapsed);}
  advance(dt){if(this.phase==='finished')return null;this.elapsed+=dt;if(this.remaining>1e-8)return null;const from=this.phase;// Autonomous is followed by the transition (when it has a length), in a full match and on its own; only a match goes on to teleop.
    const after=this.mode==='match'?'teleop':'finished';this.phase=from==='auto'?(this.timing.transitionSeconds>0?'transition':after):from==='transition'?after:'finished';this.elapsed=0;this.neutralRequired=true;return {from,to:this.phase};}
  snapshot(){return {mode:this.mode,phase:this.phase,remaining:this.remaining,elapsed:this.elapsed,timing:this.timing,neutralRequired:this.neutralRequired};}
}
module.exports={PracticeClock,timing,DEFAULTS};
