# Builds the game's retro first-person arms and knife (Classic mode), entirely from code, and exports them as GLB.
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/blender/viewmodels.py
# Space: metres, camera at the origin looking along +Y, +X right, +Z up (glTF export makes that three's -Z forward).
# Arms are built along +Y with the wrist at the origin, palm down; each arm's bone then poses it into view.
import math
import os
import sys
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'viewmodel')
FPS = 60


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def material(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat)
    return o


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# Finger layout for a right hand, palm down: name, knuckle x, segment lengths, radius.
FINGERS = [
    ('index', -0.029, (0.044, 0.027, 0.021), 0.0086),
    ('middle', -0.0095, (0.048, 0.030, 0.022), 0.0088),
    ('ring', 0.010, (0.045, 0.028, 0.021), 0.0084),
    ('pinky', 0.0285, (0.035, 0.021, 0.018), 0.0072),
]
KNUCKLE_Y = 0.092
THUMB = [(-0.036, 0.016, -0.008), (-0.058, 0.044, -0.016), (-0.070, 0.074, -0.020), (-0.076, 0.097, -0.021)]


def segments(side):
    """Every bone of one arm: name -> (head, tail, parent)."""
    s = '_R' if side > 0 else '_L'
    v = lambda x, y, z: Vector((x * side, y, z))
    out = {'arm' + s: (v(0, -0.34, 0), v(0, 0, 0), None), 'hand' + s: (v(0, 0, 0), v(0, KNUCKLE_Y, 0), 'arm' + s)}
    for name, x, lengths, _ in FINGERS:
        y, parent = KNUCKLE_Y, 'hand' + s
        for i, l in enumerate(lengths):
            bone = f'{name}{i}{s}'
            out[bone] = (v(x, y, 0), v(x, y + l, 0), parent)
            y, parent = y + l, bone
    parent = 'hand' + s
    for i in range(3):
        bone = f'thumb{i}{s}'
        out[bone] = (v(*THUMB[i]), v(*THUMB[i + 1]), parent)
        parent = bone
    return out


def make_armature(name, sides):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    every = {}
    for side in sides:
        every.update(segments(side))
    for n, (head, tail, _) in every.items():
        b = data.edit_bones.new(n)
        b.head, b.tail = head, tail
    for n, (_, _, parent) in every.items():
        if parent:
            data.edit_bones[n].parent = data.edit_bones[parent]
    # The knife spins around its own origin (the ring on the index finger), riding the hand.
    k = data.edit_bones.new('knife')
    k.head, k.tail = Vector((-0.033, 0.072, -0.030)), Vector((-0.033, 0.102, -0.030))
    k.parent = data.edit_bones['hand_R']
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm, every


# ---------- Retro set: hard boxes, a handful of flat colours, a straight knife ----------
def box_between(bm, a, b, w, h):
    """A box from a to b (bones here run along +Y or close to it), w across and h tall."""
    d = (b - a)
    m = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4() @ Matrix.Diagonal((w, d.length, h, 1))
    bmesh.ops.create_cube(bm, size=1, matrix=m)


def retro_arm(side, skin_mat, sleeve_mat, glove_mat, bones):
    s = '_R' if side > 0 else '_L'
    v = lambda x, y, z: Vector((x * side, y, z))
    parts = []
    def part(name, mat, shapes, group):
        bm = bmesh.new()
        for shape in shapes:
            box_between(bm, *shape)
        o = obj_from_bm(bm, name + s, mat)
        o.vertex_groups.new(name=group).add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        parts.append(o)
    # Forearm taper and rolled cuff.
    part('sleeve', sleeve_mat, [(v(0, -0.36, 0), v(0, -0.17, 0), 0.094, 0.082), (v(0, -0.17, 0), v(0, -0.055, 0), 0.080, 0.070), (v(0, -0.055, 0), v(0, -0.02, 0), 0.088, 0.076)], 'arm' + s)
    part('wrist', skin_mat, [(v(0, -0.02, 0), v(0, 0.004, 0), 0.062, 0.046)], 'arm' + s)
    part('palm', glove_mat, [(v(0, 0.0, 0), v(0, KNUCKLE_Y, 0), 0.078, 0.034)], 'hand' + s)
    for name, x, lengths, r in FINGERS:
        y = KNUCKLE_Y
        for i, l in enumerate(lengths):
            part(f'{name}{i}', glove_mat if i == 0 else skin_mat, [(v(x, y, 0), v(x, y + l, 0), r * 1.9, r * 1.9)], f'{name}{i}{s}')
            y += l
    for i in range(3):
        part(f'thumb{i}', glove_mat if i == 0 else skin_mat, [(v(*THUMB[i]), v(*THUMB[i + 1]), 0.021, 0.019)], f'thumb{i}{s}')
    return parts


def retro_knife(steel, grip, guard):
    """Straight knife along the fist: blade out of the thumb side, pommel past the little finger."""
    o = Vector((-0.033, 0.072, -0.030))
    bm = bmesh.new()
    # Tapered blade: wide at the guard, narrowing in hard steps to a point.
    steps = [(0.0, 0.026), (0.075, 0.024), (0.115, 0.016), (0.14, 0.0)]
    verts = []
    for x, w in steps:
        p = o + Vector((-x - 0.014, 0, 0))
        verts.append([bm.verts.new(p + Vector((0, w / 2, 0.0028))), bm.verts.new(p + Vector((0, w / 2, -0.0028))), bm.verts.new(p + Vector((0, -w / 2, 0.0001))), bm.verts.new(p + Vector((0, -w / 2, -0.0001)))])
    for r0, r1 in zip(verts, verts[1:]):
        bm.faces.new((r0[0], r1[0], r1[2], r0[2]))
        bm.faces.new((r0[1], r0[3], r1[3], r1[1]))
        bm.faces.new((r0[0], r0[1], r1[1], r1[0]))
        bm.faces.new((r0[2], r1[2], r1[3], r0[3]))
    blade = obj_from_bm(bm, 'blade', steel)
    bm = bmesh.new()
    box_between(bm, o + Vector((-0.002, 0, 0)), o + Vector((0.100, 0, 0)), 0.024, 0.020)
    box_between(bm, o + Vector((0.100, 0, 0)), o + Vector((0.118, 0, 0)), 0.030, 0.026)
    handle = obj_from_bm(bm, 'handle', grip)
    bm = bmesh.new()
    box_between(bm, o + Vector((-0.016, 0, 0)), o + Vector((-0.002, 0, 0)), 0.052, 0.024)
    cross = obj_from_bm(bm, 'guard', guard)
    parts = [blade, handle, cross]
    for p in parts:
        p.vertex_groups.new(name='knife').add(list(range(len(p.data.vertices))), 1.0, 'REPLACE')
    return parts


# ---------- Animation ----------
# Arm poses: position of the elbow (camera space) and euler degrees, applied roll (Y), then pitch (X), then yaw (Z).
ARM_R = (Vector((0.325, 0.03, -0.235)), Vector((18, 66, 36)))
ARM_L = (Vector((-0.36, -0.02, -0.285)), Vector((14, -58, -33)))
HOLD_WRIST = Vector((-42, 0, 0))  # flexed in: the knife's flat side faces the camera and the blade sweeps towards the middle


def fist(curls=(76, 96, 60), spread=1.0):
    pose = {}
    for name, *_ in FINGERS:
        for i in range(3):
            pose[f'{name}{i}_R'] = Vector((-curls[i], 0, 0))
    pose['thumb0_R'] = Vector((-12, 0, -30))
    pose['thumb1_R'] = Vector((-20, 0, -24))
    pose['thumb2_R'] = Vector((-18, 0, -22))
    return pose


def relaxed():
    pose = {}
    for name, *_ in FINGERS:
        for i, c in enumerate((30, 42, 26)):
            pose[f'{name}{i}_L'] = Vector((-c, 0, 0))
    pose['thumb0_L'] = Vector((-10, 0, 14))
    pose['thumb1_L'] = Vector((-16, 0, 12))
    pose['thumb2_L'] = Vector((-12, 0, 10))
    return pose


class Key:
    """One keyframe: offsets from the resting hold. loc in metres (camera space), rot in degrees, wrist in degrees, knife spin in degrees."""

    def __init__(self, t, loc=(0, 0, 0), rot=(0, 0, 0), wrist=(0, 0, 0), spin=0, left=(0, 0, 0), interp='BEZIER'):
        self.t, self.loc, self.rot, self.wrist, self.spin, self.left, self.interp = t, Vector(loc), Vector(rot), Vector(wrist), spin, Vector(left), interp


DRAW = [Key(0, (0.02, -0.08, -0.26), (-34, -20, 18), (30, 0, 0), -360, (0, 0, -0.1)), Key(0.34, (0, 0.006, 0.012), (3, 2, -2), (-8, 0, 0), -20), Key(0.5, (0, -0.003, -0.004), (-1, 0, 1), (3, 0, 0), 4), Key(0.7)]
IDLE = [Key(0), Key(2, (0.001, 0, 0.0035), (0.7, 0, -0.5), (1.5, 0, 0), 0, (0, 0, 0.003)), Key(4)]
# The swings pivot at the elbow: yaw (rot.z) sweeps the blade across the screen, the wrist snaps through ahead of it.
LIGHT1 = [Key(0), Key(0.09, (0.022, -0.02, 0.022), (6, 6, -20), (14, 0, -26)), Key(0.24, (-0.13, 0.05, -0.05), (-9, -14, 42), (-22, 0, 34)), Key(0.34, (-0.09, 0.02, -0.08), (-14, -8, 30), (-12, 0, 18)), Key(0.5)]
LIGHT2 = [Key(0), Key(0.09, (-0.08, -0.02, 0.012), (4, -8, 24), (10, 0, 30)), Key(0.24, (0.075, 0.05, -0.045), (-8, 12, -24), (-20, 0, -36)), Key(0.34, (0.05, 0.02, -0.07), (-12, 7, -14), (-10, 0, -16)), Key(0.5)]
HEAVY = [Key(0), Key(0.26, (0.022, -0.085, 0.052), (18, -8, -6), (24, 0, -6)), Key(0.42, (-0.052, 0.20, -0.012), (-5, 6, 9), (-24, 0, 4)), Key(0.58, (-0.048, 0.185, -0.018), (-7, 5, 8), (-20, 0, 3)), Key(1.0)]
INSPECT = [
    Key(0),
    Key(0.55, (-0.075, 0.02, 0.05), (10, -42, 16), (-14, 0, 8)),  # blade up to the light, flat side first
    Key(1.35, (-0.08, 0.025, 0.055), (12, -46, 18), (-16, 0, 12)),
    Key(1.85, (-0.075, 0.02, 0.045), (6, 72, 14), (10, 0, -8)),  # roll over to show the other side
    Key(2.55, (-0.07, 0.02, 0.04), (4, 76, 14), (12, 0, -10)),
    Key(2.85, (-0.04, 0.01, 0.015), (4, 12, 6), (0, 0, 0), 0),
    Key(3.45, (-0.04, 0.01, 0.018), (4, 10, 6), (0, 0, 0), 720),  # twirl it round the finger
    Key(3.55, (-0.04, 0.01, 0.018), (3, 8, 5), (0, 0, 0), 720),
    Key(4.1, spin=720),
]


def clip(arm, name, keys, grip, off, loop=False):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for b in arm.pose.bones:
        b.rotation_mode = 'YXZ' if b.name.startswith('arm') else 'XYZ'
    for key in keys:
        frame = round(key.t * FPS) + 1
        p = arm.pose.bones
        rest_r = arm.data.bones['arm_R'].head_local
        rest_l = arm.data.bones['arm_L'].head_local
        # Pose-bone location is relative to the rest head, along the bone's rest axes (world axes here, bones run along +Y).
        p['arm_R'].location = ARM_R[0] - rest_r + key.loc
        rr = ARM_R[1] + key.rot
        p['arm_R'].rotation_euler = Euler((math.radians(rr.x), math.radians(rr.y), math.radians(rr.z)), 'YXZ')
        p['hand_R'].rotation_euler = Euler([math.radians(a) for a in key.wrist + HOLD_WRIST], 'XYZ')
        p['knife'].rotation_euler = Euler((0, 0, math.radians(key.spin + off)), 'XYZ')
        p['arm_L'].location = ARM_L[0] - rest_l + key.left
        p['arm_L'].rotation_euler = Euler([math.radians(a) for a in ARM_L[1]], 'YXZ')
        for b, r in {**grip, **relaxed()}.items():
            p[b].rotation_euler = Euler([math.radians(a) for a in r], 'XYZ')
        for b in p:
            if b.name.startswith('arm'):
                b.keyframe_insert('location', frame=frame)
            b.keyframe_insert('rotation_euler', frame=frame)
    arm.animation_data.action = None
    return act


def export(path, clips=None):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_apply=False, export_yup=True, export_cameras=False, export_lights=False, export_force_sampling=True)


def preview(arm, name, frames, fov):
    """Renders a few frames through the game's own camera, for checking by eye."""
    scene = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.angle = math.radians(fov)
    co = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(co)
    co.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = co
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x, scene.render.resolution_y = 800, 600
    out = os.environ.get('VM_PREVIEW')
    if out:
        for clip_name, t in frames:
            arm.animation_data.action = bpy.data.actions[clip_name]
            scene.frame_set(round(t * FPS) + 1)
            scene.render.filepath = os.path.join(out, f'{name}-{clip_name}-{t}.png')
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(co)


def retro():
    reset()
    skin_mat = material('skin', (0.55, 0.36, 0.25), 0.9)
    sleeve = material('sleeve', (0.20, 0.23, 0.13), 0.95)
    glove = material('glove', (0.10, 0.09, 0.07), 0.9)
    steel = material('steel', (0.70, 0.72, 0.75), 0.42, 0.75)
    grip = material('grip', (0.06, 0.05, 0.04), 0.85)
    guard = material('guard', (0.30, 0.30, 0.31), 0.5, 0.6)
    arm, bones = make_armature('viewmodel', (1, -1))
    parts = []
    for side in (1, -1):
        parts += retro_arm(side, skin_mat, sleeve, glove, bones)
    parts += retro_knife(steel, grip, guard)
    for p in parts:
        p.parent = arm
        m = p.modifiers.new('Armature', 'ARMATURE')
        m.object = arm
    g = fist((78, 98, 62))
    for name, keys in dict(draw=DRAW, idle=IDLE, light1=LIGHT1, light2=LIGHT2, heavy=HEAVY).items():
        clip(arm, name, keys, g, 0)
    preview(arm, 'retro', [('idle', 0), ('light1', 0.24), ('heavy', 0.42)], 90)
    export(os.path.join(OUT, 'retro.glb'))


os.makedirs(OUT, exist_ok=True)
retro()
print('viewmodels: done')
