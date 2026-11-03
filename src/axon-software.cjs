'use strict';
// Axon's own programs. They are plain downloads, not installed, so having one means its file is somewhere a browser leaves it. Torque only looks for
// the file, and opens it when someone asks. It never reads anything out of it, and nothing about it leaves this computer.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SOFTWARE={
  v1:{title:'Axon Programming Software',pattern:/^Axon_Servo_Programming_Software.*\.exe$/i,page:'https://docs.axon-robotics.com/archive/programmer#:~:text=Software%20Download-,Axon%20Programming%20Software'},
  v2:{title:'Axon Software MK2',pattern:/^Axon_Software_MK2.*\.exe$/i,page:'https://docs.axon-robotics.com/servos/programmer#:~:text=Software%20Download-,Axon%20Software%20MK2'},
};
// The versions on Axon's pages when this was written, so a renamed copy is still recognised.
const KNOWN={'565acbc90998a0508bfd1980c807a14c8a4200a6a0444e8749132b1d982fe286':'v1','91360bfd1683871625c6c9542cfdf76fa7566608e1a7cd3c1280d1fe836bedf4':'v2'};
const SMALLEST=1e6;

// A whole program, not a download that is still arriving or a stray file with the right name.
function isProgram(file){try{if(fs.statSync(file).size<SMALLEST)return false;const fd=fs.openSync(file,'r');try{const head=Buffer.alloc(2);fs.readSync(fd,head,0,2,0);return head.toString('latin1')==='MZ';}finally{fs.closeSync(fd);}}catch{return false;}}
function look(folder,pattern,deep=true){
  let names;try{names=fs.readdirSync(folder,{withFileTypes:true});}catch{return null;}
  for(const e of names)if(e.isFile()&&pattern.test(e.name)&&isProgram(path.join(folder,e.name)))return path.join(folder,e.name);
  if(deep)for(const e of names)if(e.isDirectory()&&/axon/i.test(e.name)){const inside=look(path.join(folder,e.name),pattern,false);if(inside)return inside;}
  return null;
}
function recognise(file){
  if(!isProgram(file))return null;const name=path.basename(file);for(const family of Object.keys(SOFTWARE))if(SOFTWARE[family].pattern.test(name))return family;
  return KNOWN[crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]||null;
}
function remembered(memo){try{const v=JSON.parse(fs.readFileSync(memo,'utf8'));return v&&typeof v==='object'?v:{};}catch{return {};}}
// One the student pointed at, kept so it is found again. Throws if it is not the program asked for.
function remember(memo,family,file){
  if(recognise(file)!==family)throw Error(`That file is not ${SOFTWARE[family].title}. Download it from Axon's page, and pick the file it saved.`);
  fs.mkdirSync(path.dirname(memo),{recursive:true});fs.writeFileSync(memo,JSON.stringify({...remembered(memo),[family]:file},null,2));
}
// What is on this computer right now.
function finder({folders,memo=null}){
  const places=[...new Set(folders.filter(Boolean))];
  return ()=>{const picked=memo?remembered(memo):{},out={};for(const family of Object.keys(SOFTWARE)){
    let file=picked[family]&&isProgram(picked[family])?picked[family]:null;for(let i=0;!file&&i<places.length;i++)file=look(places[i],SOFTWARE[family].pattern);
    out[family]=file?{found:true,fileName:path.basename(file),path:file}:{found:false,fileName:null,path:null};}return out;};
}
module.exports={SOFTWARE,isProgram,look,recognise,remember,finder};
