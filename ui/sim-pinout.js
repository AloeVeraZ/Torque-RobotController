(function(){
  'use strict';
  // Get pinout in Configure: the same wiring sheet as the Driver Hub's Configure Robot, to zoom around and save as a picture.
  const P=()=>window.DeckPinout,A=()=>window.DeckDeviceArt,C=()=>window.DeckRobotConfig;
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button=(cls,text,fn,label)=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;if(label)b.setAttribute('aria-label',label);return b;};
  const photos=new Map();let dialog=null,url=null,drawing=false;
  function photoOf(tag,load){const art=A().photoOf(tag);if(!art||!load)return Promise.resolve(null);
    if(!photos.has(tag))photos.set(tag,Promise.resolve(load(tag)).then(u=>u?P().shrink(u,art.mask):null).catch(()=>null).then(v=>{if(!v)photos.delete(tag);return v;}));
    return photos.get(tag);}
  async function savePicture(kind,{name,sheet,write,told}){const file=`${name} pinout`;
    try{const blob=kind==='svg'?new Blob([sheet.svg],{type:'image/svg+xml'}):await P().png(url,sheet);
      if(write){const where=await write({name:file,kind,data:kind==='svg'?sheet.svg:await P().base64(blob)});if(where)told.textContent=`Saved ${where}`;return;}
      const a=el('a');a.href=URL.createObjectURL(blob);a.download=`${file}.${kind}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }catch(e){told.textContent=e.message;}}
  async function show({name,config,unsaved=false,photo,save,back}){
    if(drawing)return;drawing=true;
    try{
      const tags=[...new Set([...config.devices,...(config.other||[])].map(d=>d.tag))],hubs=(config.hubs||[]).map(h=>h.tag==='ServoHub'?'#ServoHub':h.parent?'#ControlHub':'#ExpansionHub'),pictures={};
      await Promise.all([...tags,...new Set(hubs)].map(async t=>{const u=await photoOf(t,photo);if(u)pictures[t]=u;}));
      const sheet=P().build({...config,name,photos:pictures,java:d=>C().javaFor({...d,kind:C().kindOf(d.tag)}).type});
      if(!dialog){dialog=el('dialog','sim-pinout-dialog');dialog.id='sim-pinout';dialog.setAttribute('aria-labelledby','sim-pinout-title');document.body.append(dialog);}
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([sheet.svg],{type:'image/svg+xml'}));
      const title=el('h2','',`Pinout · ${name}`),told=el('p','hint');title.id='sim-pinout-title';told.setAttribute('role','status');
      const head=el('div','sim-pinout-head');head.append(title,button('primary','Save PNG',()=>void savePicture('png',{name,sheet,write:save,told})),button('secondary','Save SVG',()=>void savePicture('svg',{name,sheet,write:save,told})),button('icon-button','×',()=>dialog.close(),'Close the pinout'));
      const notes=[];if(unsaved)notes.push(el('p','pin-note','This shows your changes before they are saved to the robot.'));
      for(const w of sheet.warnings)notes.push(el('p','pin-note bad',`⚠ ${w}`));
      const img=el('img','pin-sheet');img.src=url;img.alt=`Wiring diagram of ${name}: ${sheet.rows.length} connections`;
      const view=el('div','pin-view');view.tabIndex=0;view.setAttribute('aria-label','Wiring diagram. Scroll to move around.');view.append(img);
      const label=el('span','pin-zoom-label');let at=0;
      const zoom=z=>{const fit=Math.max(.1,(view.clientWidth-20)/sheet.width);at=z===0?0:Math.max(.1,Math.min(3,z));const now=at||fit;img.style.width=`${Math.round(sheet.width*now)}px`;label.textContent=at?`${Math.round(now*100)}%`:`Fit · ${Math.round(now*100)}%`;};
      const tools=el('div','pin-tools');tools.append(button('secondary','Fit',()=>zoom(0)),button('secondary','−',()=>zoom((at||view.clientWidth/sheet.width)/1.25),'Zoom out'),button('secondary','+',()=>zoom((at||view.clientWidth/sheet.width)*1.25),'Zoom in'),button('secondary','100%',()=>zoom(1)),label,told);
      dialog.replaceChildren(head,...notes,tools,view);dialog.onclose=()=>{dialog.replaceChildren();if(url)URL.revokeObjectURL(url);url=null;back?.();};
      dialog.showModal();requestAnimationFrame(()=>zoom(0));
    }finally{drawing=false;}
  }
  window.DeckPinoutView={show};
})();
