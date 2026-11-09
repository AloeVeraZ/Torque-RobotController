(function(){
  'use strict';
  // The list a motor or servo model is picked from, with a picture of what is under the pointer, on whichever side of the list has
  // room. The <select> stays as it is, so the keyboard, its change event and everything reading its value work as before.
  const A=()=>window.DeckDeviceArt,H=()=>window.DeckHardware,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SELECTS='select[data-wire-model],select[data-m-f="model"],select[data-wire-sensor-pick]',tagOf=value=>H()?.pictureTag?.(value)||'';
  function install({photo}){let menu=null,tip=null;const photos=new Map();
    const picture=tag=>{const key=A().photoKey(tag);if(!photo||!A().photoOf(key))return Promise.resolve(null);if(!photos.has(key))photos.set(key,Promise.resolve(photo(key)).catch(()=>null).then(u=>{if(!u)photos.delete(key);return u;}));return photos.get(key);};
    const figure=(tag,cls)=>tag?`<span class="ce-fig ${cls}" data-fig="${esc(tag)}">${A().svg(tag,{title:false})}</span>`:`<span class="ce-fig empty ${cls}"></span>`;
    const dress=root=>{for(const f of root.querySelectorAll('[data-fig]'))void picture(f.dataset.fig).then(url=>{if(!url||!f.isConnected)return;const img=document.createElement('img'),o=A().photoOf(f.dataset.fig);img.alt='';img.src=url;if(o?.caption)img.title=`${o.caption} · ${o.site}`;if(o?.kind==='component-photo'){const tag=document.createElement('span');tag.className='sim-photo-kind';tag.textContent=o.shows?`Part it uses: ${o.shows}`:'Part it uses';tag.title=img.title;f.append(tag);}f.replaceChildren(img);f.classList.add('photo');});};
    window.DeckPartPicker.dress=dress;
    const hideTip=()=>{tip?.remove();tip=null;};
    // Beside what it describes, on the side with room, and level with the row under the pointer.
    function showTip(tag,beside,row){if(!tag)return hideTip();if(tip?.dataset.tag!==tag){hideTip();tip=document.createElement('div');tip.className='ce-tip';tip.dataset.tag=tag;tip.innerHTML=figure(tag,'big');document.body.append(tip);dress(tip);}
      const w=tip.offsetWidth,h=tip.offsetHeight,b=beside.getBoundingClientRect(),r=row.getBoundingClientRect(),right=innerWidth-b.right-8,left=b.left-8;tip.style.left=(right>=w||right>=left?Math.min(b.right+8,innerWidth-w-8):Math.max(8,b.left-8-w))+'px';tip.style.top=Math.max(8,Math.min(r.top+r.height/2-h/2,innerHeight-h-8))+'px';}
    function close(){if(!menu)return;const m=menu;menu=null;m.backdrop.remove();m.remove();hideTip();m.select?.isConnected&&m.select.focus();}
    function open(select){close();const m=document.createElement('div'),backdrop=document.createElement('div'),now=select.value;m.className='ce-menu';m.setAttribute('role','listbox');backdrop.className='ce-backdrop';
      const option=o=>{const tag=tagOf(o.value);return `<button type="button" role="option" class="ce-option${o.value===now?' chosen':''}" data-pick="${esc(o.value)}" data-tip-tag="${esc(tag)}" aria-selected="${o.value===now}"${o.disabled?' disabled':''}>${figure(tag,'small')}<span><b>${esc(o.textContent)}</b></span></button>`;};
      m.innerHTML=[...select.children].map(c=>c.tagName==='OPTGROUP'?`<h4>${esc(c.label)}</h4>${[...c.children].map(option).join('')}`:option(c)).join('');
      m.onclick=e=>{const b=e.target.closest('[data-pick]');if(!b)return;const v=b.dataset.pick;close();if(v!==now){select.value=v;select.dispatchEvent(new Event('change',{bubbles:true}));}};
      m.onpointerover=e=>{const b=e.target.closest('[data-tip-tag]');if(b)showTip(b.dataset.tipTag,m,b);};m.onpointerleave=hideTip;
      m.onkeydown=e=>{const all=[...m.querySelectorAll('[data-pick]:not(:disabled)')],i=all.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=all[Math.max(0,Math.min(all.length-1,(i<0?0:i)+(e.key==='ArrowDown'?1:-1)))];next?.focus();if(next)showTip(next.dataset.tipTag,m,next);}};
      backdrop.onpointerdown=close;document.body.append(backdrop,m);menu=m;m.select=select;m.backdrop=backdrop;dress(m);
      const r=select.getBoundingClientRect(),w=Math.max(r.width,300),below=innerHeight-r.bottom-12,above=r.top-12;m.style.width=w+'px';m.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+'px';m.style.maxHeight=Math.max(below,above)+'px';if(below>=above)m.style.top=r.bottom+6+'px';else m.style.bottom=innerHeight-r.top+6+'px';
      (m.querySelector('.chosen')||m.querySelector('[data-pick]'))?.focus();}
    document.addEventListener('mousedown',e=>{const s=e.button===0&&e.target.closest?.(SELECTS);if(!s||s.disabled)return;e.preventDefault();s.focus();open(s);},true);
    // Hovering the closed list shows the model it has.
    document.addEventListener('pointermove',e=>{if(menu)return;const s=e.target.closest?.(SELECTS),card=e.target.closest?.('[data-tip-tag]');if(s&&tagOf(s.value))showTip(tagOf(s.value),s,s);else if(card)showTip(card.dataset.tipTag,card,card);else if(tip)hideTip();});}
  window.DeckPartPicker={install};
})();
