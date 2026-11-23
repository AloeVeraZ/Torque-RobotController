(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckThemes=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Two separate choices for Torque's own screens ("app") and for the FTC Driver Station screen ("station"):
  // - a theme is how the screens look and behave: Torque (flat), DEV (a moving ASCII ground, ui/theme-ascii.js), or an
  //   imported theme folder, which brings its own colours and pictures;
  // - a colour is the palette a theme draws in: an accent and the neutrals around it. Any colour goes with any theme. The
  //   built-in ones are the app's neutrals turned to a hue at the same lightness, so each keeps the same contrast; Torque,
  //   the first, is ui/tokens.css as it is. A user can make their own from a main colour and a background tint, made the
  //   same way, and pass it on as a small file.
  // Everything stays on this computer: an imported theme is copied into the app's own data folder. docs/THEMES.md says
  // how to make one.
  // The built-in themes. DEV and NYC FIRST draw a moving ground of text characters (motion 'ascii', ui/theme-ascii.js):
  // DEV's scene is Torque's τ in the colour's accent; FIRST's is FIRST's triangle, ring and square in their own inks,
  // red, white and blue, each a little lighter on a dark ground so it shows, the white the logo's grey on a light one.
  // NYC FIRST is FIRST with the Statue of Liberty's crown in place of the ring.
  const FIRST_INKS={dark:['#ff4a50','#f2f2f2','#4a9cf0'],light:['#d71920','#8f8f8f','#0062ad']};
  const THEMES=[{id:'torque',name:'Torque'},{id:'dev',name:'DEV',motion:'ascii',scene:'tau'},
    {id:'first',name:'FIRST',motion:'ascii',scene:'first',inks:FIRST_INKS},{id:'nyc-first',name:'NYC FIRST',motion:'ascii',scene:'nyc',inks:FIRST_INKS}];
  const COLOURS=[{"id":"torque","name":"Torque","dark":{"bg":"#0c0f0d","surface":"#131715","well":"#0f1311","raised":"#1d221f","control":"#1d221f","hover":"#282d2a","line":"#242926","line-strong":"#393f3b","field":"#5e6561","input-hover":"#8d9490","text":"#ebf0ed","muted":"#acb3af","quiet":"#8d9490","placeholder":"#8d9490","ink":"#ebf0ed","ink-hover":"#fafcfb","ink-active":"#cdd3cf","on-ink":"#0c0f0d","selected":"#232825","track":"#343a36","accent":"#31d78c","on-accent":"#0c0f0d","accent-hover":"#45e498","accent-active":"#05c77d","accent-soft":"#122f21","ring":"#31d78c80","thumb":"#ebf0ed"},"light":{"bg":"#f2f5f3","surface":"#fbfdfc","well":"#eaeeec","raised":"#e3e7e5","control":"#e3e7e5","hover":"#d9dedb","line":"#d9dedb","line-strong":"#b9c0bc","field":"#808884","input-hover":"#59605b","text":"#141a16","muted":"#4a524d","quiet":"#59605b","placeholder":"#59605b","ink":"#141a16","ink-hover":"#28302b","ink-active":"#060a08","on-ink":"#fbfdfc","selected":"#dde3df","track":"#c6cdc9","accent":"#037f4e","on-accent":"#ffffff","accent-hover":"#007040","accent-active":"#006435","accent-soft":"#d5e7df","ring":"#037f4e66","thumb":"#fbfdfc"}},{"id":"purple","name":"Purple","dark":{"bg":"#0e0d11","surface":"#16151a","well":"#121116","raised":"#212026","control":"#212026","hover":"#2c2b31","line":"#28272d","line-strong":"#3e3c44","field":"#63626a","input-hover":"#929199","text":"#efeef4","muted":"#b1b0b8","quiet":"#929199","placeholder":"#929199","ink":"#efeef4","ink-hover":"#fcfbfd","ink-active":"#d2d0d8","on-ink":"#0e0d11","selected":"#27262c","track":"#39373f","accent":"#bfa6ff","on-accent":"#0e0d11","accent-hover":"#ccb3ff","accent-active":"#af96ee","accent-soft":"#2a2537","ring":"#bfa6ff80","thumb":"#efeef4"},"light":{"bg":"#f4f3f7","surface":"#fdfcfe","well":"#edecf1","raised":"#e6e5ea","control":"#e6e5ea","hover":"#dddce2","line":"#dddce2","line-strong":"#bebdc5","field":"#86848e","input-hover":"#5e5c66","text":"#19171f","muted":"#504e58","quiet":"#5e5c66","placeholder":"#5e5c66","ink":"#19171f","ink-hover":"#2e2c36","ink-active":"#09080d","on-ink":"#fdfcfe","selected":"#e2e0e8","track":"#cbcad2","accent":"#7f55ce","on-accent":"#ffffff","accent-hover":"#7145bd","accent-active":"#6639b0","accent-soft":"#e6e0f2","ring":"#7f55ce66","thumb":"#fdfcfe"}},{"id":"orange","name":"Orange","dark":{"bg":"#110d0b","surface":"#191512","well":"#15110e","raised":"#251f1c","control":"#251f1c","hover":"#302a27","line":"#2c2623","line-strong":"#433c37","field":"#69615c","input-hover":"#98908b","text":"#f3edea","muted":"#b7afaa","quiet":"#98908b","placeholder":"#98908b","ink":"#f3edea","ink-hover":"#fdfbfa","ink-active":"#d7d0cb","on-ink":"#110d0b","selected":"#2b2522","track":"#3e3732","accent":"#ff9b5a","on-accent":"#110d0b","accent-hover":"#ffa867","accent-active":"#ee8b4a","accent-soft":"#372418","ring":"#ff9b5a80","thumb":"#f3edea"},"light":{"bg":"#f7f3f1","surface":"#fefcfb","well":"#f0ece9","raised":"#e9e5e2","control":"#e9e5e2","hover":"#e1dbd8","line":"#e1dbd8","line-strong":"#c4bcb7","field":"#8d847e","input-hover":"#655c57","text":"#1e1712","muted":"#574e48","quiet":"#655c57","placeholder":"#655c57","ink":"#1e1712","ink-hover":"#352c26","ink-active":"#0c0805","on-ink":"#fefcfb","selected":"#e7e0db","track":"#d1c9c4","accent":"#af5504","on-accent":"#ffffff","accent-hover":"#9f4600","accent-active":"#913a00","accent-soft":"#eee0d5","ring":"#af550466","thumb":"#fefcfb"}},{"id":"mono","name":"Mono","dark":{"bg":"#0e0e0e","surface":"#161616","well":"#121212","raised":"#212121","control":"#212121","hover":"#2c2c2c","line":"#282828","line-strong":"#3d3d3d","field":"#636363","input-hover":"#929292","text":"#eeeeee","muted":"#b1b1b1","quiet":"#929292","placeholder":"#929292","ink":"#eeeeee","ink-hover":"#fbfbfb","ink-active":"#d1d1d1","on-ink":"#0e0e0e","selected":"#272727","track":"#383838","accent":"#eeeeee","on-accent":"#0e0e0e","accent-hover":"#f5f5f5","accent-active":"#dedede","accent-soft":"#323232","ring":"#eeeeee80","thumb":"#eeeeee"},"light":{"bg":"#f4f4f4","surface":"#fcfcfc","well":"#ededed","raised":"#e6e6e6","control":"#e6e6e6","hover":"#dcdcdc","line":"#dcdcdc","line-strong":"#bebebe","field":"#868686","input-hover":"#5e5e5e","text":"#181818","muted":"#505050","quiet":"#5e5e5e","placeholder":"#5e5e5e","ink":"#181818","ink-hover":"#2e2e2e","ink-active":"#090909","on-ink":"#fcfcfc","selected":"#e1e1e1","track":"#cbcbcb","accent":"#181818","on-accent":"#fcfcfc","accent-hover":"#161616","accent-active":"#0b0b0b","accent-soft":"#dadada","ring":"#18181866","thumb":"#fcfcfc"}}];
  // BUILT_IN is the older name for the colours; it stays so callers from before the split keep working.
  const BUILT_IN=COLOURS,TOKENS=Object.keys(COLOURS[0].dark);
  // The most a list (App or Driver Station) holds, its built-in ones counted.
  const MAX_THEMES=8,MAX_COLOURS=16;
  // What an imported theme may set, by the names docs/THEMES.md uses; the rest is worked out from them.
  const GIVEN=['accent','background','surface','text','muted','line'];
  const HEX=/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,IMAGE=/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
  const POSITION=/^(center|top|bottom|left|right)( (center|top|bottom|left|right))?$|^\d{1,3}% \d{1,3}%$/;
  const LIMITS={json:200000,image:8*1024*1024,images:20*1024*1024};
  const isHex=v=>typeof v==='string'&&HEX.test(v);
  const full=h=>(h.length===4?'#'+[...h.slice(1)].map(c=>c+c).join(''):h).toLowerCase();
  const rgb=h=>[1,3,5].map(i=>parseInt(full(h).slice(i,i+2),16));
  const hex=c=>'#'+c.map(v=>Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');
  const lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;},gamma=v=>255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055);
  const lum=h=>{const [r,g,b]=rgb(h).map(lin);return .2126*r+.7152*g+.0722*b;};
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  // Colours are moved in OKLab (L lightness, then a and b, or chroma C and hue H in radians), where a step in lightness
  // looks the same size at every hue and keeps the colour's chroma.
  function lab(h){const [r,g,b]=rgb(h).map(lin);
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];}
  const lch=h=>{const [L,A,B]=lab(h);return [L,Math.hypot(A,B),Math.atan2(B,A)];};
  const linear=(L,A,B)=>{const l=(L+.3963377774*A+.2158037573*B)**3,m=(L-.1055613458*A-.0638541728*B)**3,s=(L-.0894841775*A-1.291485548*B)**3;
    return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];};
  // Back to hex at that lightness and hue, with as much of the chroma as the screen can show there. No chroma is an exact grey.
  function fromLch(L,C,H){L=Math.min(1,Math.max(0,L));if(!(C>0))return hex(Array(3).fill(gamma(L**3)));
    const at=c=>linear(L,c*Math.cos(H),c*Math.sin(H)),inside=c=>at(c).every(v=>v>=-1e-6&&v<=1+1e-6);
    if(!inside(C)){let lo=0,hi=C;for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(inside(mid))lo=mid;else hi=mid;}C=lo;}
    return hex(at(C).map(v=>gamma(Math.min(1,Math.max(0,v)))));}
  const fromLab=(L,A,B)=>fromLch(L,Math.hypot(A,B),Math.atan2(B,A));
  // A pick whose channels are within 4 of each other (of 255) is a grey: near white and near black, the hue of so small a
  // difference is noise, and would tint the whole palette.
  const isGrey=h=>{const c=rgb(h);return Math.max(...c)-Math.min(...c)<=4;};

  // The accent and what goes with it in one mode (g holds that mode's bg, surface and text): the words on it (on), its
  // hover and pressed shades, the soft ground it marks a pick with, and its focus ring. With move, the accent is moved
  // in lightness only, keeping its chroma and hue, as far as it must be to read: lighter on the dark ground, darker on
  // the light one. Without, it is kept as given (an imported theme's, which fromPackage checks).
  const ACCENTS=['accent','on-accent','accent-hover','accent-active','accent-soft','ring'],NEUTRALS=TOKENS.filter(k=>!ACCENTS.includes(k));
  // Where each of Torque's neutrals sits between its background (0) and its text (1), by lightness; soft is its accent's
  // soft ground there, and greySoft Mono's, which stands further from the ground as it has no hue to show.
  const place=(t,k)=>(lab(t[k])[0]-lab(t.bg)[0])/(lab(t.text)[0]-lab(t.bg)[0]);
  const PLACE={dark:{},light:{}};for(const mode of ['dark','light']){for(const k of NEUTRALS)PLACE[mode][k]=place(COLOURS[0][mode],k);
    PLACE[mode].soft=place(COLOURS[0][mode],'accent-soft');PLACE[mode].greySoft=place(COLOURS.find(c=>c.id==='mono')[mode],'accent-soft');}
  // How Torque's states step from its accent, in lightness; the soft ground's chroma as a share of the accent's.
  const STEP={dark:{hover:.04,active:-.05,soft:.26},light:{hover:-.045,active:-.085,soft:.16}};
  function family(mode,pick,g,{move=true,on}={}){
    const dark=mode==='dark',[L0,C0,H]=lch(pick),C=isGrey(pick)?0:C0,Lbg=lab(g.bg)[0],Ltext=lab(g.text)[0];
    // Words on the accent: the dark ground in dark (the soft ground could not hold the accent to 4.5:1 under white words),
    // white in light.
    on=on||(dark?g.bg:'#ffffff');
    // The soft ground, a little of the accent at Torque's place, drawn closer to the ground (never past half way) until
    // the accent reads on it as words: 4.5:1 in dark, 3:1 in light, as Torque's own.
    const soft=a=>{const [,Ca,Ha]=lch(a),share=Math.min(1,Ca/.12),f=PLACE[mode].greySoft+(PLACE[mode].soft-PLACE[mode].greySoft)*share;
      const at=s=>fromLch(Lbg+(Ltext-Lbg)*f*s,Ca*STEP[mode].soft,Ha);
      for(let s=1;s>.49;s-=.05){const x=at(s);if(contrast(a,x)>=(dark?4.5:3))return {x,ok:true};}return {x:at(.5),ok:false};};
    const reads=a=>contrast(a,g.bg)>=(dark?3:4.5)&&contrast(a,g.surface)>=3&&contrast(a,on)>=4.5&&soft(a).ok;
    // An own colour's grey pick is drawn as an exact grey. Moved, it keeps its chroma: a dim red lifted stays a dim red.
    let a=C||!move?pick:fromLch(L0,0,0),L=L0;
    if(move)while(!reads(a)&&(dark?L<1:L>0)){L=Math.min(1,Math.max(0,L+(dark?.005:-.005)));a=fromLch(L,C,H);}
    // Hover and pressed step as Torque's do. One that would bring the accent nearer its words than 4.5:1, or would not
    // show (8 of 255 from the accent, and pressed from hover too), steps away from the words instead.
    const away=lum(on)>lum(a)?-1:1,[La]=lab(a),apart=(x,y)=>{const p=rgb(x),q=rgb(y);return p.some((v,i)=>Math.abs(v-q[i])>=8);};
    const state=(d,further,others)=>{const fits=s=>others.every(o=>apart(s,o))&&contrast(s,on)>=4.5;
      for(const x of [d,away*Math.abs(further)]){const s=fromLch(La+x,C,H);if(fits(s))return s;}
      // At the very end of the range (black on a light ground, white on a dark one) it steps towards the words, as far
      // as it takes to show: near black, a small step in lightness is the same 8-bit colour.
      for(let m=Math.abs(d);m<.6;m+=.02){const s=fromLch(La-away*m,C,H);if(fits(s))return s;}return fromLch(La+d,C,H);};
    const hover=state(STEP[mode].hover,STEP[mode].hover,[a]),active=state(STEP[mode].active,Math.abs(STEP[mode].hover)+Math.abs(STEP[mode].active),[a,hover]);
    return {accent:a,'on-accent':on,'accent-hover':hover,'accent-active':active,'accent-soft':soft(a).x,ring:a+(dark?'80':'66')};
  }
  // Field lines (an input's edge) read at 3:1 on the surface: moved away from it in lightness until they do.
  function fieldReads(t,mode){for(let i=0;i<60&&contrast(t.field,t.surface)<3;i++){const [L,C,H]=lch(t.field);t.field=fromLch(L+(mode==='dark'?.005:-.005),C,H);}return t;}

  // A whole set of tokens from the few a theme gives: every neutral sits where Torque's does between the background and
  // the text (a well a shade darker than the ground in light, the surface a shade lighter), unless the theme gives it.
  function derive(mode,c){
    const dark=mode==='dark',bg=full(c.background),text=full(c.text),b=lab(bg),t=lab(text),at=f=>fromLab(...b.map((v,i)=>v+(t[i]-v)*f));
    const out={};for(const k of NEUTRALS)out[k]=at(PLACE[mode][k]);
    Object.assign(out,{bg,text,ink:text},c.surface?{surface:full(c.surface)}:{},c.muted?{muted:full(c.muted)}:{},c.line?{line:full(c.line)}:{});
    Object.assign(out,{'on-ink':dark?bg:out.surface,thumb:dark?text:out.surface});fieldReads(out,mode);
    const accent=full(c.accent);
    return Object.assign(out,family(mode,accent,out,{move:false,on:contrast(accent,'#ffffff')>=contrast(accent,bg)?'#ffffff':bg}));
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
  // A font added in Settings → Text arrives as its file's bytes; each page loads it once, under its own family name. It is
  // drawn at the size that sets a line as long as Inter does (80% to 125% of its own), so changing the font changes no
  // screen: it is measured once under a name of its own, then added at that size.
  const SAMPLE='The quick brown fox jumps over the lazy dog 0123456789',INTER_WIDTH=27.44,fontsIn=new WeakMap(),width=(doc,family)=>{const c=doc.createElement('canvas').getContext('2d');if(!c)return INTER_WIDTH;c.font=`400 100px ${family}`;return c.measureText(SAMPLE).width/100;};
  function addFont(doc,f){if(!f||!f.data||!f.family)return null;let have=fontsIn.get(doc);if(!have){have=new Map();fontsIn.set(doc,have);}if(have.has(f.family))return have.get(f.family);
    const W=doc.defaultView,base=f.variable?{weight:'100 900'}:{};
    const ready=(async()=>{try{const probe=new W.FontFace(`${f.family} measure`,f.data,base);doc.fonts.add(probe);await probe.load();const own=width(doc,`"${f.family} measure"`);doc.fonts.delete(probe);
      const adjust=Math.min(125,Math.max(80,100*INTER_WIDTH/own)),face=new W.FontFace(f.family,f.data,{...base,sizeAdjust:`${adjust.toFixed(1)}%`});doc.fonts.add(face);await face.load();}catch{}})();
    have.set(f.family,ready);return ready;}
  // A face that still sets words much wider than Inter (a font added here more than a quarter wider, even at 80%) marks the
  // page data-font-wide, and the few places sized for Inter's words give way for it. The built-in faces are drawn at
  // Inter's size; a font added here is measured once it has loaded at its size.
  const measuring=new WeakMap();
  function markWide(doc,f,ready){const root=doc.documentElement,turn=(measuring.get(doc)||0)+1;measuring.set(doc,turn);
    const set=wide=>{if(measuring.get(doc)!==turn)return;if(wide)root.dataset.fontWide='';else delete root.dataset.fontWide;};
    set(false);if(!f.custom||!f.family||!ready)return;
    ready.then(()=>set(width(doc,`"${f.family}"`)/INTER_WIDTH>1.15));}
  function apply(doc,theme,{font}={}){
    // theme is what compose() made: the colours to draw in, and under look the theme they are drawn by.
    const root=doc.documentElement;let sheet=sheets.get(doc);
    if(!sheet&&typeof CSSStyleSheet==='function'){sheet=new CSSStyleSheet();sheets.set(doc,sheet);doc.adoptedStyleSheets=[...doc.adoptedStyleSheets,sheet];}
    // Torque's own colours are ui/tokens.css already, so with no logo they need no stylesheet; any other colour, or a
    // theme's logo (an imported theme drawn in Torque's colour keeps its logo), does.
    const custom=!!theme&&(theme.id!=='torque'||!!theme.logo||!!theme.logoLight);
    sheet?.replaceSync(custom?css(theme):'');
    // data-look names the theme, not the colour, so a stylesheet's hooks (:root[data-look=dev]) hold in every colour.
    root.dataset.look=theme?.look||theme?.id||'torque';
    // data-motion says the theme's ground moves (DEV, FIRST, NYC FIRST), for what every moving theme needs from a page.
    if(theme?.motion)root.dataset.motion=theme.motion;else delete root.dataset.motion;
    const bg=theme?.background?.image,logo=theme?.logo;
    if(bg){root.style.setProperty('--theme-image',`url("${bg}")`);root.style.setProperty('--theme-image-position',theme.background.position||'center');root.style.setProperty('--theme-image-opacity',String(theme.background.opacity??.3));root.dataset.themeImage='';}
    else{for(const p of ['--theme-image','--theme-image-position','--theme-image-opacity'])root.style.removeProperty(p);delete root.dataset.themeImage;}
    if(logo&&custom)root.dataset.themeLogo='';else delete root.dataset.themeLogo;
    // The font: Inter (none set), a built-in one by name (tokens.css), or one added here, which sets the faces itself.
    const f=typeof font==='string'?{id:font}:font||{id:'inter'},ready=addFont(doc,f);
    if(f.id&&f.id!=='inter')root.dataset.font=f.custom?'custom':f.id;else delete root.dataset.font;
    if(f.custom&&f.family){const stack=`"${f.family}", system-ui, sans-serif`;root.style.setProperty('--font',stack);root.style.setProperty('--font-display',stack);}
    else{root.style.removeProperty('--font');root.style.removeProperty('--font-display');}
    markWide(doc,f,ready);
    // A theme whose ground moves draws it behind the page (ui/theme-ascii.js, loaded before this on each page that can show
    // it). Called on every apply: on a page already moving it takes the new colours, which a stylesheet change alone would
    // not tell it about.
    const moving=()=>globalThis.DeckAscii?.set(doc,theme?.motion==='ascii',{scene:theme?.scene,inks:theme?.inks||null});if(doc.body)moving();else doc.addEventListener('DOMContentLoaded',moving,{once:true});
  }
  // Two colours that say what a colour or theme looks like, for its swatch: its ground and its accent, dark then light.
  const swatch=t=>[t.dark.bg,t.dark.accent,t.light.bg,t.light.accent];

  // A user's own colour, from a main colour and an optional background tint (the main colour when none is given). It is
  // made the way the built-in ones were: every one of Torque's neutrals turned to the tint's hue at the same lightness and
  // chroma (none at all for a grey, as Mono), so each keeps its contrast and its place; an own colour made from Torque's
  // green is Torque. Only the accent and what goes with it (family above) come from the main colour.
  const COLOUR_ID=/^colour-[a-z0-9-]{1,40}$/;
  const shown=v=>{const s=JSON.stringify(v);return s&&s.length>40?s.slice(0,40)+'…':String(s);};
  // A name as a list shows it: control characters (a tab, a line break, an escape) taken out, as they draw as nothing or
  // break the line, then the spaces at its ends, at most 40 characters. A name with nothing else in it is no name.
  const cleanName=(v,most=40)=>v.replace(/[\x00-\x1f\x7f-\x9f]/g,'').trim().slice(0,most).trim();
  function colour(spec){
    const name=typeof spec?.name==='string'?cleanName(spec.name):'';if(!name)throw Error('A colour needs a name.');
    if(!isHex(spec.accent))throw Error(`The main colour must be a hex colour like #1a2b3c, not ${shown(spec.accent)}.`);
    if(spec.tint!=null&&!isHex(spec.tint))throw Error(`The background tint must be a hex colour like #1a2b3c, not ${shown(spec.tint)}.`);
    if(spec.for!=='app'&&spec.for!=='station')throw Error('"for" must be "app" (Torque\'s screens) or "station" (the FTC Driver Station screen).');
    const accent=full(spec.accent),tint=spec.tint==null?null:full(spec.tint),ground=tint||accent,grey=isGrey(ground),[,,hue]=lch(ground);
    const id=COLOUR_ID.test(String(spec.id))?spec.id:'colour-'+(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'own')+'-'+Math.random().toString(36).slice(2,7);
    const c={id,name,accent,tint,for:spec.for,custom:true};
    for(const mode of ['dark','light']){
      const base=COLOURS[0][mode],t={};for(const k of NEUTRALS){const [L,C]=lch(base[k]);t[k]=fromLch(L,grey?0:C,hue);}
      c[mode]={...fieldReads(t,mode),...family(mode,accent,t)};
    }
    return c;
  }
  // Checks a stored own colour before it is used again, as valid() does for a theme.
  const tokensOk=t=>['dark','light'].every(m=>t[m]&&typeof t[m]==='object'&&TOKENS.every(k=>typeof t[m][k]==='string'&&(HEX.test(t[m][k])||/^#[0-9a-f]{8}$/i.test(t[m][k]))));
  const named=n=>typeof n==='string'&&!!n.trim()&&n.length<=40;
  function validColour(c){return !!c&&typeof c==='object'&&COLOUR_ID.test(c.id)&&named(c.name)&&['app','station'].includes(c.for)&&isHex(c.accent)&&(c.tint==null||isHex(c.tint))&&tokensOk(c);}
  // A colour file: {"format":"torque-colour","version":1,"name":"…","accent":"#…","tint":"#…"}, the tint left out for
  // none. kind is the list it goes into. Returns the colour, or throws an Error that says what to fix.
  function colourFile(text,kind){
    const not='This file isn’t a colour file. Pick a file that ends in .torque-colour.json.';
    if(typeof text==='string'){if(text.length>4000)throw Error('A colour file is a few lines; this one is over 4000 characters.');text=text.replace(/^﻿/,'');}
    let p;try{p=typeof text==='string'?JSON.parse(text):text;}catch{throw Error(not);}
    if(!p||typeof p!=='object'||Array.isArray(p))throw Error(not);
    if(p.format==='torque-theme')throw Error('This file is a theme, not a colour. To use it, choose Import a theme under App theme or Driver Station theme, and pick the folder it came in.');
    if(p.format!=='torque-colour')throw Error(not);
    if(p.version!==1)throw Error(p.version==null?'The colour file needs "version": 1.':`This colour is version ${shown(p.version)}; Torque reads version 1.`);
    if(p.name==null||p.name==='')throw Error('The colour file needs a "name", like "Sunset".');
    if(typeof p.name!=='string')throw Error('The colour file’s "name" must be words in quotes, like "Sunset".');
    if(!cleanName(p.name))throw Error('The colour file needs a "name", like "Sunset".');
    if(p.accent==null||p.accent==='')throw Error('The colour file needs an "accent", like "#1a2b3c".');
    if(!isHex(p.accent))throw Error(`The colour file’s "accent" must be a hex colour in quotes, like "#1a2b3c", not ${shown(p.accent)}.`);
    if(p.tint!=null&&!isHex(p.tint))throw Error(`The colour file’s "tint" must be a hex colour in quotes, like "#1a2b3c", or left out, not ${shown(p.tint)}.`);
    return colour({name:p.name,accent:p.accent,tint:p.tint??null,for:kind});
  }
  // The file for one of a user's own colours. A built-in one is already in every copy of Torque, so it has none.
  function colourText(c){
    if(!c||!c.custom||!COLOUR_ID.test(c.id))throw Error('Only a colour you made can be exported; the built-in ones come with Torque.');
    return JSON.stringify({format:'torque-colour',version:1,name:c.name,accent:c.accent,...(c.tint?{tint:c.tint}:{})},null,2);
  }
  // What apply() takes for a theme and a colour: the colour's id, name and tokens, and under look the theme's id (with its
  // motion, and a moving theme's scene and inks). Any colour goes with any theme.
  // - A built-in theme draws in the colour, Torque's when none is given.
  // - An imported theme with no colour (null or left out) is just as it was imported: its own colours and its pictures.
  //   Given a colour, it draws in that colour and keeps its pictures: the background picture with its position and
  //   opacity, and its logo for dark and for light.
  function compose(theme,c){
    theme=theme||THEMES[0];const imported=/^custom-/.test(String(theme.id));
    if(imported&&c==null)return {...theme,look:theme.id};
    c=c||COLOURS[0];const look={id:c.id,look:theme.id,name:c.name,motion:theme.motion,...(theme.scene?{scene:theme.scene}:{}),...(theme.inks?{inks:theme.inks}:{}),dark:c.dark,light:c.light};
    if(imported)for(const k of ['background','logo','logoLight'])if(theme[k])look[k]=theme[k];
    return look;
  }

  // An imported theme: theme.json and the pictures it names, read from its folder. read(name) gives a picture as a data
  // URL (or null when the folder has no file of that name). kind is the list it is imported into ("app" or "station");
  // without one, theme.json's "for" says. Returns the theme, or throws an Error that says what to fix.
  async function fromPackage(json,read,want){
    if(typeof json==='string'){if(json.length>LIMITS.json)throw Error('theme.json is larger than 200 KB.');json=json.replace(/^﻿/,'');}
    let p;try{p=typeof json==='string'?JSON.parse(json):json;}catch(e){throw Error(`theme.json is not valid JSON: ${e.message}`);}
    if(!p||typeof p!=='object'||Array.isArray(p)||p.format!=='torque-theme')throw Error('theme.json needs "format": "torque-theme".');
    if(p.version!==1)throw Error(`This theme is version ${shown(p.version)}; Torque reads version 1.`);
    if(p.name!=null&&typeof p.name!=='string')throw Error('theme.json’s "name" must be words in quotes, like "Night Shift".');
    if(p.author!=null&&typeof p.author!=='string')throw Error('theme.json’s "author" must be words in quotes, like "Team 9999", or left out.');
    const name=cleanName(p.name||'');if(!name)throw Error('theme.json needs a "name".');
    const kind=want==='app'||want==='station'?want:p.for==='app'||p.for==='station'?p.for:null;if(!kind)throw Error('"for" must be "app" (Torque\'s screens) or "station" (the FTC Driver Station screen).');
    const theme={id:'custom-'+(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'theme')+'-'+Math.random().toString(36).slice(2,7),name,for:kind,author:cleanName(p.author||'',60),imported:Date.now()};
    for(const mode of ['dark','light']){
      const c=p.colours?.[mode]||p.colors?.[mode];if(!c||typeof c!=='object'||Array.isArray(c))throw Error(`theme.json needs "colours": { "${mode}": { … } }.`);
      for(const k of Object.keys(c))if(!GIVEN.includes(k))throw Error(`"${k}" is not a colour a theme can set. It can set: ${GIVEN.join(', ')}.`);
      for(const k of ['accent','background','text'])if(!c[k])throw Error(`colours.${mode} needs "${k}".`);
      for(const [k,v] of Object.entries(c))if(!isHex(v))throw Error(`colours.${mode}.${k} must be a hex colour in quotes, like "#1a2b3c", not ${shown(v)}.`);
      const t=derive(mode,c),need=(a,b,min,what)=>{const r=contrast(a,b);if(r<min)throw Error(`In ${mode}, ${what} is ${r.toFixed(1)}:1; it needs ${min}:1 to be readable.`);};
      need(t.text,t.bg,4.5,'text on the background');need(t.text,t.surface,4.5,'text on the surface');need(t.muted,t.surface,4.5,'muted text on the surface');need(t.accent,t.bg,3,'the accent on the background');need(t.accent,t['on-accent'],4.5,'text on the accent');
      theme[mode]=t;
    }
    let total=0;const picture=async(file,what)=>{if(!file)return null;if(typeof file!=='string'||/[\\/]|^\./.test(file))throw Error(`${what} must be the name of a file beside theme.json, like "background.jpg".`);
      if(!/\.(png|jpe?g|gif|webp)$/i.test(file))throw Error(`${what} must be a PNG, JPEG, GIF or WebP file.`);
      const url=await read(file);if(!url)throw Error(`${what} names ${file}, which is not in the theme's folder.`);if(!IMAGE.test(url))throw Error(`${file} is not a PNG, JPEG, GIF or WebP picture.`);
      const bytes=Math.floor((url.length-url.indexOf(',')-1)*3/4);if(bytes>LIMITS.image)throw Error(`${file} is larger than 8 MB.`);total+=bytes;if(total>LIMITS.images)throw Error('A theme\'s pictures can add up to 20 MB.');return url;};
    if(p.background){const b=typeof p.background==='string'?{image:p.background}:p.background;
      if(typeof b!=='object'||Array.isArray(b))throw Error('background is a file name, or { "image": "background.jpg", "position": "center", "opacity": 0.3 }.');
      const position=b.position||'center';if(typeof position!=='string'||!POSITION.test(position))throw Error('background.position is a word like "center" or "top", or two percentages like "50% 30%".');
      const opacity=b.opacity??.3;if(typeof opacity!=='number'||!(opacity>=0&&opacity<=1))throw Error('background.opacity is a number from 0 to 1, like 0.3.');
      theme.background={image:await picture(b.image,'background.image'),position,opacity};}
    if(p.logo){const l=typeof p.logo==='string'?{dark:p.logo}:p.logo;if(!l||typeof l!=='object'||Array.isArray(l)||!(l.dark||l.light))throw Error('logo is a file name, or { "dark": "logo.png", "light": "logo-light.png" }.');
      theme.logo=await picture(l.dark||l.light,l.dark?'logo.dark':'logo.light');if(l.dark&&l.light&&l.light!==l.dark)theme.logoLight=await picture(l.light,'logo.light');}
    return theme;
  }
  // Checks a stored theme (one this app imported earlier) before it is used again: what fromPackage would have made.
  const pictureOk=v=>v==null||typeof v==='string'&&IMAGE.test(v);
  const backgroundOk=b=>b==null||typeof b==='object'&&pictureOk(b.image)&&typeof b.position==='string'&&POSITION.test(b.position)&&typeof b.opacity==='number'&&b.opacity>=0&&b.opacity<=1;
  function valid(t){return !!t&&typeof t==='object'&&/^custom-[a-z0-9-]{1,40}$/.test(t.id)&&named(t.name)&&['app','station'].includes(t.for)&&(t.author==null||typeof t.author==='string'&&t.author.length<=60)
    &&tokensOk(t)&&backgroundOk(t.background)&&pictureOk(t.logo)&&pictureOk(t.logoLight);}
  const find=(list,id)=>list.find(t=>t.id===id)||null;
  return {THEMES,COLOURS,BUILT_IN,MAX_THEMES,MAX_COLOURS,TOKENS,GIVEN,LIMITS,derive,css,apply,addFont,swatch,colour,validColour,colourFile,colourText,compose,fromPackage,valid,find,contrast};
});
