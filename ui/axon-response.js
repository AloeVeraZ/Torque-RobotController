(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckAxonResponse=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // What a servo does when told to move, for students to see it overshoot, swing back and settle. Torque cannot see a servo move, so this is a model and
  // measures nothing. Each real setting does what the firmware uses it for: Damping brakes against speed, PWM Power caps the motor, and Sensitivity is a
  // band around the target where the error counts as none. The motor is a plain DC motor behind a gearbox. How big each effect is on a real servo is an
  // assumption: the factory Damping is critically damped with no load, and the bands keep the firmware's ratios but their size in degrees is a guess.
  const SPEED=500,TAU=.03,KP=1/15,KD=(2*Math.sqrt(KP*SPEED/TAU)*TAU-1)/SPEED,STEP=.0005,LONGEST=8;
  const LOADS=[{title:'No load',mass:1},{title:'Small arm',mass:2},{title:'Medium arm',mass:4},{title:'Long arm',mass:8}];
  const TOLERANCES=[.5,1,2,3,5,10],DEFAULT_LOAD=2,DEFAULT_MOVE=45,DEFAULT_TOLERANCE=2,MOVE={key:'move',min:10,max:180};
  const SENS_V2=[150,100,50,25];

  // The band around the target, in degrees. V1 stores (position + 1) << 4, Ultra High first; V2 stores 150, 100, 50, 25, Low first.
  const bandOf=(family,index)=>family==='v1'?(index+1)*.25:SENS_V2[index]/100;
  const zetaOf=({damping,factory,mass})=>{const tau=TAU*mass,kd=KD*damping/factory;return (1+kd*SPEED)/tau/(2*Math.sqrt(KP*SPEED/tau));};
  const shape=z=>z<.2?'Light damping':z<.9?'Heavy damping':z<=1.15?'Critical damping':'Overdamping';

  function simulate({damping,factory,pwm,band,mass,move}){
    const cap=pwm/255,tau=TAU*mass,kd=KD*damping/factory,samples=[];let p=0,v=0,last=0,still=0,t=0;
    for(let i=0;t<LONGEST;i++,t=i*STEP){
      const e=move-p,seen=Math.abs(e)<band?0:e,u=Math.max(-cap,Math.min(cap,KP*seen-kd*v));
      v+=(u*SPEED-v)/tau*STEP;p+=v*STEP;
      if(i%4===0)samples.push([t,p]);
      if(Math.abs(v)>.5){last=t;still=0;}else if((still+=STEP)>.15&&seen===0)break;
    }
    return {samples,move,lastMove:last,zeta:zetaOf({damping,factory,mass}),rest:Math.abs(move-p),end:niceEnd(last)};
  }
  function niceEnd(last){for(const e of [.5,.75,1,1.5,2,3,4,6,8])if(last*1.12<=e)return e;return 8;}

  function measure(r,tol){
    const {samples,move}=r;let peak=-Infinity,peakAt=0;for(const [t,p] of samples)if(p>peak){peak=p;peakAt=t;}
    const overshoot=peak-move>.05?peak-move:0;let undershoot=0,undershootAt=null,low=Infinity;
    // Short of the target again, on the way back from overshooting.
    if(overshoot)for(const [t,p] of samples)if(t>peakAt&&p<low){low=p;if(move-p>.05){undershoot=move-p;undershootAt=t;}}
    let settle=null;if(Math.abs(samples[samples.length-1][1]-move)<=tol){settle=0;for(let i=samples.length-1;i>=0;i--)if(Math.abs(samples[i][1]-move)>tol){settle=(samples[i+1]||samples[i])[0];break;}}
    return {overshoot,overshootAt:overshoot?peakAt:null,percent:overshoot/move*100,undershoot,undershootAt,settle,rest:r.rest,peak};
  }

  function plot(r,tol){
    const W=660,H=268,L=48,R=632,T=14,B=226,m=measure(r,tol),{move,end}=r,top=Math.max(move*1.25,m.peak*1.1,move+tol*1.5);
    const num=v=>+v.toFixed(1),x=t=>num(L+Math.min(t,end)/end*(R-L)),y=v=>num(B-v/top*(B-T)),parts=[];
    for(const v of [0,.5,1,1.5].map(f=>f*move).filter(v=>v<=top)){parts.push(`<line class="axon-try-grid" x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}"/><text class="axon-try-tick" x="${L-8}" y="${y(v)+4}" text-anchor="end">${num(v)}°</text>`);}
    const step=end<=.5?.1:end<=1?.2:end<=2?.5:end<=4?1:2;for(let i=0;i*step<=end+1e-9;i++){const t=i*step;parts.push(`<line class="axon-try-grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${B}"/><text class="axon-try-tick" x="${x(t)}" y="${B+16}" text-anchor="middle">${num(t)}</text>`);}
    parts.push(`<rect class="axon-try-band" x="${L}" y="${y(move+tol)}" width="${R-L}" height="${num(y(move-tol)-y(move+tol))}"/>`);
    // Past the target and short of it again, once the servo has reached it.
    const shown=r.samples.filter(s=>s[0]<=end);if(shown[shown.length-1][0]<end)shown.push([end,shown[shown.length-1][1]]);const every=Math.max(1,Math.floor(shown.length/400));let zone=[],side=0;const close=()=>{if(zone.length>1)parts.push(`<polygon class="axon-try-${side>0?'past':'short'}" points="${zone.join(' ')}"/>`);zone=[];};
    let reached=false;for(let i=0;i<shown.length;i+=every){const [t,p]=shown[i],s=p>=move?1:-1;if(!reached){if(s<0)continue;reached=true;}if(s!==side){close();side=s;zone.push(`${x(t)},${y(move)}`);}zone.push(`${x(t)},${y(p)}`);}close();
    parts.push(`<line class="axon-try-target" x1="${L}" x2="${R}" y1="${y(move)}" y2="${y(move)}"/><polyline class="axon-try-curve" points="${shown.filter((s,i)=>i%every===0||i===shown.length-1).map(([t,p])=>`${x(t)},${y(p)}`).join(' ')}"/>`);
    const mark=(cls,t,v,text,below)=>{const px=x(t),py=y(v),start=px<R-120;parts.push(`<circle class="axon-try-${cls}" cx="${px}" cy="${py}" r="4"/><text class="axon-try-note" x="${start?px+8:px-8}" y="${num(Math.max(T+10,Math.min(B-4,py+(below?14:-6))))}" text-anchor="${start?'start':'end'}">${text}</text>`);};
    if(m.overshoot)mark('over',m.overshootAt,m.peak,`Overshoot +${m.overshoot.toFixed(1)}°`);
    if(m.undershoot>=.1)mark('under',m.undershootAt,move-m.undershoot,`Undershoot −${m.undershoot.toFixed(1)}°`,true);
    if(m.settle!==null&&m.settle<=end){const px=x(m.settle),start=px<R-130;parts.push(`<line class="axon-try-settled" x1="${px}" x2="${px}" y1="${y(move)}" y2="${B}"/><text class="axon-try-note" x="${start?px+6:px-6}" y="${B-6}" text-anchor="${start?'start':'end'}">Inside ±${tol}° at ${m.settle.toFixed(2)} s</text>`);}
    parts.push(`<text class="axon-try-tick" x="${R}" y="${y(move+tol)-4}" text-anchor="end">Target ${num(move)}°</text><text class="axon-try-tick" x="${(L+R)/2}" y="${H-6}" text-anchor="middle">Time (seconds)</text><text class="axon-try-tick" x="${L}" y="10">Position</text>`);
    return `<svg class="axon-try-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${shape(r.zeta)}. Overshoot ${m.overshoot.toFixed(1)} degrees, undershoot ${m.undershoot.toFixed(1)} degrees, ${m.settle===null?`never inside plus or minus ${tol} degrees`:`inside plus or minus ${tol} degrees at ${m.settle.toFixed(2)} seconds`}.">${parts.join('')}</svg>`;
  }
  // ---- A Test: a run of moves the servo really made. targets are [time s, degrees] from the pulses Torque sent; the position is the same
  // model as above, following those targets. Degrees from centre are the pulse's distance from 1500 µs times degPerUs.
  function track({damping,factory,pwm,band,mass,targets,until}){
    const cap=pwm/255,tau=TAU*mass,kd=KD*damping/factory,samples=[];if(!targets.length)return samples;let p=targets[0][1],v=0,k=0;
    for(let i=0,t=0;t<=until;i++,t=i*STEP){while(k+1<targets.length&&targets[k+1][0]<=t)k++;const goal=targets[k][1],e=goal-p,seen=Math.abs(e)<band?0:e,u=Math.max(-cap,Math.min(cap,KP*seen-kd*v));
      v+=(u*SPEED-v)/tau*STEP;p+=v*STEP;if(i%8===0)samples.push([t,p]);}
    return samples;
  }
  // Each move: how far it passed its target, how far short it came back, and when it stayed inside the tolerance.
  function measureMoves(samples,targets,tol){
    const out=[];for(let k=1;k<targets.length;k++){const [t0,goal]=targets[k],from=targets[k-1][1],end=k+1<targets.length?targets[k+1][0]:Infinity,dir=Math.sign(goal-from)||1,seg=samples.filter(([t])=>t>=t0&&t<end);if(!seg.length)continue;
      let peak=-Infinity,peakAt=t0;for(const [t,p] of seg){const past=(p-goal)*dir;if(past>peak){peak=past;peakAt=t;}}const overshoot=peak>.05?peak:0;
      let undershoot=0,underAt=null;if(overshoot)for(const [t,p] of seg)if(t>peakAt){const short=(goal-p)*dir;if(short>undershoot+1e-9){undershoot=short;underAt=t;}}
      let settle=null;if(Math.abs(seg[seg.length-1][1]-goal)<=tol){settle=0;for(let i=seg.length-1;i>=0;i--)if(Math.abs(seg[i][1]-goal)>tol){settle=(seg[i+1]||seg[i])[0]-t0;break;}}
      out.push({index:k,from,goal,move:Math.abs(goal-from),overshoot,overshootAt:overshoot?peakAt:null,peak:goal+dir*overshoot,undershoot:undershoot>=.1?undershoot:0,undershootAt:underAt,under:goal-dir*undershoot,settle,settleAt:settle===null?null:t0+settle});}
    return out;
  }
  // The graph: the position sent (real), the modelled servo, and the current the programmer measured (real), on one time axis.
  function plotRun({targets,until,model,current,tol,moves,done,span=[]}){
    const W=660,H=300,L=46,R=606,T=12,B=258,num=v=>+v.toFixed(1),degs=[...span,...targets.map(t=>t[1]),...model.map(m=>m[1])];
    let lo=Math.min(...degs),hi=Math.max(...degs);const pad=Math.max(5,(hi-lo)*.15);lo-=pad;hi+=pad;
    const amp=Math.max(1,...current.map(c=>c[1])),x=t=>num(L+Math.min(t,until)/until*(R-L)),y=v=>num(B-(v-lo)/(hi-lo)*(B-T)),ya=a=>num(B-a/amp*(B-T)*.45),parts=[];
    const stepDeg=[1,2,5,10,15,20,30,45,60,90].find(s=>(hi-lo)/s<=6)||90;for(let v=Math.ceil(lo/stepDeg)*stepDeg;v<=hi;v+=stepDeg)parts.push(`<line class="axon-try-grid" x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}"/><text class="axon-try-tick" x="${L-6}" y="${y(v)+4}" text-anchor="end">${num(v)}°</text>`);
    const ts=until<=2?.5:until<=5?1:until<=12?2:5;for(let t=0;t<=until+1e-9;t+=ts)parts.push(`<line class="axon-try-grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${B}"/><text class="axon-try-tick" x="${x(t)}" y="${B+16}" text-anchor="middle">${num(t)}</text>`);
    for(let a=0;a<=amp+1e-9;a+=amp>2?1:.5)parts.push(`<text class="axon-try-tick axon-try-amp" x="${R+6}" y="${ya(a)+4}">${a.toFixed(1)} A</text>`);
    const shown=t=>t<=(done?until:Math.max(...current.map(c=>c[0]),targets[targets.length-1][0]));
    if(done)for(let k=0;k<targets.length;k++){const t0=targets[k][0],t1=k+1<targets.length?targets[k+1][0]:until,g=targets[k][1];parts.push(`<rect class="axon-try-band" x="${x(t0)}" y="${y(g+tol)}" width="${num(x(t1)-x(t0))}" height="${num(y(g-tol)-y(g+tol))}"/>`);}
    if(current.length>1)parts.push(`<polyline class="axon-try-current" points="${current.map(([t,a])=>`${x(t)},${ya(a)}`).join(' ')}"/>`);
    const stairs=[];targets.forEach(([t,g],k)=>{if(k)stairs.push(`${x(t)},${y(targets[k-1][1])}`);stairs.push(`${x(t)},${y(g)}`);});stairs.push(`${x(Math.min(until,done?until:Math.max(targets[targets.length-1][0],...current.map(c=>c[0]))))},${y(targets[targets.length-1][1])}`);
    parts.push(`<polyline class="axon-try-target" points="${stairs.join(' ')}"/>`);
    const curve=model.filter(([t])=>shown(t)),every=Math.max(1,Math.floor(curve.length/500));if(curve.length>1)parts.push(`<polyline class="axon-try-curve" points="${curve.filter((m,i)=>i%every===0||i===curve.length-1).map(([t,p])=>`${x(t)},${y(p)}`).join(' ')}"/>`);
    if(done)for(const m of moves){const note=(cls,t,v,text,below)=>{const px=x(t),start=px<R-120;parts.push(`<circle class="axon-try-${cls}" cx="${px}" cy="${y(v)}" r="4"/><text class="axon-try-note" x="${start?px+7:px-7}" y="${num(Math.max(T+10,Math.min(B-4,y(v)+(below?14:-6))))}" text-anchor="${start?'start':'end'}">${text}</text>`);};
      if(m.overshoot)note('over',m.overshootAt,m.peak,`+${m.overshoot.toFixed(1)}°`,m.goal<m.from);if(m.undershoot)note('under',m.undershootAt,m.under,`−${m.undershoot.toFixed(1)}°`,m.goal>m.from);}
    parts.push(`<text class="axon-try-tick" x="${(L+R)/2}" y="${H-4}" text-anchor="middle">Time (seconds)</text>`);
    return `<svg class="axon-try-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Test of ${targets.length-1} ${targets.length===2?'move':'moves'}${done?'':', running'}">${parts.join('')}</svg>`;
  }
  return {LOADS,TOLERANCES,DEFAULT_LOAD,DEFAULT_MOVE,DEFAULT_TOLERANCE,MOVE,bandOf,zetaOf,shape,simulate,measure,plot,track,measureMoves,plotRun};
});
