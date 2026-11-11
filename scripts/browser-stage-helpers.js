import { PerspectiveCamera } from 'three';

export async function openEntry(page) {
  const trigger=page.locator('[data-action="openEntry"]');
  await page.locator('#nickname').waitFor({state:'attached'});
  if(!await page.locator('#nickname').isVisible())await trigger.click();
  await page.locator('#nickname').waitFor({state:'visible'});
}

// Exercise the same visible controls as players, including the settings drawer.
export async function closeStagePanel(page) {
  if (await page.locator('#stage-dialog[open]').count()) {
    await page.locator('[data-action="closeStagePanel"]').click();
    await page.locator('#stage-dialog[open]').waitFor({state:'hidden'});
  }
}

export async function openStagePanel(page, action) {
  await closeStagePanel(page);
  if(action==='openPlayers'&&!await page.locator('[data-action="openPlayers"]').count()){
    await page.locator('[data-player]').first().click();
    if(await page.locator('[data-action="allPlayers"]').isVisible())await page.locator('[data-action="allPlayers"]').click();
  }else await page.locator(`[data-action="${action}"]`).first().click();
  await page.locator('#stage-dialog[open]').waitFor();
}

export async function toggleBoard(page, label) {
  const direct=page.getByRole('button',{name:label,exact:true});
  if (!await direct.isVisible()) await openStagePanel(page,'openSettings');
  await page.getByRole('button',{name:label,exact:true}).click();
  await closeStagePanel(page);
}

export async function boardCamera(page,bounds,far=150) {
  // The WS frame can arrive before React commits and the scene's next frame.
  // Read one rendered camera atomically rather than mixing frame attributes.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const shot=await page.locator('#board canvas').evaluate(canvas=>({position:JSON.parse(canvas.dataset.camera),target:JSON.parse(canvas.dataset.cameraTarget||'[0,0,0]'),view:JSON.parse(canvas.dataset.cameraView||'null')}));
  const camera=new PerspectiveCamera(34,bounds.width/bounds.height,.1,far);
  camera.position.fromArray(shot.position);
  camera.lookAt(...shot.target);
  const view=shot.view;
  if(view?.enabled) camera.setViewOffset(view.fullWidth,view.fullHeight,view.offsetX,view.offsetY,view.width,view.height);
  camera.updateMatrixWorld();
  return camera;
}
