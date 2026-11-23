'use strict';
// A finger leaves :hover on whatever it last touched, so a tapped button would keep its hover look until the next tap
// somewhere else. While the last pointer was a finger the page is marked data-touch and the stylesheets' hover looks
// stand down (each :hover carries :not(:where([data-touch] *))); the next mouse or trackpad move brings them back. The
// Steam Deck's trackpads count as a mouse, so a media query on the primary pointer cannot tell the two apart.
(()=>{
  const root=document.documentElement;
  const touch=on=>{if(on)root.dataset.touch='';else if('touch' in root.dataset)delete root.dataset.touch;};
  addEventListener('pointerdown',e=>touch(e.pointerType==='touch'),{capture:true,passive:true});
  addEventListener('pointermove',e=>{if(e.pointerType!=='touch')touch(false);},{capture:true,passive:true});
})();
