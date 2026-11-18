'use strict';
// Route planning runs here so a large visibility graph cannot stall the driver station UI.
// A route that cannot keep clear of everything still comes back, driven on physics: its blocked paths are listed in
// result.unclear (ui/sim-planner.js planLoose). Only what physics cannot settle comes back as an error.
importScripts('vendor/planning.js','sim-planner.js');
onmessage=event=>{const {id,project,footprint,fieldZones,field}=event.data||{};try{postMessage({id,result:DeckPlanner.plan(project,footprint,fieldZones,field)});}catch(error){let issues=[];try{issues=DeckPlanner.analyze(project,footprint,fieldZones,field,true);}catch{}
  try{postMessage({id,result:DeckPlanner.planLoose(project,footprint,fieldZones,field,issues)});}catch{postMessage({id,error:error.message,issues});}}};
