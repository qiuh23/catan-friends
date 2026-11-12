"""Offline render of actual exported runtime geometry, not a web screenshot."""
import bpy, math, os, sys
from mathutils import Vector

root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'test-results','roads')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(out,'roads-model.glb'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=64
scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1500;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG'
world=bpy.data.worlds.new('Coastal ambient');scene.world=world;world.use_nodes=True
background=world.node_tree.nodes.get('Background')

def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.8
 return m

bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=5.8,depth=.12,location=(0,0,-.11));sea=bpy.context.object;sea.name='Preview sea base';sea.data.materials.append(material('Matte sea',(.09,.26,.32)))
bpy.ops.object.camera_add(location=(3.5,-5.6,4.8));camera=bpy.context.object;camera.name='Road detail camera'
target=Vector((0,0,.3));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=4.0;scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=(-3,-4,7));key=bpy.context.object;key.data.shape='DISK';key.data.size=5
key.rotation_euler=(-key.location).to_track_quat('-Z','Y').to_euler()

glasses=[];pools=[]
for obj in list(scene.objects):
 if obj.name.startswith('RoadLampGlass'):
  m=obj.data.materials[0];p=m.node_tree.nodes.get('Principled BSDF');glasses.append(p)
 if obj.name.startswith('RoadLampPools'):
  m=bpy.data.materials.new('Soft road pool '+obj.name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();links=m.node_tree.links
  output=n.new('ShaderNodeOutputMaterial');mix=n.new('ShaderNodeMixShader');transparent=n.new('ShaderNodeBsdfTransparent');emit=n.new('ShaderNodeEmission');emit.inputs[0].default_value=(1,.53,.20,1);emit.inputs[1].default_value=.8
  uv=n.new('ShaderNodeTexCoord');distance=n.new('ShaderNodeVectorMath');distance.operation='DISTANCE';distance.inputs[1].default_value=(.5,.5,0)
  remap=n.new('ShaderNodeMapRange');remap.clamp=True;remap.inputs['From Min'].default_value=0;remap.inputs['From Max'].default_value=.5;remap.inputs['To Min'].default_value=1;remap.inputs['To Max'].default_value=0
  square=n.new('ShaderNodeMath');square.operation='MULTIPLY';strength=n.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=.34
  links.new(uv.outputs['UV'],distance.inputs[0]);links.new(distance.outputs['Value'],remap.inputs['Value']);links.new(remap.outputs[0],square.inputs[0]);links.new(remap.outputs[0],square.inputs[1]);links.new(square.outputs[0],strength.inputs[0]);links.new(strength.outputs[0],mix.inputs[0]);links.new(transparent.outputs[0],mix.inputs[1]);links.new(emit.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs[0]);obj.data.materials.clear();obj.data.materials.append(m);pools.append(strength)

for phase in ['day','night']:
 night=phase=='night'
 key.data.energy=900 if not night else 180;key.data.color=(1,.89,.72) if not night else (.60,.74,1)
 background.inputs['Color'].default_value=(.56,.66,.72,1) if not night else (.10,.17,.28,1);background.inputs['Strength'].default_value=.45 if not night else .24
 for p in glasses:
  p.inputs['Emission Color'].default_value=(1,.45,.12,1);p.inputs['Emission Strength'].default_value=3.8 if night else 0
 for strength in pools:strength.inputs[1].default_value=.34 if night else 0
 scene.render.filepath=os.path.join(out,'road-detail-'+phase+'.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'road-detail-preview.blend'))
