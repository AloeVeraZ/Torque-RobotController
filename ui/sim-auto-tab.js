(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckAutoTab=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Calibrate → Autonomous: what Simulate planned and ran, sent to the real robot as its autonomous. The route, its
  // actions and the mechanisms' moves all come from Simulate (Run & review is where it is tried first); this step shows
  // what would be sent, opens Run & review to change it, and sends it. Send to robot asks for the name it shows under on
  // the Driver Station, in a pop-up, and remembers it with the route.
  //   o: {box, route() -> {name, paths, actions, seconds|null, problem ('' when it can be sent), report: {title, level}|null},
  //       supported() -> '' or why no autonomous is written for this robot, name: {get() -> text ('' = not named), set(text)},
  //       code() -> Promise<{files, name (the file), source, opMode (as the Driver Station shows it)}>,
  //       send(out) -> Promise<text>, sent: {get() -> text, set(text)}, connected(), busy() -> why not now or '', visible(),
  //       toRun() (opens Simulate → Run & review), saveFile(name, text) -> Promise<path|null>, copy(text)}
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sig=t=>{let h=5381;for(let i=0;i<t.length;i++)h=(h*33^t.charCodeAt(i))>>>0;return h.toString(36)+':'+t.length;};
  // A name the Driver Station can show: one line, no quotes or backslashes, 60 characters at most.
  const cleanName=t=>String(t??'').replace(/[\r\n\t"\\]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
  const defaultName=route=>cleanName(`${route?.name||'Planned route'} (Deck)`);
  const nameOf=(o,route)=>cleanName(o.name.get())||defaultName(route);
  // What the route is, in a line.
  function facts(r){const n=(k,one,many)=>`${k} ${k===1?one:many}`,out=[n(r.paths,'path','paths')];if(r.actions)out.push(n(r.actions,'action','actions'));if(Number.isFinite(r.seconds))out.push(`about ${r.seconds.toFixed(1)} s`);return out.join(' · ');}
  function create(o){const box=o.box;let sending=false,said='',savedNote='',drawn='',code=null,codeKey='',codeErr='',making=false;
    const lastSent=()=>{try{return JSON.parse(o.sent.get()||'null')||{};}catch{return {};}};
    // The code as it would be sent, made again whenever the route or its name changes.
    function make(route,name){const key=JSON.stringify([route.name,route.paths,route.actions,route.seconds,route.stamp,name]);if(key===codeKey||making)return;making=true;
      Promise.resolve().then(()=>o.code()).then(out=>{code=out;codeErr='';},e=>{code=null;codeErr=String(e?.message||e);}).finally(()=>{making=false;codeKey=key;render();});}
    const status=(route,name)=>{const last=lastSent();if(sending)return 'Sending it to the robot and building it there…';if(said)return said;
      if(code&&last.sig===sig(code.source))return `On the robot as “${last.name||name}”${last.at?`, sent ${last.at}`:''}. Pick it on the Driver Station under Autonomous.`;
      if(!o.connected())return 'No robot connected: plug in the Control Hub, or join its Wi-Fi.';const why=o.busy();if(why)return why;
      return last.sig?'The simulation changed since it was last sent.':'Not on the robot yet.';};
    function render(){const route=o.route(),why=o.supported(),name=nameOf(o,route),ok=!why&&!route.problem;if(ok)make(route,name);
      const can=ok&&!!code&&!sending,run=route.report?`Run &amp; review: ${esc(route.report.title)}`:'Not run in Run &amp; review yet: run it there first to see it finish before the real robot tries it.';
      const html=`<section class="cal-card rt-card at-card"><h2>Autonomous</h2><p class="hint">Everything in the simulation goes to the robot as its autonomous: the route, the actions along it and what the mechanisms do. Change it in Simulate and it changes here. The first time on the real robot, run it with the wheels off the ground.</p>
        <div class="at-route"><div class="at-facts"><b>${esc(route.name||'Route')}</b><span>${esc(route.paths?facts(route):'No paths yet')}</span><span class="at-run${route.report?.level?` ${esc(route.report.level)}`:''}">${run}</span></div><div class="button-row"><button type="button" class="secondary" data-at="run">Open Run &amp; review</button></div></div>
        ${why?`<p class="cal-sense-note bad">${esc(why)}</p>`:route.problem?`<p class="cal-sense-note bad">${esc(route.problem)}</p>`:codeErr?`<p class="cal-sense-note bad">${esc(codeErr)}</p>`:''}
        <div class="button-row rt-send"><button type="button" class="primary" data-at="send"${can?'':' disabled'}>${sending?'Sending…':'Send to robot'}</button><span class="hint at-named">Shows on the Driver Station as “${esc(name)}”. <button type="button" class="text-button" data-at="rename"${ok?'':' disabled'}>Rename…</button></span></div>
        <p class="hint" role="status" data-at-status>${esc(ok?status(route,name):'')}</p>
        <div class="button-row"><button type="button" class="secondary" data-at="save"${can?'':' disabled'}>Save as a file…</button><button type="button" class="secondary" data-at="copy"${can?'':' disabled'}>Copy</button><span class="hint" role="status" data-at-saved>${esc(savedNote)}</span></div>
        ${code&&ok?`<details class="usb-facts"><summary>See the code</summary><pre class="cal-cam-code cal-chassis-code" data-at-code>${esc(code.source)}</pre></details>`:''}</section>
        <dialog class="at-name" aria-labelledby="at-name-title"><form method="dialog"><h2 id="at-name-title">Name the autonomous</h2><p class="hint">This is the name it shows under on the Driver Station, in the Autonomous list.</p><div class="cal-field"><label for="at-name-input">Name</label><input id="at-name-input" type="text" maxlength="60" autocomplete="off" spellcheck="false"></div><div class="button-row"><button type="submit" value="go" class="primary" data-at-go>Send to robot</button><button type="submit" value="no" class="secondary">Cancel</button></div></form></dialog>`;
      // The same page again changes nothing: an open pop-up or the code being read is left alone.
      if(html!==drawn&&!box.querySelector?.('dialog[open]')){drawn=html;box.innerHTML=html;}}
    // The pop-up: the name, then what to do with it (send it, or only keep it).
    function ask(sendAfter){const d=box.querySelector('dialog.at-name');if(!d)return;const route=o.route(),input=d.querySelector('input'),go=d.querySelector('[data-at-go]');input.value=nameOf(o,route);go.textContent=sendAfter?'Send to robot':'Save the name';d.returnValue='';
      d.onclose=()=>{if(d.returnValue!=='go')return render();const next=cleanName(input.value);o.name.set(next===defaultName(route)?'':next);said='';codeKey='';code=null;drawn='';
        if(!sendAfter)return render();sending=true;render();
        Promise.resolve().then(()=>o.code()).then(out=>{code=out;codeKey='';return Promise.resolve(o.send(out)).then(t=>{o.sent.set(JSON.stringify({sig:sig(out.source),name:nameOf(o,o.route()),at:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}));said=t||'';});})
          .catch(e=>{said=`It did not get there: ${e?.message||e}`;}).finally(()=>{sending=false;drawn='';render();});};
      if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');input.focus();input.select?.();}
    box.addEventListener('click',e=>{const a=e.target.closest?.('[data-at]')?.dataset.at;if(!a)return;const note=t=>{savedNote=t;const n=box.querySelector('[data-at-saved]');if(n)n.textContent=t;drawn='';};
      if(a==='run')return void o.toRun?.();if(a==='send')return ask(true);if(a==='rename')return ask(false);if(!code)return;
      if(a==='save')return void Promise.resolve(o.saveFile(code.name,code.source)).then(f=>note(f?`Saved to ${f}`:''),x=>note(`It was not saved: ${x?.message||x}`));
      if(a==='copy')return void Promise.resolve(o.copy(code.source)).then(()=>note('Copied.'),()=>note('It could not be copied: open See the code and select it.'));});
    return {refresh:render,name:()=>nameOf(o,o.route())};}
  return {create,cleanName,defaultName,facts};});
