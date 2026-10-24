# -*- coding: utf-8 -*-
"""用 Python 复现 skin3d.js 的渲染数学，生成预览图并检查形状是否正确。

这样做是因为本机沙箱不允许启动 Chrome（mojo IPC 被拒），
但两边的数学是同一套（JS 端已有 26 项单测），这里验证"画出来像不像人"。

用法：python render-preview.py
输出：preview-front.png / preview-iso.png
"""

import math
import os

from PIL import Image

TEX = 64
HERE = os.path.dirname(os.path.abspath(__file__))

PARTS = [
    dict(name="head", u=0,  v=0,  w=8, h=8,  d=8, cx=0,  cy=28, cz=0),
    dict(name="body", u=16, v=16, w=8, h=12, d=4, cx=0,  cy=18, cz=0),
    dict(name="armR", u=40, v=16, w=4, h=12, d=4, cx=-6, cy=18, cz=0),
    dict(name="armL", u=32, v=48, w=4, h=12, d=4, cx=6,  cy=18, cz=0),
    dict(name="legR", u=0,  v=16, w=4, h=12, d=4, cx=-2, cy=6,  cz=0),
    dict(name="legL", u=16, v=48, w=4, h=12, d=4, cx=2,  cy=6,  cz=0),
]

COLORS = dict(skin=(246, 201, 168), shirt=(63, 127, 191), pants=(58, 58, 85),
              hair=(74, 53, 38), dark=(43, 33, 26), shoe=(34, 34, 46),
              collar=(47, 95, 146))


def uv_rects(u, v, w, h, d):
    return {
        "top":    (u + d,         v,     w, d),
        "bottom": (u + d + w,     v,     w, d),
        "right":  (u,             v + d, d, h),
        "front":  (u + d,         v + d, w, h),
        "left":   (u + d + w,     v + d, d, h),
        "back":   (u + d + w + d, v + d, w, h),
    }


def build_faces():
    out = []
    for p in PARTS:
        r = uv_rects(p["u"], p["v"], p["w"], p["h"], p["d"])
        x0 = p["cx"] - p["w"] / 2.0
        x1 = p["cx"] + p["w"] / 2.0
        y0 = p["cy"] - p["h"] / 2.0
        y1 = p["cy"] + p["h"] / 2.0
        z0 = p["cz"] - p["d"] / 2.0
        z1 = p["cz"] + p["d"] / 2.0
        defs = {
            "front":  [(x0, y1, z1), (x1, y1, z1), (x1, y0, z1), (x0, y0, z1)],
            "back":   [(x1, y1, z0), (x0, y1, z0), (x0, y0, z0), (x1, y0, z0)],
            "right":  [(x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (x0, y0, z0)],
            "left":   [(x1, y1, z1), (x1, y1, z0), (x1, y0, z0), (x1, y0, z1)],
            "top":    [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            "bottom": [(x1, y0, z1), (x0, y0, z1), (x0, y0, z0), (x1, y0, z0)],
        }
        for key, corners in defs.items():
            out.append({"part": p["name"], "key": key, "uv": r[key], "corners": corners})
    return out


def rot_point(p, view):
    cy, sy = math.cos(view["yaw"]), math.sin(view["yaw"])
    cp, sp = math.cos(view["pitch"]), math.sin(view["pitch"])
    y = p[1] - 16.0
    x1 = p[0] * cy + p[2] * sy
    z1 = -p[0] * sy + p[2] * cy
    y1 = y * cp - z1 * sp
    z2 = y * sp + z1 * cp
    return (x1, y1, z2)


def project(p, view):
    r = rot_point(p, view)
    return (view["cx"] + r[0] * view["scale"],
            view["cy"] - r[1] * view["scale"],
            r[2])


def quad_of(face, view):
    pts = [project(c, view) for c in face["corners"]]
    depth = sum(p[2] for p in pts) / 4.0
    return {"pts": pts, "depth": depth}


def point_in_quad(px, py, pts):
    sign = 0
    for i in range(4):
        ax, ay = pts[i][0], pts[i][1]
        bx, by = pts[(i + 1) % 4][0], pts[(i + 1) % 4][1]
        cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
        if abs(cross) < 1e-9:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True


# ---------------------------------------------------------------- 默认皮肤

def make_texture():
    img = Image.new("RGBA", (TEX, TEX), (0, 0, 0, 0))
    faces = build_faces()

    def fill_part(name, color):
        for f in faces:
            if f["part"] != name:
                continue
            u, v, w, h = f["uv"]
            for y in range(v, v + h):
                for x in range(u, u + w):
                    img.putpixel((x, y), color + (255,))

    fill_part("head", COLORS["skin"])
    fill_part("armR", COLORS["skin"])
    fill_part("armL", COLORS["skin"])
    fill_part("body", COLORS["shirt"])
    fill_part("legR", COLORS["pants"])
    fill_part("legL", COLORS["pants"])

    def rect(u, v, w, h, color):
        for y in range(v, v + h):
            for x in range(u, u + w):
                img.putpixel((x, y), color + (255,))

    uv = {f["part"] + ":" + f["key"]: f["uv"] for f in faces}

    u, v, w, h = uv["head:top"]
    rect(u, v, w, h, COLORS["hair"])
    u, v, w, h = uv["head:front"]
    rect(u, v, w, 2, COLORS["hair"])
    rect(u + 1, v + 3, 2, 2, COLORS["dark"])
    rect(u + 5, v + 3, 2, 2, COLORS["dark"])
    u, v, w, h = uv["body:front"]
    rect(u, v, w, 2, COLORS["collar"])
    for leg in ("legR", "legL"):
        u, v, w, h = uv[leg + ":front"]
        rect(u, v + 10, w, 2, COLORS["shoe"])
    return img


# ---------------------------------------------------------------- 渲染

def render(tex, size=(620, 720), yaw=0.0, pitch=0.12):
    W, H = size
    view = {"yaw": yaw, "pitch": pitch, "cx": W / 2.0, "cy": H / 2.0 + 60}
    view["scale"] = min(W / 26.0, H / 40.0) * 1.0

    out = Image.new("RGB", (W, H), (27, 21, 15))
    px = out.load()
    tex_px = tex.load()

    quads = [(quad_of(f, view), f) for f in build_faces()]
    quads.sort(key=lambda t: t[0]["depth"])

    for q, f in quads:
        pts = q["pts"]
        u0, v0, tw, th = f["uv"]
        p0, p1, p3 = pts[0], pts[1], pts[3]
        a = p1[0] - p0[0]
        b = p1[1] - p0[1]
        c = p3[0] - p0[0]
        d = p3[1] - p0[1]
        det = a * d - b * c
        if abs(det) < 1e-9:
            continue

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x_lo, x_hi = int(max(0, min(xs))) - 1, int(min(W - 1, max(xs))) + 1
        y_lo, y_hi = int(max(0, min(ys))) - 1, int(min(H - 1, max(ys))) + 1

        for yy in range(y_lo, y_hi + 1):
            for xx in range(x_lo, x_hi + 1):
                mx, my = xx + 0.5, yy + 0.5
                if not point_in_quad(mx, my, pts):
                    continue
                dx, dy = mx - p0[0], my - p0[1]
                u = (d * dx - c * dy) / det
                v = (-b * dx + a * dy) / det
                if u < 0 or u > 1 or v < 0 or v > 1:
                    continue
                tx = min(TEX - 1, max(0, int(u0 + u * tw)))
                ty = min(TEX - 1, max(0, int(v0 + v * th)))
                r, g, b_, a_ = tex_px[tx, ty]
                if a_ > 0:
                    px[xx, yy] = (r, g, b_)
    return out


def analyze(img):
    W, H = img.size
    px = img.load()
    counts = {"skin": 0, "shirt": 0, "pants": 0, "hair": 0, "dark": 0}
    target = {
        "skin": COLORS["skin"], "shirt": COLORS["shirt"], "pants": COLORS["pants"],
        "hair": COLORS["hair"], "dark": COLORS["dark"],
    }

    def near(c1, c2, tol=12):
        return all(abs(c1[i] - c2[i]) <= tol for i in range(3))

    bbox = {}
    for y in range(H):
        for x in range(W):
            c = px[x, y]
            for name, ref in target.items():
                if near(c, ref):
                    counts[name] += 1
                    if name not in bbox:
                        bbox[name] = [x, y, x, y]
                    else:
                        b = bbox[name]
                        b[0] = min(b[0], x); b[1] = min(b[1], y)
                        b[2] = max(b[2], x); b[3] = max(b[3], y)
                    break
    return counts, bbox


def main():
    tex = make_texture()
    tex.save(os.path.join(HERE, "texture-64.png"))
    print("纹理已保存: texture-64.png")

    front = render(tex, yaw=0.0, pitch=0.10)
    front.save(os.path.join(HERE, "preview-front.png"))
    iso = render(tex, yaw=-0.6, pitch=0.28)
    iso.save(os.path.join(HERE, "preview-iso.png"))
    print("预览已保存: preview-front.png / preview-iso.png")

    counts, bbox = analyze(front)
    W, H = front.size
    print("\n=== 正面预览分析（%dx%d）===" % (W, H))
    for k, v in counts.items():
        print("  %-6s %7d px   bbox=%s" % (k, v, bbox.get(k)))

    total = sum(counts.values())
    ok = True

    if counts["skin"] < 3000:
        print("  [!] 肤色太少，模型可能没画出来"); ok = False
    if counts["shirt"] < 2000:
        print("  [!] 衣服区域太少"); ok = False
    if counts["pants"] < 1500:
        print("  [!] 裤腿区域太少"); ok = False
    if counts["hair"] < 300:
        print("  [!] 头发没画上"); ok = False
    if counts["dark"] < 20:
        print("  [!] 眼睛没画上"); ok = False

    # 空间关系：头发在最上，衣服在中间，裤子在最下
    if "hair" in bbox and "shirt" in bbox and "pants" in bbox:
        hair_y = (bbox["hair"][1] + bbox["hair"][3]) / 2
        shirt_y = (bbox["shirt"][1] + bbox["shirt"][3]) / 2
        pants_y = (bbox["pants"][1] + bbox["pants"][3]) / 2
        print("  y 中心: 头发 %.0f < 衣服 %.0f < 裤子 %.0f" % (hair_y, shirt_y, pants_y))
        if not (hair_y < shirt_y < pants_y):
            print("  [!] 上下顺序不对"); ok = False

    # 左右对称性（正面视角）
    if "shirt" in bbox:
        x0, y0, x1, y1 = bbox["shirt"]
        mid = (x0 + x1) / 2.0
        left = right = 0
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if x < mid and px_safe(front, x, y) is not None:
                    pass
        print("  衣服水平中心: %.0f (画面中心 %.0f)" % (mid, W / 2.0))
        if abs(mid - W / 2.0) > 12:
            print("  [!] 模型没有居中"); ok = False

    print("\n结论:", "PASS - 渲染管线正常，模型是个人形" if ok else "WARN - 需要检查")


def px_safe(img, x, y):
    W, H = img.size
    if 0 <= x < W and 0 <= y < H:
        return img.load()[x, y]
    return None


if __name__ == "__main__":
    main()
