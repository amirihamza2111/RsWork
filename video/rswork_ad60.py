"""
RsWork — 60-second commercial (plain language, benefits only).

Built for attention: a 3-second hook, word-by-word captions with highlighted keywords,
diagonal wipe transitions, camera "punches" on the hero moments, and every scene change
landing on a bar of the 112 BPM music.

Reuses the building blocks of rswork_promo.py. Same commands as the long video:
  blender -b -P video/rswork_ad60.py -- --preview video/out/ad_preview 5 15 40
  blender -b -P video/rswork_ad60.py -- --events video/out/ad_events.json
  blender -b -P video/rswork_ad60.py -- --render video/out/ad_frames
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rswork_promo as P  # noqa: E402
from rswork_promo import (  # noqa: E402
    LOGO, MENU, Shot, F, akey, app_header, bump, circle, dashes, fade_in, fade_out, group,
    grow_x, grow_y, icon, image, kpi, life, move, new_obj, notif, phone, pill, poly_mesh,
    polyline, pop, qr, rect, ring, rkey, screen_group, slide_in, soft, swap, tap, text, ticket,
    typewriter, width, _finish,
)

P.TOTAL = 60.0
P.LAST = int(P.TOTAL * P.FPS)
BAR = 4 * 60 / 112                       # music: 112 BPM, scene changes land on bars
CUTS = [b * BAR for b in (0, 3, 10, 14, 17, 19.5, 23.5, 26, 28)]   # 28 bars = 60 s


# --------------------------------------------------------------------------- #
# Attention tools
# --------------------------------------------------------------------------- #
def words(spec, t0, t1=None, x=0.0, y=0.0, size=0.78, align="LEFT", color="white", hi="orange",
          font="bold", stagger=0.05, z=0.5, gap=1.06):
    """Kinetic caption: words pop in one by one; *wrapped* words are highlighted."""
    g = group(x, y, z)
    objs = []
    on = False
    for li, line in enumerate(spec.split("\n")):
        row, cx = [], 0.0
        for wd in line.split(" "):
            if wd.startswith("*"):
                on = True
            o = text(wd.replace("*", ""), 0, -li * size * gap, size, hi if on else color, font,
                     "LEFT", "TOP", parent=g)
            if wd.rstrip(".,?!:").endswith("*"):
                on = False
            w = width(o)
            o.location.x = cx
            cx += w + size * 0.25
            row.append(o)
        shift = {"LEFT": 0.0, "CENTER": -(cx - size * 0.25) / 2, "RIGHT": -(cx - size * 0.25)}[align]
        for o in row:
            o.location.x += shift
        objs += row
    for i, o in enumerate(objs):
        slide_in(o, t0 + i * stagger, dy=-0.28, d=0.32)
    if t1 is not None:
        fade_out(g, t1 - 0.25, 0.25)
    g["h"] = len(spec.split("\n")) * size * gap
    return g


def caption(head, sub, t0, t1, x, y, size=0.78, align="LEFT"):
    g = words(head, t0, t1, x, y, size, align)
    if sub:
        words(sub, t0 + 0.35, t1, x, y - g["h"] - 0.15, size * 0.5, align, "sky", "orange", "semi",
              stagger=0.03)


def kicker(s, t, x, y, align="LEFT"):
    k = text(s.upper(), x, y, 0.26, "orange", "bold", align, spacing=1.3)
    slide_in(k, t, dy=-0.2)


def punch(t, amt=0.95, d=0.5):
    """Quick camera zoom-in on a beat (and a 'thump' in the soundtrack)."""
    cam = P.CAM.data
    for tt, v in ((t, 19.2), (t + 0.1, 19.2 * amt), (t + d, 19.2)):
        cam.ortho_scale = v
        cam.keyframe_insert("ortho_scale", frame=F(tt))
    P.EVENTS.setdefault("punch", []).append(t)


def wipe(b):
    """Diagonal orange/teal bars sweeping across the cut at time b."""
    g = group(0, 0, 8.0)
    g.rotation_euler.z = math.radians(16)
    parts = (rect(28, 22, "teal", 0, 0, 0.0, parent=g),
             rect(1.6, 22, "orange", 14.8, 0, 0.01, parent=g),
             rect(1.6, 22, "orange", -14.8, 0, 0.01, parent=g),
             rect(0.5, 22, "sky", 16.2, 0, 0.01, parent=g))
    P.lkey(g, b - 0.38, x=-36)
    P.lkey(g, b + 0.38, x=36)
    for o in parts:
        o.hide_render = True
        o.keyframe_insert("hide_render", frame=1)
        o.hide_render = False
        o.keyframe_insert("hide_render", frame=F(b - 0.4))
        o.hide_render = True
        o.keyframe_insert("hide_render", frame=F(b + 0.42))


# --------------------------------------------------------------------------- #
def a01_hook(s0, s1):
    with Shot(s0, s1, zoom=0):
        beat = BAR / 4
        qs = ((0xE916, "Waiting *forever*?", 0.12, 2 * beat),
              (0xF0E3, "Orders *lost* on paper?", 2 * beat, 4 * beat),
              (0xE9D2, "Guessing *tomorrow*?", 4 * beat, 6 * beat))
        for code, q, t0, t1 in qs:
            ic = group(0, 1.75, 0.2)
            circle(0.75, "orange", parent=ic, alpha=0.16)
            icon(code, 0, 0, 0.75, "orange", 0.01, parent=ic)
            pop(ic, t0, 0.35, 1.15)
            fade_out(ic, t1 - 0.12, 0.12)
            words(q, t0, t1 + 0.13, 0, 0.55, 1.05, "CENTER", stagger=0.06)
            if t0 > 0.5:
                punch(t0, 0.96, 0.35)
        words("There's a *better way*.", 6 * beat, 8 * beat + 0.1, 0, 0.55, 0.95, "CENTER")
        glow = soft(0, 1.15, 4.6, 4.6, "teal", 0.4, z=-1)
        fade_in(glow, 8 * beat, 0.4)
        logo = image(LOGO, 2.6, 2.6, 0, 1.15, 0.2)
        logo.rotation_euler.z = math.radians(-40)
        pop(logo, 8 * beat, 0.5, 1.18)
        rkey(logo, 8 * beat, -40)
        rkey(logo, 8 * beat + 0.5, 0)
        punch(8 * beat, 0.92, 0.6)
        slide_in(text("RsWork", 0, -0.95, 1.15, "white", "black", "CENTER"), 8 * beat + 0.3)
        words("The *simple* way to run your restaurant", 8 * beat + 0.7, None, 0, -1.65, 0.46,
              "CENTER", "sky", "orange", "semi", stagger=0.04)


def a02_guests(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        ph = phone(-4.4, -0.1, 0.0)
        slide_in(ph, T(0.15), dy=-1.0, d=0.6)
        kicker("For your guests", T(0.3), -0.2, 3.55)
        X, Y = -0.2, 2.85
        caption("Guests scan\nthe *QR code*", "No app to download. No waiting.", T(0.4), T(3.7), X, Y)
        caption("Your menu,\nwith *photos*", "In French, English or Arabic", T(3.7), T(7.4), X, Y)
        caption("Order in\na few *taps*", "It goes straight to the kitchen", T(7.4), T(10.7), X, Y)
        caption("Follow it, pay,\nand *review*", "All from their phone", T(10.7), s1, X, Y)

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
            P.lkey(o, T(0.7))
            P.lkey(o, T(1.6), y=-0.75)
            P.lkey(o, T(2.3), y=1.45)
        pop(pill("Table 7 · Le Jasmin", 0, -2.05, 0.19, "white", "green", 0.05, A, code=0xE73E), T(2.4), 0.4)
        life(A, T(0.15), T(3.8), fi=0.4)

        B = screen_group(ph, 0.021)
        rect(3.4, 7.0, "screen", r=0.4, parent=B)
        app_header(B, "Le Jasmin", "Table 7 · Menu")
        for i, lg in enumerate(("FR", "EN", "ع")):
            circle(0.19, "white", 0.42 + i * 0.47, 2.75, 0.02, alpha=0.18, parent=B)
            text(lg, 0.42 + i * 0.47, 2.75, 0.15, "white", "bold", "CENTER", parent=B, z=0.03)
        sel = ring(0.22, 0.035, "white", 0.42, 2.75, 0.03, parent=B)
        tap(0.89, 2.75, T(4.6), parent=B)
        move(sel, T(4.7), 0.3, x=0.89)
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
            swap(n_fr, n_en, T(4.8))
            text(price, -0.6, yy - 0.17, 0.15, "primary", "semi", parent=B, z=0.03)
            circle(0.2, "primary", 1.2, yy - 0.12, 0.03, parent=B)
            icon(0xE710, 1.2, yy - 0.12, 0.16, "white", 0.04, parent=B)
        tap(1.2, 0.63, T(6.0), parent=B)
        tap(1.2, -1.57, T(7.0), parent=B)
        cart = group(0, -3.0, 0.03, B)
        rect(3.15, 0.62, "ink", r=0.31, parent=cart)
        circle(0.19, "orange", -1.3, 0, 0.01, parent=cart)
        c1 = text("1", -1.3, 0, 0.15, "white", "bold", "CENTER", parent=cart, z=0.02)
        c2 = text("2", -1.3, 0, 0.15, "white", "bold", "CENTER", parent=cart, z=0.02)
        text("View cart", -1.0, 0, 0.16, "white", "semi", parent=cart, z=0.02)
        p1 = text("24.0 TND", 1.35, 0, 0.16, "white", "bold", "RIGHT", parent=cart, z=0.02)
        p2 = text("30.0 TND", 1.35, 0, 0.16, "white", "bold", "RIGHT", parent=cart, z=0.02)
        pop(cart, T(6.2), 0.4)
        swap(c1, c2, T(7.1), 0.15)
        swap(p1, p2, T(7.1), 0.15)
        tap(0.4, -3.0, T(8.2), parent=B)
        life(B, T(3.6), T(8.9))

        C = screen_group(ph, 0.022)
        rect(3.4, 7.0, "screen", r=0.4, parent=C)
        ok = group(0, 1.0, 0.02, C)
        circle(0.72, "green", parent=ok)
        icon(0xE73E, 0, 0, 0.62, "white", 0.01, parent=ok)
        pop(ok, T(9.0), 0.5, 1.2)
        punch(T(9.0), 0.94)
        text("Order sent!", 0, -0.2, 0.3, "ink", "bold", "CENTER", parent=C, z=0.02)
        text("The kitchen already has it.", 0, -0.65, 0.16, "ink2", "reg", "CENTER", parent=C, z=0.02)
        life(C, T(8.8), T(10.9))

        D = screen_group(ph, 0.023)
        rect(3.4, 7.0, "screen", r=0.4, parent=D)
        text("Your order", -1.45, 2.85, 0.26, "ink", "bold", parent=D, z=0.02)
        text("Table 7", -1.45, 2.45, 0.15, "ink2", parent=D, z=0.02)
        ys = [1.5 - i * 1.05 for i in range(4)]
        rect(0.06, ys[0] - ys[-1], "grey", -1.15, ys[0], 0.02, anchor="T", parent=D)
        for i, lab in enumerate(("Received", "Preparing", "Ready", "Served")):
            circle(0.17, "grey", -1.15, ys[i], 0.03, parent=D)
            done = group(-1.15, ys[i], 0.04, D)
            circle(0.21, "green", parent=done)
            icon(0xE73E, 0, 0, 0.2, "white", 0.01, parent=done)
            pop(done, T(11.0 + i * 0.5), 0.4, 1.2)
            text(lab, -0.75, ys[i], 0.22, "ink", "bold", parent=D, z=0.03)
        life(D, T(10.8), T(13.2))

        E = screen_group(ph, 0.024)
        rect(3.4, 7.0, "screen", r=0.4, parent=E)
        text("Your bill", -1.45, 2.85, 0.26, "ink", "bold", parent=E, z=0.02)
        rect(3.15, 0.95, "paper", 0, 1.6, 0.02, r=0.14, parent=E)
        text("Total", -1.35, 1.6, 0.17, "ink2", parent=E, z=0.03)
        text("30.0 TND", 1.35, 1.6, 0.28, "ink", "bold", "RIGHT", parent=E, z=0.03)
        b1 = group(0, 0.55, 0.02, E)
        rect(3.15, 0.62, "primary", r=0.31, parent=b1)
        text("Pay by card", 0, 0, 0.17, "white", "semi", "CENTER", parent=b1, z=0.01)
        b1ok = group(0, 0.55, 0.03, E)
        rect(3.15, 0.62, "green", r=0.31, parent=b1ok)
        icon(0xE73E, -0.4, 0, 0.2, "white", 0.01, parent=b1ok)
        text("Paid", -0.1, 0, 0.18, "white", "bold", parent=b1ok, z=0.01)
        b2 = group(0, -0.2, 0.02, E)
        rect(3.15, 0.62, "chip", r=0.31, parent=b2)
        text("Pay cash at the table", 0, 0, 0.16, "ink", "semi", "CENTER", parent=b2, z=0.01)
        tap(0.2, 0.55, T(13.4), parent=E)
        fade_in(b1ok, T(13.55), 0.2)
        fade_in(text("How was your meal?", 0, -1.2, 0.19, "ink", "bold", "CENTER", parent=E, z=0.02), T(13.6))
        for i in range(5):
            sx = -1.2 + i * 0.6
            icon(0xE734, sx, -1.8, 0.4, "grey", 0.02, parent=E)
            pop(icon(0xE735, sx, -1.8, 0.4, "orange", 0.03, parent=E), T(13.8 + i * 0.1), 0.3, 1.3)
        fade_in(E, T(13.1), 0.3)


def a03_kitchen(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        mon = group(-2.35, -0.45, 0.0)
        soft(0.3, -0.5, 6.8, 4.4, "black", 0.5, z=-0.05, parent=mon)
        rect(11.65, 7.05, "line", r=0.29, z=-0.01, parent=mon)
        rect(11.6, 7.0, "frame", r=0.28, parent=mon)
        rect(11.2, 6.6, "kds", 0, 0, 0.01, r=0.16, parent=mon)
        rect(1.4, 0.5, "frame", 0, -3.75, -0.01, parent=mon)
        rect(3.6, 0.16, "frame", 0, -4.0, -0.01, r=0.08, parent=mon)
        text("Kitchen screen", -5.25, 2.9, 0.3, "white", "bold", parent=mon, z=0.02)
        dot = circle(0.1, "green", 4.4, 2.9, 0.02, parent=mon)
        text("LIVE", 4.62, 2.9, 0.2, "green", "bold", parent=mon, z=0.02)
        for k in range(0, 8, 2):
            bump(dot, T(0.5 + k), 0.8, 1.5)
        for cx, lab, col in ((-3.65, "New", "orange"), (0, "Cooking", "teal"), (3.65, "Ready", "green")):
            rect(3.45, 5.45, "kcol", cx, -0.45, 0.015, r=0.16, parent=mon)
            circle(0.08, col, cx - 1.45, 1.93, 0.02, parent=mon)
            text(lab, cx - 1.27, 1.93, 0.26, "white", "bold", parent=mon, z=0.02)
        slot = (0.95, -0.7, -2.35)
        C = ticket(mon, -3.65, slot[0], "Table 12", "04:10", ("1× Grilled fish", "1× Mixed grill"), "orange")
        B = ticket(mon, 0, slot[0], "Table 3", "07:45", ("1× Lamb couscous", "2× Mint tea"), "teal")
        A = ticket(mon, -3.65, slot[1], "Table 7", "00:05", ("1× Lamb couscous", "1× Fresh juice"), "orange")
        flash = rect(3.36, 1.66, "orange", 0, 0, -0.005, r=0.16, parent=A)
        for k, a in ((1.0, 0.0), (1.3, 1.0), (1.7, 0.25), (2.1, 1.0), (2.5, 0.0)):
            akey(flash, T(k), a)
        pop(A, T(1.0), 0.45, 1.12)
        punch(T(1.0), 0.95)
        move(C, T(2.6), 0.5, 0, slot[1]); move(A, T(2.6), 0.5, -3.65, slot[0])
        move(B, T(4.2), 0.5, 3.65, slot[0]); move(C, T(4.2), 0.5, 0, slot[0])
        tap(-3.65, slot[0], T(5.1), parent=mon)
        move(A, T(5.3), 0.5, 0, slot[1])
        move(C, T(6.6), 0.5, 3.65, slot[1]); move(A, T(6.6), 0.5, 0, slot[0])
        fade_in(mon, T(0.15), 0.4)
        slide_in(mon, T(0.15), dy=-0.6, d=0.5)
        kicker("In the kitchen", T(0.3), 4.0, 3.55)
        caption("Orders show\nup *instantly*", "No paper. No mistakes.", T(0.4), T(4.3), 4.0, 2.9, 0.66)
        caption("From *new*\nto *ready*", "Everyone knows what's next", T(4.3), s1, 4.0, 2.9, 0.66)


def a04_waiter(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        kicker("On the floor", T(0.3), -8.6, 2.9)
        words("Food *ready*?\nWaiters know.", T(0.4), T(3.4), -8.6, 2.25, 0.82)
        words("Table wants\nthe *bill*?\nThey know too.", T(3.4), s1, -8.6, 2.25, 0.82)
        ph = phone(4.6, -0.1, 0.0)
        slide_in(ph, T(0.15), dy=-1.0, d=0.6)
        S = screen_group(ph)
        app_header(S, "Waiter · Sami", "Tables 1–8")
        text("Latest", -1.5, 1.45, 0.17, "ink2", "bold", parent=S, z=0.02)
        old = notif(S, 0.7, 0xE73E, "grey", "Table 5 · served", "2 minutes ago")
        n1 = notif(S, 0.7, 0xEA8F, "green", "Table 7 · ready to serve", "Lamb couscous, juice")
        move(old, T(0.9), 0.4, y=-0.45)
        pop(n1, T(1.0), 0.45, 1.1)
        punch(T(1.0), 0.95)
        n2 = notif(S, 0.7, 0xE8C7, "orange", "Table 3 · wants the bill", "Cash · 34.0 TND")
        move(old, T(3.6), 0.4, y=-1.6)
        move(n1, T(3.6), 0.4, y=-0.45)
        pop(n2, T(3.7), 0.45, 1.1)
        fade_in(S, T(0.15), 0.5)


def a05_cashier(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        caption("Close the bill in *one tap*", "Cash or card, with a printed receipt", T(0.2), None,
                0, 4.75, 0.74, "CENTER")
        panel = group(-3.4, -1.0, 0.0)
        rect(9.6, 4.2, "card", r=0.3, parent=panel)
        text("Bills", -4.4, 1.55, 0.34, "white", "bold", parent=panel, z=0.01)
        for i, (tb, meth, amt, act) in enumerate((("Table 3", "Cash", "34.0 TND", True),
                                                  ("Table 7", "Card", "30.0 TND", False))):
            y = 0.5 - i * 1.25
            r = group(0, y, 0.01, panel)
            rect(9.0, 1.0, "card2", r=0.14, parent=r)
            text(tb, -4.1, 0, 0.3, "white", "bold", parent=r, z=0.01)
            text(meth, -0.8, 0, 0.24, "sky", "semi", parent=r, z=0.01)
            text(amt, 2.4, 0, 0.3, "white", "bold", "RIGHT", parent=r, z=0.01)
            if act:
                cf = pill("Confirm", 3.6, 0, 0.2, "white", "primary", 0.01, r, h=0.5, pad=0.22)
                pd = pill("Paid", 3.6, 0, 0.2, "white", "green", 0.02, r, h=0.5, code=0xE73E, pad=0.2)
                tap(3.6, y, T(1.2), parent=panel)
                fade_out(cf, T(1.35), 0.2)
                pop(pd, T(1.4), 0.4, 1.25)
                punch(T(1.4), 0.95)
            else:
                pill("Paid", 3.6, 0, 0.2, "white", "green", 0.01, r, h=0.5, code=0xE73E, pad=0.2)
        fade_in(panel, T(0.2), 0.4)
        slide_in(panel, T(0.2), dy=-0.5, d=0.5)
        pop(pill("Table 3 is free again", -3.4, -3.85, 0.26, "white", "green", 0.1, code=0xE73E), T(3.1), 0.45)
        rc = group(5.4, 2.9, 0.2)
        fade_in(soft(0.2, -3.0, 2.3, 3.3, "black", 0.45, z=-0.05, parent=rc), T(1.7), 1.0)
        grow_y(rect(3.6, 6.0, "paper", anchor="T", parent=rc), T(1.7), 0.9)
        lines = (("LE JASMIN", 0, -0.5, 0.3, "ink", "bold", "CENTER"),
                 ("Table 3", -1.55, -1.3, 0.19, "ink", "reg", "LEFT"),
                 ("1× Lamb couscous", -1.55, -1.9, 0.19, "ink", "reg", "LEFT"),
                 ("24.0", 1.55, -1.9, 0.19, "ink", "reg", "RIGHT"),
                 ("2× Mint tea", -1.55, -2.3, 0.19, "ink", "reg", "LEFT"),
                 ("6.0", 1.55, -2.3, 0.19, "ink", "reg", "RIGHT"),
                 ("1× Mineral water", -1.55, -2.7, 0.19, "ink", "reg", "LEFT"),
                 ("4.0", 1.55, -2.7, 0.19, "ink", "reg", "RIGHT"),
                 ("TOTAL", -1.55, -3.5, 0.26, "ink", "bold", "LEFT"),
                 ("34.0 TND", 1.55, -3.5, 0.26, "ink", "bold", "RIGHT"),
                 ("Paid · Cash", -1.55, -3.95, 0.19, "green", "semi", "LEFT"),
                 ("Merci et à bientôt !", 0, -4.8, 0.18, "ink2", "reg", "CENTER"))
        for i, (s, x, y, sz, col, fnt, al) in enumerate(lines):
            fade_in(text(s, x, y, sz, col, fnt, al, parent=rc, z=0.01), T(2.1 + i * 0.05), 0.25)
        for y in (-0.95, -3.1):
            g = group(0, y, 0.01, rc)
            dashes(-1.6, 1.6, 0, "grey", parent=g)
            fade_in(g, T(2.2), 0.3)


def a06_owner(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        words("Your restaurant on *one screen*", T(0.2), None, 0, 4.85, 0.58, "CENTER")
        lap = group(0, 0.1, 0.0)
        soft(0, -0.6, 7.6, 4.4, "black", 0.5, z=-0.05, parent=lap)
        rect(12.85, 7.15, "line", r=0.27, z=-0.01, parent=lap)
        rect(12.8, 7.1, "frame", r=0.25, parent=lap)
        rect(12.4, 6.7, "screen", 0, 0, 0.01, r=0.1, parent=lap)
        rect(14.4, 0.3, "#2B3B4A", 0, -3.72, 0.0, r=0.15, parent=lap)
        slide_in(lap, T(0.15), dy=-0.7, d=0.6)
        rect(2.3, 6.7, "paper", -6.2, 0, 0.015, anchor="L", parent=lap)
        rect(0.02, 6.7, "rule", -3.9, 0, 0.016, parent=lap)
        image(LOGO, 0.5, 0.5, -5.8, 2.85, 0.02, parent=lap)
        text("RsWork", -5.45, 2.85, 0.22, "ink", "black", parent=lap, z=0.02)
        nav = ((0xE9D2, "Overview"), (0xF0E3, "Orders"), (0xED56, "Menu"), (0xE80A, "Tables"),
               (0xE716, "Team"), (0xED15, "Reviews"))
        ny = [2.05 - i * 0.55 for i in range(len(nav))]
        hl = rect(2.06, 0.44, "#DCE9F3", -5.05, ny[0], 0.018, r=0.1, parent=lap)
        for i, (code, lab) in enumerate(nav):
            icon(code, -5.85, ny[i], 0.2, "primary", 0.02, parent=lap)
            text(lab, -5.6, ny[i], 0.19, "ink", "semi", parent=lap, z=0.02)
        move(hl, T(4.6), 0.3, y=ny[2])

        P1 = group(0, 0, 0.02, lap)
        text("Today", -3.65, 2.85, 0.34, "ink", "bold", parent=P1)
        for i, (lab, fmt, v, dlt) in enumerate((
                ("Sales", lambda v: f"{v:,.0f} TND".replace(",", " "), 2845, "+12% vs last week"),
                ("Orders", lambda v: f"{v:.0f}", 126, "+9% vs last week"),
                ("Average bill", lambda v: f"{v:.1f} TND", 22.6, "+3% vs last week"),
                ("Guest rating", lambda v: f"{v:.1f} / 5", 4.7, "18 new reviews"))):
            kpi(P1, -2.5 + i * 2.45, 1.6, lab, fmt, v, dlt, T(0.8))
        punch(T(0.8), 0.96)
        ch = group(-0.65, -1.25, 0.0, P1)
        rect(6.1, 3.6, "paper", r=0.12, parent=ch)
        text("Sales this week", -2.8, 1.48, 0.19, "ink", "bold", parent=ch, z=0.01)
        for i, (v, d) in enumerate(zip((0.52, 0.57, 0.6, 0.66, 0.92, 1.0, 0.78),
                                       ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"))):
            bx = -2.4 + i * 0.8
            grow_y(rect(0.46, 2.3 * v, "teal" if i == 5 else "primary", bx, -1.25, 0.01, r=0.06,
                        anchor="B", parent=ch), T(1.2 + i * 0.08), 0.5)
            text(d, bx, -1.5, 0.15, "ink2", "reg", "CENTER", parent=ch, z=0.01)
        bs = group(4.27, -1.25, 0.0, P1)
        rect(3.45, 3.6, "paper", r=0.12, parent=bs)
        text("Best dishes", -1.5, 1.48, 0.19, "ink", "bold", parent=bs, z=0.01)
        for i, (nm, w) in enumerate((("Lamb couscous", 2.9), ("Merguez ojja", 2.3),
                                     ("Mixed grill", 1.8), ("Mint tea", 1.4))):
            yy = 0.85 - i * 0.7
            text(nm, -1.5, yy, 0.17, "ink", parent=bs, z=0.01)
            grow_x(rect(w, 0.14, "teal" if i == 0 else "primary", -1.5, yy - 0.28, 0.01, r=0.07,
                        anchor="L", parent=bs), T(1.5 + i * 0.1), 0.6)
        life(P1, T(0.4), T(4.7))

        P2 = group(0, 0, 0.02, lap)
        text("Menu", -3.65, 2.85, 0.34, "ink", "bold", parent=P2)
        dishes = (("couscous-agneau", "Lamb couscous", "24.0"), ("ojja-merguez", "Merguez ojja", "16.5"),
                  ("grillade-mixte", "Mixed grill", "32.0"), ("poisson-grille", "Grilled fish", "28.0"),
                  ("brochettes-de-poulet", "Chicken skewers", "19.0"), ("kafteji-royal", "Kafteji royal", "14.0"),
                  ("lablabi", "Lablabi", "8.5"), ("the", "Mint tea", "3.0"))
        for i, (img, nm, pr) in enumerate(dishes):
            g = group(-2.5 + (i % 4) * 2.45, 0.85 - (i // 4) * 2.6, 0.0, P2)
            rect(2.3, 2.4, "paper", r=0.12, parent=g)
            image(os.path.join(MENU, img + ".webp"), 2.3, 1.25, 0, 0.575, 0.01, r=0.12, parent=g)
            text(nm, -1.0, -0.28, 0.17, "ink", "bold", parent=g, z=0.01)
            p_old = text(pr + " TND", -1.0, -0.66, 0.16, "primary", "semi", parent=g, z=0.01)
            fade_in(g, T(4.8 + i * 0.05), 0.3)
            if nm == "Grilled fish":
                p_new = text("29.5 TND", -1.0, -0.66, 0.16, "orange", "bold", parent=g, z=0.01)
                tap(-0.6, -0.66, T(6.3), parent=g)
                swap(p_old, p_new, T(6.5), 0.25)
                bump(g, T(6.5), 0.5, 1.1)
        fade_in(P2, T(4.6), 0.3)
        fade_in(lap, T(0.15), 0.4)
        words("See your *sales*, *best dishes* and *reviews*", T(0.6), T(4.7), 0, -4.25, 0.46, "CENTER",
              font="semi", stagger=0.03)
        words("Change *prices* and *photos* in seconds", T(4.8), None, 0, -4.25, 0.46, "CENTER",
              font="semi", stagger=0.03)


def a07_forecast(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        words("Know how *busy* next week will be", T(0.15), None, -8.8, 4.85, 0.6, "LEFT")
        card = group(-3.5, -0.85, 0.0)
        rect(10.6, 6.4, "card", r=0.3, parent=card)
        X0, X1, Y0, Y1 = -4.7, 4.7, -2.45, 1.8
        text("Guests per day", -4.85, 2.65, 0.26, "white", "bold", parent=card, z=0.01)
        for lx, col, lab in ((0.2, "teal", "Past weeks"), (2.6, "orange", "Next week")):
            rect(0.32, 0.08, col, lx, 2.65, 0.01, r=0.03, parent=card)
            text(lab, lx + 0.25, 2.65, 0.2, "muted", parent=card, z=0.01)
        for v in (0, 50, 100):
            rect(X1 - X0, 0.012, "line", X0, Y0 + (Y1 - Y0) * v / 100, 0.01, anchor="L", parent=card)
        pattern = (42, 45, 47, 50, 68, 80, 60)
        rnd = P.random.Random(5)
        nh, na = 21, 28
        step = (X1 - X0) / (na - 1)

        def pt(i, v):
            return (X0 + i * step, Y0 + (Y1 - Y0) * v / 100)

        hist = [pattern[i % 7] + 0.25 * i + rnd.uniform(-3, 3) for i in range(nh)]
        fc = [pattern[i % 7] + 0.25 * i for i in range(nh - 1, na)]
        fc[0] = hist[-1]
        h = polyline([pt(i, v) for i, v in enumerate(hist)], 0.08, "teal", 0.03, card)
        f = polyline([pt(nh - 1 + i, v) for i, v in enumerate(fc)], 0.09, "orange", 0.035, card)
        for ln, t0, t1 in ((h, T(0.4), T(1.5)), (f, T(1.7), T(2.4))):
            ln.data.bevel_factor_end = 0.0
            ln.data.keyframe_insert("bevel_factor_end", frame=F(t0))
            ln.data.bevel_factor_end = 1.0
            ln.data.keyframe_insert("bevel_factor_end", frame=F(t1))
            fade_in(ln, t0, 0.1)
        punch(T(2.4), 0.95)
        up = [pt(nh - 1 + i, v + 4 + i) for i, v in enumerate(fc)]
        lo = [pt(nh - 1 + i, v - 4 - i) for i, v in enumerate(fc)]
        me = poly_mesh(None, up + lo[::-1])
        band = new_obj("band", me, card, (0, 0, 0.02))
        _finish(band, me, "orange", 0.22)
        fade_in(band, T(2.3), 0.4)
        tg = group(X0 + (nh - 1) * step, 0, 0.025, card)
        dashes(Y0, Y1 + 0.1, 0, "muted", parent=tg, vertical=True, th=0.02)
        text("Today", 0, Y1 + 0.33, 0.18, "muted", "semi", "CENTER", parent=tg)
        fade_in(tg, T(1.5), 0.3)
        fade_in(card, T(0.2), 0.35)
        slide_in(card, T(0.2), dy=-0.5, d=0.45)

        kicker("Simple tips", T(2.6), 2.2, 1.9)
        bub = group(5.6, 0.6, 0.4)
        rect(7.0, 1.6, "card2", r=0.25, parent=bub)
        rect(7.04, 1.64, "orange", r=0.26, z=-0.005, alpha=0.5, parent=bub)
        circle(0.3, "orange", -3.0, 0, 0.01, alpha=0.18, parent=bub)
        icon(0xEA80, -3.0, 0, 0.3, "orange", 0.02, parent=bub)
        pop(bub, T(2.7), 0.4, 1.06)
        typewriter("Saturday will be busy.\nAdd one more cook in the evening.", T(2.9), T(3.7), -2.55,
                   0.42, 0.26, "white", "semi", parent=bub, z=0.02, line=1.15)
        words("Clear advice, in *plain words*", T(3.2), None, 2.2, -0.6, 0.36, "LEFT", "muted",
              "orange", "semi", stagger=0.04)


def a08_cta(s0, s1):
    T = lambda d: s0 + d  # noqa: E731
    with Shot(s0, s1, zoom=0):
        fade_in(soft(0, 1.6, 4.2, 4.2, "teal", 0.36, z=-1), T(0.1), 0.6)
        logo = image(LOGO, 2.4, 2.4, 0, 1.85, 0.2)
        logo.rotation_euler.z = math.radians(-40)
        pop(logo, T(0.15), 0.5, 1.18)
        rkey(logo, T(0.15), -40)
        rkey(logo, T(0.65), 0)
        punch(T(0.15), 0.93, 0.6)
        slide_in(text("RsWork", 0, -0.05, 1.05, "white", "black", "CENTER"), T(0.4))
        words("Faster service. Happier guests. *More sales.*", T(0.75), None, 0, -0.68, 0.46, "CENTER",
              "sky", "orange", "semi", stagger=0.05)
        btn = pill("Book your demo", 0, -2.15, 0.34, "white", "orange", 0.1, pad=0.6, h=0.9,
                   code=0xE8BD, font="bold")
        pop(btn, T(1.5), 0.5, 1.15)
        for k in (2.4, 3.2):
            bump(btn, T(k), 0.45, 1.08)
        fade_in(text("rs-work-ge7g.vercel.app", 0, -3.1, 0.3, "muted", "semi", "CENTER"), T(1.9))


def build_ad():
    P.setup()
    P.background()
    scenes = (a01_hook, a02_guests, a03_kitchen, a04_waiter, a05_cashier, a06_owner,
              a07_forecast, a08_cta)
    for fn, s0, s1 in zip(scenes, CUTS, CUTS[1:]):
        fn(s0, s1)
    for b in CUTS[1:-1]:
        wipe(b)


if __name__ == "__main__":
    P.main(build_ad)
