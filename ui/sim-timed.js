(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckTimed=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),num=(v,f,a,b)=>typeof v==='number'&&Number.isFinite(v)?clamp(v,a,b):f;
  // source 'robot': speeds, speed-up and coasting are worked out from the robot settings (motors, wheels,
  // mass) by driving the simulated robot; 'measured': the team typed numbers measured on their robot.
  // A rest-to-rest curve (source 'robot' only): [[seconds of power, the seconds at cruise speed it is worth]], rising, measured on
  // the simulated robot at curvePower. A short burst of power never reaches cruise speed and a long one rolls on after it, so
  // a leg's time comes from the curve, not from speed and a fixed lag.
  const curve=c=>Array.isArray(c)&&c.length>=2&&c.every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)&&(!i||p[0]>c[i-1][0]&&p[1]>c[i-1][1]))?c.map(p=>[p[0],p[1]]):undefined;
  function settings(raw={}){const curves=raw.source!=='measured'&&curve(raw.forwardCurve)&&typeof raw.curvePower==='number'&&raw.curvePower>0?{forwardCurve:curve(raw.forwardCurve),strafeCurve:curve(raw.strafeCurve)||curve(raw.forwardCurve),curvePower:raw.curvePower,rest:num(raw.rest,.15,0,1.5)}:{};
    return {...curves,source:raw.source==='measured'?'measured':'robot',power:num(raw.power,.45,0,1),forwardSpeed:num(raw.forwardSpeed,60,Number.MIN_VALUE,Infinity),strafeSpeed:num(raw.strafeSpeed,50,Number.MIN_VALUE,Infinity),startup:num(raw.startup,.2,0,Infinity),stopping:num(raw.stopping,0,0,Infinity),strafeStopping:num(raw.strafeStopping,num(raw.stopping,0,0,Infinity),0,Infinity),headingP:num(raw.headingP,1.6,0,Infinity)};}
  // Values a team would measure on the floor, taken from the simulated robot instead: speed at full
  // power, the time lost reaching cruise speed, and how far it rolls after power is cut (as time at cruise).
  function calibrate(tuning,drive,power=.45){const v=tuning.maxForward*power;
    return {forwardSpeed:+tuning.maxForward.toFixed(1),strafeSpeed:+tuning.maxStrafe.toFixed(1),startup:+Math.min(3,v/(2*Math.max(1,drive.accel))).toFixed(3),stopping:+Math.min(2,tuning.linearBrakeForward+tuning.quadraticBrakeForward*v).toFixed(3),
      strafeStopping:+Math.min(2,tuning.linearBrakeStrafe+tuning.quadraticBrakeStrafe*tuning.maxStrafe*power).toFixed(3)};}
  function powerFor(c,cruise){if(cruise<=0)return 0;const [t0,c0]=c[0];if(cruise<=c0)return cruise*t0/c0;
    for(let i=1;i<c.length;i++){const [ta,ca]=c[i-1],[tb,cb]=c[i];if(cruise<=cb)return ta+(tb-ta)*(cruise-ca)/(cb-ca);}const [tl,cl]=c[c.length-1];return tl+(cruise-cl);}
  function point(points,t){let p=points.map(q=>({...q}));while(p.length>1)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));return p[0];}
  function compile(route,raw={}){
    if(!route?.segments?.length)throw Error('Plan a route first.');const config=settings({...raw,power:route.defaultPower??raw.power}),steps=[],stops=route.stops||[],waits=new Map(stops.map(s=>[s.segment,s]));let to=0;let stopped=true,h=(route.heading||0)*Math.PI/180;
    for(const [index,segment]of route.segments.entries()){
      while(to<stops.length-1&&stops[to].segment<index)to++;
      const power=Number.isFinite(stops[to]?.path?.power)?clamp(stops[to].path.power,0,1):config.power;
      if(power===0){steps.push({kind:'disabled',forward:0,strafe:0,seconds:0,power:0,segment:index});break;}
      // Tank routes turn before every leg; holonomic turning routes only where the heading changes.
      if(Number.isFinite(segment.heading)){const next=segment.heading*Math.PI/180;if(route.nonholonomic||Math.abs(Math.atan2(Math.sin(next-h),Math.cos(next-h)))>1e-6){steps.push({kind:'turn',heading:next,forward:0,strafe:0,seconds:30,power,segment:index});stopped=true;}h=next;}const points=segment.points;if(!points?.length||points.some(p=>![p.x,p.y].every(Number.isFinite)))throw Error('The route has invalid points.');const length=points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-points[i].x,p.y-points[i].y),0),turning=Number.isFinite(segment.endHeading)&&Number.isFinite(segment.heading),count=Math.max(segment.type==='line'?1:Math.max(4,Math.ceil(length/5)),turning?Math.ceil(Math.abs(segment.endHeading-segment.heading)/10):1);let a=points[0];
      // A path the robot turns or spins along is driven in short pieces, each aimed at its share of the turn.
      while(to<stops.length-1&&stops[to].segment<index)to++;const moving=stops[to]?.path?.kind==='action'?String(stops[to].path.action||'Action path'):undefined,movingSeconds=moving&&Number.isFinite(stops[to].path.actionSeconds)?stops[to].path.actionSeconds:null,movingCell=stops[to]?.path?.cell==='other'?'other':'start',movingSteps=moving&&stops[to].path.steps?.length>1?stops[to].path.steps:null,rad=d=>d*Math.PI/180,at=t=>{if(segment.target){const p=point(points,t);return Math.atan2(segment.target.y-p.y,segment.target.x-p.x);}return rad(segment.heading+(segment.endHeading-segment.heading)*t);},pieces=segment.target?Math.max(count,Math.ceil(length/.5)):count;
      for(let i=1;i<=pieces;i++){if(turning)h=at((i-.5)/pieces);const b=point(points,i/pieces),dx=b.x-a.x,dy=b.y-a.y,forward=dx*Math.cos(h)+dy*Math.sin(h),left=-dx*Math.sin(h)+dy*Math.cos(h),fwd=Math.abs(forward)/(config.forwardSpeed*power),duration=fwd+Math.abs(left)/(config.strafeSpeed*power);
        // Turning back on itself (more than a right angle) the robot has to stop first: a short stop is planned there.
        {const prev=steps[steps.length-1];if(duration>1e-6&&prev&&!prev.kind&&(prev.forward||prev.strafe)&&!prev.moving&&!moving){const ph=prev.heading??h,px=prev.forward*Math.cos(ph)-prev.strafe*Math.sin(ph),py=prev.forward*Math.sin(ph)+prev.strafe*Math.cos(ph);if(px*dx+py*dy<0){steps.push({forward:0,strafe:0,seconds:Math.max(.15,config.rest??0),segment:index,settle:true});stopped=true;}}}
        if(duration>1e-6){steps.push({heading:turning?at(i/pieces):h,...(turning?{mid:h}:{}),...(moving?{moving,movingSeconds,movingCell,movingSteps,path:to}:{}),forward:forward/(config.forwardSpeed*duration),strafe:route.nonholonomic?0:left/(config.strafeSpeed*duration),seconds:duration+(stopped?config.startup:0),cruise:duration,forwardShare:fwd/duration,fromStop:stopped,power,segment:index});stopped=false;}a=b;}
      if(turning)h=rad(segment.endHeading);
      // At a pin: turn in place if it asks for a heading, then hold for its action and pause.
      const stop=waits.get(index);if(stop&&Number.isFinite(stop.turn)){const next=rad(stop.turn);if(Math.abs(Math.atan2(Math.sin(next-h),Math.cos(next-h)))>1e-6){steps.push({kind:'turn',heading:next,forward:0,strafe:0,seconds:30,power,segment:index});stopped=true;}h=next;}
      if(stop&&stop.wait>0){steps.push({forward:0,strafe:0,seconds:stop.wait,segment:index});stopped=true;}
      if(stop&&stop.action){const timed=Number.isFinite(stop.actionSeconds)&&stop.actionSeconds>0;steps.push({forward:0,strafe:0,seconds:timed?stop.actionSeconds:0,action:String(stop.action),forSeconds:timed,cell:stop.cell==='other'?'other':'start',...(stop.steps?.length>1?{steps:stop.steps}:{}),segment:index});stopped=true;}}
    // A leg (drive steps from a stop to a stop) at the power the curves were measured at takes the time the curves give for
    // its distance, shared across its steps.
    const moves=x=>x&&x.kind!=='turn'&&x.kind!=='disabled'&&(x.forward||x.strafe);
    if(config.forwardCurve)for(let i=0;i<steps.length;){if(!moves(steps[i])||!steps[i].fromStop){i++;continue;}let j=i;while(moves(steps[j+1])&&!steps[j+1].fromStop)j++;
      const leg=steps.slice(i,j+1),ends=!steps[j+1]||!moves(steps[j+1]);
      if(ends&&leg.every(x=>!x.moving&&Math.abs((x.power??config.power)-config.curvePower)<1e-6)){const cruise=leg.reduce((a,x)=>a+x.cruise,0),share=leg.reduce((a,x)=>a+x.cruise*x.forwardShare,0)/cruise,
          secs=share*powerFor(config.forwardCurve,cruise)+(1-share)*powerFor(config.strafeCurve,cruise);for(const x of leg){x.seconds=Math.max(.02,x.cruise*secs/cruise);x.fromCurve=true;}}
      i=j+1;}
    // Stop compensation: a drive step that ends in a stop ends early by the time the robot rolls on.
    for(let i=0;i<steps.length;i++){const s=steps[i],next=steps[i+1];if(!s.fromCurve&&s.kind!=='turn'&&(s.forward||s.strafe)&&(!next||next.kind==='turn'||(!next.forward&&!next.strafe))){const f=Math.abs(s.forward),l=Math.abs(s.strafe);s.seconds=Math.max(.02,s.seconds-(f*config.stopping+l*config.strafeStopping)/(f+l));}}
    for(const x of steps){delete x.cruise;delete x.forwardShare;delete x.fromStop;delete x.fromCurve;delete x.settle;}
    if(!steps.length)throw Error('The route has no movement.');return {heading:h,config,steps,duration:steps.some(s=>s.kind==='turn'||s.kind==='disabled')?null:steps.reduce((s,p)=>s+p.seconds,0)};
  }
  const configPower=c=>c.power;
  class Runner{
    constructor(route,config){this.plan=compile(route,config);this.index=0;this.elapsed=0;this.time=0;}
    // hold(step): true while a pin's action (shooting, for example) has not finished; the pin waits for it.
    advance(dt,imu,hold=null){
      this.time+=dt;this.elapsed+=dt*(this.share??1);this.share=1;let step=this.plan.steps[this.index];
      if(step?.kind==='disabled')return {done:false,drive:{forward:0,strafe:0,turn:0},segment:step.segment};
      if(step?.kind==='turn'){
        const error=Math.atan2(Math.sin(step.heading-imu),Math.cos(step.heading-imu)),rate=this.lastImu===undefined?0:Math.atan2(Math.sin(imu-this.lastImu),Math.cos(imu-this.lastImu))/dt;this.lastImu=imu;
        this.settled=Math.abs(error)<Math.PI/120&&Math.abs(rate)<.12?(this.settled||0)+dt:0;
        if(this.settled>=.15){this.index++;this.elapsed=0;this.settled=0;this.lastImu=undefined;step=this.plan.steps[this.index];}
        else{if(this.elapsed>=step.seconds)throw Error('IMU chassis turn did not settle within 30 seconds.');return {done:false,drive:{forward:0,strafe:0,turn:clamp(error*Math.max(.5,Math.min(3,this.plan.config.headingP))-rate*.08,-Math.min(.5,step.power??this.plan.config.power),Math.min(.5,step.power??this.plan.config.power))},segment:step.segment};}
      }else{
        let called=false;const busy=s=>{called=true;return hold?.(s,this.index);};
        while(step&&!['turn','disabled'].includes(step.kind)&&this.elapsed>=step.seconds&&!(step.action&&!step.forSeconds&&busy(step))){this.elapsed-=step.seconds;step=this.plan.steps[++this.index];called=false;}
        if(step?.action&&!called)hold?.(step,this.index);
        if(step?.action&&this.elapsed>step.seconds)this.elapsed=step.seconds;
        if(step?.kind==='disabled')return {done:false,drive:{forward:0,strafe:0,turn:0},segment:step.segment};
        if(step?.kind==='turn'){this.elapsed=0;return {done:false,drive:{forward:0,strafe:0,turn:0},segment:step.segment};}
      }
      if(!step)return {done:true,drive:{forward:0,strafe:0,turn:0}};
      const target=step.heading??this.plan.heading,error=Math.atan2(Math.sin(target-imu),Math.cos(target-imu)),turn=clamp(error*this.plan.config.headingP,-.5,.5);
      const gain=Math.max(1,(Math.abs(step.forward)+Math.abs(step.strafe)+Math.abs(turn))/Math.max(.000001,step.power??configPower(this.plan.config)));
      if(step.forward||step.strafe)this.share=1/gain;
      if(step.moving&&this.movingPath!==step.path){this.movingPath=step.path;this.movingStart=this.time;}
      const acting=step.moving&&!(step.movingSeconds>0&&this.time-this.movingStart>=step.movingSeconds)?step.moving:null;
      return {done:false,actingCell:step.movingCell,actingSteps:acting?step.movingSteps:null,drive:{forward:step.forward/gain,strafe:step.strafe/gain,turn:step.forward||step.strafe?turn/gain:0},wait:step.action!==undefined||(!step.forward&&!step.strafe)?{action:step.action||'',remaining:step.seconds-this.elapsed}:null,acting,segment:step.segment};
    }
  }
  return {settings,calibrate,compile,Runner};
});
