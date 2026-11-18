'use strict';
// Simulation utility process. The driver station's main process forks this only while the
// Simulation view is open, relays messages to and from the window, and kills it on exit, so
// physics and the Java controller process never run on the UI thread or outlive the view.
const {SimEngine}=require('./sim-engine.cjs'),{convertStep}=require('./sim-model.cjs'),path=require('node:path');
const port=process.parentPort,workDir=process.argv[2];
const engine=new SimEngine({workDir,emit:message=>port.postMessage(message)});
const calls={load:c=>engine.load(c),play:()=>{if(engine.mode!=='program'&&(!engine.practice||engine.practice.phase==='finished'))throw Error('Start a practice run first.');return engine.play();},pause:()=>engine.pause(),speed:s=>engine.setSpeed(s),practice:p=>engine.startPractice(p),practiceInput:p=>engine.practiceInput(p),
  run:p=>engine.run(p),calibrateTimed:power=>engine.timedCalibration(power),stop:()=>engine.stop(),reset:()=>engine.reset(),zones:z=>engine.setZones(z),start:s=>engine.setStart(s),step:n=>engine.step(Math.max(1,Math.min(600,n|0))),convertStep:file=>convertStep(file,path.join(__dirname,'../sim-runtime')),
  preview:p=>engine.preview(p),
  evaluate:candidates=>engine.evaluate(candidates,(index,total)=>port.postMessage({type:'optimize',index,total}))};
port.on('message',async({data})=>{
  const {id,method,args=[]}=data||{};
  if(method==='practice-input'){engine.practiceInput(args[0]);return;}
  try{if(!Object.hasOwn(calls,method))throw Error('Unknown simulator action.');const value=await calls[method](...args);port.postMessage({type:'reply',id,ok:true,value:value===undefined?null:value});}
  catch(e){port.postMessage({type:'reply',id,ok:false,error:e.message});}
});
process.on('exit',()=>engine.dispose());
port.postMessage({type:'host-ready'});
