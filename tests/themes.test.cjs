'use strict';
// Theme packages (docs/THEMES.md): the list a theme is imported into decides its kind, a logo can come as one file or as
// one for dark and one for light, and a theme that would be hard to read is refused with what to fix.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const T=require('../ui/themes.js');
const dir=path.join(__dirname,'../docs/themes');
const reader=folder=>async name=>{const f=path.join(dir,folder,name);if(!fs.existsSync(f))return null;return `data:image/${/\.png$/.test(name)?'png':'jpeg'};base64,`+fs.readFileSync(f).toString('base64');};
const json=folder=>fs.readFileSync(path.join(dir,folder,'theme.json'),'utf8');
const minimal=extra=>JSON.stringify({format:'torque-theme',version:1,name:'Test',colours:{dark:{accent:'#ffa94d',background:'#0b0f1a',text:'#eef1f8'},light:{accent:'#b2560a',background:'#f3f5fa',text:'#121726'}},...extra});

test('the list a theme is imported into decides its kind; theme.json only says it when nothing else does',async()=>{
  assert.equal(JSON.parse(json('night-shift')).for,'station');
  assert.equal((await T.fromPackage(json('night-shift'),reader('night-shift'),'app')).for,'app');
  assert.equal((await T.fromPackage(json('night-shift'),reader('night-shift'))).for,'station');
  assert.equal((await T.fromPackage(json('field-day'),reader('field-day'),'station')).for,'station');
  await assert.rejects(T.fromPackage(minimal({}),async()=>null),/"for" must be/);
  assert.equal((await T.fromPackage(minimal({}),async()=>null,'app')).for,'app');
});

test('a logo is one file for both modes, or one for dark and one for light',async()=>{
  const both=await T.fromPackage(json('night-shift'),reader('night-shift'),'station');
  assert.ok(both.logo&&both.logoLight&&both.logo!==both.logoLight);assert.ok(T.valid(both));
  const css=T.css(both),[dark,light]=[css.indexOf(both.logo),css.indexOf(both.logoLight)];
  assert.ok(dark>0&&dark<css.indexOf('[data-theme=light]'),'the dark logo is in the dark block');
  assert.ok(light>css.indexOf('[data-theme=light]'),'the light logo is in the light blocks');
  const one=await T.fromPackage(minimal({logo:'logo.png'}),reader('night-shift'),'app');
  assert.ok(one.logo&&!one.logoLight);assert.equal(T.css(one).split(one.logo).length-1,3,'one logo in all three blocks');
  await assert.rejects(T.fromPackage(minimal({logo:{}}),reader('night-shift'),'app'),/logo is a file name/);
  await assert.rejects(T.fromPackage(minimal({logo:{dark:'logo.png',light:'missing.png'}}),reader('night-shift'),'app'),/missing\.png, which is not in the theme's folder/);
  assert.equal(T.valid({...both,logoLight:'data:text/html,hi'}),false,'a stored light logo must be a picture');
});

test('a theme that would be hard to read is refused, saying what to fix',async()=>{
  const faint=JSON.stringify({format:'torque-theme',version:1,name:'Faint',colours:{dark:{accent:'#ffa94d',background:'#0b0f1a',text:'#333333'},light:{accent:'#b2560a',background:'#f3f5fa',text:'#121726'}}});
  await assert.rejects(T.fromPackage(faint,async()=>null,'app'),/In dark, text on the background is \d\.\d:1; it needs 4\.5:1/);
});
