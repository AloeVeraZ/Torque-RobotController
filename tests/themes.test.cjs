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

// Themes and colours are two choices: a theme is how the screens look and behave, a colour the palette a built-in theme
// draws in. A user's own colour stays readable whatever main colour it starts from, and travels as a small file.
const hue=h=>{const [r,g,b]=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255),max=Math.max(r,g,b),d=max-Math.min(r,g,b);if(!d)return null;return Math.round((max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4)*60);};

test('the built-in themes and colours are the ones Settings lists',()=>{
  assert.deepEqual(T.COLOURS.map(c=>c.id),['torque','purple','orange','mono']);
  assert.equal(T.BUILT_IN,T.COLOURS,'BUILT_IN is the older name for the colours');
  assert.deepEqual(T.THEMES.map(t=>t.id),['torque','dev','first','nyc-first']);assert.deepEqual(T.THEMES.map(t=>t.name),['Torque','DEV','FIRST','NYC FIRST']);
  for(const t of T.THEMES.slice(1))assert.equal(t.motion,'ascii');assert.deepEqual(T.THEMES.slice(1).map(t=>t.scene),['tau','first','nyc']);
  // FIRST's and NYC FIRST's three inks, red, white and blue, for dark and for light; each shows on its own ground.
  for(const t of T.THEMES.slice(2)){for(const mode of ['dark','light']){assert.equal(t.inks[mode].length,3);for(const ink of t.inks[mode])assert.ok(T.contrast(ink,T.COLOURS[0][mode].bg)>=2.5,`${t.name} ${mode} ${ink}`);}}
  assert.ok(T.MAX_THEMES>=T.THEMES.length&&T.MAX_COLOURS>=T.COLOURS.length);
  assert.equal(T.COLOURS[0].dark.accent,'#31d78c','Torque keeps ui/tokens.css\'s accent');
});

test('an own colour keeps its accent readable, from very dark, very light, grey and saturated colours',()=>{
  for(const accent of ['#000000','#050505','#ffffff','#fafafa','#808080','#ffff00','#0000ff','#00ffff','#ff00ff','#31d78c','#7f55ce']){
    const c=T.colour({name:'Test',accent,for:'app'});assert.ok(T.validColour(c),accent);
    const d=c.dark,l=c.light;
    assert.ok(T.contrast(d.accent,d.bg)>=3,`${accent} dark: accent on the ground`);assert.ok(T.contrast(d.accent,d['on-accent'])>=4.5,`${accent} dark: words on the accent`);
    assert.ok(T.contrast(l.accent,l.bg)>=4.5,`${accent} light: accent on the ground`);assert.ok(T.contrast(l.accent,'#ffffff')>=4.5,`${accent} light: white on the accent`);
    for(const m of [d,l]){assert.ok(T.contrast(m.text,m.bg)>=4.5);assert.ok(T.contrast(m.muted,m.surface)>=4.5,`${accent}: muted text`);}
  }
  const grey=T.colour({name:'Grey',accent:'#808080',for:'app'});assert.equal(hue(grey.dark.bg),null,'a grey makes grey grounds, as Mono');
  assert.equal(T.colour({name:'Ok',accent:'#31d78c',for:'app'}).dark.accent,'#31d78c','an accent that already reads is left as it is');
});

test('the tint turns the ground to its hue, and defaults to the main colour',()=>{
  const plain=T.colour({name:'Blue',accent:'#2f6fff',for:'app'}),warm=T.colour({name:'Blue',accent:'#2f6fff',tint:'#ff6a00',for:'app'});
  assert.ok(Math.abs(hue(plain.dark.bg)-hue('#2f6fff'))<15,'no tint: the ground leans to the accent');
  assert.ok(Math.abs(hue(warm.dark.bg)-hue('#ff6a00'))<15&&Math.abs(hue(warm.light.bg)-hue('#ff6a00'))<15,'a tint: the ground leans to the tint');
  assert.equal(plain.dark.accent,warm.dark.accent);assert.equal(warm.tint,'#ff6a00');assert.equal(plain.tint,null);
  assert.match(plain.id,/^colour-blue-[a-z0-9]{5}$/);assert.equal(T.colour({...plain,id:'colour-mine'}).id,'colour-mine');
  assert.throws(()=>T.colour({name:'  ',accent:'#123456',for:'app'}),/needs a name/);
  assert.throws(()=>T.colour({name:'X',accent:'blue',for:'app'}),/hex colour/);
  assert.equal(T.validColour({...plain,id:'custom-x'}),false);assert.equal(T.validColour({...plain,light:{}}),false);
});

test('a colour file round-trips, and a bad one says what to fix',()=>{
  const c=T.colour({name:'Sunset',accent:'#ff6a00',tint:'#3355ff',for:'app'}),text=T.colourText(c);
  assert.deepEqual(JSON.parse(text),{format:'torque-colour',version:1,name:'Sunset',accent:'#ff6a00',tint:'#3355ff'});assert.match(text,/\n  "name"/);
  const back=T.colourFile(text,'station');assert.equal(back.for,'station');assert.deepEqual([back.name,back.accent,back.tint,back.dark,back.light],[c.name,c.accent,c.tint,c.dark,c.light]);
  assert.equal(JSON.parse(T.colourText(T.colour({name:'No tint',accent:'#ff6a00',for:'app'}))).tint,undefined);
  const file=o=>JSON.stringify({format:'torque-colour',version:1,name:'X',accent:'#123456',...o});
  assert.throws(()=>T.colourFile('{nope','app'),/^Error: This file isn’t a colour file\. Pick a file that ends in \.torque-colour\.json\.$/);
  for(const other of ['[]','null','"torque-colour"','{"name":"X"}'])assert.throws(()=>T.colourFile(other,'app'),/isn’t a colour file/,other);
  assert.throws(()=>T.colourFile(file({format:'torque-theme'}),'app'),/is a theme, not a colour\. To use it, choose Import a theme under App theme or Driver Station theme/);
  assert.throws(()=>T.colourFile(file({version:2}),'app'),/version 2; Torque reads version 1/);
  assert.throws(()=>T.colourFile(file({name:''}),'app'),/needs a "name"/);
  assert.throws(()=>T.colourFile(file({accent:undefined}),'app'),/^Error: The colour file needs an "accent", like "#1a2b3c"\.$/);
  assert.throws(()=>T.colourFile(file({accent:'red'}),'app'),/"accent" must be a hex colour/);
  assert.throws(()=>T.colourFile(file({tint:'#12'}),'app'),/"tint" must be a hex colour/);
  assert.equal(T.colourFile('\uFEFF'+file({}),'app').accent,'#123456','a byte-order mark before the text is fine');
  assert.throws(()=>T.colourFile(' '.repeat(4001),'app'),/over 4000 characters/);
  for(const b of T.COLOURS)assert.throws(()=>T.colourText(b),/Only a colour you made/);
});

test('compose: any colour with any theme; an imported theme with no colour is as it was imported',async()=>{
  const purple=T.COLOURS.find(c=>c.id==='purple'),dev=T.compose(T.THEMES[1],purple);
  assert.deepEqual({...dev},{id:'purple',look:'dev',name:'Purple',motion:'ascii',scene:'tau',dark:purple.dark,light:purple.light});
  // A moving theme with its own inks passes its scene and inks on; the page's colours are still the colour's.
  const nyc=T.compose(T.THEMES.find(t=>t.id==='nyc-first'),purple);assert.equal(nyc.look,'nyc-first');assert.equal(nyc.scene,'nyc');assert.deepEqual(nyc.inks,T.THEMES[3].inks);assert.equal(nyc.dark,purple.dark);
  const flat=T.compose(T.THEMES[0],T.COLOURS[0]);assert.equal(flat.id,'torque');assert.equal(flat.look,'torque');assert.equal(flat.motion,undefined);
  assert.equal(T.compose(null,null).id,'torque');assert.equal(T.compose(T.THEMES[1]).id,'torque','a built-in theme with no colour draws in Torque\'s');
  const own=await T.fromPackage(json('night-shift'),reader('night-shift'),'app');
  for(const none of [null,undefined]){const as=T.compose(own,none);
    assert.deepEqual(as,{...own,look:own.id},'no colour: the theme just as it was imported');assert.equal(as.dark,own.dark);assert.equal(as.logo,own.logo);}
  const mine=T.colour({name:'Mine',accent:'#2f6fff',for:'app'});
  for(const c of [purple,mine,T.COLOURS[0]]){const x=T.compose(own,c);
    assert.equal(x.id,c.id);assert.equal(x.look,own.id,'look is the theme');assert.equal(x.dark,c.dark,'the colour\'s tokens');assert.equal(x.light,c.light);
    assert.equal(x.background,own.background,'its background picture, position and opacity');assert.equal(x.logo,own.logo);assert.equal(x.logoLight,own.logoLight);
    const css=T.css(x);assert.ok(css.includes(`--accent:${c.dark.accent};`)&&css.includes(own.logo)&&css.includes(own.logoLight),'the colour, with the theme\'s logos');}
  const plain=await T.fromPackage(minimal({}),async()=>null,'app'),x=T.compose(plain,purple);
  assert.ok(!('background' in x)&&!('logo' in x)&&!('logoLight' in x),'a theme with no pictures adds none');
  assert.deepEqual(T.swatch(purple),[purple.dark.bg,purple.dark.accent,purple.light.bg,purple.light.accent]);
});

// The colour engine: an own colour is made as the built-in ones are, and keeps every contrast it promises.
const lab=h=>{const lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;},[r,g,b]=[1,3,5].map(i=>lin(parseInt(h.slice(i,i+2),16)));
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];};
const L=h=>lab(h)[0],chroma=h=>{const [,a,b]=lab(h);return Math.hypot(a,b);};
const apart=(x,y)=>Math.max(...[1,3,5].map(i=>Math.abs(parseInt(x.slice(i,i+2),16)-parseInt(y.slice(i,i+2),16))));
const grey=h=>h.slice(1,3)===h.slice(3,5)&&h.slice(3,5)===h.slice(5,7);
const ACCENTS=['accent','on-accent','accent-hover','accent-active','accent-soft','ring'],NEUTRALS=T.TOKENS.filter(k=>!ACCENTS.includes(k));
// What every colour must keep, in each mode.
function promises(c,what){
  for(const mode of ['dark','light']){const t=c[mode],dark=mode==='dark',at=`${what} ${mode}`;
    for(const k of T.TOKENS)assert.match(t[k],k==='ring'?/^#[0-9a-f]{8}$/:/^#[0-9a-f]{6}$/,`${at} ${k}`);
    const need=(a,b,min,label)=>{const r=T.contrast(t[a],t[b]);assert.ok(r>=min,`${at}: ${label||a+' on '+b} is ${r.toFixed(2)}, needs ${min}`);};
    need('accent','bg',dark?3:4.5);need('accent','surface',3);need('on-accent','accent',4.5);need('on-accent','accent-hover',4.5);need('on-accent','accent-active',4.5);
    need('accent','accent-soft',dark?4.5:3,'accent words on accent-soft');need('text','accent-soft',4.5);
    need('text','bg',4.5);need('text','surface',4.5);need('muted','surface',4.5);need('quiet','bg',3);need('placeholder','surface',3);need('field','surface',3);need('ink','on-ink',4.5);
    assert.ok(apart(t['accent-hover'],t.accent)>=8&&apart(t['accent-active'],t.accent)>=8&&apart(t['accent-active'],t['accent-hover'])>=8,`${at}: hover and pressed show`);
    assert.equal(t.ring.slice(0,7),t.accent);
    // Torque's lightness relations: every neutral sits on the same side of the ground as Torque's, about as far.
    const base=T.COLOURS[0][mode];
    for(const k of NEUTRALS){const own=L(t[k])-L(t.bg),torque=L(base[k])-L(base.bg);
      if(Math.abs(torque)>.005)assert.equal(Math.sign(own),Math.sign(torque),`${at}: ${k} is on Torque's side of the ground`);
      assert.ok(Math.abs(L(t[k])-L(base[k]))<(k==='field'?.03:.006),`${at}: ${k} keeps Torque's lightness`);}
    if(!dark)assert.ok(L(t.well)<L(t.bg)&&L(t.surface)>L(t.bg)&&L(t['ink-hover'])>L(t.text)&&L(t['ink-active'])<L(t.text),`${at}: well darker, surface lighter, ink steps as Torque's`);
    assert.equal(t['on-ink'],dark?t.bg:t.surface);
  }
}

test('an own colour keeps every contrast it promises, for a few hundred picks, extremes and near-greys',()=>{
  let seed=20261122;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  const pick=()=>'#'+[0,0,0].map(()=>Math.floor(rnd()*256).toString(16).padStart(2,'0')).join('');
  const picks=[];for(let i=0;i<250;i++)picks.push([pick(),null],[pick(),pick()]);
  const extremes=['#000000','#ffffff','#808080','#010000','#000001','#fffffe','#fefeff','#ff0000','#e53935','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#31d78c','#7f55ce','#ea1347','#0077dd','#445533','#777777'];
  for(const a of extremes)for(const t of [null,'#000000','#ffffff','#0ee103','#ff6a00'])picks.push([a,t]);
  for(const [accent,tint] of picks){const c=T.colour({name:'Sweep',accent,tint,for:'app'});assert.ok(T.validColour(c),accent);promises(c,`${accent}/${tint}`);}
  for(const b of T.COLOURS)for(const mode of ['dark','light'])assert.ok(T.contrast(b[mode].accent,b[mode].bg)>=(mode==='dark'?3:4.5),`built-in ${b.id} ${mode}`);
});

test('an own colour made from Torque\'s green is Torque, and one from a built-in accent looks like that built-in',()=>{
  const torque=T.COLOURS[0],own=T.colour({name:'Green',accent:torque.dark.accent,for:'app'});
  for(const mode of ['dark','light'])for(const k of NEUTRALS)assert.ok(apart(own[mode][k],torque[mode][k])<=2,`${mode} ${k}: ${own[mode][k]} against Torque's ${torque[mode][k]}`);
  for(const k of ACCENTS.filter(k=>k!=='ring'))assert.ok(apart(own.dark[k],torque.dark[k])<=2,`dark ${k}: ${own.dark[k]} against ${torque.dark[k]}`);
  assert.equal(own.dark.accent,torque.dark.accent,'Torque\'s dark accent already reads, so it is kept');
  for(const k of ACCENTS.filter(k=>k!=='ring'))assert.ok(apart(own.light[k],torque.light[k])<=12,`light ${k}: ${own.light[k]} against ${torque.light[k]}`);
  for(const id of ['purple','orange']){const b=T.COLOURS.find(c=>c.id===id),c=T.colour({name:id,accent:b.dark.accent,for:'app'});
    for(const mode of ['dark','light'])for(const k of NEUTRALS)assert.ok(apart(c[mode][k],b[mode][k])<=6,`${id} ${mode} ${k}: ${c[mode][k]} against ${b[mode][k]}`);}
  // Mono: a grey's neutrals are Mono's.
  const mono=T.COLOURS.find(c=>c.id==='mono'),g=T.colour({name:'Grey',accent:'#808080',for:'app'});
  for(const mode of ['dark','light'])for(const k of NEUTRALS)assert.ok(apart(g[mode][k],mono[mode][k])<=3,`grey ${mode} ${k}: ${g[mode][k]} against Mono's ${mono[mode][k]}`);
});

test('near white and near black are greys, and a moved accent keeps its chroma',()=>{
  for(const accent of ['#fffffe','#fefeff','#010000','#000001','#000000','#ffffff','#808080','#0a0a0b','#f0f0f1']){const c=T.colour({name:'Grey',accent,for:'app'});
    for(const mode of ['dark','light'])for(const k of T.TOKENS)assert.ok(grey(c[mode][k].slice(0,7)),`${accent} ${mode} ${k} is ${c[mode][k]}, not a grey`);}
  const tinted=T.colour({name:'Grey ground',accent:'#2f6fff',tint:'#fffffe',for:'app'});assert.ok(grey(tinted.dark.bg)&&grey(tinted.light.well),'a near-white tint makes grey grounds');
  // A very dark red is lifted to read on the dark ground as a red of the same chroma, not a bright one.
  const dim=T.colour({name:'Dim',accent:'#200000',for:'app'});assert.ok(chroma(dim.dark.accent)<chroma('#200000')+.01,`${dim.dark.accent} keeps #200000's chroma`);
  const red=T.colour({name:'Red',accent:'#ff0000',for:'app'});assert.ok(chroma(red.light.accent)>.2,'a strong red stays a strong red');
  assert.equal(T.colour({name:'Upper',accent:'#ABC',tint:'#DEF',for:'app'}).accent,'#aabbcc','three-digit hex is written out in lower case');
  assert.equal(T.colour({name:'Upper',accent:'#ABC',tint:'#DEF',for:'app'}).tint,'#ddeeff');
});

test('a colour file or theme.json with values of the wrong kind is refused, saying what to fix',async()=>{
  const file=o=>JSON.stringify({format:'torque-colour',version:1,name:'X',accent:'#123456',...o});
  for(const accent of [['#123456'],{hex:'#123456'},123456,true])assert.throws(()=>T.colourFile(file({accent}),'app'),/^Error: The colour file’s "accent" must be a hex colour in quotes, like "#1a2b3c", not /,JSON.stringify(accent));
  assert.throws(()=>T.colourFile(file({tint:['#abcdef']}),'app'),/"tint" must be a hex colour in quotes/);
  for(const name of [{a:1},12345,['Sunset'],true])assert.throws(()=>T.colourFile(file({name}),'app'),/^Error: The colour file’s "name" must be words in quotes, like "Sunset"\.$/,JSON.stringify(name));
  assert.throws(()=>T.colourFile({format:'torque-colour',version:1,name:'X',accent:['#123456']},'app'),/must be a hex colour/,'given as an object too');
  assert.throws(()=>T.colour({name:'X',accent:['#123456'],for:'app'}),/main colour must be a hex colour/);
  assert.throws(()=>T.colour({name:{a:1},accent:'#123456',for:'app'}),/needs a name/);
  const theme=(dark,extra)=>JSON.stringify({format:'torque-theme',version:1,name:'A',colours:{dark:{accent:'#ffa94d',background:'#0b0f1a',text:'#eef1f8',...dark},light:{accent:'#b2560a',background:'#f3f5fa',text:'#121726'}},...extra});
  await assert.rejects(T.fromPackage(theme({accent:['#ffa94d']}),async()=>null,'app'),/colours\.dark\.accent must be a hex colour in quotes/);
  await assert.rejects(T.fromPackage(theme({background:['#0b0f1a']}),async()=>null,'app'),/colours\.dark\.background must be a hex colour/);
  await assert.rejects(T.fromPackage(theme({},{name:{a:1}}),async()=>null,'app'),/"name" must be words in quotes/);
  await assert.rejects(T.fromPackage(theme({},{author:['me']}),async()=>null,'app'),/"author" must be words in quotes/);
  await assert.rejects(T.fromPackage(theme({},{background:5}),async()=>null,'app'),/background is a file name/);
  await assert.rejects(T.fromPackage(theme({},{background:{position:['top']}}),async()=>null,'app'),/background\.position is a word/);
  await assert.rejects(T.fromPackage(theme({},{background:{opacity:'lots'}}),async()=>null,'app'),/background\.opacity is a number from 0 to 1/);
  await assert.rejects(T.fromPackage(theme({},{logo:['logo.png']}),async()=>null,'app'),/logo is a file name/);
  await assert.rejects(T.fromPackage('x'.repeat(300000),async()=>null,'app'),/larger than 200 KB/,'the size is checked before the text is read');
});

test('a name loses its control characters, and one with nothing else is refused',async()=>{
  // A tab, a line break, an escape, a delete or a C1 control draws as nothing or breaks a list's line.
  const odd='\x1b[31mSun\tset\n\x7f\x85';
  assert.equal(T.colour({name:odd,accent:'#ff6a00',for:'app'}).name,'[31mSunset');
  assert.equal(T.colour({name:' \u0007 Dusk \r\n',accent:'#ff6a00',for:'app'}).name,'Dusk','spaces at the ends go after the controls do');
  for(const name of ['\x00\x01\x1f','\n\t\x7f','\x07 \x08'])assert.throws(()=>T.colour({name,accent:'#ff6a00',for:'app'}),/needs a name/,JSON.stringify(name));
  const file=name=>JSON.stringify({format:'torque-colour',version:1,name,accent:'#123456'});
  assert.equal(T.colourFile(file('Team\u0000 Teal\u001f'),'app').name,'Team Teal');
  assert.throws(()=>T.colourFile(file('\u0000\u001b\u007f'),'app'),/^Error: The colour file needs a "name", like "Sunset"\.$/);
  const theme=extra=>JSON.stringify({format:'torque-theme',version:1,colours:{dark:{accent:'#ffa94d',background:'#0b0f1a',text:'#eef1f8'},light:{accent:'#b2560a',background:'#f3f5fa',text:'#121726'}},...extra});
  const t=await T.fromPackage(theme({name:'\tNight\u0000 Shift\n',author:'Team\r\n 9999\u001b'}),async()=>null,'app');
  assert.equal(t.name,'Night Shift');assert.equal(t.author,'Team 9999');assert.ok(T.valid(t));
  await assert.rejects(T.fromPackage(theme({name:'\u0000\n\t\u007f'}),async()=>null,'app'),/needs a "name"/);
  assert.equal(T.colour({name:'\u0001'+'x'.repeat(45),accent:'#ff6a00',for:'app'}).name,'x'.repeat(40),'40 characters, counted after the controls go');
});

test('a stored theme or colour is checked again: names, background position and opacity, pictures',async()=>{
  const t=await T.fromPackage(json('night-shift'),reader('night-shift'),'app');assert.ok(T.valid(t));
  for(const bad of [{name:'x'.repeat(41)},{name:''},{name:5},{author:{}},{background:{...t.background,position:'url(x)'}},{background:{...t.background,opacity:'lots'}},
    {background:{...t.background,opacity:2}},{background:{...t.background,image:'data:text/html,hi'}},{logo:7}])assert.equal(T.valid({...t,...bad}),false,JSON.stringify(bad).slice(0,60));
  assert.ok(T.valid({...t,background:{image:null,position:'50% 30%',opacity:0}}));
  const c=T.colour({name:'Mine',accent:'#2f6fff',for:'app'});assert.ok(T.validColour(c));
  assert.equal(T.validColour({...c,name:'x'.repeat(41)}),false);assert.equal(T.validColour({...c,accent:['#2f6fff']}),false);
});

test('css() puts an own colour on a page: its tokens in dark, then in light, and the older names',()=>{
  const c=T.colour({name:'Mine',accent:'#2f6fff',tint:'#ff6a00',for:'app'}),css=T.css(T.compose(T.THEMES[1],c)),split=css.indexOf(':root[data-theme=light]');
  assert.ok(split>0&&css.includes('@media (prefers-color-scheme: light){:root:not([data-theme=dark]){'));
  for(const k of T.TOKENS){assert.ok(css.slice(0,split).includes(`--${k}:${c.dark[k]};`),`dark ${k}`);assert.ok(css.slice(split).includes(`--${k}:${c.light[k]};`),`light ${k}`);}
  assert.ok(css.includes(`--accent-text:${c.dark.accent};--accent-bg:${c.dark['accent-soft']};`));assert.ok(!css.includes('--theme-logo'),'no logo');
});

test('derive() places a theme\'s neutrals as Torque\'s are, and gives Torque back from its own three colours',()=>{
  for(const mode of ['dark','light']){const b=T.COLOURS[0][mode],d=T.derive(mode,{background:b.bg,text:b.text,accent:b.accent});
    for(const k of NEUTRALS)assert.ok(apart(d[k],b[k])<=2,`${mode} ${k}: ${d[k]} against ${b[k]}`);}
  const light=T.derive('light',{background:'#f4f7f2',text:'#152015',accent:'#2e7d32'});
  assert.ok(L(light.well)<L(light.bg)&&L(light.surface)>L(light.bg)&&L(light['ink-hover'])>L(light.text)&&L(light['ink-active'])<L(light.text));
  assert.ok(T.contrast(light.field,light.surface)>=3&&T.contrast(light['accent-active'],light['on-accent'])>=4.5);
});
