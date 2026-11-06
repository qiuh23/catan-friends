// Place a bounded preview beside its actual trigger, avoiding public status
// and action controls. Compact docks may use a narrower single-line preview.
export function anchorChatPreview(preview, trigger, obstacles=[],rectangles=[]) {
  if(!preview?.firstElementChild || !trigger?.isConnected || !trigger.getClientRects().length)return;
  const viewport=visualViewport,style=getComputedStyle(preview);
  const pad=edge=>Math.max(8,parseFloat(style.getPropertyValue(`--chat-safe-${edge}`))||0);
  const left=(viewport?.offsetLeft||0)+pad('left'),top=(viewport?.offsetTop||0)+pad('top');
  const right=(viewport?.offsetLeft||0)+(viewport?.width||innerWidth)-pad('right'),bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-pad('bottom');
  const anchor=trigger.getBoundingClientRect(),gap=10;
  const blocked=obstacles.filter(node=>node?.getClientRects().length).map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height).concat(rectangles);
  for(const desired of [236,196,156,104]) {
    preview.dataset.compact=String(desired<150);
    preview.style.width=`${Math.min(desired,right-left)}px`;
    const {width,height}=preview.getBoundingClientRect();
    const clampX=x=>Math.max(left,Math.min(right-width,x));
    const candidates=[
      [anchor.left-width-gap,anchor.top],[anchor.right+gap,anchor.top],
      [clampX(anchor.right-width),anchor.bottom+gap],[clampX(anchor.left),anchor.bottom+gap],
      [right-width,anchor.bottom+gap],[anchor.left-width-gap,anchor.bottom+gap],
      [clampX(anchor.right-width),anchor.top-height-gap],[clampX(anchor.left),anchor.top-height-gap],
    ];
    for(const r of blocked)if(r.bottom>=anchor.bottom&&r.bottom<anchor.bottom+100) {
      candidates.push([clampX(anchor.right-width),r.bottom+gap],[clampX(anchor.left),r.bottom+gap]);
    }
    const chosen=candidates.find(([x,y])=>x>=left&&x+width<=right&&y>=top&&y+height<=bottom && !blocked.some(r=>x<r.right+4&&x+width>r.left-4&&y<r.bottom+4&&y+height>r.top-4));
    if(chosen){preview.style.visibility='visible';preview.style.left=`${chosen[0]}px`;preview.style.top=`${chosen[1]}px`;return;}
  }
  preview.style.visibility='hidden';
}
