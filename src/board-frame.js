// HUD space is reserved inside the scene, never by shrinking its canvas.
// Dialogs intentionally do not participate in this frame.
export function boardFrame(width,height,padding={}) {
  const clean=value=>Number.isFinite(value)?Math.max(0,value):0;
  let left=clean(padding.left),right=clean(padding.right),top=clean(padding.top),bottom=clean(padding.bottom);
  const xScale=Math.min(1,width*.8/(left+right||1)),yScale=Math.min(1,height*.8/(top+bottom||1));
  left*=xScale;right*=xScale;top*=yScale;bottom*=yScale;
  return {left,right,top,bottom,width:width-left-right,height:height-top-bottom,
    centerX:(left-right)/width,centerY:(bottom-top)/height,
    halfWidth:(width-left-right)/width*.96,halfHeight:(height-top-bottom)/height*.96};
}
