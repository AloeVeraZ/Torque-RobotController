'use strict';
// Pairs every numeric field with a touch slider so values can be set without a keyboard. The number
// box keeps exact entry; the slider updates it live and commits with a 'change' event on release.
// Range comes from data-slider-min/max/step, falling back to the field's own min/max/step.
// The box and its bar share a .num-field wrapper, so moving focus from one to the other keeps the
// pair together (:focus-within) instead of hiding the bar under the pointer. Compact rows that lay
// the bar out themselves (.sim-pin-row) and popovers keep them as plain siblings.
window.DeckNumberSliders=(()=>{
 const pairs=new Map();
 const read=(input,key,fallback)=>{const v=parseFloat(input.dataset['slider'+key]??input.getAttribute(key.toLowerCase()));return Number.isFinite(v)?v:fallback;};
 const nice=x=>{const p=10**Math.floor(Math.log10(x)),m=x/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p;};
 const decimals=step=>{const text=String(step);return text.includes('e-')?+text.split('e-')[1]:(text.split('.')[1]||'').length;};
 function sync(input){
  const range=pairs.get(input);if(!range)return;
  const min=read(input,'Min',0),max=Math.max(min+1e-6,read(input,'Max',min+100)),own=input.dataset.sliderStep??input.getAttribute('step'),step=own&&own!=='any'&&+own>0?+own:nice((max-min)/200);
  range.min=String(min);range.max=String(max);range.step=String(step);range.disabled=input.disabled||input.readOnly;range.hidden=input.hidden;
  const value=input.valueAsNumber;if(Number.isFinite(value))range.value=String(Math.min(max,Math.max(min,value)));
  fill(range);
 }
 // The filled part of the track, drawn by CSS from --fill.
 const fill=range=>range.style.setProperty('--fill',`${(+range.value-+range.min)/Math.max(1e-9,+range.max-+range.min)*100}%`);
 function pair(input){
  if(pairs.has(input)||input.dataset.slider==='off')return;
  const range=document.createElement('input');range.type='range';range.className='num-slider';if(input.id)range.id=input.id+'-slider';
  const label=(input.labels?.[0]?.textContent||input.getAttribute('aria-label')||input.title||'Value').trim();range.setAttribute('aria-label',label+' slider');
  range.addEventListener('input',()=>{fill(range);const v=+range.value;input.value=String(+v.toFixed(Math.min(6,decimals(range.step))));input.dispatchEvent(new Event('input',{bubbles:true}));});
  range.addEventListener('change',()=>{input.dispatchEvent(new Event('change',{bubbles:true}));if(input.dataset.sliderSubmit!==undefined)input.form?.requestSubmit();});
  range.addEventListener('pointerdown',()=>sync(input));
  input.addEventListener('input',()=>sync(input));input.addEventListener('change',()=>sync(input));
  if(input.closest('.sim-pin-row,.sim-popover')||input.dataset.sliderWrap==='off'||input.parentElement?.classList.contains('num-field'))input.after(range);
  else{const field=document.createElement('span');field.className='num-field';input.replaceWith(field);field.append(input,range);}
  pairs.set(input,range);sync(input);
 }
 const scan=root=>{for(const input of root.querySelectorAll('input[type=number]'))pair(input);};
 function refresh(){for(const input of pairs.keys())if(input.isConnected)sync(input);else pairs.delete(input);}
 function attach(root=document.body){
  // A typed number saves by itself: on Enter, on leaving the box, and a moment after the last keystroke when it is a
  // number inside the box's own range. There is no button to press. A box in a form is sent by its form.
  const saved=new WeakMap();let timer=0;
  root.addEventListener('focusin',event=>{if(event.target.matches?.('input[type=number]')&&!saved.has(event.target))saved.set(event.target,event.target.value);});
  root.addEventListener('change',event=>{if(event.target.matches?.('input[type=number]'))saved.set(event.target,event.target.value);},true);
  root.addEventListener('input',event=>{const input=event.target;if(!event.isTrusted||!input.matches?.('input[type=number]')||input.form||input.closest('#sim-effects'))return;clearTimeout(timer);
    timer=setTimeout(()=>{const v=input.valueAsNumber,min=parseFloat(input.min),max=parseFloat(input.max);
      if(!input.isConnected||document.activeElement!==input||!Number.isFinite(v)||Number.isFinite(min)&&v<min||Number.isFinite(max)&&v>max||saved.get(input)===input.value)return;
      const id=input.id;input.dispatchEvent(new Event('change',{bubbles:true}));
      // A panel that draws itself again keeps the box being typed in.
      if(id&&!input.isConnected){const next=document.getElementById(id);if(next?.matches('input[type=number]')&&!next.disabled)next.focus();}},900);});
  root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input[type=number]')&&!event.target.form){event.preventDefault();event.target.blur();}});
  scan(root);
  new MutationObserver(records=>{let removed=false;
   for(const record of records){
    if(record.type==='attributes'){if(pairs.has(record.target))sync(record.target);continue;}
    if(record.removedNodes.length)removed=true;
    for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches('input[type=number]'))pair(node);else scan(node);}
   }
   if(removed)for(const input of pairs.keys())if(!input.isConnected)pairs.delete(input);
  }).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','hidden','min','max','step','data-slider-min','data-slider-max','data-slider-step']});
 }
 return {attach,refresh,sync};
})();
