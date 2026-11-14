import * as THREE from 'three';
import {Batches,clearLayer} from '../terrain.js';
import {addRoadNetwork,addBoardBuildings} from '../pieces.js';

// Only reveal transforms belong to the home scene. Meshes, materials, model
// selection, road endpoints and owner-aware joins come from the match renderer.
export function createHomePieces(state,{assets,models,layer}) {
  const {board,homeDemo}=state,color=id=>state.players.find(p=>p.id===id)?.color||'#e57c54';
  const batch=new Batches(assets),connections=addRoadNetwork(batch,board,color,{tagPieces:true});
  batch.finish(layer);
  const moves=new Map(),rows=[],matrix=new THREE.Matrix4(),scale=new THREE.Matrix4();
  const roadIndices=new Map(homeDemo.roads.map((road,i)=>[road.edge,i]));
  for(const mesh of layer.children) {
    // Reveal stays within this small, always-visible island. Do not rebuild
    // bounds or instance buffers as roads appear, replay or change direction.
    mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.pieces.forEach((piece,index)=>{
      const key=`${piece.kind}:${piece.id}`;
      if(!moves.has(key)) {
        const road=piece.kind==='road'?homeDemo.roads[roadIndices.get(piece.id)]:null;
        const pivot=board.vertices[road?road.from:piece.id],to=road?board.vertices[road.to]:null;
        const frame=new THREE.Matrix4().makeTranslation(pivot.x,.2675,pivot.z);
        if(to)frame.multiply(new THREE.Matrix4().makeRotationY(-Math.atan2(to.z-pivot.z,to.x-pivot.x)));
        moves.set(key,{piece,frame,inverse:frame.clone().invert(),transform:new THREE.Matrix4(),amount:null});
      }
      rows.push({mesh,index,base:new THREE.Matrix4().fromArray(mesh.instanceMatrix.array,index*16),move:moves.get(key)});
    });
  }
  const buildings=homeDemo.buildings.map(({vertex,upgradeAt})=>{
    const source=board.vertices[vertex];
    const build=level=>{
      const group=new THREE.Group(),parts=new Batches(assets);
      addBoardBuildings(parts,[{...source,x:0,z:0,level}],color,models,group);parts.finish(group);
      group.position.set(source.x,0,source.z);layer.add(group);return group;
    };
    return {village:build(1),city:upgradeAt===undefined?null:build(2)};
  });
  let disposed=false;
  return {
    buildings,connections,
    animate(pose) {
      if(disposed)return;
      for(const move of moves.values()) {
        const {piece}=move;
        // A corner appears only as both incident roads arrive. The same-owner
        // shape is fixed at construction, so no topology allocation per frame.
        const amount=piece.kind==='road'?pose.roads[roadIndices.get(piece.id)]:Math.min(...piece.edges.map(id=>{
          const t=Math.max(0,Math.min(1,(pose.roads[roadIndices.get(id)]-.72)/.28));return t*t*(3-2*t);
        }));
        move.dirty=move.amount!==amount;if(!move.dirty)continue;move.amount=amount;
        if(amount===1)move.transform.identity();
        else {
          if(amount<=.001)scale.makeScale(0,0,0);
          else scale.makeScale(piece.kind==='road'?amount:1,piece.kind==='road'?1:amount,1);
          move.transform.multiplyMatrices(move.frame,scale).multiply(move.inverse);
        }
      }
      for(const row of rows)if(row.move.dirty) {
        matrix.multiplyMatrices(row.move.transform,row.base);row.mesh.setMatrixAt(row.index,matrix);row.mesh.instanceMatrix.needsUpdate=true;
      }
      buildings.forEach((building,i)=>{
        for(const kind of ['village','city']) {
          const group=building[kind],amount=pose.buildings[i][kind];if(!group)continue;
          group.visible=amount>.001;group.scale.set(1,Math.max(.001,amount),1);group.position.y=.27*(1-amount);
        }
      });
    },
    dispose() {
      if(disposed)return;disposed=true;
      for(const building of buildings)for(const group of Object.values(building))if(group)models.releaseLayer(group);
      clearLayer(layer);rows.length=0;moves.clear();
    },
  };
}
