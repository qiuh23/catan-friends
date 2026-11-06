// Native dialogs keep focus, Escape and nested-modal semantics. One temporary
// history entry lets the system Back button dismiss only the topmost window.
export function installDialogDismissal({beforeClose=()=>{},onStageClose=()=>{},onChange=()=>{},canDismiss=()=>true}={}) {
  const dialogs=[...document.querySelectorAll('dialog')],order=[];
  const marker=`catan-overlay-${Date.now()}`;let ownBack=false,scheduled=false,routeURL=location.href;
  const top=()=>order.filter(dialog=>dialog.open).at(-1);
  function sync(){
    scheduled=false;onChange();
    if(top()&&!ownBack&&history.state?.catanOverlay!==marker)history.pushState({...history.state,catanOverlay:marker},'',location.href);
    else if(!top()&&!ownBack&&history.state?.catanOverlay===marker){ownBack=true;history.back();}
  }
  const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(sync);}};
  function dismiss(dialog){beforeClose();if(dialog.id==='stage-dialog')onStageClose();else dialog.close();}
  for(const dialog of dialogs){
    const show=dialog.showModal.bind(dialog);
    dialog.showModal=()=>{if(dialog.open)return;show();const index=order.indexOf(dialog);if(index>=0)order.splice(index,1);order.push(dialog);schedule();};
    let startedOutside=false;
    const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
    dialog.addEventListener('pointerdown',event=>{startedOutside=outside(event);});
    dialog.addEventListener('click',event=>{if(startedOutside&&outside(event)&&top()===dialog&&canDismiss(dialog))dismiss(dialog);startedOutside=false;});
    dialog.addEventListener('cancel',beforeClose);
    dialog.addEventListener('close',()=>{beforeClose();schedule();});
  }
  window.addEventListener('popstate',()=>{
    if(ownBack){ownBack=false;history.replaceState(history.state,'',routeURL);schedule();return;}
    const dialog=top();if(dialog){history.replaceState(history.state,'',routeURL);dismiss(dialog);}schedule();
  });
  return {replaceURL(url){routeURL=new URL(url,location.href).href;history.replaceState(history.state,'',routeURL);schedule();}};
}
