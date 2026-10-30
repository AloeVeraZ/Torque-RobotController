// Report a bug (the bug icon beside ⋮, or in its menu): a title, what happened and up to 3 pictures (chosen, pasted or dropped). The main process sends it
// (src/bug-report.cjs); when it cannot, the same report can open on GitHub's new issue page.
(function(){
  'use strict';
  const MAX_IMAGES=3,MAX_BYTES=3*1024*1024,$=s=>document.querySelector(s),api=window.deck;
  const dialog=$('#bug-dialog');if(!dialog)return;
  let images=[];
  const say=(text,error=false)=>{const s=$('#bug-status');s.textContent=text;s.classList.toggle('error',error);};
  const report=()=>({title:$('#bug-title').value,body:$('#bug-body').value,images:images.map(({name,data})=>({name,data}))});
  function renderImages(){
    const list=$('#bug-images');list.replaceChildren(...images.map((image,i)=>{const li=document.createElement('li'),pic=document.createElement('img'),remove=document.createElement('button');
      pic.src=image.url;pic.alt=image.name;remove.type='button';remove.className='icon-button';remove.textContent='×';remove.title='Remove';remove.setAttribute('aria-label',`Remove ${image.name}`);
      remove.onclick=()=>{URL.revokeObjectURL(image.url);images.splice(i,1);renderImages();};li.append(pic,remove);return li;}));
    $('#bug-add').disabled=images.length>=MAX_IMAGES;}
  const base64=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
  async function addFiles(files){
    for(const file of files){if(!file.type.startsWith('image/'))continue;
      if(images.length>=MAX_IMAGES){say(`A report can have up to ${MAX_IMAGES} pictures.`,true);return;}
      if(file.size>MAX_BYTES){say(`${file.name||'That picture'} is over 3 MB.`,true);continue;}
      images.push({name:file.name||`picture-${images.length+1}.png`,data:await base64(file),url:URL.createObjectURL(file)});say('');}
    renderImages();}
  function reset(){for(const image of images)URL.revokeObjectURL(image.url);images=[];$('#bug-form').reset();$('#bug-browser').hidden=true;$('#bug-send').hidden=false;$('#bug-send').disabled=false;$('#bug-cancel').textContent='Cancel';say('');renderImages();}
  function close(){dialog.close();reset();void api.overlay(false).catch(()=>{});}
  const open=()=>{$('#menu').hidden=true;$('#more').setAttribute('aria-expanded','false');reset();dialog.showModal();void api.overlay(true).catch(()=>{});$('#bug-title').focus();};
  $('#menu-bug').onclick=open;$('#bug-quick').onclick=open;
  $('#bug-cancel').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('#bug-add').onclick=()=>$('#bug-file').click();$('#bug-file').onchange=e=>{void addFiles([...e.target.files]);e.target.value='';};
  dialog.addEventListener('paste',e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();void addFiles(files);}});
  dialog.addEventListener('dragover',e=>e.preventDefault());dialog.addEventListener('drop',e=>{e.preventDefault();void addFiles([...e.dataTransfer.files]);});
  $('#bug-form').onsubmit=e=>{e.preventDefault();void(async()=>{const send=$('#bug-send');send.disabled=true;say('Sending…');
    try{const result=await api.bugReport(report());if(result.sent){reset();say(`Sent. Thank you! It is report ${result.number}.`);$('#bug-send').hidden=true;$('#bug-cancel').textContent='Close';return;}
      say(`${result.reason} You can send it on GitHub instead (this needs a free GitHub account, and the report is public there).`,true);$('#bug-browser').hidden=false;}
    catch(error){say(error.message,true);}finally{send.disabled=false;}})();};
  $('#bug-browser').onclick=()=>void(async()=>{try{await api.bugReportBrowser(report());say('Opened on GitHub. Press Submit there to send it.');}catch(error){say(error.message,true);}})();
  renderImages();
})();
