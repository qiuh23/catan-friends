/** Stable cosmetic choices only. Never change resource/number/topology or gameplay RNG. */
export const TERRAIN_VARIANTS=Object.freeze({forest:3,wheat:3,sheep:3,ore:3,clay:3,desert:2});
const aliases={wood:'forest',brick:'clay',forest:'forest',clay:'clay',wheat:'wheat',sheep:'sheep',ore:'ore',desert:'desert'};
export function hashAppearance(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function chooseTerrainVariant(tile,{seed=0,baseURL='/assets/v7/catan/variants/models/'}={}){
 if(!tile||!Number.isInteger(tile.id))throw new TypeError('tile.id must be a stable integer from the board');
 const resource=aliases[tile.resource];if(!resource)throw new RangeError('unknown terrain resource');
 if(!['string','number'].includes(typeof seed)||(typeof seed==='number'&&!Number.isFinite(seed)))throw new TypeError('seed must be a finite number or string');
 const key=JSON.stringify([seed,tile.id,resource]),index=hashAppearance(key+':variant')%TERRAIN_VARIANTS[resource]+1,rotationSteps=hashAppearance(key+':rotation')%6;
 const asset=`catan_terrain_${resource}_${String(index).padStart(2,'0')}`;
 return {asset,resource,index,rotationSteps,rotationY:rotationSteps*Math.PI/3,url:baseURL.replace(/\/?$/,'/')+asset+'.glb'};
}
export function groupTerrainVariants(tiles,options){
 if(!Array.isArray(tiles))throw new TypeError('tiles must be an array');const groups=new Map(),ids=new Set();
 for(const tile of tiles){if(!tile||!Number.isFinite(tile.x)||!Number.isFinite(tile.z))throw new TypeError('finite tile.x and tile.z required');if(ids.has(tile.id))throw new RangeError('duplicate tile.id');ids.add(tile.id);const choice=chooseTerrainVariant(tile,options);if(!groups.has(choice.asset))groups.set(choice.asset,{asset:choice.asset,resource:choice.resource,index:choice.index,url:choice.url,instances:[]});groups.get(choice.asset).instances.push({tileId:tile.id,x:tile.x,z:tile.z,rotationY:choice.rotationY});}
 return [...groups.values()];
}
/** Current createBoard has no seed field. Derive a stable cosmetic key without ownership/turn data. */
export function deriveTerrainAppearanceSeed(board){
 if(!board||!Array.isArray(board.tiles))throw new TypeError('board.tiles required');
 groupTerrainVariants(board.tiles,{seed:0});
 return 'layout:'+hashAppearance(JSON.stringify([...board.tiles].sort((a,b)=>a.id-b.id).map(t=>[t.id,t.resource,t.x,t.z]))).toString(16);
}
