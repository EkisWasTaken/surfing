# Fits the licensed arms and karambit together, animates them and exports the game's modern viewmodel.
#   MODELS=<folder with arms/ and knife/ unzipped> blender -b -P scripts/blender/fit_modern.py
# Models (both CC BY, see the README's credits): "FREE [FPS Arms] GameReady - RIGGED" by bamenwo05, "Karambit Knife" by ediirawan.
# Space: metres, camera at the origin looking along +Y, +X right, +Z up (glTF export makes that three's -Z forward).
import math
import os
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.environ['MODELS']
OUT = os.path.join(ROOT, 'src', 'assets', 'viewmodel', 'modern.glb')
FPS = 30
TEX = 1024


def frame(origin, y, z):
    """A rigid frame at origin: +Y along y, +Z as close to z as it can be, +X = Y x Z."""
    y = Vector(y).normalized()
    x = y.cross(Vector(z)).normalized()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = origin
    return m


def image(path, data=False):
    img = bpy.data.images.load(path)
    if data:
        img.colorspace_settings.name = 'Non-Color'
    if max(img.size) > TEX:
        img.scale(TEX, TEX)
    return img


def pbr(name, base, normal, rough, metal=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    def tex(path, data):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = image(path, data)
        return n
    nt.links.new(tex(base, False).outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex(rough, True).outputs['Color'], b.inputs['Roughness'])
    if metal:
        nt.links.new(tex(metal, True).outputs['Color'], b.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex(normal, True).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = FPS
at = lambda *p: os.path.join(MODELS, *p)

# ---------- Arms ----------
bpy.ops.import_scene.fbx(filepath=at('arms', 'source', 'FPS Arms.fbx'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm.animation_data_clear()
T = lambda n: at('arms', 'textures', n)
mesh.data.materials[0] = pbr('arm', T('Arm_and_Hand_Arm_BaseColor.png'), T('Arm_and_Hand_Arm_Normal.png'), T('Arm_and_Hand_Arm_Roughness.png'))
mesh.data.materials[1] = pbr('hand', T('Hand_Hand_BaseColor.png'), T('Hand_Hand_Normal.png'), T('Hand_Hand_Roughness.png'))

bones = arm.data.bones
head = lambda n: bones[n].head_local.copy()
# Rest frames, right arm: hand with +Y along the fingers, +Z out of the back of the hand, +X towards the little finger.
W0, E0, S0 = head('Hand_1.R'), head('Arm_2.R'), head('Arm_1.R')
HAND0 = frame(W0, head('Finger_3_1.R') - W0, (0, 0, 1))
FORE0 = frame(W0, W0 - E0, (0, 0, 1))
UPPER0 = frame(E0, E0 - S0, (0, 0, 1))
L_FORE = (W0 - E0).length
to_hand = HAND0.inverted()
print('HANDFRAME', {n: [round(c, 3) for c in to_hand @ head(n)] for n in ('Finger_1_1.R', 'Finger_2_1.R', 'Finger_3_1.R', 'Finger_4_1.R', 'Finger_5_1.R')})

# ---------- Knife: ring on the index finger, handle across the fist, grooves towards the fingers, tip curling forward ----------
RING_MODEL = Vector((1.84, 0, 0.79))  # ring centre in the model
KNIFE_SCALE = 0.038  # 4.97 long -> 19 cm
RING_HAND = Vector((-0.026, 0.062, -0.029))  # ring centre in hand space
bpy.ops.import_scene.fbx(filepath=at('knife', 'source', 'karambit_sketchfab', 'model', 'karambit_sketchfab.fbx'))
knife = bpy.data.objects['karambit_low']
bpy.data.objects.remove(bpy.data.objects['karambit_low.001'])  # the artist's second presentation copy
K = lambda n: at('knife', 'textures', 'karambit_low_karambit_' + n + '.png')
knife.data.materials[0] = pbr('knife', K('BaseColor'), K('Normal'), K('Roughness'), K('Metallic'))
# Model -X (ring to blade) -> hand +X, model -Z (grooves) -> hand +Y, model -Y -> hand +Z.
SEAT = Matrix(((-1, 0, 0), (0, 0, -1), (0, -1, 0))).to_4x4()
place = HAND0 @ Matrix.Translation(RING_HAND) @ SEAT @ Matrix.Scale(KNIFE_SCALE, 4) @ Matrix.Translation(-RING_MODEL)
knife.data.transform(place @ knife.matrix_world)
knife.matrix_world = Matrix.Identity(4)
knife.parent = arm
knife.modifiers.new('Armature', 'ARMATURE').object = arm
knife.vertex_groups.new(name='knife').add(list(range(len(knife.data.vertices))), 1.0, 'REPLACE')
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
kb = arm.data.edit_bones.new('knife')
kb.head = HAND0 @ RING_HAND
kb.tail = HAND0 @ (RING_HAND + Vector((0, 0.03, 0)))
kb.parent = arm.data.edit_bones['Hand_1.R']
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- Poses ----------
# Where the right hand rests in view, and the forearm leading to it.
WRIST = Vector((0.188, 0.375, -0.098))
HAND_X = Vector((-0.35, 0.25, -0.90))  # little finger side: down and in, so the blade hangs below the fist
HAND_Y = Vector((-0.72, 0.60, 0.35))  # fingers: in towards the middle of the screen
FORE_DIR = Vector((-0.42, 0.78, 0.46)).normalized()
x, y = HAND_X.normalized(), HAND_Y.normalized()
y = (y - x * y.dot(x)).normalized()
HAND_T = Matrix((x, y, x.cross(y))).transposed().to_4x4()
HAND_T.translation = WRIST
ELBOW = WRIST - FORE_DIR * L_FORE
FORE_T = frame(WRIST, FORE_DIR, HAND_T.col[2].to_3d() * 0.5 + Vector((0, 0, 0.5)))
UPPER_T = frame(ELBOW, (-0.25, 0.75, 0.55), (0, 0, 1))
# Left arm: mirrored into the lower left, fingers relaxed.
L_WRIST = Vector((0.225, 0.30, -0.185))
L_FORE_DIR = Vector((-0.34, 0.86, 0.38)).normalized()
L_HAND_T = frame(L_WRIST, (-0.55, 0.82, 0.12), (0.30, 0.20, 0.93))
L_FORE_T = frame(L_WRIST, L_FORE_DIR, (0.2, 0.1, 0.97))
L_ELBOW = L_WRIST - L_FORE_DIR * L_FORE
L_UPPER_T = frame(L_ELBOW, (-0.2, 0.8, 0.5), (0, 0, 1))
MIRROR = Matrix.Scale(-1, 4, (1, 0, 0))


def curl_axis_local(name, axis_hand, side):
    """A hand-space axis expressed in a bone's own rest axes."""
    axis = HAND0.to_3x3() @ axis_hand
    if side == 'L':
        axis = Vector((axis.x, -axis.y, -axis.z))  # the mirror of a rotation axis
    return (bones[name].matrix_local.to_3x3().inverted() @ axis).normalized()


GRIP = {
    '2': (86, 88, 52),  # index, through the ring
    '3': (84, 92, 58),
    '4': (84, 92, 58),
    '5': (86, 90, 58),
}
RELAX = {'2': (30, 34, 22), '3': (36, 40, 26), '4': (40, 44, 28), '5': (44, 48, 30)}
X, Z = Vector((1, 0, 0)), Vector((0, 0, 1))


def set_fingers(p, curls, side, thumb):
    for f, angles in curls.items():
        for seg, deg in enumerate(angles):
            n = f'Finger_{f}_{seg + 1}.{side}'
            p[n].rotation_quaternion = Quaternion(curl_axis_local(n, X, side), math.radians(-deg))
    for seg, (axis, deg) in enumerate(thumb):
        n = f'Finger_1_{seg + 1}.{side}'
        p[n].rotation_quaternion = Quaternion(curl_axis_local(n, axis, side), math.radians(deg))


THUMB_GRIP = [(Z, -24), (Z, -26), (Z, -24), (Z, -16)]
THUMB_RELAX = [(Z, -8), (Z, -10), (Z, -8), (Z, -6)]


class Key:
    """Offsets from the hold: loc in metres, rot in degrees (elbow pivot, Y then X then Z), wrist in degrees (hand axes), knife spin in degrees."""

    def __init__(self, t, loc=(0, 0, 0), rot=(0, 0, 0), wrist=(0, 0, 0), spin=0, left=(0, 0, 0)):
        self.t, self.loc, self.rot, self.wrist, self.spin, self.left = t, Vector(loc), Vector(rot), Vector(wrist), spin, Vector(left)


def sample(keys, t):
    if t <= keys[0].t:
        return keys[0]
    for a, b in zip(keys, keys[1:]):
        if t <= b.t:
            u = (t - a.t) / (b.t - a.t)
            u = u * u * (3 - 2 * u)
            return Key(t, a.loc.lerp(b.loc, u), a.rot.lerp(b.rot, u), a.wrist.lerp(b.wrist, u), a.spin + (b.spin - a.spin) * u, a.left.lerp(b.left, u))
    return keys[-1]


def rad(v):
    return tuple(math.radians(c) for c in v)


def pose(p, k):
    off = Matrix.Translation(ELBOW + k.loc) @ Euler(rad(k.rot), 'YXZ').to_matrix().to_4x4() @ Matrix.Translation(-ELBOW)
    hand = off @ HAND_T @ Euler(rad(k.wrist), 'XYZ').to_matrix().to_4x4() @ HAND0.inverted()
    fore = off @ FORE_T @ FORE0.inverted()
    upper = off @ UPPER_T @ UPPER0.inverted()
    left = Matrix.Translation(k.left)
    out = {
        'FPS Arms Root': Matrix.Translation((0, -0.6, -1.8)),
        'Arm_1.R': upper,
        'Arm_2.R': fore,
        'Hand_1.R': hand,
        'Arm_1.L': left @ MIRROR @ L_UPPER_T @ UPPER0.inverted() @ MIRROR,
        'Arm_2.L': left @ MIRROR @ L_FORE_T @ FORE0.inverted() @ MIRROR,
        'Hand_1.L': left @ MIRROR @ L_HAND_T @ HAND0.inverted() @ MIRROR,
    }
    for n, t in out.items():
        p[n].matrix = t @ bones[n].matrix_local
        bpy.context.view_layer.update()
    p['knife'].rotation_quaternion = Quaternion(curl_axis_local('knife', Z, 'R'), math.radians(k.spin))


MOVING = ['FPS Arms Root', 'Arm_1.R', 'Arm_2.R', 'Hand_1.R', 'Arm_1.L', 'Arm_2.L', 'Hand_1.L', 'knife']
FINGER_BONES = [b.name for b in bones if b.name.startswith('Finger_') and not b.name.endswith('_end')]


def bake(name, keys):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    p = arm.pose.bones
    for b in p:
        b.rotation_mode = 'QUATERNION'
    set_fingers(p, GRIP, 'R', THUMB_GRIP)
    set_fingers(p, RELAX, 'L', THUMB_RELAX)
    last = round(keys[-1].t * FPS)
    for f in (0, last):
        for n in FINGER_BONES:
            p[n].keyframe_insert('rotation_quaternion', frame=f + 1)
    prev = {}
    for f in range(last + 1):
        pose(p, sample(keys, f / FPS))
        for n in MOVING:
            q = p[n].rotation_quaternion
            if n in prev:
                q.make_compatible(prev[n])
            prev[n] = q.copy()
            p[n].keyframe_insert('location', frame=f + 1)
            p[n].keyframe_insert('rotation_quaternion', frame=f + 1)
    arm.animation_data.action = None


DRAW = [Key(0, (0.03, -0.06, -0.20), (-30, -14, 14), (24, 0, 0), -360, (0, 0, -0.08)), Key(0.34, (0, 0.006, 0.010), (3, 2, -2), (-6, 0, 0), -20), Key(0.5, (0, -0.003, -0.003), (-1, 0, 1), (2, 0, 0), 4), Key(0.7)]
IDLE = [Key(0), Key(2, (0.001, 0, 0.003), (0.6, 0, -0.4), (1.2, 0, 0), 0, (0, 0, 0.003)), Key(4)]
LIGHT1 = [Key(0), Key(0.09, (0.02, -0.018, 0.018), (5, 5, -16), (10, 0, -14)), Key(0.24, (-0.075, 0.035, 0.022), (-3, -7, 21), (-12, 0, 16)), Key(0.34, (-0.055, 0.016, 0.004), (-6, -4, 15), (-6, 0, 9)), Key(0.5)]
LIGHT2 = [Key(0), Key(0.09, (-0.07, -0.018, 0.012), (4, -6, 20), (8, 0, 18)), Key(0.24, (0.022, 0.035, 0.02), (-4, 7, -12), (-12, 0, -18)), Key(0.34, (0.012, 0.016, 0.0), (-6, 4, -7), (-6, 0, -8)), Key(0.5)]
HEAVY = [Key(0), Key(0.26, (0.02, -0.07, 0.04), (14, -6, -5), (16, 0, -4)), Key(0.42, (-0.045, 0.16, -0.01), (-4, 4, 7), (-16, 0, 3)), Key(0.58, (-0.042, 0.15, -0.015), (-6, 4, 6), (-13, 0, 2)), Key(1.0)]
INSPECT = [
    Key(0),
    Key(0.55, (-0.04, 0.0, 0.05), (6, 0, 8), (-10, 0, 12)),  # bring the blade up to the light
    Key(1.35, (-0.042, 0.0, 0.054), (7, 0, 9), (-12, 0, 16)),
    Key(1.9, (-0.085, 0.0, 0.085), (5, 10, 8), (-112, 0, 6)),  # turn the wrist over to show the other side
    Key(2.55, (-0.088, 0.0, 0.085), (5, 12, 8), (-118, 0, 8)),
    Key(2.85, (-0.02, 0.0, 0.016), (2, 8, 4), (0, 0, 0), 0),
    Key(3.45, (-0.02, 0.0, 0.018), (2, 6, 4), (0, 0, 0), 720),  # twirl it round the finger
    Key(4.0, spin=720),
]
bpy.context.scene.render.fps = FPS  # the FBX import reset it
for name, keys in dict(draw=DRAW, idle=IDLE, light1=LIGHT1, light2=LIGHT2, heavy=HEAVY, lookat01=INSPECT).items():
    bake(name, keys)

mesh.data.polygons.foreach_set('use_smooth', [True] * len(mesh.data.polygons))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_apply=False, export_yup=True, export_cameras=False, export_lights=False, export_force_sampling=True, export_image_format='WEBP', export_image_quality=85)
print('modern: done', os.path.getsize(OUT))
