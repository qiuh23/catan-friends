// Board renderers distinguish a blank tap from placement and camera gestures.
// Here only genuine taps on noninteractive space outside the board dismiss costs.
export function installOutsideCostDismissal(root,onDismiss) {
  const pointers=new Set();let tap=null;
  const blank=target=>target?.closest&&!target.closest('#board,#play-dock,button,a,input,select,textarea,label,summary,[role="button"],dialog');
  root.addEventListener('pointerdown',event=>{
    pointers.add(event.pointerId);
    tap=pointers.size===1&&event.button===0&&blank(event.target)?{id:event.pointerId,x:event.clientX,y:event.clientY}:null;
  },true);
  root.addEventListener('pointermove',event=>{
    if(tap?.id===event.pointerId&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>3)tap=null;
  },true);
  root.addEventListener('pointerup',event=>{
    const dismiss=tap?.id===event.pointerId&&pointers.size===1&&blank(event.target)&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=3;
    pointers.delete(event.pointerId);tap=null;if(dismiss)onDismiss();
  },true);
  root.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);tap=null;},true);
}
