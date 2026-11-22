(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckThemes=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Themes: the colours, and for an imported one its pictures, of Torque's own screens ("app") or of the FTC Driver
  // Station screen ("station"). The built-in ones are the app's neutrals turned to a hue at the same lightness, so each
  // keeps the same contrast; Torque, the first, is ui/tokens.css as it is. Everything stays on this computer: an imported
  // theme is copied into the app's own data folder. docs/THEMES.md says how to make one.
  const BUILT_IN=[{"id":"torque","name":"Torque","dark":{"bg":"#0c0f0d","surface":"#131715","well":"#0f1311","raised":"#1d221f","control":"#1d221f","hover":"#282d2a","line":"#242926","line-strong":"#393f3b","field":"#5e6561","input-hover":"#8d9490","text":"#ebf0ed","muted":"#acb3af","quiet":"#8d9490","placeholder":"#8d9490","ink":"#ebf0ed","ink-hover":"#fafcfb","ink-active":"#cdd3cf","on-ink":"#0c0f0d","selected":"#232825","track":"#343a36","accent":"#31d78c","on-accent":"#0c0f0d","accent-hover":"#45e498","accent-active":"#05c77d","accent-soft":"#122f21","ring":"#31d78c80","thumb":"#ebf0ed"},"light":{"bg":"#f2f5f3","surface":"#fbfdfc","well":"#eaeeec","raised":"#e3e7e5","control":"#e3e7e5","hover":"#d9dedb","line":"#d9dedb","line-strong":"#b9c0bc","field":"#808884","input-hover":"#59605b","text":"#141a16","muted":"#4a524d","quiet":"#59605b","placeholder":"#59605b","ink":"#141a16","ink-hover":"#28302b","ink-active":"#060a08","on-ink":"#fbfdfc","selected":"#dde3df","track":"#c6cdc9","accent":"#037f4e","on-accent":"#ffffff","accent-hover":"#007040","accent-active":"#006435","accent-soft":"#d5e7df","ring":"#037f4e66","thumb":"#fbfdfc"}},{"id":"blue","name":"Blue","dark":{"bg":"#0c0e12","surface":"#13161a","well":"#0f1216","raised":"#1d2126","control":"#1d2126","hover":"#282c31","line":"#24282d","line-strong":"#393e45","field":"#5e646b","input-hover":"#8d939a","text":"#ebeff4","muted":"#acb2b9","quiet":"#8d939a","placeholder":"#8d939a","ink":"#ebeff4","ink-hover":"#fafcfe","ink-active":"#cdd2d9","on-ink":"#0c0e12","selected":"#23272c","track":"#343940","accent":"#87bafe","on-accent":"#0c0e12","accent-hover":"#93c7ff","accent-active":"#78aaed","accent-soft":"#202a38","ring":"#87bafe80","thumb":"#ebeff4"},"light":{"bg":"#f2f4f8","surface":"#fbfdff","well":"#eaedf1","raised":"#e3e6ea","control":"#e3e6ea","hover":"#d9dde2","line":"#d9dde2","line-strong":"#b9bfc6","field":"#80868f","input-hover":"#585f67","text":"#14191f","muted":"#4a5059","quiet":"#585f67","placeholder":"#585f67","ink":"#14191f","ink-hover":"#282e37","ink-active":"#06090e","on-ink":"#fbfdff","selected":"#dde2e9","track":"#c6ccd3","accent":"#186cce","on-accent":"#ffffff","accent-hover":"#005dbd","accent-active":"#0050b0","accent-soft":"#d8e4f3","ring":"#186cce66","thumb":"#fbfdff"}},{"id":"orange","name":"Orange","dark":{"bg":"#110d0b","surface":"#191512","well":"#15110e","raised":"#251f1c","control":"#251f1c","hover":"#302a27","line":"#2c2623","line-strong":"#433c37","field":"#69615c","input-hover":"#98908b","text":"#f3edea","muted":"#b7afaa","quiet":"#98908b","placeholder":"#98908b","ink":"#f3edea","ink-hover":"#fdfbfa","ink-active":"#d7d0cb","on-ink":"#110d0b","selected":"#2b2522","track":"#3e3732","accent":"#ff9b5a","on-accent":"#110d0b","accent-hover":"#ffa867","accent-active":"#ee8b4a","accent-soft":"#372418","ring":"#ff9b5a80","thumb":"#f3edea"},"light":{"bg":"#f7f3f1","surface":"#fefcfb","well":"#f0ece9","raised":"#e9e5e2","control":"#e9e5e2","hover":"#e1dbd8","line":"#e1dbd8","line-strong":"#c4bcb7","field":"#8d847e","input-hover":"#655c57","text":"#1e1712","muted":"#574e48","quiet":"#655c57","placeholder":"#655c57","ink":"#1e1712","ink-hover":"#352c26","ink-active":"#0c0805","on-ink":"#fefcfb","selected":"#e7e0db","track":"#d1c9c4","accent":"#af5504","on-accent":"#ffffff","accent-hover":"#9f4600","accent-active":"#913a00","accent-soft":"#eee0d5","ring":"#af550466","thumb":"#fefcfb"}},{"id":"purple","name":"Purple","dark":{"bg":"#0e0d11","surface":"#16151a","well":"#121116","raised":"#212026","control":"#212026","hover":"#2c2b31","line":"#28272d","line-strong":"#3e3c44","field":"#63626a","input-hover":"#929199","text":"#efeef4","muted":"#b1b0b8","quiet":"#929199","placeholder":"#929199","ink":"#efeef4","ink-hover":"#fcfbfd","ink-active":"#d2d0d8","on-ink":"#0e0d11","selected":"#27262c","track":"#39373f","accent":"#bfa6ff","on-accent":"#0e0d11","accent-hover":"#ccb3ff","accent-active":"#af96ee","accent-soft":"#2a2537","ring":"#bfa6ff80","thumb":"#efeef4"},"light":{"bg":"#f4f3f7","surface":"#fdfcfe","well":"#edecf1","raised":"#e6e5ea","control":"#e6e5ea","hover":"#dddce2","line":"#dddce2","line-strong":"#bebdc5","field":"#86848e","input-hover":"#5e5c66","text":"#19171f","muted":"#504e58","quiet":"#5e5c66","placeholder":"#5e5c66","ink":"#19171f","ink-hover":"#2e2c36","ink-active":"#09080d","on-ink":"#fdfcfe","selected":"#e2e0e8","track":"#cbcad2","accent":"#7f55ce","on-accent":"#ffffff","accent-hover":"#7145bd","accent-active":"#6639b0","accent-soft":"#e6e0f2","ring":"#7f55ce66","thumb":"#fdfcfe"}},{"id":"red","name":"Red","dark":{"bg":"#110d0d","surface":"#1a1414","well":"#161010","raised":"#261f1e","control":"#261f1e","hover":"#312a29","line":"#2d2625","line-strong":"#443b3a","field":"#6a6060","input-hover":"#998f8f","text":"#f4edec","muted":"#b8aeae","quiet":"#998f8f","placeholder":"#998f8f","ink":"#f4edec","ink-hover":"#fdfbfb","ink-active":"#d8cfce","on-ink":"#110d0d","selected":"#2c2524","track":"#3f3635","accent":"#ff958f","on-accent":"#110d0d","accent-hover":"#ffa29b","accent-active":"#ee8580","accent-soft":"#372322","ring":"#ff958f80","thumb":"#f4edec"},"light":{"bg":"#f7f3f3","surface":"#fefcfc","well":"#f1ebeb","raised":"#eae4e4","control":"#eae4e4","hover":"#e2dbda","line":"#e2dbda","line-strong":"#c5bbbb","field":"#8e8382","input-hover":"#665b5b","text":"#1f1616","muted":"#584c4c","quiet":"#665b5b","placeholder":"#665b5b","ink":"#1f1616","ink-hover":"#362a2a","ink-active":"#0d0707","on-ink":"#fefcfc","selected":"#e8dfde","track":"#d2c8c8","accent":"#d02b34","on-accent":"#ffffff","accent-hover":"#be1025","accent-active":"#b00018","accent-soft":"#f2dbdc","ring":"#d02b3466","thumb":"#fefcfc"}},{"id":"mono","name":"Mono","dark":{"bg":"#0e0e0e","surface":"#161616","well":"#121212","raised":"#212121","control":"#212121","hover":"#2c2c2c","line":"#282828","line-strong":"#3d3d3d","field":"#636363","input-hover":"#929292","text":"#eeeeee","muted":"#b1b1b1","quiet":"#929292","placeholder":"#929292","ink":"#eeeeee","ink-hover":"#fbfbfb","ink-active":"#d1d1d1","on-ink":"#0e0e0e","selected":"#272727","track":"#383838","accent":"#eeeeee","on-accent":"#0e0e0e","accent-hover":"#f5f5f5","accent-active":"#dedede","accent-soft":"#323232","ring":"#eeeeee80","thumb":"#eeeeee"},"light":{"bg":"#f4f4f4","surface":"#fcfcfc","well":"#ededed","raised":"#e6e6e6","control":"#e6e6e6","hover":"#dcdcdc","line":"#dcdcdc","line-strong":"#bebebe","field":"#868686","input-hover":"#5e5e5e","text":"#181818","muted":"#505050","quiet":"#5e5e5e","placeholder":"#5e5e5e","ink":"#181818","ink-hover":"#2e2e2e","ink-active":"#090909","on-ink":"#fcfcfc","selected":"#e1e1e1","track":"#cbcbcb","accent":"#181818","on-accent":"#fcfcfc","accent-hover":"#161616","accent-active":"#0b0b0b","accent-soft":"#dadada","ring":"#18181866","thumb":"#fcfcfc"}}];
  const TOKENS=Object.keys(BUILT_IN[0].dark);
  // What an imported theme may set, by the names docs/THEMES.md uses; the rest is worked out from them.
  const GIVEN=['accent','background','surface','text','muted','line'];
  const HEX=/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,IMAGE=/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
  const LIMITS={json:200000,image:8*1024*1024,images:20*1024*1024};
  const full=h=>h.length===4?'#'+[...h.slice(1)].map(c=>c+c).join(''):h.toLowerCase();
  const rgb=h=>[1,3,5].map(i=>parseInt(full(h).slice(i,i+2),16));
  const hex=c=>'#'+c.map(v=>Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>hex(rgb(a).map((v,i)=>v*t+rgb(b)[i]*(1-t)));
  const lum=h=>{const [r,g,b]=rgb(h).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

  // A whole set of tokens from the few a theme gives: grounds and lines are steps between its background, surface and
  // text, so they keep the same relation they have in the built-in themes.
  function derive(mode,c){
    const bg=full(c.background),surface=full(c.surface||mix(c.text,c.background,mode==='dark'?.04:.02)),text=full(c.text),muted=full(c.muted||mix(text,surface,.68)),accent=full(c.accent);
    const line=full(c.line||mix(text,surface,mode==='dark'?.09:.12)),dark=mode==='dark';
    const onAccent=contrast(accent,'#ffffff')>=contrast(accent,bg)?'#ffffff':bg;
    return {bg,surface,well:mix(bg,surface,.5),raised:mix(text,surface,dark?.07:.08),control:mix(text,surface,dark?.07:.08),hover:mix(text,surface,dark?.12:.13),
      line,'line-strong':mix(text,surface,dark?.2:.25),field:mix(text,surface,dark?.38:.45),'input-hover':mix(text,surface,.55),text,muted,quiet:mix(muted,bg,.85),placeholder:mix(muted,bg,.85),
      ink:text,'ink-hover':mix(text,dark?'#ffffff':'#000000',.85),'ink-active':mix(text,bg,.85),'on-ink':bg,selected:mix(text,surface,dark?.1:.1),track:mix(text,surface,dark?.16:.2),
      accent,'on-accent':onAccent,'accent-hover':mix(accent,dark?'#ffffff':'#000000',.88),'accent-active':mix(accent,dark?'#000000':'#000000',.85),'accent-soft':mix(accent,bg,dark?.16:.12),
      ring:accent+(dark?'80':'66'),thumb:dark?text:surface};
  }
  // The CSS that puts a theme on a page: dark first, light where the page is light (as ui/tokens.css does), and the
  // names older stylesheets still use.
  // A logo can come in two: one for dark, one for light.
  function css(theme){
    const logo=url=>url?`--theme-logo:url("${url}");`:'';
    const block=(t,mode)=>TOKENS.map(k=>`--${k}:${t[k]};`).join('')+`--accent-text:${t.accent};--accent-bg:${t['accent-soft']};--accent-fill:${t.accent};--input-hover:${t['input-hover']};`+logo(mode==='light'&&theme.logoLight||theme.logo);
    return `:root{${block(theme.dark,'dark')}}:root[data-theme=light]{${block(theme.light,'light')}}@media (prefers-color-scheme: light){:root:not([data-theme=dark]){${block(theme.light,'light')}}}`;
  }
  // Puts a theme on a page (null, or Torque, takes it off). A constructed stylesheet, so the pages' content security
  // policy, which allows no inline styles, still holds. Pictures go in as custom properties the stylesheets draw with.
  const sheets=new WeakMap();
  // A font added in Settings → Text arrives as its file's bytes; each page loads it once, under its own family name.
  const fontsIn=new WeakMap();
  function addFont(doc,f){if(!f||!f.data||!f.family)return;let have=fontsIn.get(doc);if(!have){have=new Set();fontsIn.set(doc,have);}if(have.has(f.family))return;have.add(f.family);
    try{const face=new doc.defaultView.FontFace(f.family,f.data,f.variable?{weight:'100 900'}:{});doc.fonts.add(face);face.load().catch(()=>{});}catch{}}
  function apply(doc,theme,{font}={}){
    const root=doc.documentElement;let sheet=sheets.get(doc);
    if(!sheet&&typeof CSSStyleSheet==='function'){sheet=new CSSStyleSheet();sheets.set(doc,sheet);doc.adoptedStyleSheets=[...doc.adoptedStyleSheets,sheet];}
    const custom=theme&&theme.id!=='torque';
    sheet?.replaceSync(custom?css(theme):'');
    root.dataset.look=theme?.id||'torque';
    const bg=theme?.background?.image,logo=theme?.logo;
    if(bg){root.style.setProperty('--theme-image',`url("${bg}")`);root.style.setProperty('--theme-image-position',theme.background.position||'center');root.style.setProperty('--theme-image-opacity',String(theme.background.opacity??.3));root.dataset.themeImage='';}
    else{root.style.removeProperty('--theme-image');delete root.dataset.themeImage;}
    if(logo&&custom)root.dataset.themeLogo='';else delete root.dataset.themeLogo;
    // The font: Inter (none set), a built-in one by name (tokens.css), or one added here, which sets the faces itself.
    const f=typeof font==='string'?{id:font}:font||{id:'inter'};addFont(doc,f);
    if(f.id&&f.id!=='inter')root.dataset.font=f.custom?'custom':f.id;else delete root.dataset.font;
    if(f.custom&&f.family){const stack=`"${f.family}", system-ui, sans-serif`;root.style.setProperty('--font',stack);root.style.setProperty('--font-display',stack);}
    else{root.style.removeProperty('--font');root.style.removeProperty('--font-display');}
  }
  // Two colours that say what a theme looks like, for its swatch: its ground and its accent, dark.
  const swatch=t=>[t.dark.bg,t.dark.accent,t.light.bg,t.light.accent];

  // An imported theme: theme.json and the pictures it names, read from its folder. read(name) gives a picture as a data
  // URL (or null when the folder has no file of that name). kind is the list it is imported into ("app" or "station");
  // without one, theme.json's "for" says. Returns the theme, or throws an Error that says what to fix.
  async function fromPackage(json,read,want){
    let p;try{p=typeof json==='string'?JSON.parse(json):json;}catch(e){throw Error(`theme.json is not valid JSON: ${e.message}`);}
    if(typeof json==='string'&&json.length>LIMITS.json)throw Error('theme.json is larger than 200 KB.');
    if(!p||p.format!=='torque-theme')throw Error('theme.json needs "format": "torque-theme".');
    if(p.version!==1)throw Error('This theme is version '+p.version+'; Torque reads version 1.');
    const name=String(p.name||'').trim().slice(0,40);if(!name)throw Error('theme.json needs a "name".');
    const kind=want==='app'||want==='station'?want:p.for==='app'||p.for==='station'?p.for:null;if(!kind)throw Error('"for" must be "app" (Torque\'s screens) or "station" (the FTC Driver Station screen).');
    const theme={id:'custom-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,7),name,for:kind,author:String(p.author||'').slice(0,60),imported:Date.now()};
    for(const mode of ['dark','light']){
      const c=p.colours?.[mode]||p.colors?.[mode];if(!c||typeof c!=='object')throw Error(`theme.json needs "colours": { "${mode}": { … } }.`);
      for(const k of Object.keys(c))if(!GIVEN.includes(k))throw Error(`"${k}" is not a colour a theme can set. It can set: ${GIVEN.join(', ')}.`);
      for(const k of ['accent','background','text'])if(!c[k])throw Error(`colours.${mode} needs "${k}".`);
      for(const [k,v] of Object.entries(c))if(!HEX.test(String(v)))throw Error(`colours.${mode}.${k} must be a hex colour like #1a2b3c, not ${JSON.stringify(v)}.`);
      const t=derive(mode,c),need=(a,b,min,what)=>{const r=contrast(a,b);if(r<min)throw Error(`In ${mode}, ${what} is ${r.toFixed(1)}:1; it needs ${min}:1 to be readable.`);};
      need(t.text,t.bg,4.5,'text on the background');need(t.text,t.surface,4.5,'text on the surface');need(t.muted,t.surface,4.5,'muted text on the surface');need(t.accent,t.bg,3,'the accent on the background');need(t.accent,t['on-accent'],4.5,'text on the accent');
      theme[mode]=t;
    }
    let total=0;const picture=async(file,what)=>{if(!file)return null;if(typeof file!=='string'||/[\\/]|^\./.test(file))throw Error(`${what} must be the name of a file beside theme.json, like "background.jpg".`);
      if(!/\.(png|jpe?g|gif|webp)$/i.test(file))throw Error(`${what} must be a PNG, JPEG, GIF or WebP file.`);
      const url=await read(file);if(!url)throw Error(`${what} names ${file}, which is not in the theme's folder.`);if(!IMAGE.test(url))throw Error(`${file} is not a PNG, JPEG, GIF or WebP picture.`);
      const bytes=Math.floor((url.length-url.indexOf(',')-1)*3/4);if(bytes>LIMITS.image)throw Error(`${file} is larger than 8 MB.`);total+=bytes;if(total>LIMITS.images)throw Error('A theme\'s pictures can add up to 20 MB.');return url;};
    if(p.background){const b=typeof p.background==='string'?{image:p.background}:p.background,position=String(b.position||'center');
      if(!/^(center|top|bottom|left|right)( (center|top|bottom|left|right))?$|^\d{1,3}% \d{1,3}%$/.test(position))throw Error('background.position is a word like "center" or "top", or two percentages like "50% 30%".');
      const opacity=b.opacity===undefined?.3:Number(b.opacity);if(!(opacity>=0&&opacity<=1))throw Error('background.opacity is a number from 0 to 1.');
      theme.background={image:await picture(b.image,'background.image'),position,opacity};}
    if(p.logo){const l=typeof p.logo==='string'?{dark:p.logo}:p.logo;if(!l||typeof l!=='object'||!(l.dark||l.light))throw Error('logo is a file name, or { "dark": "logo.png", "light": "logo-light.png" }.');
      theme.logo=await picture(l.dark||l.light,l.dark?'logo.dark':'logo.light');if(l.dark&&l.light&&l.light!==l.dark)theme.logoLight=await picture(l.light,'logo.light');}
    return theme;
  }
  // Checks a stored theme (one this app imported earlier) before it is used again.
  function valid(t){return !!t&&typeof t==='object'&&/^custom-[a-z0-9-]{1,40}$/.test(t.id)&&typeof t.name==='string'&&['app','station'].includes(t.for)&&['dark','light'].every(m=>t[m]&&TOKENS.every(k=>typeof t[m][k]==='string'&&(HEX.test(t[m][k])||/^#[0-9a-f]{8}$/i.test(t[m][k]))))&&(!t.background||!t.background.image||IMAGE.test(t.background.image))&&(!t.logo||IMAGE.test(t.logo))&&(!t.logoLight||IMAGE.test(t.logoLight));}
  const find=(list,id)=>list.find(t=>t.id===id)||null;
  return {BUILT_IN,TOKENS,GIVEN,LIMITS,derive,css,apply,addFont,swatch,fromPackage,valid,find,contrast};
});
