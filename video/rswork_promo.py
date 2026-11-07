"""
RsWork — 3-minute product promo, built procedurally in Blender (5.x, Eevee).

Every shape, text, icon and animation is created by this script, so the video can be
re-edited by changing text/timings here and re-rendering.

  Open in Blender to scrub/tweak:   blender -P video/rswork_promo.py
  Save a .blend:                    blender -b -P video/rswork_promo.py -- --save video/out/rswork_promo.blend
  Preview stills (seconds):         blender -b -P video/rswork_promo.py -- --preview video/out/preview 5 20 45
                                    (add the word `full` for full-resolution stills)
  Export event times (for the music): blender -b -P video/rswork_promo.py -- --events video/out/events.json
  Render PNG frames:                blender -b -P video/rswork_promo.py -- --render video/out/frames [first last]

Then encode with video/render.ps1 (adds the music track if present).
"""
import bpy
import bmesh
import math
import os
import random
import sys

FPS = 30
TOTAL = 180.0
LAST = int(TOTAL * FPS)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
LOGO = os.path.join(REPO, "frontend", "public", "rswork_logo.png")
MENU = os.path.join(REPO, "scripts", "assets", "menu")
FONT_DIR = r"C:\Windows\Fonts"


def F(t):
    """Seconds -> frame number (frame 1 = 0 s)."""
    return max(1, int(round(t * FPS)) + 1)


# --------------------------------------------------------------------------- #
# Palette (sRGB hex) — taken from the app theme + the logo's orange
# --------------------------------------------------------------------------- #
HEX = {
    "bg": "#0B1620", "card": "#132434", "card2": "#1A3045", "line": "#2A4862",
    "teal": "#2E9CCA", "primary": "#386F94", "sky": "#C4D7E4", "orange": "#F28B30",
    "green": "#2FB37A", "red": "#E05A4F", "white": "#F3F7FA", "muted": "#8DA4B6",
    "dim": "#5A7186", "screen": "#F1F5F8", "paper": "#FFFFFF", "ink": "#16232E",
    "ink2": "#617281", "rule": "#DCE4EA", "frame": "#04080C", "kds": "#0E1922",
    "kcol": "#152532", "ticket": "#20364A", "grey": "#C3CED7", "chip": "#E3ECF3",
    "black": "#000000",
}


def lin(c):
    if isinstance(c, str):
        h = HEX.get(c, c).lstrip("#")
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# --------------------------------------------------------------------------- #
# Scene setup
# --------------------------------------------------------------------------- #
FONT = {}
MAT = {}
CAM = None
EVENTS = {"shot": [], "tap": [], "pop": []}   # exported for the sound design


def setup():
    global CAM
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    r = sc.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, 100
    r.fps = FPS
    sc.frame_start, sc.frame_end = 1, LAST
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    ee = sc.eevee
    ee.taa_render_samples = 16
    for a in ("use_shadows", "use_raytracing", "use_gtao", "use_bloom", "use_ssr",
              "use_motion_blur", "use_volumetric_shadows"):
        if hasattr(ee, a):
            try:
                setattr(ee, a, False)
            except Exception:
                pass

    world = bpy.data.worlds.new("World")
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    world.node_tree.nodes["Background"].inputs[0].default_value = (*lin("bg"), 1)

    cam = bpy.data.cameras.new("Camera")
    cam.type = "ORTHO"
    cam.ortho_scale = 19.2          # 1 unit = 100 px; frame is x[-9.6,9.6] y[-5.4,5.4]
    cam.clip_start, cam.clip_end = 0.1, 100
    CAM = bpy.data.objects.new("Camera", cam)
    CAM.location = (0, 0, 30)
    sc.collection.objects.link(CAM)
    sc.camera = CAM

    for k, f in (("reg", "segoeui.ttf"), ("semi", "seguisb.ttf"), ("bold", "segoeuib.ttf"),
                 ("black", "seguibl.ttf"), ("light", "segoeuil.ttf"), ("icon", "SegoeIcons.ttf")):
        FONT[k] = bpy.data.fonts.load(os.path.join(FONT_DIR, f))

    MAT["flat"] = flat_material()
    MAT["glow"] = glow_material()


def _blended(m):
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        m.blend_method = "BLEND"
    m.use_backface_culling = False


def _base_nodes(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    al = nt.nodes.new("ShaderNodeAttribute")
    al.attribute_type, al.attribute_name = "OBJECT", "rs_alpha"
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    _blended(m)
    return m, nt, al, em, mx


def flat_material():
    """Unlit colour; colour + alpha come from the object's custom props (animatable)."""
    m, nt, al, em, mx = _base_nodes("FLAT")
    col = nt.nodes.new("ShaderNodeAttribute")
    col.attribute_type, col.attribute_name = "OBJECT", "rs_color"
    nt.links.new(col.outputs["Color"], em.inputs["Color"])
    nt.links.new(al.outputs["Fac"], mx.inputs[0])
    return m


def glow_material():
    """Radial soft blob (for glows and shadows)."""
    m, nt, al, em, mx = _base_nodes("GLOW")
    col = nt.nodes.new("ShaderNodeAttribute")
    col.attribute_type, col.attribute_name = "OBJECT", "rs_color"
    nt.links.new(col.outputs["Color"], em.inputs["Color"])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(tc.outputs["Object"], ln.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.interpolation_type = "SMOOTHSTEP"
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    nt.links.new(ln.outputs["Value"], mr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(mr.outputs["Result"], mul.inputs[0])
    nt.links.new(al.outputs["Fac"], mul.inputs[1])
    nt.links.new(mul.outputs[0], mx.inputs[0])
    return m


def image_material(path):
    key = "IMG:" + path
    if key in MAT:
        return MAT[key]
    m, nt, al, em, mx = _base_nodes("IMG_" + os.path.basename(path))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(tex.outputs["Alpha"], mul.inputs[0])
    nt.links.new(al.outputs["Fac"], mul.inputs[1])
    nt.links.new(mul.outputs[0], mx.inputs[0])
    MAT[key] = m
    return m


# --------------------------------------------------------------------------- #
# Shots: every object created inside `with Shot(a, b)` is only rendered in [a, b]
# and fades out at the end of the shot.
# --------------------------------------------------------------------------- #
class Shot:
    cur = None

    def __init__(self, s0, s1, zoom=0.025):
        self.s0, self.s1, self.zoom = s0, s1, zoom
        self.objs = []

    def __enter__(self):
        Shot.cur = self
        EVENTS["shot"].append(self.s0)
        return self

    def __exit__(self, *exc):
        Shot.cur = None
        if exc[0] is not None:
            return False
        s0, s1 = self.s0, self.s1
        for o in self.objs:
            if "rs_base" in o and "rs_t1" not in o:
                akey(o, s1 - 0.5, alpha_at(o, s1 - 0.5))
                akey(o, s1, 0.0)
            if o.type == "EMPTY":
                continue
            t0 = max(s0, o.get("rs_t0", s0))
            t1 = min(s1, o.get("rs_t1", s1))
            if F(t0) > 1:
                o.hide_render = True
                o.keyframe_insert("hide_render", frame=1)
            o.hide_render = False
            o.keyframe_insert("hide_render", frame=F(t0))
            if F(t1) <= LAST:
                o.hide_render = True
                o.keyframe_insert("hide_render", frame=F(t1))
        # slow camera push-in for the whole shot
        cam = CAM.data
        cam.ortho_scale = 19.2
        cam.keyframe_insert("ortho_scale", frame=F(s0))
        cam.ortho_scale = 19.2 * (1 - self.zoom)
        cam.keyframe_insert("ortho_scale", frame=max(F(s0) + 1, F(s1) - 1))
        return False


def new_obj(name, data, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    o.location = loc
    if Shot.cur is not None:
        Shot.cur.objs.append(o)
    return o


def paint(o, color, alpha=1.0):
    o["rs_color"] = lin(color)
    o["rs_alpha"] = float(alpha)
    o["rs_base"] = float(alpha)


def group(x=0.0, y=0.0, z=0.0, parent=None, name="grp"):
    o = new_obj(name, None, parent, (x, y, z))
    o.empty_display_size = 0.2
    return o


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
_MESH = {}
ANCHOR = {"C": (0, 0), "L": (1, 0), "R": (-1, 0), "B": (0, 1), "T": (0, -1),
          "BL": (1, 1), "TL": (1, -1)}


def poly_mesh(key, pts, uv_rect=None):
    if key and key in _MESH:
        return _MESH[key]
    me = bpy.data.meshes.new(key or "poly")
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for x, y in pts]
    face = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new("UVMap")
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    u0, v0, u1, v1 = uv_rect or (0, 0, 1, 1)
    for lp in face.loops:
        x, y = lp.vert.co.x, lp.vert.co.y
        lp[uvl].uv = (u0 + (u1 - u0) * (x - x0) / max(1e-6, x1 - x0),
                      v0 + (v1 - v0) * (y - y0) / max(1e-6, y1 - y0))
    bm.to_mesh(me)
    bm.free()
    if key:
        _MESH[key] = me
    return me


def rr_points(w, h, r, anchor="C", seg=10):
    ax, ay = ANCHOR[anchor]
    ox, oy = ax * w / 2, ay * h / 2
    r = max(0.0, min(r, w / 2, h / 2))
    if r < 1e-4:
        return [(w / 2 + ox, h / 2 + oy), (-w / 2 + ox, h / 2 + oy),
                (-w / 2 + ox, -h / 2 + oy), (w / 2 + ox, -h / 2 + oy)]
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a) + ox, cy + r * math.sin(a) + oy))
    return pts


def _finish(o, me_or_cu, color, alpha, mat=None):
    mats = me_or_cu.materials
    if len(mats) == 0:
        mats.append(mat or MAT["flat"])
    paint(o, color, alpha)
    return o


def rect(w, h, color, x=0.0, y=0.0, z=0.0, r=0.0, alpha=1.0, parent=None, anchor="C"):
    key = f"rr_{w:.3f}_{h:.3f}_{r:.3f}_{anchor}"
    me = poly_mesh(key, rr_points(w, h, r, anchor))
    return _finish(new_obj("rect", me, parent, (x, y, z)), me, color, alpha)


def circle(rad, color, x=0.0, y=0.0, z=0.0, alpha=1.0, parent=None, seg=64):
    key = f"circ_{rad:.3f}"
    pts = [(rad * math.cos(2 * math.pi * i / seg), rad * math.sin(2 * math.pi * i / seg))
           for i in range(seg)]
    me = poly_mesh(key, pts)
    return _finish(new_obj("circle", me, parent, (x, y, z)), me, color, alpha)


def ring(rad, thick, color, x=0.0, y=0.0, z=0.0, alpha=1.0, parent=None, seg=64):
    key = f"ring_{rad:.3f}_{thick:.3f}"
    if key not in _MESH:
        me = bpy.data.meshes.new(key)
        bm = bmesh.new()
        outer, inner = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            outer.append(bm.verts.new((rad * math.cos(a), rad * math.sin(a), 0)))
            ri = rad - thick
            inner.append(bm.verts.new((ri * math.cos(a), ri * math.sin(a), 0)))
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((outer[i], outer[j], inner[j], inner[i]))
        bm.to_mesh(me)
        bm.free()
        _MESH[key] = me
    me = _MESH[key]
    return _finish(new_obj("ring", me, parent, (x, y, z)), me, color, alpha)


def soft(x, y, rx, ry, color, alpha, z=-2.0, parent=None):
    """Soft radial blob. Scale = radius, so don't pop() it."""
    seg = 64
    pts = [(math.cos(2 * math.pi * i / seg), math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    me = poly_mesh("soft_unit", pts)
    if len(me.materials) == 0:
        me.materials.append(MAT["glow"])
    o = new_obj("soft", me, parent, (x, y, z))
    o.scale = (rx, ry, 1)
    paint(o, color, alpha)
    return o


def image(path, w, h, x=0.0, y=0.0, z=0.0, r=0.0, alpha=1.0, parent=None, anchor="C"):
    mat = image_material(path)
    img = mat.node_tree.nodes["Image Texture"].image
    iw, ih = img.size[0] or 1, img.size[1] or 1
    ia, ra = iw / ih, w / h
    if ia > ra:   # image wider -> crop sides
        k = ra / ia
        uv = ((1 - k) / 2, 0, (1 + k) / 2, 1)
    else:
        k = ia / ra
        uv = (0, (1 - k) / 2, 1, (1 + k) / 2)
    me = poly_mesh(None, rr_points(w, h, r, anchor), uv_rect=uv)
    me.materials.append(mat)
    o = new_obj("image", me, parent, (x, y, z))
    paint(o, "white", alpha)
    return o


def text(s, x=0.0, y=0.0, size=0.3, color="white", font="reg", align="LEFT", valign="CENTER",
         z=0.0, alpha=1.0, parent=None, spacing=1.0, line=1.0):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = s
    cu.font = FONT[font]
    cu.size = size
    cu.align_x = align
    cu.align_y = valign
    cu.space_character = spacing
    cu.space_line = line
    o = new_obj("t:" + s[:24], cu, parent, (x, y, z))
    return _finish(o, cu, color, alpha)


def icon(code, x=0.0, y=0.0, size=0.4, color="white", z=0.0, alpha=1.0, parent=None):
    return text(chr(code), x, y, size, color, "icon", "CENTER", "CENTER", z, alpha, parent)


def width(o):
    bpy.context.view_layer.update()
    return o.dimensions.x


def polyline(pts, wdt, color, z=0.0, parent=None, alpha=1.0):
    cu = bpy.data.curves.new("line", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, (px, py) in enumerate(pts):
        sp.points[i].co = (px, py, 0, 1)
    cu.bevel_depth = wdt / 2
    cu.bevel_resolution = 3
    cu.bevel_factor_mapping_end = "SPLINE"
    o = new_obj("line", cu, parent, (0, 0, z))
    return _finish(o, cu, color, alpha)


def qr(size, color, x=0.0, y=0.0, z=0.0, parent=None, seed=7, n=25):
    """A QR-looking pattern (finder squares + random modules) as a single mesh."""
    rnd = random.Random(seed)
    c = size / n
    me = bpy.data.meshes.new("qr")
    bm = bmesh.new()

    def cell(i, j, wc=1, hc=1):
        x0, y0 = -size / 2 + i * c, size / 2 - (j + hc) * c
        vs = [bm.verts.new((x0, y0, 0)), bm.verts.new((x0 + wc * c, y0, 0)),
              bm.verts.new((x0 + wc * c, y0 + hc * c, 0)), bm.verts.new((x0, y0 + hc * c, 0))]
        bm.faces.new(vs)

    finders = ((0, 0), (n - 7, 0), (0, n - 7))
    for fi, fj in finders:
        cell(fi, fj, 7, 1); cell(fi, fj + 6, 7, 1); cell(fi, fj + 1, 1, 5); cell(fi + 6, fj + 1, 1, 5)
        cell(fi + 2, fj + 2, 3, 3)

    def in_finder(i, j):
        return any(fi - 1 <= i <= fi + 7 and fj - 1 <= j <= fj + 7 for fi, fj in finders)

    for j in range(n):
        for i in range(n):
            if not in_finder(i, j) and rnd.random() < 0.48:
                cell(i, j)
    bm.to_mesh(me)
    bm.free()
    o = new_obj("qr", me, parent, (x, y, z))
    return _finish(o, me, color, 1.0)


# --------------------------------------------------------------------------- #
# Animation helpers (all times in seconds)
# --------------------------------------------------------------------------- #
def desc(o):
    out = [o]
    for ch in o.children:
        out += desc(ch)
    return out


_KEYS = {}   # object name -> {frame: alpha}, to know an object's alpha at any time


def akey(o, t, a):
    o["rs_alpha"] = float(a)
    o.keyframe_insert('["rs_alpha"]', frame=F(t))
    _KEYS.setdefault(o.name, {})[F(t)] = float(a)


def alpha_at(o, t):
    keys = sorted(_KEYS.get(o.name, {}).items())
    if not keys:
        return o["rs_base"]
    f = F(t)
    if f <= keys[0][0]:
        return keys[0][1]
    for (f0, a0), (f1, a1) in zip(keys, keys[1:]):
        if f0 <= f <= f1:
            return a0 + (a1 - a0) * (f - f0) / max(1, f1 - f0)
    return keys[-1][1]


# An object is rendered from its LAST fade-in time, so an element revealed later
# (e.g. by swap()) stays hidden even when its parent screen fades in earlier.
def set_t0(o, t):
    o["rs_t0"] = max(o.get("rs_t0", -1e9), t)


def set_t1(o, t):
    o["rs_t1"] = min(o.get("rs_t1", 1e9), t)


def fade_in(o, t, d=0.45):
    for n in desc(o):
        if "rs_base" in n:
            akey(n, t, 0.0)
            akey(n, t + d, n["rs_base"])
            set_t0(n, t)
    return o


def fade_out(o, t, d=0.4):
    for n in desc(o):
        if "rs_base" in n:
            akey(n, t, alpha_at(n, t))
            akey(n, t + d, 0.0)
            set_t1(n, t + d)
    return o


def dim(o, t, f, d=0.4):
    for n in desc(o):
        if "rs_base" in n:
            akey(n, t, alpha_at(n, t))
            akey(n, t + d, n["rs_base"] * f)
    return o


def life(o, t0, t1, fi=0.35, fo=0.35):
    fade_in(o, t0, fi)
    fade_out(o, t1 - fo, fo)
    return o


def lkey(o, t, x=None, y=None):
    if x is not None:
        o.location.x = x
    if y is not None:
        o.location.y = y
    o.keyframe_insert("location", frame=F(t))


def move(o, t, d, x=None, y=None):
    lkey(o, t)
    lkey(o, t + d, x, y)


def skey(o, t, s):
    sx, sy = s if isinstance(s, tuple) else (s, s)
    o.scale = (sx, sy, o.scale.z)
    o.keyframe_insert("scale", frame=F(t))


def rkey(o, t, deg):
    o.rotation_euler.z = math.radians(deg)
    o.keyframe_insert("rotation_euler", frame=F(t))


def pop(o, t, d=0.55, over=1.08):
    EVENTS["pop"].append(t)
    skey(o, t, 0.001)
    skey(o, t + d * 0.65, over)
    skey(o, t + d, 1.0)
    fade_in(o, t, d * 0.35)
    return o


def bump(o, t, d=0.45, over=1.1):
    skey(o, t, 1.0)
    skey(o, t + d * 0.45, over)
    skey(o, t + d, 1.0)


def slide_in(o, t, dx=0.0, dy=-0.35, d=0.6):
    x, y = o.location.x, o.location.y
    lkey(o, t, x + dx, y + dy)
    lkey(o, t + d, x, y)
    fade_in(o, t, d * 0.8)
    return o


def grow_x(o, t, d=0.6):
    skey(o, t, (0.001, 1))
    skey(o, t + d, (1, 1))
    fade_in(o, t, 0.15)
    return o


def grow_y(o, t, d=0.6):
    skey(o, t, (1, 0.001))
    skey(o, t + d, (1, 1))
    fade_in(o, t, 0.15)
    return o


def tap(x, y, t, parent=None, z=0.6):
    """A finger-tap indicator."""
    EVENTS["tap"].append(t)
    for o, a in ((circle(0.2, "white", x, y, z, 0.45, parent), 0.45),
                 (ring(0.26, 0.035, "white", x, y, z + 0.001, 0.9, parent), 0.9)):
        skey(o, t, 0.5)
        skey(o, t + 0.4, 1.3)
        akey(o, t, 0.0)
        akey(o, t + 0.08, a)
        akey(o, t + 0.45, 0.0)
        set_t0(o, t)
        set_t1(o, t + 0.5)


def swap(old, new, t, d=0.3):
    """Cross-fade between two objects/groups at time t (new must not be faded in yet)."""
    fade_out(old, t, d)
    fade_in(new, t, d)


def counter(fmt, v0, v1, t0, t1, x, y, size, color="ink", font="bold", align="LEFT",
            parent=None, z=0.0):
    """A number that counts up: one text object per step, each visible for its slice."""
    n = max(2, int((t1 - t0) * FPS / 2))
    objs = []
    for i in range(n + 1):
        k = i / n
        e = 1 - (1 - k) ** 3
        o = text(fmt(v0 + (v1 - v0) * e), x, y, size, color, font, align, parent=parent, z=z)
        if i > 0:
            o["rs_t0"] = t0 + (t1 - t0) * i / n
        if i < n:
            o["rs_t1"] = t0 + (t1 - t0) * (i + 1) / n
        objs.append(o)
    return objs


def typewriter(s, t0, t1, x, y, size, color="white", font="reg", parent=None, z=0.0, step=3,
               line=1.0):
    cuts = list(range(step, len(s), step)) + [len(s)]
    n = len(cuts)
    for i, c in enumerate(cuts):
        o = text(s[:c], x, y, size, color, font, "LEFT", "TOP", z, parent=parent, line=line)
        o["rs_t0"] = t0 + (t1 - t0) * i / n
        if i < n - 1:
            o["rs_t1"] = t0 + (t1 - t0) * (i + 1) / n


# --------------------------------------------------------------------------- #
# Reusable UI pieces
# --------------------------------------------------------------------------- #
def pill(label, x, y, size, fg, bg, z=0.0, parent=None, pad=0.3, h=None, code=None,
         font="semi", bg_alpha=1.0, align="CENTER", icol=None):
    g = group(x, y, z, parent)
    t = text(label, 0, 0, size, fg, font, "CENTER", "CENTER", 0.01, parent=g)
    tw = width(t)
    iw = size * 1.5 if code else 0.0
    w = tw + 2 * pad + iw
    hh = h or size * 2.2
    rect(w, hh, bg, r=hh / 2, z=0.0, parent=g, alpha=bg_alpha)
    if code:
        icon(code, -w / 2 + pad + size * 0.5, 0, size * 1.05, icol or fg, 0.01, parent=g)
        t.location.x = iw / 2
    if align == "LEFT":
        g.location.x = x + w / 2
    elif align == "RIGHT":
        g.location.x = x - w / 2
    g["w"] = w
    return g


def heading(kicker, title, t, x=0.0, y=4.3, align="CENTER", size=0.6, line=1.0):
    k = text(kicker.upper(), x, y + 0.66, 0.26, "orange", "bold", align, spacing=1.3)
    h = text(title, x, y + 0.3, size, "white", "bold", align, "TOP", line=line)
    slide_in(k, t, dy=-0.2)
    slide_in(h, t + 0.12, dy=-0.3)
    return k, h


def bullet(x, y, code, label, t, sub=None, size=0.3, icol="orange", parent=None, z=0.2):
    g = group(x, y, z, parent)
    circle(0.32, "card2", 0, 0, 0, parent=g)
    icon(code, 0, 0, 0.32, icol, 0.01, parent=g)
    text(label, 0.6, 0.16 if sub else 0.0, size, "white", "semi", "LEFT", parent=g, z=0.01)
    if sub:
        text(sub, 0.6, -0.22, size * 0.75, "muted", "reg", "LEFT", parent=g, z=0.01)
    slide_in(g, t, dx=-0.35, dy=0)
    return g


def phone(x, y, z=0.0, w=3.4, h=7.0, screen="screen", scale=1.2):
    g = group(x, y, z)
    g.scale = (scale, scale, 1)
    soft(0.3, -0.4, w * 0.95, h * 0.62, "black", 0.55, z=-0.05, parent=g)
    rect(w + 0.34, h + 0.34, "line", r=0.56, z=-0.01, parent=g)
    rect(w + 0.26, h + 0.26, "frame", r=0.52, z=0.0, parent=g)
    rect(w, h, screen, r=0.4, z=0.01, parent=g)
    rect(1.0, 0.2, "frame", 0, h / 2 - 0.2, z=0.4, r=0.1, parent=g)
    return g


def screen_group(parent, z=0.02):
    return group(0, 0, z, parent)


def app_header(parent, title, sub, h_top=3.5, w=3.4, height=1.5, color="primary"):
    rect(w, height, color, 0, h_top - height / 2, 0.01, r=0.4, parent=parent)
    rect(w, 0.45, color, 0, h_top - height + 0.225, 0.01, parent=parent)
    text(title, -w / 2 + 0.25, h_top - 0.5, 0.26, "white", "bold", parent=parent, z=0.02)
    text(sub, -w / 2 + 0.25, h_top - 0.9, 0.16, "sky", "reg", parent=parent, z=0.02)


def dashes(x0, x1, y, color, parent=None, z=0.0, dash=0.12, gap=0.08, th=0.025, vertical=False):
    p = x0
    while p < x1 - 1e-6:
        e = min(p + dash, x1)
        if vertical:
            rect(th, e - p, color, y, (p + e) / 2, z, parent=parent)
        else:
            rect(e - p, th, color, (p + e) / 2, y, z, parent=parent)
        p = e + gap


# --------------------------------------------------------------------------- #
# Global background: slow drifting colour glows
# --------------------------------------------------------------------------- #
def background():
    rnd = random.Random(11)
    for color, a, rx in (("teal", 0.20, 7.5), ("orange", 0.10, 6.0), ("primary", 0.22, 8.5)):
        o = soft(rnd.uniform(-6, 6), rnd.uniform(-3, 3), rx, rx * 0.8, color, a, z=-5)
        for t in range(0, int(TOTAL) + 1, 30):
            lkey(o, t, rnd.uniform(-7, 7), rnd.uniform(-3.5, 3.5))


# =========================================================================== #
# SHOTS
# =========================================================================== #
def s01_intro(s0=0.0, s1=9.0):
    with Shot(s0, s1, zoom=0.03):
        soft(0, 0.4, 4.6, 4.6, "teal", 0.35, z=-1)
        fade_in(Shot.cur.objs[-1], 0.2, 1.2)
        logo = image(LOGO, 3.0, 3.0, 0, 0.4, 0.2)
        logo.rotation_euler.z = math.radians(-30)
        pop(logo, 0.4, 0.9)
        rkey(logo, 0.4, -30)
        rkey(logo, 1.3, 0)
        # logo slides left, wordmark appears
        move(logo, 2.6, 0.8, x=-3.6)
        skey(logo, 2.6, 1.0)
        skey(logo, 3.4, 0.85)
        title = text("RsWork", -1.75, 1.15, 1.45, "white", "black", "LEFT")
        slide_in(title, 3.0, dx=-0.6, dy=0, d=0.7)
        x = -1.7
        for i, (wd, col) in enumerate((("Scan.", "white"), ("Order.", "white"),
                                       ("Serve.", "white"), ("Grow.", "orange"))):
            o = text(wd, x, -0.25, 0.5, col, "semi", "LEFT")
            x += width(o) + 0.22
            slide_in(o, 3.8 + i * 0.35, dy=-0.25, d=0.5)
        bar = rect(x - 1.92, 0.06, "orange", -1.7, -0.85, anchor="L")
        grow_x(bar, 5.3, 0.7)
        sub = text("Smart QR ordering & restaurant management", -1.7, -1.35, 0.3, "muted")
        slide_in(sub, 5.7, dy=-0.2)
        by = text("by Nerovex", 0, -4.6, 0.22, "dim", "semi", "CENTER", spacing=1.2)
        fade_in(by, 6.4, 0.6)


def s02_problem(s0=9.0, s1=26.0):
    with Shot(s0, s1):
        heading("The problem", "Every busy service hits the same walls", 9.3)
        cards = (
            (0xE916, "Slow ordering", "Guests wait for a menu,\na waiter, then the bill."),
            (0xF0E3, "Lost tickets", "Paper orders get lost\nbetween floor and kitchen."),
            (0xE9D2, "No visibility", "No clear view of sales,\nbest sellers or tomorrow."),
        )
        for i, (code, title, body) in enumerate(cards):
            g = group(-5.95 + i * 5.95, -0.45, 0.1)
            rect(5.4, 4.4, "card", r=0.35, parent=g)
            circle(0.62, "orange", 0, 1.15, 0.01, alpha=0.14, parent=g)
            icon(code, 0, 1.15, 0.62, "orange", 0.02, parent=g)
            text(title, 0, 0.05, 0.44, "white", "bold", "CENTER", parent=g, z=0.02)
            text(body, 0, -0.45, 0.31, "muted", "reg", "CENTER", "TOP", parent=g, z=0.02, line=1.15)
            slide_in(g, 10.6 + i * 0.8, dy=-0.6, d=0.7)
        msg = text("Every minute lost is a table not turned.", 0, -4.2, 0.42, "sky", "semi", "CENTER")
        slide_in(msg, 19.2, dy=-0.25)


def s03_solution(s0=26.0, s1=38.0):
    with Shot(s0, s1):
        logo = image(LOGO, 1.6, 1.6, 0, 3.55, 0.2)
        pop(logo, 26.3, 0.7)
        t = text("Meet RsWork", 0, 2.15, 0.85, "white", "black", "CENTER")
        slide_in(t, 26.7)
        sub = text("One platform from the table to the kitchen to the cash register.",
                   0, 1.3, 0.34, "muted", "reg", "CENTER")
        slide_in(sub, 27.2)
        y = -1.3
        line = rect(12.8, 0.05, "line", -6.4, y, 0.05, anchor="L")
        grow_x(line, 28.4, 1.6)
        roles = ((0xE77B, "Diner", "Scans & orders"), (0xED56, "Kitchen", "Cooks live"),
                 (0xEA8F, "Waiter", "Serves & collects"), (0xE8C7, "Cashier", "Settles bills"),
                 (0xE9D2, "Manager", "Sees everything"))
        nodes = []
        for i, (code, name, role) in enumerate(roles):
            x = -6.4 + i * 3.2
            g = group(x, y, 0.2)
            circle(0.85, "card2", parent=g)
            ring(0.88, 0.05, "teal", z=0.01, parent=g)
            icon(code, 0, 0, 0.72, "white", 0.02, parent=g)
            pop(g, 28.6 + i * 0.35, 0.6)
            nodes.append(g)
            lab = text(name, x, y - 1.32, 0.34, "white", "bold", "CENTER")
            sl = text(role, x, y - 1.78, 0.26, "muted", "reg", "CENTER")
            fade_in(lab, 28.9 + i * 0.35)
            fade_in(sl, 29.0 + i * 0.35)
        # an "order" pulse travels through every role
        dot = circle(0.16, "orange", -6.4, y, 0.15)
        glow = soft(-6.4, y, 0.7, 0.7, "orange", 0.6, z=0.14)
        for o in (dot, glow):
            fade_in(o, 31.0, 0.3)
            move(o, 31.0, 4.0, x=6.4)
            fade_out(o, 35.1, 0.4)
        for i, g in enumerate(nodes):
            bump(g, 31.0 + i * 1.0 - 0.1, 0.5, 1.14)
        cap = pill("Every screen updates in real time — no refresh, no paper.", 0, -4.35, 0.3,
                   "sky", "card2", code=0xE945, icol="orange", pad=0.4)
        slide_in(cap, 33.2, dy=-0.25)


def s04_diner(s0=38.0, s1=64.0):
    with Shot(s0, s1):
        ph = phone(-4.6, -0.15, 0.0)
        slide_in(ph, 38.3, dy=-1.0, d=0.8)

        # --- A: scan the QR -----------------------------------------------------
        A = screen_group(ph)
        rect(3.4, 7.0, "#1B2731", r=0.4, parent=A)
        text("Scan the QR on your table", 0, 2.75, 0.18, "white", "semi", "CENTER", parent=A, z=0.01)
        rect(2.3, 2.3, "paper", 0, 0.35, 0.01, r=0.12, parent=A)
        qr(1.9, "ink", 0, 0.35, 0.02, parent=A, seed=3)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx, cy = sx * 1.42, 0.35 + sy * 1.42
                rect(0.5, 0.07, "orange", cx - sx * 0.215, cy, 0.03, parent=A)
                rect(0.07, 0.5, "orange", cx, cy - sy * 0.215, 0.03, parent=A)
        scan = rect(2.5, 0.05, "orange", 0, 1.45, 0.04, parent=A)
        sglow = soft(0, 1.45, 1.4, 0.18, "orange", 0.5, z=0.035, parent=A)
        for o in (scan, sglow):
            lkey(o, 39.2)
            lkey(o, 40.2, y=-0.75)
            lkey(o, 41.2, y=1.45)
        ok = pill("Table 7 · Le Jasmin", 0, -2.05, 0.19, "white", "green", 0.05, A, code=0xE73E)
        pop(ok, 41.6, 0.5)
        life(A, 38.3, 43.4, fi=0.6)

        # --- B: the menu --------------------------------------------------------
        B = screen_group(ph, 0.021)
        rect(3.4, 7.0, "screen", r=0.4, parent=B)
        app_header(B, "Le Jasmin", "Table 7 · Menu")
        langs = ("FR", "EN", "ع")
        for i, lg in enumerate(langs):
            circle(0.19, "white", 0.42 + i * 0.47, 2.75, 0.02, alpha=0.18, parent=B)
            text(lg, 0.42 + i * 0.47, 2.75, 0.15, "white", "bold", "CENTER", parent=B, z=0.03)
        sel = ring(0.22, 0.035, "white", 0.42, 2.75, 0.03, parent=B)
        tap(0.89, 2.75, 44.4, parent=B)
        move(sel, 44.5, 0.3, x=0.89)
        tx = -1.55
        for lab, act in (("All", True), ("Mains", False), ("Drinks", False), ("Desserts", False)):
            p = pill(lab, tx, 1.6, 0.15, "white" if act else "ink2", "primary" if act else "chip",
                     0.02, B, h=0.42, pad=0.2, align="LEFT")
            tx += p["w"] + 0.12
        items = (("couscous-agneau", "Couscous à l'agneau", "Lamb couscous", "24.0 TND"),
                 ("ojja-merguez", "Ojja aux merguez", "Merguez ojja", "16.5 TND"),
                 ("jus", "Jus frais", "Fresh juice", "6.0 TND"))
        for i, (img, fr, en, price) in enumerate(items):
            yy = 0.75 - i * 1.1
            rect(3.15, 0.95, "paper", 0, yy, 0.02, r=0.14, parent=B)
            image(os.path.join(MENU, img + ".webp"), 0.75, 0.75, -1.1, yy, 0.03, r=0.1, parent=B)
            n_fr = text(fr, -0.6, yy + 0.16, 0.16, "ink", "bold", parent=B, z=0.03)
            n_en = text(en, -0.6, yy + 0.16, 0.16, "ink", "bold", parent=B, z=0.03)
            n_en["rs_base"] = 1.0
            akey(n_en, 38.0, 0.0)
            swap(n_fr, n_en, 44.6)
            text(price, -0.6, yy - 0.17, 0.15, "primary", "semi", parent=B, z=0.03)
            circle(0.2, "primary", 1.2, yy - 0.12, 0.03, parent=B)
            icon(0xE710, 1.2, yy - 0.12, 0.16, "white", 0.04, parent=B)
        tap(1.2, 0.63, 46.0, parent=B)
        tap(1.2, -1.57, 48.2, parent=B)
        sug = pill("Goes well with: Fresh juice", 0, -2.3, 0.14, "ink", "#FCE6D2", 0.03, B,
                   code=0xEA80, icol="orange", h=0.44)
        pop(sug, 47.0, 0.45)
        cart = group(0, -3.0, 0.03, B)
        rect(3.15, 0.62, "ink", r=0.31, parent=cart)
        circle(0.19, "orange", -1.3, 0, 0.01, parent=cart)
        c1 = text("1", -1.3, 0, 0.15, "white", "bold", "CENTER", parent=cart, z=0.02)
        c2 = text("2", -1.3, 0, 0.15, "white", "bold", "CENTER", parent=cart, z=0.02)
        text("View cart", -1.0, 0, 0.16, "white", "semi", parent=cart, z=0.02)
        p1 = text("24.0 TND", 1.35, 0, 0.16, "white", "bold", "RIGHT", parent=cart, z=0.02)
        p2 = text("30.0 TND", 1.35, 0, 0.16, "white", "bold", "RIGHT", parent=cart, z=0.02)
        pop(cart, 46.2, 0.45)
        for o in (c2, p2):
            akey(o, 38.0, 0.0)
        swap(c1, c2, 48.3, 0.15)
        swap(p1, p2, 48.3, 0.15)
        tap(0.4, -3.0, 49.6, parent=B)
        life(B, 43.2, 50.6)

        # --- C: order confirmed -------------------------------------------------
        C = screen_group(ph, 0.022)
        rect(3.4, 7.0, "screen", r=0.4, parent=C)
        ok = group(0, 1.0, 0.02, C)
        circle(0.72, "green", parent=ok)
        icon(0xE73E, 0, 0, 0.62, "white", 0.01, parent=ok)
        pop(ok, 50.7, 0.55, 1.15)
        text("Order sent!", 0, -0.2, 0.3, "ink", "bold", "CENTER", parent=C, z=0.02)
        text("ORD-20261021-0042", 0, -0.62, 0.15, "ink2", "reg", "CENTER", parent=C, z=0.02)
        text("The kitchen already has it.", 0, -1.0, 0.16, "ink2", "reg", "CENTER", parent=C, z=0.02)
        life(C, 50.4, 53.6)

        # --- D: live tracking ---------------------------------------------------
        D = screen_group(ph, 0.023)
        rect(3.4, 7.0, "screen", r=0.4, parent=D)
        text("Your order", -1.45, 2.85, 0.26, "ink", "bold", parent=D, z=0.02)
        text("#0042 · Table 7", -1.45, 2.45, 0.15, "ink2", parent=D, z=0.02)
        live = pill("Live", 1.05, 2.8, 0.14, "white", "green", 0.02, D, h=0.36, pad=0.2)
        steps = (("Received", "The kitchen has your order", 53.9),
                 ("Preparing", "The chef is cooking", 55.4),
                 ("Ready", "On its way to your table", 57.0),
                 ("Served", "Enjoy your meal!", 58.6))
        ys = [1.5 - i * 1.05 for i in range(4)]
        rect(0.06, ys[0] - ys[-1], "grey", -1.15, ys[0], 0.02, anchor="T", parent=D)
        prog = rect(0.06, ys[0] - ys[-1], "green", -1.15, ys[0], 0.025, anchor="T", parent=D)
        skey(prog, 38.0, (1, 0.001))
        for i, (lab, sub, t) in enumerate(steps):
            circle(0.17, "grey", -1.15, ys[i], 0.03, parent=D)
            done = group(-1.15, ys[i], 0.04, D)
            circle(0.21, "green", parent=done)
            icon(0xE73E, 0, 0, 0.2, "white", 0.01, parent=done)
            pop(done, t, 0.45, 1.2)
            text(lab, -0.75, ys[i] + 0.13, 0.2, "ink", "bold", parent=D, z=0.03)
            text(sub, -0.75, ys[i] - 0.17, 0.13, "ink2", parent=D, z=0.03)
            if i > 0:
                skey(prog, t - 0.5, (1, max(0.001, (ys[0] - ys[i - 1]) / (ys[0] - ys[-1]))))
                skey(prog, t, (1, (ys[0] - ys[i]) / (ys[0] - ys[-1])))
        life(D, 53.4, 60.4)

        # --- E: pay & rate ------------------------------------------------------
        E = screen_group(ph, 0.024)
        rect(3.4, 7.0, "screen", r=0.4, parent=E)
        text("Your bill", -1.45, 2.85, 0.26, "ink", "bold", parent=E, z=0.02)
        text("Table 7 · 2 items", -1.45, 2.45, 0.15, "ink2", parent=E, z=0.02)
        rect(3.15, 0.95, "paper", 0, 1.6, 0.02, r=0.14, parent=E)
        text("Total", -1.35, 1.6, 0.17, "ink2", parent=E, z=0.03)
        text("30.0 TND", 1.35, 1.6, 0.28, "ink", "bold", "RIGHT", parent=E, z=0.03)
        b1 = group(0, 0.55, 0.02, E)
        rect(3.15, 0.62, "primary", r=0.31, parent=b1)
        icon(0xE8C7, -0.85, 0, 0.2, "white", 0.01, parent=b1)
        text("Pay by card", -0.55, 0, 0.17, "white", "semi", parent=b1, z=0.01)
        b1ok = group(0, 0.55, 0.03, E)
        rect(3.15, 0.62, "green", r=0.31, parent=b1ok)
        icon(0xE73E, -0.6, 0, 0.2, "white", 0.01, parent=b1ok)
        text("Paid", -0.3, 0, 0.18, "white", "bold", parent=b1ok, z=0.01)
        for n in desc(b1ok):
            if "rs_base" in n:
                akey(n, 38.0, 0.0)
        b2 = group(0, -0.2, 0.02, E)
        rect(3.15, 0.62, "chip", r=0.31, parent=b2)
        text("Pay cash at the table", 0, 0, 0.16, "ink", "semi", "CENTER", parent=b2, z=0.01)
        tap(0.2, 0.55, 60.9, parent=E)
        fade_in(b1ok, 61.1, 0.25)
        bump(b1ok, 61.1, 0.4, 1.06)
        q = text("How was your meal?", 0, -1.2, 0.19, "ink", "bold", "CENTER", parent=E, z=0.02)
        fade_in(q, 61.5)
        for i in range(5):
            sx = -1.2 + i * 0.6
            icon(0xE734, sx, -1.8, 0.4, "grey", 0.02, parent=E)
            st = icon(0xE735, sx, -1.8, 0.4, "orange", 0.03, parent=E)
            pop(st, 61.9 + i * 0.14, 0.35, 1.3)
        thx = text("Thank you!", 0, -2.55, 0.18, "green", "bold", "CENTER", parent=E, z=0.02)
        fade_in(thx, 62.9)
        fade_in(E, 60.2, 0.35)
        # hide the late screens until their time (fade_in above keyed 0 before)

        # --- right column -------------------------------------------------------
        heading("For your guests", "Order from the table\nin seconds", 38.6, x=-0.6, y=3.75,
                align="LEFT", size=0.56)
        rows = ((0xE799, "Scan the table's QR — no app to install", 40.0),
                (0xE909, "Menu in French, English and Arabic", 44.2),
                (0xEA80, "Smart suggestions that raise the bill", 47.0),
                (0xE823, "Live tracking from kitchen to table", 51.0),
                (0xE8C7, "Pay by card or cash", 57.6),
                (0xE734, "Rate the meal in one tap", 61.0))
        for i, (code, lab, t) in enumerate(rows):
            bullet(-0.3, 1.45 - i * 0.92, code, lab, t)


def ticket(parent, x, y, title, timer, lines, stripe="teal"):
    g = group(x, y, 0.03, parent)
    rect(3.2, 1.5, "ticket", r=0.12, parent=g)
    rect(0.07, 1.25, stripe, -1.5, 0, 0.01, parent=g)
    text(title, -1.32, 0.48, 0.24, "white", "bold", parent=g, z=0.01)
    text(timer, 1.45, 0.48, 0.19, "muted", "semi", "RIGHT", parent=g, z=0.01)
    for i, ln in enumerate(lines):
        text(ln, -1.32, 0.1 - i * 0.33, 0.2, "sky", parent=g, z=0.01)
    return g


def s05_kitchen(s0=64.0, s1=84.0):
    with Shot(s0, s1):
        mon = group(-2.35, -0.45, 0.0)
        soft(0.3, -0.5, 6.8, 4.4, "black", 0.5, z=-0.05, parent=mon)
        rect(11.6, 7.0, "frame", r=0.28, parent=mon)
        rect(11.65, 7.05, "line", r=0.29, z=-0.01, parent=mon)
        rect(11.2, 6.6, "kds", 0, 0, 0.01, r=0.16, parent=mon)
        rect(1.4, 0.5, "frame", 0, -3.75, -0.01, parent=mon)
        rect(3.6, 0.16, "frame", 0, -4.0, -0.01, r=0.08, parent=mon)
        text("Kitchen display", -5.25, 2.9, 0.3, "white", "bold", parent=mon, z=0.02)
        text("Le Jasmin · lunch service", -2.3, 2.88, 0.2, "muted", parent=mon, z=0.02)
        livedot = circle(0.1, "green", 4.4, 2.9, 0.02, parent=mon)
        text("LIVE", 4.62, 2.9, 0.2, "green", "bold", parent=mon, z=0.02)
        for k in range(0, 19, 2):
            bump(livedot, 64.5 + k, 0.8, 1.5)
        cols = ((-3.65, "New", "orange"), (0, "Preparing", "teal"), (3.65, "Ready", "green"))
        for cx, lab, col in cols:
            rect(3.45, 5.45, "kcol", cx, -0.45, 0.015, r=0.16, parent=mon)
            circle(0.08, col, cx - 1.45, 1.93, 0.02, parent=mon)
            text(lab, cx - 1.27, 1.93, 0.26, "white", "bold", parent=mon, z=0.02)
        slot = (0.95, -0.7, -2.35)

        C = ticket(mon, -3.65, slot[0], "T12 · #0040", "04:10", ("1× Grilled fish", "1× Mixed grill"), "orange")
        B = ticket(mon, 0, slot[0], "T3 · #0039", "07:45", ("1× Lamb couscous", "2× Mint tea"), "teal")
        A = ticket(mon, -3.65, slot[1], "T7 · #0042", "00:05", ("1× Lamb couscous", "1× Fresh juice"), "orange")
        flash = rect(3.36, 1.66, "orange", 0, 0, -0.005, r=0.16, parent=A)
        akey(flash, 65.6, 0.0)
        for k, a in ((65.9, 1.0), (66.3, 0.25), (66.7, 1.0), (67.1, 0.25), (67.5, 0.0)):
            akey(flash, k, a)
        new = pill("NEW", 1.1, -0.52, 0.16, "white", "orange", 0.02, A, h=0.36, pad=0.16)
        fade_out(new, 69.0)
        pop(A, 65.6, 0.5)
        chef = pill("Chef Sami", 0.8, -0.52, 0.16, "ink", "sky", 0.02, A, h=0.36, pad=0.16,
                    code=0xE77B)
        tap(-3.65, slot[0], 72.4, parent=mon)
        fade_in(chef, 72.9, 0.3)
        # choreography
        move(C, 67.6, 0.6, 0, slot[1]); move(A, 67.6, 0.6, -3.65, slot[0])
        move(B, 70.2, 0.6, 3.65, slot[0]); move(C, 70.2, 0.6, 0, slot[0])
        move(A, 72.6, 0.6, 0, slot[1])
        move(C, 76.0, 0.6, 3.65, slot[1]); move(A, 76.0, 0.6, 0, slot[0])
        fade_out(B, 78.4, 0.4)
        move(C, 78.8, 0.6, 3.65, slot[0])
        move(A, 80.4, 0.6, 3.65, slot[1])
        fade_in(mon, 64.2, 0.5)
        slide_in(mon, 64.2, dy=-0.6, d=0.7)

        heading("In the kitchen", "A live board\ninstead of paper", 64.6, x=4.0, y=3.95,
                align="LEFT", size=0.5)
        rows = ((0xE945, "Orders appear instantly", "No paper, no shouting", 66.0),
                (0xE916, "A timer on every ticket", "Spot what has waited too long", 68.6),
                (0xE77B, "Cooks claim their dishes", "Everyone knows who does what", 72.8),
                (0xE73E, "Status flows back live", "Guests and waiters see progress", 76.4))
        for i, (code, lab, sub, t) in enumerate(rows):
            bullet(4.3, 1.55 - i * 1.15, code, lab, t, sub=sub, size=0.27)


def notif(parent, y, code, col, title, sub):
    g = group(0, y, 0.03, parent)
    rect(3.15, 1.0, "paper", r=0.14, parent=g)
    circle(0.26, col, -1.18, 0, 0.01, parent=g)
    icon(code, -1.18, 0, 0.22, "white", 0.02, parent=g)
    text(title, -0.78, 0.16, 0.16, "ink", "bold", parent=g, z=0.01)
    text(sub, -0.78, -0.17, 0.13, "ink2", parent=g, z=0.01)
    return g


def s06_waiter(s0=84.0, s1=98.0):
    with Shot(s0, s1):
        heading("On the floor", "Waiters always know\nwhat to do next", 84.4, x=-8.8, y=3.75,
                align="LEFT", size=0.56)
        rows = ((0xEA8F, "Instant alert when a dish is ready", 86.0),
                (0xE8C7, "Bill requests arrive in real time", 88.6),
                (0xE716, "Tables shared fairly between waiters", 91.0),
                (0xE73E, "Claim an order — no double serving", 93.4))
        for i, (code, lab, t) in enumerate(rows):
            bullet(-8.5, 0.95 - i * 1.0, code, lab, t)

        ph = phone(4.6, -0.15, 0.0)
        slide_in(ph, 84.3, dy=-1.0, d=0.8)
        S = screen_group(ph)
        app_header(S, "Waiter · Sami", "On duty · 3 open orders", color="primary")
        sec = pill("My section: tables 1–8", 0, 1.6, 0.15, "ink", "chip", 0.02, S, code=0xE716,
                   icol="primary", h=0.44)
        sub = text("Auto-balanced with 2 waiters", 0, 1.13, 0.13, "ink2", "reg", "CENTER", parent=S, z=0.02)
        fade_in(sub, 91.2)
        bump(sec, 91.0, 0.5, 1.12)
        slots = (0.2, -0.95, -2.1)
        n1 = notif(S, slots[0], 0xEA8F, "green", "Table 7 · ready to serve", "#0042 · couscous, juice")
        pop(n1, 86.2, 0.45)
        n2 = notif(S, slots[0], 0xE8C7, "orange", "Table 3 · bill requested", "Cash · 34.0 TND")
        move(n1, 88.8, 0.4, y=slots[1])
        pop(n2, 88.9, 0.45)
        n3 = notif(S, slots[0], 0xE719, "teal", "Table 12 · new order", "Tap to claim it")
        claim = pill("Claim", 1.05, -0.17, 0.13, "white", "primary", 0.02, n3, h=0.32, pad=0.18)
        mine = pill("Mine", 1.05, -0.17, 0.13, "white", "green", 0.03, n3, h=0.32, pad=0.18,
                    code=0xE73E)
        move(n1, 93.5, 0.4, y=slots[2])
        move(n2, 93.5, 0.4, y=slots[1])
        pop(n3, 93.6, 0.45)
        tap(1.05, slots[0] - 0.17, 94.6, parent=S)
        fade_out(claim, 94.75, 0.2)
        pop(mine, 94.8, 0.4, 1.2)
        fade_in(S, 84.3, 0.6)


def s07_cashier(s0=98.0, s1=110.0):
    with Shot(s0, s1):
        heading("At the register", "Close every bill in one tap", 98.3, y=4.25)
        xs = (-3.9, 0.0, 3.9)
        for i, (code, lab) in enumerate(((0xE8C7, "Cash & card"), (0xE73E, "Each bill settled once"),
                                         (0xE8A5, "Printable receipts"))):
            p = pill(lab, -3.4 + (i - 1) * 3.45, 2.95, 0.22, "sky", "card2", 0.1, code=code,
                     icol="orange", pad=0.3)
            slide_in(p, 99.0 + i * 0.3, dy=-0.2)
        panel = group(-3.4, -0.75, 0.0)
        rect(9.6, 5.3, "card", r=0.3, parent=panel)
        text("Payments", -4.4, 2.05, 0.34, "white", "bold", parent=panel, z=0.01)
        text("Today · 3 open bills", -2.4, 2.03, 0.21, "muted", parent=panel, z=0.01)
        rows = (("Table 3", "ORD-…-0039", "Cash", "34.0 TND", "confirm"),
                ("Table 7", "ORD-…-0042", "Card", "30.0 TND", "paid"),
                ("Table 12", "ORD-…-0040", "Cash", "41.5 TND", "confirm"))
        for i, (tb, ordn, meth, amt, st) in enumerate(rows):
            y = 1.0 - i * 1.15
            r = group(0, y, 0.01, panel)
            rect(9.0, 0.95, "card2", r=0.14, parent=r)
            circle(0.25, "teal" if meth == "Card" else "orange", -4.0, 0, 0.01, alpha=0.2, parent=r)
            icon(0xE8C7 if meth == "Card" else 0xE825, -4.0, 0, 0.22,
                 "teal" if meth == "Card" else "orange", 0.02, parent=r)
            text(tb, -3.55, 0.16, 0.26, "white", "bold", parent=r, z=0.01)
            text(ordn, -3.55, -0.22, 0.17, "muted", parent=r, z=0.01)
            text(meth, -0.6, 0, 0.22, "sky", "semi", parent=r, z=0.01)
            text(amt, 2.5, 0, 0.27, "white", "bold", "RIGHT", parent=r, z=0.01)
            if st == "paid":
                pill("Paid", 3.6, 0, 0.18, "white", "green", 0.01, r, h=0.46, code=0xE73E, pad=0.2)
            else:
                cf = pill("Confirm", 3.6, 0, 0.18, "white", "primary", 0.01, r, h=0.46, pad=0.22)
                if i == 0:
                    pd = pill("Paid", 3.6, 0, 0.18, "white", "green", 0.02, r, h=0.46,
                              code=0xE73E, pad=0.2)
                    tap(3.6, y, 100.8, parent=panel)
                    fade_out(cf, 100.95, 0.2)
                    pop(pd, 101.0, 0.4, 1.2)
        fade_in(panel, 98.8, 0.5)
        slide_in(panel, 98.8, dy=-0.5, d=0.6)
        free = pill("Table 3 is free again", -3.4, -4.15, 0.24, "white", "green", 0.1, code=0xE73E)
        pop(free, 104.2, 0.5)

        # receipt unrolling
        rc = group(5.4, 2.4, 0.2)
        fade_in(soft(0.2, -3.2, 2.4, 3.6, "black", 0.45, z=-0.05, parent=rc), 101.8, 1.2)
        paper = rect(3.6, 6.4, "paper", anchor="T", parent=rc)
        grow_y(paper, 101.6, 1.2)
        cx = 0
        items = (
            ("LE JASMIN", 0, -0.45, 0.3, "ink", "bold", "CENTER"),
            ("Tunis · Tel. 00 000 000", 0, -0.82, 0.16, "ink2", "reg", "CENTER"),
            ("Table 3 · #0039", -1.55, -1.45, 0.16, "ink", "reg", "LEFT"),
            ("21/10/2026 13:05", 1.55, -1.45, 0.16, "ink2", "reg", "RIGHT"),
            ("1× Lamb couscous", -1.55, -1.95, 0.19, "ink", "reg", "LEFT"),
            ("24.0", 1.55, -1.95, 0.19, "ink", "reg", "RIGHT"),
            ("2× Mint tea", -1.55, -2.35, 0.19, "ink", "reg", "LEFT"),
            ("6.0", 1.55, -2.35, 0.19, "ink", "reg", "RIGHT"),
            ("1× Mineral water", -1.55, -2.75, 0.19, "ink", "reg", "LEFT"),
            ("4.0", 1.55, -2.75, 0.19, "ink", "reg", "RIGHT"),
            ("TOTAL", -1.55, -3.55, 0.25, "ink", "bold", "LEFT"),
            ("34.0 TND", 1.55, -3.55, 0.25, "ink", "bold", "RIGHT"),
            ("Paid · Cash", -1.55, -3.95, 0.18, "green", "semi", "LEFT"),
            ("Merci et à bientôt !", 0, -4.7, 0.17, "ink2", "reg", "CENTER"),
        )
        for i, (s, x, y, sz, col, fnt, al) in enumerate(items):
            o = text(s, x, y, sz, col, fnt, al, parent=rc, z=0.01)
            fade_in(o, 102.0 + i * 0.07, 0.3)
        for y in (-1.15, -3.15):
            g = group(0, y, 0.01, rc)
            dashes(-1.6, 1.6, 0, "grey", parent=g)
            fade_in(g, 102.2, 0.3)
        qg = group(0, -5.6, 0.01, rc)
        qr(0.9, "ink", 0, 0, 0, parent=qg, seed=21)
        fade_in(qg, 103.0, 0.3)


def kpi(parent, x, y, label, fmt, v1, delta, t):
    g = group(x, y, 0.02, parent)
    rect(2.3, 1.15, "paper", r=0.12, parent=g)
    text(label, -1.0, 0.33, 0.17, "ink2", parent=g, z=0.01)
    counter(fmt, 0, v1, t, t + 1.6, -1.0, -0.03, 0.34, "ink", "bold", parent=g, z=0.01)
    text(delta, -1.0, -0.38, 0.15, "green", "semi", parent=g, z=0.01)
    return g


def s08_manager(s0=110.0, s1=138.0):
    with Shot(s0, s1, zoom=0.015):
        k = text("FOR THE OWNER", 0, 4.95, 0.22, "orange", "bold", "CENTER", spacing=1.3)
        h = text("Your whole restaurant on one screen", 0, 4.42, 0.46, "white", "bold", "CENTER")
        slide_in(k, 110.2, dy=-0.2)
        slide_in(h, 110.3, dy=-0.3)
        lap = group(0, 0.15, 0.0)
        soft(0, -0.6, 7.6, 4.4, "black", 0.5, z=-0.05, parent=lap)
        rect(12.85, 7.15, "line", r=0.27, z=-0.01, parent=lap)
        rect(12.8, 7.1, "frame", r=0.25, parent=lap)
        rect(12.4, 6.7, "screen", 0, 0, 0.01, r=0.1, parent=lap)
        rect(14.4, 0.3, "#2B3B4A", 0, -3.72, 0.0, r=0.15, parent=lap)
        rect(2.2, 0.1, "#1C2833", 0, -3.62, 0.01, r=0.05, parent=lap)
        slide_in(lap, 110.2, dy=-0.7, d=0.8)

        # sidebar
        rect(2.3, 6.7, "paper", -6.2, 0, 0.015, anchor="L", parent=lap)
        rect(0.02, 6.7, "rule", -3.9, 0, 0.016, parent=lap)
        image(LOGO, 0.5, 0.5, -5.8, 2.85, 0.02, parent=lap)
        text("RsWork", -5.45, 2.85, 0.22, "ink", "black", parent=lap, z=0.02)
        nav = ((0xE9D2, "Dashboard"), (0xF0E3, "Orders"), (0xED56, "Menu"), (0xE80A, "Tables"),
               (0xE716, "Staff"), (0xE8C7, "Payments"), (0xED15, "Feedback"), (0xE9F9, "AI report"))
        ny = [2.05 - i * 0.52 for i in range(len(nav))]
        hl = rect(2.06, 0.42, "#DCE9F3", -5.05, ny[0], 0.018, r=0.1, parent=lap)
        for i, (code, lab) in enumerate(nav):
            icon(code, -5.85, ny[i], 0.2, "primary", 0.02, parent=lap)
            text(lab, -5.6, ny[i], 0.19, "ink", "semi", parent=lap, z=0.02)
        for t, idx in ((120.0, 2), (125.0, 3), (130.0, 4), (134.0, 6)):
            move(hl, t, 0.35, y=ny[idx])

        def page(title, sub, t0, t1):
            P = group(0, 0, 0.02, lap)
            text(title, -3.65, 2.85, 0.34, "ink", "bold", parent=P, z=0.0)
            text(sub, -3.65, 2.43, 0.18, "ink2", parent=P, z=0.0)
            return P

        # --- dashboard ---
        P1 = page("Dashboard", "Today · Le Jasmin", 110.6, 120.3)
        for i, (lab, fmt, v, dlt) in enumerate((
                ("Revenue", lambda v: f"{v:,.0f} TND".replace(",", " "), 2845, "+12% vs last week"),
                ("Orders", lambda v: f"{v:.0f}", 126, "+9% vs last week"),
                ("Average ticket", lambda v: f"{v:.1f} TND", 22.6, "+3% vs last week"),
                ("Guest rating", lambda v: f"{v:.1f} / 5", 4.7, "18 new reviews"))):
            kpi(P1, -2.5 + i * 2.45, 1.6, lab, fmt, v, dlt, 111.6)
        ch = group(-0.65, -1.25, 0.02, P1)
        rect(6.1, 3.6, "paper", r=0.12, parent=ch)
        text("Revenue · last 7 days", -2.8, 1.48, 0.19, "ink", "bold", parent=ch, z=0.01)
        for gy in (-0.55, 0.1, 0.75):
            rect(5.5, 0.012, "rule", 0, gy, 0.005, parent=ch)
        vals = (0.52, 0.57, 0.6, 0.66, 0.92, 1.0, 0.78)
        for i, (v, d) in enumerate(zip(vals, ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"))):
            bx = -2.4 + i * 0.8
            b = rect(0.46, 2.3 * v, "teal" if i == 5 else "primary", bx, -1.25, 0.01, r=0.06,
                     anchor="B", parent=ch)
            grow_y(b, 112.4 + i * 0.12, 0.7)
            text(d, bx, -1.5, 0.15, "ink2", "reg", "CENTER", parent=ch, z=0.01)
        bs = group(4.27, -1.25, 0.02, P1)
        rect(3.45, 3.6, "paper", r=0.12, parent=bs)
        text("Best sellers", -1.5, 1.48, 0.19, "ink", "bold", parent=bs, z=0.01)
        for i, (nm, w) in enumerate((("Lamb couscous", 2.9), ("Merguez ojja", 2.3),
                                     ("Mixed grill", 1.8), ("Mint tea", 1.4))):
            yy = 0.85 - i * 0.7
            text(nm, -1.5, yy, 0.17, "ink", parent=bs, z=0.01)
            b = rect(w, 0.14, "teal" if i == 0 else "primary", -1.5, yy - 0.28, 0.01, r=0.07,
                     anchor="L", parent=bs)
            grow_x(b, 112.8 + i * 0.15, 0.8)
        life(P1, 110.6, 120.3)

        # --- menu ---
        P2 = page("Menu", "21 dishes · 4 categories", 120.0, 125.3)
        pill("+ Add dish", 5.0, 2.75, 0.18, "white", "primary", 0.0, P2, h=0.46)
        dishes = (("couscous-agneau", "Lamb couscous", "24.0"), ("ojja-merguez", "Merguez ojja", "16.5"),
                  ("grillade-mixte", "Mixed grill", "32.0"), ("poisson-grille", "Grilled fish", "28.0"),
                  ("brochettes-de-poulet", "Chicken skewers", "19.0"), ("kafteji-royal", "Kafteji royal", "14.0"),
                  ("lablabi", "Lablabi", "8.5"), ("the", "Mint tea", "3.0"))
        for i, (img, nm, pr) in enumerate(dishes):
            cx, cy = -2.5 + (i % 4) * 2.45, 0.85 - (i // 4) * 2.6
            g = group(cx, cy, 0.0, P2)
            rect(2.3, 2.4, "paper", r=0.12, parent=g)
            image(os.path.join(MENU, img + ".webp"), 2.3, 1.25, 0, 0.575, 0.01, r=0.12, parent=g)
            text(nm, -1.0, -0.28, 0.17, "ink", "bold", parent=g, z=0.01)
            p_old = text(pr + " TND", -1.0, -0.66, 0.16, "primary", "semi", parent=g, z=0.01)
            tg = group(0.72, -0.65, 0.01, g)
            rect(0.52, 0.28, "green", r=0.14, parent=tg)
            knob = circle(0.1, "white", 0.12, 0, 0.01, parent=tg)
            fade_in(g, 120.4 + i * 0.08, 0.35)
            if nm == "Grilled fish":
                p_new = text("29.5 TND", -1.0, -0.66, 0.16, "orange", "bold", parent=g, z=0.01)
                akey(p_new, 110.0, 0.0)
                tap(-0.6, -0.65, 122.2, parent=g)
                swap(p_old, p_new, 122.4, 0.25)
                bump(g, 122.4, 0.5, 1.06)
            if nm == "Lablabi":
                off = rect(0.52, 0.28, "grey", r=0.14, z=0.005, parent=tg)
                akey(off, 110.0, 0.0)
                tap(0.72, -0.65, 123.5, parent=g)
                fade_in(off, 123.6, 0.2)
                move(knob, 123.6, 0.25, x=-0.12)
                dim(g, 123.9, 0.55, 0.3)
        life(P2, 120.0, 125.3)

        # --- tables ---
        P3 = page("Tables & QR codes", "8 tables · 2 sections", 125.0, 130.3)
        pill("Print all QR codes", 4.45, 2.75, 0.18, "white", "primary", 0.0, P3, h=0.46, code=0xE8A5)
        qrs = []
        for i in range(8):
            cx, cy = -2.5 + (i % 4) * 2.45, 0.85 - (i // 4) * 2.6
            g = group(cx, cy, 0.0, P3)
            rect(2.3, 2.4, "paper", r=0.12, parent=g)
            text(f"Table {i + 1}", -1.0, 0.92, 0.18, "ink", "bold", parent=g, z=0.01)
            occ = i in (2, 6)
            pill("Occupied" if occ else "Free", 0.58, 0.92, 0.14, "white",
                 "orange" if occ else "green", 0.01, g, h=0.34, pad=0.13)
            q = group(0, -0.08, 0.01, g)
            qr(1.2, "ink", parent=q, seed=40 + i)
            qrs.append(q)
            text("Section " + ("A" if i < 4 else "B"), -1.0, -0.95, 0.15, "ink2", parent=g, z=0.01)
            fade_in(g, 125.4 + i * 0.08, 0.35)
        tap(4.45, 2.75, 127.4, parent=P3)
        for i, q in enumerate(qrs):
            bump(q, 127.7 + i * 0.1, 0.4, 1.15)
        life(P3, 125.0, 130.3)

        # --- staff ---
        P4 = page("Staff", "Accounts, roles and passwords", 130.0, 134.3)
        pill("+ Add staff", 5.0, 2.75, 0.18, "white", "primary", 0.0, P4, h=0.46)
        for x, lab in ((-3.5, "Name"), (1.0, "Role"), (3.9, "Status")):
            text(lab, x, 1.85, 0.16, "ink2", "semi", parent=P4)
        staff = (("AB", "Amine B.", "Manager", "primary"), ("SK", "Sami K.", "Cook", "orange"),
                 ("YT", "Yasmine T.", "Cook", "orange"), ("KM", "Karim M.", "Waiter", "teal"),
                 ("LS", "Leila S.", "Cashier", "green"), ("NA", "Nour A.", "Waiter", "teal"))
        for i, (ini, nm, role, col) in enumerate(staff):
            g = group(1.15, 1.3 - i * 0.68, 0.0, P4)
            rect(9.8, 0.6, "paper", r=0.1, parent=g)
            circle(0.21, col, -4.4, 0, 0.01, parent=g)
            text(ini, -4.4, 0, 0.14, "white", "bold", "CENTER", parent=g, z=0.02)
            text(nm, -4.05, 0, 0.19, "ink", "semi", parent=g, z=0.01)
            pill(role, -0.15, 0, 0.15, col, "chip", 0.01, g, h=0.38, pad=0.18, align="LEFT")
            st = "New" if i == 5 else "Active"
            text(st, 2.75, 0, 0.17, "orange" if i == 5 else "green", "semi", parent=g, z=0.01)
            if i == 5:
                tap(5.0, 2.75, 131.6, parent=P4)
                slide_in(g, 132.0, dy=0.3, d=0.5)
            else:
                fade_in(g, 130.4 + i * 0.08, 0.35)
        life(P4, 130.0, 134.3)

        # --- feedback ---
        P5 = page("Guest feedback", "Last 30 days", 134.0, 138.0)
        sm = group(-2.15, -0.3, 0.0, P5)
        rect(3.0, 4.6, "paper", r=0.12, parent=sm)
        text("4.7", 0, 1.3, 0.75, "ink", "black", "CENTER", parent=sm, z=0.01)
        for i in range(5):
            icon(0xE735, -0.72 + i * 0.36, 0.55, 0.24, "orange", 0.01, parent=sm)
        text("126 reviews", 0, 0.12, 0.16, "ink2", "reg", "CENTER", parent=sm, z=0.01)
        for i, (lab, w) in enumerate((("Food", 2.3), ("Service", 2.1), ("Speed", 2.2))):
            yy = -0.5 - i * 0.55
            text(lab, -1.25, yy + 0.14, 0.15, "ink2", parent=sm, z=0.01)
            rect(2.5, 0.1, "rule", -1.25, yy - 0.1, 0.01, r=0.05, anchor="L", parent=sm)
            b = rect(w, 0.1, "green", -1.25, yy - 0.1, 0.02, r=0.05, anchor="L", parent=sm)
            grow_x(b, 134.8 + i * 0.15, 0.7)
        fade_in(sm, 134.4, 0.4)
        revs = (("“Ordering from the table was so easy.”", "Table 7 · Service"),
                ("“The couscous was excellent and fast.”", "Table 3 · Food"),
                ("“Great service, we will come back!”", "Table 12 · Service"))
        for i, (q, meta) in enumerate(revs):
            g = group(2.95, 1.3 - i * 1.4, 0.0, P5)
            rect(5.9, 1.2, "paper", r=0.12, parent=g)
            for s in range(5):
                icon(0xE735, -2.65 + s * 0.22, 0.3, 0.15, "orange", 0.01, parent=g)
            text(q, -2.75, -0.02, 0.2, "ink", "semi", parent=g, z=0.01)
            text(meta, -2.75, -0.37, 0.15, "ink2", parent=g, z=0.01)
            slide_in(g, 134.7 + i * 0.3, dx=0.4, dy=0, d=0.5)
        fade_in(P5, 134.0, 0.35)

        caps = ((110.9, 120.0, 0xE9D2, "Live dashboard: revenue, orders and best sellers"),
                (120.2, 125.0, 0xED56, "Update dishes, photos and prices in seconds"),
                (125.2, 130.0, 0xE80A, "Create tables and print their QR codes"),
                (130.2, 134.0, 0xE716, "Add staff accounts with the right role"),
                (134.2, 138.0, 0xED15, "Read every guest review"))
        fade_in(lap, 110.2, 0.5)
        for t0, t1, code, s in caps:
            p = pill(s, 0, -4.55, 0.29, "white", "card2", 0.3, code=code, icol="orange", pad=0.4)
            if t1 >= 138.0:
                slide_in(p, t0, dy=-0.2, d=0.4)
            else:
                life(p, t0, t1)


def s09_ai(s0=138.0, s1=158.0):
    with Shot(s0, s1):
        heading("Built-in intelligence", "See next week before it happens", 138.3, x=-8.8,
                y=4.05, align="LEFT", size=0.5)
        card = group(-3.5, -0.85, 0.0)
        rect(10.6, 6.4, "card", r=0.3, parent=card)
        slide_in(card, 138.6, dy=-0.5, d=0.6)
        # plot frame (card-local coordinates)
        X0, X1, Y0, Y1 = -4.7, 4.7, -2.45, 1.8
        text("Orders per day", -4.85, 2.65, 0.26, "white", "bold", parent=card, z=0.01)
        for lx, col, lab, a in ((-0.4, "teal", "History", 1.0), (1.45, "orange", "Forecast", 1.0),
                                (3.4, "orange", "90% range", 0.3)):
            rect(0.32, 0.08 if a == 1.0 else 0.22, col, lx, 2.65, 0.01, alpha=a, r=0.03, parent=card)
            text(lab, lx + 0.25, 2.65, 0.2, "muted", parent=card, z=0.01)
        for v in (0, 25, 50, 75, 100):
            yy = Y0 + (Y1 - Y0) * v / 100
            rect(X1 - X0, 0.012 if v else 0.02, "line", X0, yy, 0.01, anchor="L", parent=card)
            text(str(v), X0 - 0.12, yy, 0.16, "dim", "reg", "RIGHT", parent=card, z=0.01)
        pattern = (42, 45, 47, 50, 68, 80, 60)
        rnd = random.Random(5)
        n_hist, n_all = 21, 28
        step = (X1 - X0) / (n_all - 1)

        def P(i, v):
            return (X0 + i * step, Y0 + (Y1 - Y0) * v / 100)

        hist = [pattern[i % 7] + 0.25 * i + rnd.uniform(-3, 3) for i in range(n_hist)]
        fc = [pattern[i % 7] + 0.25 * i for i in range(n_hist - 1, n_all)]
        fc[0] = hist[-1]
        h_line = polyline([P(i, v) for i, v in enumerate(hist)], 0.07, "teal", 0.03, card)
        f_line = polyline([P(n_hist - 1 + i, v) for i, v in enumerate(fc)], 0.07, "orange", 0.035, card)
        for ln, t0, t1 in ((h_line, 139.4, 142.4), (f_line, 143.0, 144.6)):
            cu = ln.data
            cu.bevel_factor_end = 0.0
            cu.keyframe_insert("bevel_factor_end", frame=F(t0))
            cu.bevel_factor_end = 1.0
            cu.keyframe_insert("bevel_factor_end", frame=F(t1))
            fade_in(ln, t0, 0.1)
        up = [P(n_hist - 1 + i, v + 4 + 1.0 * i) for i, v in enumerate(fc)]
        lo = [P(n_hist - 1 + i, v - 4 - 1.0 * i) for i, v in enumerate(fc)]
        band_me = poly_mesh(None, up + lo[::-1])
        band = new_obj("band", band_me, card, (0, 0, 0.02))
        _finish(band, band_me, "orange", 0.22)
        fade_in(band, 144.4, 0.6)
        tx = X0 + (n_hist - 1) * step
        tg = group(tx, 0, 0.025, card)
        dashes(Y0, Y1 + 0.1, 0, "muted", parent=tg, vertical=True, th=0.02)
        text("Today", 0, Y1 + 0.33, 0.18, "muted", "semi", "CENTER", parent=tg, z=0.0)
        fade_in(tg, 142.5, 0.4)
        sat = n_all - 2   # the forecast Saturday
        sx, sy = P(sat, fc[sat - n_hist + 1])
        cg = group(sx, sy, 0.05, card)
        circle(0.09, "orange", parent=cg)
        ring(0.17, 0.03, "orange", z=0.001, parent=cg)
        pill("Saturday: ~86 orders expected", -2.0, 0.5, 0.19, "white", "orange", 0.01, cg,
             h=0.46, pad=0.2)
        pop(cg, 154.0, 0.5)
        fade_in(card, 138.6, 0.5)
        badge = pill("Best model picked automatically by backtesting on your data", -3.5, -4.7,
                     0.22, "sky", "card2", 0.1, code=0xE9D9, icol="orange", pad=0.35)
        slide_in(badge, 145.4, dy=-0.2)

        # report pages
        def page(x, y, rot, t, kind):
            g = group(x, y, 0.2 + (0.05 if kind == 1 else 0.0))
            g.rotation_euler.z = math.radians(rot)
            soft(0.15, -0.2, 2.1, 2.7, "black", 0.5, z=-0.03, parent=g)
            rect(3.3, 4.6, "paper", r=0.06, parent=g)
            rect(3.3, 0.6, "primary", 0, 2.0, 0.01, r=0.06, parent=g)
            rect(3.3, 0.2, "primary", 0, 1.8, 0.01, parent=g)
            text("RsWork · AI business report" if kind == 1 else "Forecast & insights",
                 -1.45, 2.0, 0.16, "white", "bold", parent=g, z=0.02)
            if kind == 1:
                for i, v in enumerate(("2 845", "126", "22.6")):
                    bx = -1.05 + i * 1.05
                    rect(0.95, 0.6, "screen", bx, 1.15, 0.01, r=0.05, parent=g)
                    text(v, bx, 1.15, 0.15, "ink", "bold", "CENTER", parent=g, z=0.02)
                rnd2 = random.Random(9)
                for i in range(6):
                    rect(rnd2.uniform(2.2, 2.9), 0.06, "grey", -1.45, 0.45 - i * 0.22, 0.01,
                         anchor="L", parent=g)
                for i, v in enumerate((0.5, 0.6, 0.55, 0.7, 0.95, 1.0, 0.8)):
                    rect(0.26, 1.0 * v, "teal" if i == 5 else "primary", -1.2 + i * 0.4, -1.95, 0.01,
                         anchor="B", parent=g)
            else:
                pts = [(-1.4 + i * 0.4, -0.2 + 0.5 * math.sin(i * 0.9) + 0.06 * i) for i in range(8)]
                polyline(pts, 0.04, "orange", 0.02, g)
                for i in range(7):
                    circle(0.04, "teal", -1.4, -0.9 - i * 0.24, 0.01, parent=g)
                    rect(random.Random(i).uniform(1.6, 2.6), 0.06, "grey", -1.25, -0.9 - i * 0.24,
                         0.01, anchor="L", parent=g)
            fade_in(g, t, 0.5)
            slide_in(g, t, dx=1.6, dy=0, d=0.7)
            return g

        page(6.3, 0.75, 6, 146.6, 2)
        page(5.3, 1.0, -4, 147.0, 1)
        bub = group(5.5, -3.0, 0.4)
        rect(7.0, 1.45, "card2", r=0.25, parent=bub)
        rect(7.04, 1.49, "orange", r=0.26, z=-0.005, alpha=0.5, parent=bub)
        circle(0.3, "orange", -3.0, 0, 0.01, alpha=0.18, parent=bub)
        icon(0xEA80, -3.0, 0, 0.3, "orange", 0.02, parent=bub)
        pop(bub, 148.4, 0.45, 1.04)
        typewriter("Friday and Saturday bring almost 40% of your revenue.\n"
                   "Plan one extra cook on Saturday evening.",
                   148.9, 151.6, -2.55, 0.36, 0.22, "white", "reg", parent=bub, z=0.02, line=1.15)
        for i, (code, lab) in enumerate(((0xE9F9, "Plain-language AI report"),
                                         (0xE8A5, "One-click PDF"))):
            p = pill(lab, 3.75 + i * 3.6, -4.7, 0.22, "sky", "card2", 0.1, code=code, icol="orange")
            slide_in(p, 152.3 + i * 0.4, dy=-0.2)


def s10_trust(s0=158.0, s1=170.0):
    with Shot(s0, s1):
        heading("Under the hood", "Secure, fast and built for real service", 158.3, y=4.1)
        tiles = ((0xEA18, "Private by design", "Each restaurant only ever\nsees its own data."),
                 (0xE72E, "Secure payments", "Stripe card payments; amounts\nare checked on the server."),
                 (0xE945, "Real-time everywhere", "Every screen updates live,\nno refresh needed."),
                 (0xE916, "Fast under load", "95% of requests answered in\nunder 163 ms in load tests."),
                 (0xE9D9, "Tested", "Automated security and\nend-to-end test suites."),
                 (0xE753, "Nothing to install", "Runs in the browser on phones,\ntablets and laptops."))
        for i, (code, title, body) in enumerate(tiles):
            cx, cy = -5.95 + (i % 3) * 5.95, 1.15 - (i // 3) * 2.65
            g = group(cx, cy, 0.1)
            rect(5.65, 2.4, "card", r=0.25, parent=g)
            circle(0.5, "teal", -2.1, 0.0, 0.01, alpha=0.16, parent=g)
            icon(code, -2.1, 0.0, 0.48, "teal", 0.02, parent=g)
            text(title, -1.4, 0.55, 0.33, "white", "bold", parent=g, z=0.01)
            text(body, -1.4, 0.2, 0.23, "muted", "reg", "LEFT", "TOP", parent=g, z=0.01, line=1.15)
            pop(g, 159.2 + i * 0.3, 0.55, 1.05)
        stack = ("React", "Supabase · PostgreSQL", "Realtime", "Stripe", "Python forecasting", "LLM reports")
        ps = [pill(s, 0, -3.9, 0.22, "sky", "card2", 0.1, pad=0.3) for s in stack]
        total = sum(p["w"] for p in ps) + 0.25 * (len(ps) - 1)
        x = -total / 2
        for i, p in enumerate(ps):
            p.location.x = x + p["w"] / 2
            x += p["w"] + 0.25
            slide_in(p, 162.4 + i * 0.15, dy=-0.2)


def s11_cta(s0=170.0, s1=180.0):
    with Shot(s0, s1, zoom=0.02):
        g = soft(0, 1.6, 4.0, 4.0, "teal", 0.32, z=-1)
        fade_in(g, 170.2, 1.0)
        logo = image(LOGO, 2.5, 2.5, 0, 1.75, 0.2)
        pop(logo, 170.3, 0.8)
        t = text("RsWork", 0, -0.15, 1.05, "white", "black", "CENTER")
        slide_in(t, 170.9)
        tg = text("Turn every table into a faster, smarter service.", 0, -0.95, 0.4, "sky", "semi",
                  "CENTER")
        slide_in(tg, 171.4)
        b = pill("Request a demo", 0, -2.15, 0.3, "white", "orange", 0.1, pad=0.55, h=0.8,
                 code=0xE8BD, font="bold")
        pop(b, 172.2, 0.6)
        u = text("rs-work-ge7g.vercel.app", 0, -3.05, 0.26, "muted", "semi", "CENTER")
        fade_in(u, 172.8)
        by = text("by Nerovex", 0, -4.6, 0.22, "dim", "semi", "CENTER", spacing=1.2)
        fade_in(by, 173.3)


def build():
    setup()
    background()
    s01_intro()
    s02_problem()
    s03_solution()
    s04_diner()
    s05_kitchen()
    s06_waiter()
    s07_cashier()
    s08_manager()
    s09_ai()
    s10_trust()
    s11_cta()


# --------------------------------------------------------------------------- #
def main(build_fn=None):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    (build_fn or build)()
    sc = bpy.context.scene
    if not argv:
        return
    cmd = argv[0]
    if cmd == "--events":
        import json
        with open(argv[1], "w") as fh:
            json.dump({k: sorted(set(round(t, 3) for t in v)) for k, v in EVENTS.items()}, fh)
    elif cmd == "--save":
        os.makedirs(os.path.dirname(os.path.abspath(argv[1])), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[1]))
    elif cmd == "--preview":
        out = argv[1]
        os.makedirs(out, exist_ok=True)
        times = argv[2:]
        full = "full" in times
        sc.render.resolution_percentage = 100 if full else 50
        sc.eevee.taa_render_samples = 16 if full else 4
        for t in (t for t in times if t != "full"):
            sc.frame_set(F(float(t)))
            sc.render.filepath = os.path.join(out, f"t{float(t):06.1f}.png")
            bpy.ops.render.render(write_still=True)
    elif cmd == "--render":
        out = argv[1]
        os.makedirs(out, exist_ok=True)
        if len(argv) >= 4:
            sc.frame_start, sc.frame_end = int(argv[2]), int(argv[3])
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGB"
        sc.render.filepath = os.path.join(out, "")
        sc.render.use_overwrite = False
        sc.render.use_placeholder = True
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
