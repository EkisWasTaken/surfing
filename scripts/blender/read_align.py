# Reads the handles from a saved alignment file into scripts/blender/holds/<set>.json, which fit_viewmodel.py builds from.
#   blender -b align/m9.blend -P scripts/blender/read_align.py
import json
import os
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
name = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
dg = bpy.context.evaluated_depsgraph_get()


def rigid(m):
    """Position and rotation only: a stray scale on a handle must not stretch the arm."""
    loc, rot, _ = m.decompose()
    out = rot.to_matrix().to_4x4()
    out.translation = loc
    return out


flat = lambda m: [c for row in m for c in row]
kn = bpy.data.objects['Knife']
prev = Matrix([kn['adj'][i:i + 4] for i in range(0, 16, 4)])
adj = rigid(kn.matrix_basis) @ Matrix.Translation(-Vector(kn['ring'])) @ prev
hold = {
    'hand': flat(rigid(bpy.data.objects['Hand'].evaluated_get(dg).matrix_world)),
    'fore': flat(rigid(bpy.data.objects['Forearm'].evaluated_get(dg).matrix_world)),
    'knife': flat(adj),
}
if 'Left Hand' in bpy.data.objects:
    hold['left_hand'] = flat(rigid(bpy.data.objects['Left Hand'].evaluated_get(dg).matrix_world))
    hold['left_fore'] = flat(rigid(bpy.data.objects['Left Forearm'].evaluated_get(dg).matrix_world))
if 'fingers_editable' in kn:
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    hold['fingers'] = {b.name: list(b.rotation_quaternion) for b in arm.pose.bones if b.name.startswith('Finger_') and not b.name.endswith('_end')}
os.makedirs(os.path.join(ROOT, 'scripts', 'blender', 'holds'), exist_ok=True)
path = os.path.join(ROOT, 'scripts', 'blender', 'holds', name + '.json')
with open(path, 'w') as f:
    json.dump(hold, f, indent=1)
print('hold saved', path)
