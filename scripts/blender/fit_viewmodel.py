# Fits the licensed arms and a knife together, animates them and exports a viewmodel for the game.
#   MODELS=<folder with arms/ and knife/ unzipped> blender -b -P scripts/blender/fit_viewmodel.py
#   VM_SET=retro makes the Classic set instead: the same arms cut down to a low-poly, pixel-textured look, with a simple straight knife of ours.
# Models (both CC BY, see the README's credits): "FREE [FPS Arms] GameReady - RIGGED" by bamenwo05, "Karambit Knife" by ediirawan.
# Space: metres, camera at the origin looking along +Y, +X right, +Z up (glTF export makes that three's -Z forward).
import math
import os
import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.environ['MODELS']
RETRO = os.environ.get('VM_SET') == 'retro'
OUT = os.path.join(ROOT, 'src', 'assets', 'viewmodel', 'retro.glb' if RETRO else 'modern.glb')
FPS = 30
TEX = 128 if RETRO else 1024


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
        if RETRO:
            n.interpolation = 'Closest'  # chunky pixels
        return n
    nt.links.new(tex(base, False).outputs['Color'], b.inputs['Base Color'])
    if RETRO:
        b.inputs['Roughness'].default_value = 0.9
        return m
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

if RETRO:
    for mod in list(mesh.modifiers):
        mesh.modifiers.remove(mod)
    bpy.context.view_layer.objects.active = mesh
    dec = mesh.modifiers.new('cut', 'DECIMATE')
    dec.ratio = 0.14
    bpy.ops.object.modifier_apply(modifier=dec.name)
    mesh.modifiers.new('Armature', 'ARMATURE').object = arm
    print('RETRO arms tris', sum(len(p.vertices) - 2 for p in mesh.data.polygons))

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
RING_HAND = Vector((-0.026, 0.080, -0.027)) if RETRO else Vector((-0.026, 0.086, -0.030))  # knife origin in hand space


def flat(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


if RETRO:
    # Straight knife across the fist: blade out of the thumb side, pommel past the little finger. Hand space, then to rest.
    bm = bmesh.new()
    def box(x0, x1, w, t, mat):
        c = RING_HAND + Vector(((x0 + x1) / 2, 0, 0))
        made = bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(c) @ Matrix.Diagonal((x1 - x0, w, t, 1)))
        for v in made['verts']:
            for f in v.link_faces:
                f.material_index = mat
    box(-0.012, 0.098, 0.020, 0.014, 1)  # handle
    box(0.098, 0.112, 0.026, 0.020, 2)  # pommel
    box(-0.026, -0.012, 0.050, 0.024, 2)  # guard
    rows = []
    for x, w in [(-0.026, 0.027), (-0.105, 0.025), (-0.155, 0.015), (-0.185, 0.0)]:
        p = RING_HAND + Vector((x, 0, 0))
        rows.append([bm.verts.new(p + Vector((0, -w / 2, 0.0032))), bm.verts.new(p + Vector((0, -w / 2, -0.0032))), bm.verts.new(p + Vector((0, w / 2, -0.0003))), bm.verts.new(p + Vector((0, w / 2, 0.0003)))])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(HAND0)
    me = bpy.data.meshes.new('knife')
    bm.to_mesh(me)
    bm.free()
    knife = bpy.data.objects.new('knife', me)
    bpy.context.collection.objects.link(knife)
    for m in (flat('steel', (0.62, 0.64, 0.67), 0.38, 0.8), flat('grip', (0.05, 0.04, 0.03), 0.85), flat('guard', (0.26, 0.26, 0.27), 0.5, 0.6)):
        me.materials.append(m)
else:
    # Licensed karambit: ring on the index finger, handle across the fist, grooves towards the fingers, tip curling forward.
    RING_MODEL = Vector((1.84, 0, 0.79))  # ring centre in the model
    KNIFE_SCALE = 0.038  # 4.97 long -> 19 cm
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
WRIST = Vector((0.145, 0.300, -0.130)) if RETRO else Vector((0.168, 0.400, -0.112))
# Little finger side. Modern: down, a hammer grip with the blade below the fist. Classic: down and back, so the straight blade points up and forward.
HAND_X = Vector((0.16, -0.46, -0.87)) if RETRO else Vector((-0.24, 0.52, -0.82))
HAND_Y = Vector((-0.66, 0.72, -0.08)) if RETRO else Vector((-0.62, 0.76, 0.18))  # knuckles close to in line with the forearm, turned to show the blade's flat
FORE_DIR = Vector((-0.40, 0.84, 0.36)).normalized() if RETRO else Vector((-0.34, 0.88, 0.33)).normalized()
x, y = HAND_X.normalized(), HAND_Y.normalized()
y = (y - x * y.dot(x)).normalized()
HAND_T = Matrix((x, y, x.cross(y))).transposed().to_4x4()
HAND_T.translation = WRIST
ELBOW = WRIST - FORE_DIR * L_FORE
FORE_T = frame(WRIST, FORE_DIR, HAND_T.col[2].to_3d() * 0.5 + Vector((0, 0, 0.5)))
UPPER_T = frame(ELBOW, (-0.25, 0.75, 0.55), (0, 0, 1))
# Left arm: mirrored into the lower left, fingers relaxed.
L_WRIST = Vector((0.33, 0.22, -0.36))  # out of view until something brings it up
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


# ---------- Grip: each finger is searched against the knife's real surface ----------
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
knife_hand = (HAND0.inverted() @ Matrix.Identity(4))
KV = [knife_hand @ v.co for v in knife.data.vertices]
BVH = BVHTree.FromPolygons(KV, [tuple(p.vertices) for p in knife.data.polygons])
GROOVE_X = {'2': RING_HAND.x, '3': RING_HAND.x + 0.0255, '4': RING_HAND.x + 0.0468, '5': RING_HAND.x + 0.0684}  # the knuckles' own spacing suits the straight handle too
FINGER_R = {'2': 0.0082, '3': 0.0085, '4': 0.0082, '5': 0.0072}


def chain(f, side='R'):
    names = [f'Finger_{f}_{i}.{side}' for i in (1, 2, 3)]
    pts = [to_hand @ head(n) for n in names] + [to_hand @ head(f'Finger_{f}_3.{side}_end')]
    return names, pts


def fk(pts, axis, phi, angles):
    """Joint positions, and each joint's accumulated rotation, after spreading by phi and curling by angles (hand space)."""
    out, rots, p = [pts[0]], [], pts[0]
    R = Quaternion(Z, phi)
    for i, a in enumerate(angles):
        R = R @ Quaternion(axis, -a)
        rots.append(R.copy())
        p = p + R @ (pts[i + 1] - pts[i])
        out.append(p)
    return out, rots


def signed(p):
    loc, n, _, d = BVH.find_nearest(p)
    return d if (p - loc).dot(n) >= 0 else -d


def cost(f, joints):
    r, c = FINGER_R[f], 0.0
    for i in range(3):
        a, b = joints[i], joints[i + 1]
        for k in range(1, 5):
            p = a.lerp(b, k / 4)
            d = signed(p)
            if d < r:
                c += 60 * (r - d) ** 2  # never through the knife
            elif i > 0:
                c += (d - r) ** 2  # the last two joints close on it
            if i > 0 and p.z > -0.012 and p.y < 0.098:
                c += 40 * (p.z + 0.012) ** 2  # nor through the palm
    c += 6 * (joints[3].x - GROOVE_X[f]) ** 2 + 6 * (joints[1].x - GROOVE_X[f]) ** 2  # stay in this finger's groove
    if f == '2' and not RETRO:
        c += 12 * ((joints[0].lerp(joints[1], 0.75) - RING_HAND).length) ** 2  # through the ring
    return c


def solve(f):
    names, pts = chain(f)
    d0 = (pts[1] - pts[0]).normalized()
    axis = d0.cross(Z).normalized()
    best, deg = (1e9, None), math.radians
    for phi in range(-16, 17, 4):
        for a in range(40, 121, 8):
            for b in range(30, 121, 8):
                for c in range(10, 91, 10):
                    ang = (deg(a), deg(b), deg(c))
                    v = cost(f, fk(pts, axis, deg(phi), ang)[0])
                    if v < best[0]:
                        best = (v, (deg(phi), *ang))
    phi, *ang = best[1]
    step = deg(4)
    for _ in range(3):  # refine around the best
        for phi2 in (phi - step, phi, phi + step):
            for a in (ang[0] - step, ang[0], ang[0] + step):
                for b in (ang[1] - step, ang[1], ang[1] + step):
                    for c in (ang[2] - step, ang[2], ang[2] + step):
                        v = cost(f, fk(pts, axis, phi2, (a, b, c))[0])
                        if v < best[0]:
                            best = (v, (phi2, a, b, c))
        phi, *ang = best[1]
        step /= 2
    joints, rots = fk(pts, axis, phi, ang)
    d = [signed(j) for j in joints]
    print('GRIP', f, 'spread', round(math.degrees(phi)), 'curl', [round(math.degrees(x)) for x in ang], 'tip', [round(c, 3) for c in joints[3]], 'gaps mm', [round((x - FINGER_R[f]) * 1000, 1) for x in d])
    # Per-joint rest-space rotations: each bone adds its own on top of its parent's.
    prev, local = Quaternion(), {}
    for n, R in zip(names, rots):
        local[n] = prev.inverted() @ R
        prev = R
    return local, joints


GRIP_ROT = {}
JOINTS = {}
for f in '2345':
    rot, joints = solve(f)
    GRIP_ROT.update(rot)
    JOINTS[f] = joints


def solve_thumb():
    """The thumb closes over the index finger, its tip on the outside of the index's middle joint."""
    names = [f'Finger_1_{i}.R' for i in (1, 2, 3, 4)]
    pts = [to_hand @ head(n) for n in names] + [to_hand @ head('Finger_1_4.R_end')]
    target = JOINTS['2'][2] + Vector((-0.006, 0.004, -0.008))
    best, deg = (1e9, None), math.radians
    d = (pts[1] - pts[0]).normalized()
    flex = d.cross(Z).normalized()
    def run(a, b, c):
        R = Quaternion(Z, a) @ Quaternion(X, b)
        rots, p, out = [], pts[0], []
        for i in range(4):
            if i:
                R = R @ Quaternion(flex, -c)
            rots.append(R.copy())
            p = p + R @ (pts[i + 1] - pts[i])
            out.append(p.copy())
        return out, rots
    for a in range(-70, 11, 5):
        for b in range(-60, 31, 5):
            for c in range(0, 46, 5):
                out, _ = run(deg(a), deg(b), deg(c))
                v = (out[-1] - target).length ** 2
                for p in out:
                    q = signed(p)
                    if q < 0.009:
                        v += 40 * (0.009 - q) ** 2
                if v < best[0]:
                    best = (v, (a, b, c))
    a, b, c = best[1]
    out, rots = run(deg(a), deg(b), deg(c))
    print('THUMB', best[1], 'miss mm', round((out[-1] - target).length * 1000, 1))
    prev, local = Quaternion(), {}
    for n, R in zip(names, rots):
        local[n] = prev.inverted() @ R
        prev = R
    return local


GRIP_ROT.update(solve_thumb())
RELAX = {'2': (24, 30, 20), '3': (30, 36, 24), '4': (34, 40, 26), '5': (38, 44, 28)}
THUMB_RELAX = [(Z, -8), (Z, -10), (Z, -8), (Z, -6)]


def set_fingers(p):
    H = HAND0.to_3x3()
    for n, q in GRIP_ROT.items():
        B = bones[n].matrix_local.to_3x3()
        p[n].rotation_quaternion = (B.inverted() @ H @ q.to_matrix() @ H.inverted() @ B).to_quaternion()
    for f, angles in RELAX.items():
        for seg, a in enumerate(angles):
            n = f'Finger_{f}_{seg + 1}.L'
            p[n].rotation_quaternion = Quaternion(curl_axis_local(n, X, 'L'), math.radians(-a))
    for seg, (axis, a) in enumerate(THUMB_RELAX):
        n = f'Finger_1_{seg + 1}.L'
        p[n].rotation_quaternion = Quaternion(curl_axis_local(n, axis, 'L'), math.radians(a))


class Key:
    """Offsets from the hold: loc in metres, rot in degrees (elbow pivot, Y then X then Z), wrist in degrees (hand axes),
    knife spin in degrees, roll in degrees (the forearm turning over). ease is how this key is approached."""

    def __init__(self, t, loc=(0, 0, 0), rot=(0, 0, 0), wrist=(0, 0, 0), spin=0, left=(0, 0, 0), roll=0, ease='smooth'):
        self.t, self.loc, self.rot, self.wrist, self.spin, self.left, self.roll, self.ease = t, Vector(loc), Vector(rot), Vector(wrist), spin, Vector(left), roll, ease


EASE = {'smooth': lambda u: u * u * (3 - 2 * u), 'strike': lambda u: u * u * u, 'out': lambda u: 1 - (1 - u) ** 3, 'settle': lambda u: 1 - (1 - u) ** 2}


def sample(keys, t):
    if t <= keys[0].t:
        return keys[0]
    for a, b in zip(keys, keys[1:]):
        if t <= b.t:
            u = EASE[b.ease]((t - a.t) / (b.t - a.t))
            return Key(t, a.loc.lerp(b.loc, u), a.rot.lerp(b.rot, u), a.wrist.lerp(b.wrist, u), a.spin + (b.spin - a.spin) * u, a.left.lerp(b.left, u), a.roll + (b.roll - a.roll) * u)
    return keys[-1]


def rad(v):
    return tuple(math.radians(c) for c in v)


def pose(p, k):
    off = Matrix.Translation(ELBOW + k.loc) @ Euler(rad(k.rot), 'YXZ').to_matrix().to_4x4() @ Matrix.Translation(-ELBOW)
    turn = lambda a: Matrix.Translation(WRIST) @ Matrix.Rotation(math.radians(a), 4, FORE_DIR) @ Matrix.Translation(-WRIST)
    hand = off @ turn(k.roll) @ HAND_T @ Euler(rad(k.wrist), 'XYZ').to_matrix().to_4x4() @ HAND0.inverted()
    fore = off @ turn(k.roll * 0.6) @ FORE_T @ FORE0.inverted()  # a forearm twists less than the hand on the end of it
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
    set_fingers(p)
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


# Knife timing: a short wind-up, a strike that accelerates into contact, follow-through past it, then a slower settle.
DRAW = [
    Key(0, (0.05, -0.10, -0.20), (-34, -12, 14), (30, 0, 0), -360, (0, 0, -0.08)),
    Key(0.30, (0, 0.006, 0.012), (3, 1, -2), (-5, 0, 0), -24, ease='out'),  # up and the knife spins into the grip
    Key(0.46, (0, -0.004, -0.004), (-1, 0, 1), (2, 0, 0), 5, ease='settle'),
    Key(0.70),
]
IDLE = [Key(0), Key(2, (0.0012, 0, 0.0028), (0.5, 0, -0.35), (0.9, 0, 0), 0, (0, 0, 0.003)), Key(4)]
# Forehand: cocked up and out to the right, whipped down across the screen.
LIGHT1 = [
    Key(0),
    Key(0.09, (-0.005, -0.030, 0.050), (8, 4, -10), (12, 0, -8), ease='out'),
    Key(0.20, (-0.125, 0.070, 0.038), (-3, -5, 20), (-18, 0, 14), ease='strike'),
    Key(0.28, (-0.150, 0.060, 0.016), (-5, -7, 24), (-22, 0, 18), ease='settle'),
    Key(0.50, ease='smooth'),
]
# Backhand: starts across the body, snaps back out to the right.
LIGHT2 = [
    Key(0),
    Key(0.10, (-0.105, -0.020, 0.030), (-2, -6, 18), (-10, 0, 16), ease='out'),
    Key(0.21, (-0.040, 0.070, 0.036), (6, 6, -6), (14, 0, -14), ease='strike'),
    Key(0.29, (-0.030, 0.055, 0.020), (4, 8, -8), (17, 0, -18), ease='settle'),
    Key(0.50, ease='smooth'),
]
# Stab: pulled well back and up, driven straight in, held, drawn out.
HEAVY = [
    Key(0),
    Key(0.24, (-0.035, -0.105, 0.040), (14, -3, -2), (20, 0, -4), ease='out'),
    Key(0.37, (-0.060, 0.185, -0.022), (-7, 2, 8), (-16, 0, 4), ease='strike'),
    Key(0.54, (-0.058, 0.170, -0.028), (-8, 2, 7), (-14, 0, 3), ease='settle'),
    Key(1.0, ease='smooth'),
]
# Inspect: raised to the light, turned to show each side of the blade, then twirled round the finger and caught.
INSPECT = [
    Key(0),
    Key(0.55, (-0.060, -0.040, 0.075), (6, 0, 10), (-6, 0, 4), roll=-26),
    Key(1.30, (-0.063, -0.040, 0.080), (7, 0, 11), (-8, 0, 5), roll=-30),
    Key(1.95, (-0.070, -0.045, 0.080), (6, 0, 12), (-6, 0, 2), roll=58),
    Key(2.65, (-0.072, -0.045, 0.078), (6, 0, 12), (-8, 0, 2), roll=64),
    Key(3.00, (-0.030, -0.015, 0.030), (3, 0, 6), (0, 0, 0)),
    Key(3.55, (-0.030, -0.015, 0.034), (3, 0, 6), (0, 0, 0), 720, ease='settle'),
    Key(4.00, spin=720),
]
bpy.context.scene.render.fps = FPS  # the FBX import reset it
def timed(keys, f):
    for k in keys:
        k.t *= f
    return keys


# Classic has quicker slashes (a 0.35 s cooldown) and no inspect.
CLIPS = dict(draw=DRAW, idle=IDLE, light1=timed(LIGHT1, 0.7), light2=timed(LIGHT2, 0.7), heavy=HEAVY) if RETRO else dict(draw=DRAW, idle=IDLE, light1=LIGHT1, light2=LIGHT2, heavy=HEAVY, lookat01=INSPECT)
for name, keys in CLIPS.items():
    bake(name, keys)

mesh.data.polygons.foreach_set('use_smooth', [not RETRO] * len(mesh.data.polygons))  # hard facets for the retro look
mesh.data.update()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_apply=False, export_yup=True, export_cameras=False, export_lights=False, export_force_sampling=True, export_image_format='WEBP', export_image_quality=85)
print('viewmodel done', OUT, os.path.getsize(OUT))

