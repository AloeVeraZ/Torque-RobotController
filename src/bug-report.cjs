'use strict';
// A bug report from the app (⋮ → Report a bug): its text and up to 3 pictures, with the app version and system. It goes to
// the relay in package.json bugReportUrl (tools/bug-report-relay), which holds the GitHub token: a token inside the app could
// be read by anyone who has it. With no relay, or when it cannot be reached, the report opens on GitHub's new issue page.
const MAX_IMAGES=3,MAX_IMAGE_BYTES=3*1024*1024,MAX_TITLE=120,MAX_BODY=10000,MAX_URL_BODY=4000;
const TYPES=[['png',b=>b[0]===0x89&&b.toString('latin1',1,4)==='PNG'],['jpg',b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff],['webp',b=>b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP'],['gif',b=>b.toString('latin1',0,3)==='GIF']];
const imageType=bytes=>TYPES.find(([,test])=>bytes.length>12&&test(bytes))?.[0]||null;
// Checks what the window sends; a problem is said in words the person can act on.
function clean(report){
  const title=String(report?.title??'').trim(),body=String(report?.body??'').trim(),images=Array.isArray(report?.images)?report.images:[];
  if(!title)throw Error('Give the report a short title.');if(title.length>MAX_TITLE)throw Error(`Keep the title under ${MAX_TITLE} characters.`);
  if(!body)throw Error('Say what happened.');if(body.length>MAX_BODY)throw Error(`Keep the description under ${MAX_BODY} characters.`);
  if(images.length>MAX_IMAGES)throw Error(`A report can have up to ${MAX_IMAGES} pictures.`);
  return {title,body,images:images.map(image=>{const data=String(image?.data??''),bytes=Buffer.from(data,'base64'),type=imageType(bytes);
    if(!type)throw Error(`${image?.name||'That file'} is not a PNG, JPEG, WebP or GIF picture.`);if(bytes.length>MAX_IMAGE_BYTES)throw Error(`${image?.name||'A picture'} is over 3 MB.`);
    return {name:String(image.name||'picture').slice(0,80),type,data,bytes};})};}
// Sends it to the relay: {sent:true,number} or {sent:false,reason}.
async function send(report,{url,about,fetcher=fetch,timeoutMs=60000}){
  const r=clean(report);if(!url)return {sent:false,reason:'Automatic sending is not set up in this version.'};
  try{const res=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({title:r.title,body:r.body,about,images:r.images.map(({name,data})=>({name,data}))})});
    const answer=await res.json().catch(()=>({}));if(res.ok&&answer.ok)return {sent:true,number:answer.number};
    return {sent:false,reason:answer.error||`The report service answered ${res.status}.`};}
  catch(e){return {sent:false,reason:e.name==='TimeoutError'?'The report service took too long to answer.':'Could not reach the report service. Check the internet connection.'};}}
// GitHub's new issue page with the text filled in; pictures have to be dragged in there, so they are saved for that.
function issueUrl(report,{repo,about}){const r=clean(report),name=String(repo).replace(/^.*github\.com[/:]/,'').replace(/\.git$/,'');
  const body=`${r.body.slice(0,MAX_URL_BODY)}${r.body.length>MAX_URL_BODY?'\n\n(cut short: paste the rest here)':''}\n\n---\n${about}${r.images.length?`\n\nDrag the ${r.images.length===1?'picture':`${r.images.length} pictures`} from the folder Torque just opened into this box.`:''}`;
  return `https://github.com/${name}/issues/new?${new URLSearchParams({title:r.title,body})}`;}
const about=({version,channel,platform,arch,release})=>`Torque ${version} (${channel}) on ${platform} ${release} ${arch}`;
module.exports={clean,send,issueUrl,about,imageType,MAX_IMAGES,MAX_IMAGE_BYTES};
