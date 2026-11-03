'use strict';
// The app's few sounds. Short, quiet and made here, so there is nothing to load and nothing for a weak computer to do. The three-dot menu mutes them all, and that stays.
window.DeckSounds=(()=>{
  const KEY='torque-sounds-off';
  let off=(()=>{try{return localStorage.getItem(KEY)==='1';}catch{return false;}})(),quiet=false,audio=null;
  // Each note: [seconds from now, hertz, how long, how loud].
  const SOUNDS={
    tap:[[0,1100,.03,.012]],
    connect:[[0,523,.09,.03],[.09,784,.15,.03]],
    drop:[[0,523,.1,.03],[.1,349,.2,.03]],
    ready:[[0,659,.08,.022],[.08,988,.15,.022]],
    saved:[[0,587,.07,.022],[.07,784,.07,.022],[.14,1047,.17,.022]],
    ok:[[0,880,.12,.022]],
    fail:[[0,233,.2,.03]],
    stop:[[0,196,.16,.04]],
    attention:[[0,660,.18,.05],[.2,880,.18,.05]],
  };
  function play(name){const notes=SOUNDS[name];if(off||quiet||!notes)return;
    try{audio||=new AudioContext();void audio.resume();const now=audio.currentTime;
      for(const [at,hz,long,loud] of notes){const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=hz;g.gain.setValueAtTime(0,now+at);g.gain.linearRampToValueAtTime(loud,now+at+.012);g.gain.exponentialRampToValueAtTime(.0003,now+at+long);o.connect(g).connect(audio.destination);o.start(now+at);o.stop(now+at+long+.02);}}catch{}}
  function setMuted(value){off=!!value;try{localStorage.setItem(KEY,off?'1':'0');}catch{}}
  // Moving between tabs and steps, wherever they are.
  document.addEventListener('click',e=>{if(e.target.closest?.('header nav .tab,.flow-steps>button,.cal-tabs>button'))play('tap');});
  // quiet: Competition mode, whatever the menu says.
  return {play,muted:()=>off||quiet,setMuted,setQuiet:value=>{quiet=!!value;}};
})();
