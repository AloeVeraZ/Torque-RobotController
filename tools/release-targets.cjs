'use strict';
// Which desktop packages a release builds and publishes (used by .github/workflows/release.yml).
// A testing tag builds package.json's testingReleaseTargets and a main tag its mainReleaseTargets
// (every platform when the key is missing), so a build can go to some devices first; the others
// keep their version and the in-app check says so.
//   node tools/release-targets.cjs targets <testing|main>                 -> ["windows"]
//   node tools/release-targets.cjs prepare <dist> <targets> <version> <tag> -> {"title","notes"}
const fs=require('node:fs'),path=require('node:path');
const ALL=['steamdeck','windows','macos-arm64'];
const LABEL={steamdeck:'Steam Deck/Linux',windows:'Windows x64','macos-arm64':'Apple Silicon'};
// Release file names (tools/package.py) by platform; FULL is the one the in-app updater downloads.
const FILES={steamdeck:/-SteamDeck\.(tar\.gz|run)$/,windows:/-Windows(\.zip|-Setup\.exe)$/,'macos-arm64':/-macOS-arm64\.zip$/};
const FULL={steamdeck:'SteamDeck.tar.gz',windows:'Windows.zip','macos-arm64':'macOS-arm64.zip'};
const APP=/^DeckDriverStation-\d+\.\d+\.\d+-App-[a-f0-9]{12}\.tar\.gz$/;

function check(list,key='testingReleaseTargets'){
  if(!Array.isArray(list)||!list.length||new Set(list).size!==list.length||list.some(t=>!ALL.includes(t)))throw Error(`${key} must list one or more of ${ALL.join(', ')}, each once.`);
  return ALL.filter(t=>list.includes(t));
}
function targets(branch,meta){
  if(branch!=='testing'&&branch!=='main')throw Error(`Releases come from testing or main, not ${branch}.`);
  const key=branch+'ReleaseTargets';
  return meta?.[key]===undefined?ALL.slice():check(meta[key],key);
}
const partial=list=>check(list).length<ALL.length;
// A main release can carry a name people know it by, from package.json's releaseName. The updater goes by the tag, so this is only its title.
function describe(tag,list,name=''){
  list=check(list);const label=name&&!tag.startsWith('testing-')?`${name} (${tag})`:tag;if(!partial(list))return {title:`Torque ${label}`,notes:''};
  const names=l=>l.map(t=>LABEL[t]).join(' and '),only=names(list),rest=ALL.filter(t=>!list.includes(t));
  return {title:`Torque ${label} (${only} only)`,notes:`This build is for ${only} only. ${names(rest)} ${rest.length>1?'stay on their':'stays on its'} current version until a later release includes ${rest.length>1?'them':'it'}.`};
}
// Checks the built files before anything is published. Each target needs its update download and
// checksum, and no other platform's file may be there. The App package (app code only) fits every
// platform, and updaters up to 2.4.22 take it without their own full download, so a partial release
// drops it: otherwise it would install this version on the devices the release was not built for.
function plan(files,list,version){
  list=check(list);const drop=[],problems=[],keep=[];
  for(const file of files){
    const name=file.replace(/\.sha256$/,'');
    if(APP.test(name)){(partial(list)?drop:keep).push(file);continue;}
    const platform=ALL.find(t=>FILES[t].test(name)&&name.startsWith('DeckDriverStation-'));
    if(!platform)problems.push(`${file} is not a known release file.`);
    else if(!list.includes(platform))problems.push(`${file} is for ${LABEL[platform]}, which this release does not build.`);
    else keep.push(file);
  }
  for(const t of list)for(const file of [`DeckDriverStation-${version}-${FULL[t]}`,`DeckDriverStation-${version}-${FULL[t]}.sha256`])if(!files.includes(file))problems.push(`${file} is missing.`);
  return {keep,drop,problems};
}

module.exports={ALL,LABEL,targets,partial,describe,plan};
if(require.main===module){
  const [command,...args]=process.argv.slice(2);
  try{
    if(command==='targets'){
      const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
      process.stdout.write(JSON.stringify(targets(args[0],meta))+'\n');
    }else if(command==='prepare'){
      const [dist,list,version,tag]=args;if(!/^\d+\.\d+\.\d+$/.test(version||'')||!tag)throw Error('prepare needs the version and tag.');
      const chosen=JSON.parse(list),{drop,problems}=plan(fs.readdirSync(dist),chosen,version);
      if(problems.length)throw Error(problems.join('\n'));
      for(const file of drop){fs.rmSync(path.join(dist,file));console.error(`Left out ${file}: this release is not built for every platform.`);}
      const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));process.stdout.write(JSON.stringify(describe(tag,chosen,meta.releaseName))+'\n');
    }else throw Error('Use: release-targets.cjs targets <testing|main> | prepare <dist> <targets JSON> <version> <tag>');
  }catch(e){console.error(e.message);process.exit(1);}
}
