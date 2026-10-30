#!/usr/bin/env node
'use strict';
// How many times each release was downloaded, from GitHub's free public API: node tools/download-stats.cjs [owner/name]
// A count is one download of a file, not one person: an app update downloads too, and the same person may download twice.
// Only installers and zips count, so checksum files and update manifests do not inflate it.
const REPO=process.argv[2]||String(require('../package.json').repository.url).replace(/^.*github\.com[/:]/,'').replace(/\.git$/,'');
const counted=name=>/\.(exe|zip|dmg|appimage|deb|tar\.gz)$/i.test(name);
function summarize(releases){
  const rows=releases.map(r=>({tag:r.tag_name,published:String(r.published_at||'').slice(0,10),prerelease:!!r.prerelease,downloads:(r.assets||[]).filter(a=>counted(a.name)).reduce((n,a)=>n+a.download_count,0)})).sort((a,b)=>b.published.localeCompare(a.published));
  return {rows,total:rows.reduce((n,r)=>n+r.downloads,0)};}
async function releases(repo,fetcher=fetch){const out=[];
  for(let page=1;page<=10;page++){const res=await fetcher(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'torque-download-stats'}});
    if(!res.ok)throw Error(`GitHub answered ${res.status}.`);const list=await res.json();out.push(...list);if(list.length<100)break;}
  return out;}
if(require.main===module)void releases(REPO).then(list=>{const {rows,total}=summarize(list);
  for(const r of rows)console.log(`${String(r.downloads).padStart(6)}  ${r.tag.padEnd(22)} ${r.published}${r.prerelease?'  testing':''}`);
  console.log(`${String(total).padStart(6)}  total across ${rows.length} releases`);}).catch(e=>{console.error(e.message);process.exit(1);});
module.exports={summarize,releases,counted};
