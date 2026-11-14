"""Offline runtime-geometry review. Not WebGL, UI or real-device acceptance."""
import bpy, math, os, json
from mathutils import Vector
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'test-results','readability')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
variant=os.environ.get('PREVIEW_VARIANT','after')
source='comparison/before.glb' if variant=='before' else 'scene.glb'
style={'dayRim':.42,'nightRim':.58,'rimPower':3} if variant=='before' else json.load(open(os.path.join(out,'highlight.json')))
bpy.ops.import_scene.gltf(filepath=os.path.join(out,source))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=False
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG'
world=bpy.data.worlds.new('Coastal ambient');scene.world=world;world.use_nodes=True
background=world.node_tree.nodes.get('Background')
def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.8
 return m
sea_material=material('Preview sea',(.065,.23,.28))
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=6.4,depth=.12,location=(0,0,-.11));bpy.context.object.data.materials.append(sea_material)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
bpy.ops.object.light_add(type='AREA',location=(-3,-4,9));key=bpy.context.object;key.data.shape='DISK';key.data.size=5;key.rotation_euler=(-key.location).to_track_quat('-Z','Y').to_euler()
glass=[];pools=[];robbers=[]
for obj in list(scene.objects):
 if obj.name.startswith('RobberGoldenOutline'):
  m=bpy.data.materials.new('Golden silhouette shell');m.use_nodes=True;n=m.node_tree.nodes;n.clear();links=m.node_tree.links
  output=n.new('ShaderNodeOutputMaterial');mix=n.new('ShaderNodeMixShader');transparent=n.new('ShaderNodeBsdfTransparent');emit=n.new('ShaderNodeEmission');emit.inputs[0].default_value=(1,.665,.145,1);emit.inputs[1].default_value=1.4;geometry=n.new('ShaderNodeNewGeometry')
  links.new(geometry.outputs['Backfacing'],mix.inputs[0]);links.new(transparent.outputs[0],mix.inputs[1]);links.new(emit.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs[0]);obj.data.materials.clear();obj.data.materials.append(m)

 if obj.name.startswith('RoadLampGlass'):glass.append(obj.data.materials[0].node_tree.nodes.get('Principled BSDF'))
 if obj.name.startswith('RoadLampPools'):pools.append(obj)
 if obj.name.startswith('ReadabilityRobber'):
  m=obj.data.materials[0];nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
  # Reproduce the view-dependent warm edge used by the runtime shader, without
  # postprocess bloom or point lights. This remains an offline approximation.
  layer=nodes.new('ShaderNodeLayerWeight');power=nodes.new('ShaderNodeMath');power.operation='POWER';power.inputs[1].default_value=style['rimPower']
  strength=nodes.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=.58
  links.new(layer.outputs['Facing'],power.inputs[0]);links.new(power.outputs[0],strength.inputs[0]);links.new(strength.outputs[0],p.inputs['Emission Strength']);p.inputs['Emission Color'].default_value=(1,.69,.30,1);robbers.append(strength)
# Physical discs are a reference for clearance only; runtime labels are sprites.
board=json.load(open(os.path.join(out,'board.json')))
ivory=material('Number reference discs',(.94,.87,.66));ink=material('Number ink',(.10,.15,.12))
for tile in board['tiles']:
 if not tile.get('number'):continue
 x,y=tile['x'],-tile['z']
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.205,depth=.012,location=(x,y,.435));bpy.context.object.data.materials.append(ivory)
 bpy.ops.object.text_add(location=(x,y,.444));t=bpy.context.object;t.data.body=str(tile['number']);t.data.align_x='CENTER';t.data.align_y='CENTER';t.data.size=.22;t.data.extrude=.0001;t.data.materials.append(ink)
for phase in os.environ.get('PREVIEW_PHASES','day,night').split(','):
 night=phase=='night';key.data.energy=1000 if not night else 200;key.data.color=(1,.89,.72) if not night else (.60,.74,1)
 background.inputs['Color'].default_value=(.56,.66,.72,1) if not night else (.10,.17,.28,1);background.inputs['Strength'].default_value=.45 if not night else .27
 for p in glass:p.inputs['Emission Color'].default_value=(1,.45,.12,1);p.inputs['Emission Strength'].default_value=3.8 if night else 0
 for p in pools:p.hide_render=not night
 for r in robbers:r.inputs[1].default_value=style['nightRim'] if night else style['dayRim']
 for name,size,loc,scale in [('overview-landscape',(1266,760),(4,-6.4,9),14.8),('overview-portrait',(600,1100),(0,-3,12),19.7),('detail',(1200,850),(2,-4.2,5),4.7),('roads',(1200,850),(1.5,-2.6,4.8),2.8),('robber',(900,1000),(1.2,-3.4,3.7),1.8),('mobile',(390,844),(0,-3,12),21.3),('mobile-landscape',(844,390),(4,-6.4,9),19.3)]:
  if os.environ.get('PREVIEW_VIEWS') and name not in os.environ['PREVIEW_VIEWS'].split(','):continue
  scene.render.resolution_x,scene.render.resolution_y=size;scene.render.resolution_percentage=100
  target={'roads':(0,.85,.32),'robber':(0,-.47,.65)}.get(name,(0,0,.3))
  camera.location=loc;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
  scene.render.filepath=os.path.join(out,'comparison',f'{variant}-{name}-{phase}.png');bpy.ops.render.render(write_still=True)
