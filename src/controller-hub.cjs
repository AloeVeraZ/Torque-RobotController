'use strict';
const {Assignments}=require('../ui/controllers.js');
const {axes:calibratedAxes}=require('../ui/controller-calibration.js');
const key=p=>p?`${p.index}:${p.id}`:'';
const normalizeValues=(items,max,min=0)=>Array.isArray(items)?items.slice(0,max).map(v=>Number.isFinite(v)?Math.max(min,Math.min(1,v)):0):[];
const flags=(values,buttons,threshold)=>buttons.map((value,i)=>Array.isArray(values)&&i<values.length?values[i]===true:value>threshold);
// Every robot takes both controllers: Controller 2 is whatever second controller is plugged in, so there is nothing to
// choose per robot. setCount stays for anything that still asks for one.
class ControllerHub{
  constructor({hardware={},preferred=[],persist=()=>{},zoneFor=()=>0}={}){this.hardware=hardware;this.preferred=preferred;this.persist=persist;this.zoneFor=zoneFor;this.assignments=new Assignments();this.pads=[];this.count=2;this.capture=null;this.blocked=new Set();this.assignment=null;}
  axesActive(p){const zone=this.zoneFor(p.id);return zone>0&&p.mapping==='standard'&&p.axes.length>=2?calibratedAxes(p.axes,zone).some(v=>Math.abs(v)>0.08):p.axesActive;}
  setCount(count){if(![1,2].includes(count))throw Error('Choose one or two controllers.');this.count=count;}
  begin(slot,now=Date.now()){if(![1,2].includes(slot))throw Error('Choose controller 1 or controller 2.');this.capture={slot,deadline:now+15000,waiting:new Set(this.pads.filter(p=>p.pressed||this.axesActive(p)).map(key))};}
  automatic(){this.cancel();this.assignments=new Assignments();this.preferred=[null,null];this.ingest(this.pads);this.assignments.automaticUser1=true;this.persist(this.preferred);for(const p of this.assignments.snapshot(this.pads))if(p)this.blocked.add(key(p));}
  cancel(){this.capture=null;}
  // Only on an explicit choice (leaving keyboard mode): never promote Controller 2 on a disconnect.
  promote(){const a=this.assignments;if(a.users[1]!==null||a.users[2]===null)return;const p=this.pads.find(p=>p.index===a.users[2]&&p.id===a.identities[2]);if(p)a.assign(1,p);}
  tick(now=Date.now()){if(this.capture&&now>=this.capture.deadline)this.capture=null;}
  // pin: a device id (the keyboard) that must hold Controller 1 whenever it is present.
  ingest(values,{pin}={}){
    const seen=new Set();this.pads=Array.from(Array.isArray(values)?values:[]).slice(0,16).filter(p=>p&&p.connected&&Number.isInteger(p.index)&&p.index>=0&&p.index<16&&typeof p.id==='string'&&p.id.length<=2048&&!seen.has(p.index)&&seen.add(p.index)).map(p=>{const buttons=normalizeValues(p.buttons,24);return {id:p.id,index:p.index,mapping:p.mapping==='standard'?'standard':'',connected:true,pressed:!!p.pressed,axesActive:!!p.axesActive,axes:normalizeValues(p.axes,4,-1),buttons,buttonPressed:flags(p.buttonPressed,buttons,.5),buttonTouched:flags(p.buttonTouched,buttons,0)};});
    // Clear stale identities before restoring a saved choice, including when a
    // controller reconnects under a different browser index.
    for(const slot of [1,2])if(!this.pads.some(p=>p.index===this.assignments.users[slot]&&p.id===this.assignments.identities[slot])){this.assignments.users[slot]=null;this.assignments.identities[slot]=null;}
    this.tick();for(const p of this.pads)if(!p.pressed&&!this.axesActive(p))this.blocked.delete(key(p));
    if(this.capture){
      for(const p of this.pads)if(!p.pressed&&(p.mapping!=='standard'||!this.axesActive(p)))this.capture.waiting.delete(key(p));
      const selected=this.pads.find(p=>p.pressed&&!this.capture.waiting.has(key(p)));
      if(selected){const slot=this.capture.slot;this.assignments.assign(slot,selected,{swap:true});this.assignment={slot,id:selected.id,serial:(this.assignment?.serial||0)+1};this.capture=null;for(const p of this.assignments.snapshot(this.pads))if(p)this.blocked.add(key(p));this.preferred=this.assignments.snapshot(this.pads);this.persist(this.preferred);}
    }
    for(const slot of [1,2])if(this.assignments.users[slot]===null){const wanted=this.preferred[slot-1],pad=wanted&&this.pads.find(p=>p.id===wanted.id&&p.index===wanted.index)||wanted&&this.pads.find(p=>p.id===wanted.id);if(pad&&this.assignments.users[3-slot]!==pad.index)this.assignments.assign(slot,pad);}
    this.assignments.sync(this.pads,this.hardware);
    const pinned=pin&&this.pads.find(p=>p.id===pin);if(pinned&&(this.assignments.users[1]!==pinned.index||this.assignments.identities[1]!==pinned.id))this.assignments.assign(1,pinned);
    if(this.assignments.users[2]===null){const second=this.pads.find(p=>p.mapping==='standard'&&p.index!==this.assignments.users[1]);if(second)this.assignments.assign(2,second);}
    const present=new Set(this.pads.map(key));for(const blocked of this.blocked)if(!present.has(blocked))this.blocked.delete(blocked);
  }
  state(){const slots=this.assignments.snapshot(this.pads);return {count:this.count,slots,devices:this.pads.map(({id,index,mapping})=>({id,index,mapping})),readings:slots.map(slot=>slot?this.pads.find(p=>key(p)===key(slot)):null),automatic:this.assignments.automaticUser1,capture:this.capture?{slot:this.capture.slot,deadline:this.capture.deadline}:null,blocked:[...this.blocked],assignment:this.assignment};}
}
module.exports={ControllerHub};
