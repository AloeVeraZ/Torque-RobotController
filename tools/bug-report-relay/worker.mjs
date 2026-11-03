// Bug reports from the Torque app become GitHub issues. Runs on Cloudflare Workers' free plan, which has no card on file and
// simply refuses requests past its limit. It holds the GitHub token, so the app does not have to. See docs/BUG_REPORTS.md.
// Secrets: GITHUB_TOKEN. Vars: REPO ("owner/name"). KV namespace (optional, recommended): LIMITS.
const MAX_IMAGES=3,MAX_IMAGE_BYTES=3*1024*1024,MAX_REQUEST=14*1024*1024,PER_IP_PER_HOUR=5,PER_DAY=50;
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const fail=(status,error)=>json(status,{ok:false,error});
const fromBase64=data=>Uint8Array.from(atob(data),c=>c.charCodeAt(0));
const text=(bytes,a,b)=>String.fromCharCode(...bytes.slice(a,b));
function imageType(b){if(b.length<=12)return null;if(b[0]===0x89&&text(b,1,4)==='PNG')return 'png';if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'jpg';if(text(b,0,4)==='RIFF'&&text(b,8,12)==='WEBP')return 'webp';if(text(b,0,3)==='GIF')return 'gif';return null;}
// A report cannot ping anyone or link other issues: mentions and issue numbers are broken up.
const quiet=s=>String(s).replace(/@/g,'@​').replace(/#(\d)/g,'#​$1');
// Counts in KV: one key per IP per hour, one per day. Without KV the limits hold per running copy of the worker only.
const memory=new Map();
async function bump(env,key,ttl){const now=env.LIMITS?+(await env.LIMITS.get(key))||0:memory.get(key)||0;if(env.LIMITS)await env.LIMITS.put(key,String(now+1),{expirationTtl:ttl});else memory.set(key,now+1);return now+1;}
async function github(env,path,method,body){
  const res=await fetch(`https://api.github.com/repos/${env.REPO}${path}`,{method,headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'torque-bug-report-relay','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok)throw Error(`GitHub answered ${res.status} for ${path}`);return res.json();}
export default {async fetch(request,env){
  if(request.method!=='POST')return fail(405,'Send a report with POST.');
  if(+request.headers.get('content-length')>MAX_REQUEST)return fail(413,'That report is too large.');
  let report;try{report=await request.json();}catch{return fail(400,'That report could not be read.');}
  const title=String(report?.title??'').trim(),body=String(report?.body??'').trim(),about=String(report?.about??'').slice(0,200),images=Array.isArray(report?.images)?report.images:[];
  if(!title||title.length>120)return fail(400,'The title must be 1 to 120 characters.');if(!body||body.length>10000)return fail(400,'The description must be 1 to 10000 characters.');if(images.length>MAX_IMAGES)return fail(400,`A report can have up to ${MAX_IMAGES} pictures.`);
  const pictures=[];for(const image of images){let bytes;try{bytes=fromBase64(String(image?.data??''));}catch{return fail(400,'A picture could not be read.');}const type=imageType(bytes);
    if(!type)return fail(400,'Pictures must be PNG, JPEG, WebP or GIF.');if(bytes.length>MAX_IMAGE_BYTES)return fail(413,'A picture is over 3 MB.');pictures.push({data:String(image.data),type});}
  const ip=request.headers.get('cf-connecting-ip')||'unknown',hour=Math.floor(Date.now()/3600000),day=new Date().toISOString().slice(0,10);
  if(await bump(env,`ip:${ip}:${hour}`,7200)>PER_IP_PER_HOUR)return fail(429,'Too many reports from this network. Try again in an hour.');
  if(await bump(env,`day:${day}`,172800)>PER_DAY)return fail(429,'Too many reports today. Try again tomorrow.');
  try{const id=`${day}-${crypto.randomUUID().slice(0,8)}`,links=[];
    for(const [i,p] of pictures.entries()){const file=`reports/${id}/${i+1}.${p.type}`,saved=await github(env,`/contents/${file}`,'PUT',{message:`Picture for bug report ${id}`,content:p.data});links.push(`![Picture ${i+1}](${saved.content.html_url}?raw=true)`);}
    const issue=await github(env,'/issues','POST',{title:`[Bug report] ${quiet(title)}`,body:`${quiet(body)}${links.length?`\n\n${links.join('\n\n')}`:''}\n\n---\n${quiet(about)}`});
    return json(200,{ok:true,number:issue.number});}
  catch(e){console.error(e.message);return fail(502,'The report could not be saved. Try again later.');}
}};
