/* =========================================================================
 *  MC 皮肤编辑器 · 3D 绘制核心
 *  纯 Canvas 2D 实现，零依赖：
 *    1) 把玩家模型的 6 块立方体投影到 2D，按深度排序"贴图"（画家算法）
 *    2) 鼠标位置反解到 64×64 皮肤纹理坐标 → 直接改纹理像素 → 重绘
 *    3) 导出就是一张 64×64 PNG（Minecraft 标准皮肤格式）
 *
 *  皮肤 UV 布局（64×64）：
 *    一个 w×h×d 的盒子从纹理 (u,v) 开始铺 6 个面：
 *      top    (u+d,     v)      w×d
 *      bottom (u+d+w,   v)      w×d
 *      right  (u,       v+d)    d×h
 *      front  (u+d,     v+d)    w×h
 *      left   (u+d+w,   v+d)    d×h
 *      back   (u+d+w+d, v+d)    w×h
 *    头部 (0,0) 8×8×8 · 身体 (16,16) 8×12×4 · 右臂 (40,16)
 *    右腿 (0,16) · 左腿 (16,48) · 左臂 (32,48)
 * ========================================================================= */
(function (global) {
  'use strict';

  var TEX = 64;

  /* ============================ 纯逻辑（可单测） ============================ */

  function uvRects(u, v, w, h, d) {
    return {
      top:    [u + d,         v,     w, d],
      bottom: [u + d + w,     v,     w, d],
      right:  [u,             v + d, d, h],
      front:  [u + d,         v + d, w, h],
      left:   [u + d + w,     v + d, d, h],
      back:   [u + d + w + d, v + d, w, h],
    };
  }

  /**
   * 一个笔刷方块画在纹理上的实际范围。
   * clip = 当前面自己的 UV 矩形；给了就把它裁进去，
   * 这样大笔刷画到面的边缘时，绝不会"漏"到隔壁区域的纹理上。
   * 返回 { x, y, w, h, empty }
   */
  function brushRect(tx, ty, size, clip) {
    var half = Math.floor((size - 1) / 2);
    var x0 = tx - half, y0 = ty - half;
    var x1 = x0 + size, y1 = y0 + size;
    if (clip) {
      x0 = Math.max(x0, clip[0]);
      y0 = Math.max(y0, clip[1]);
      x1 = Math.min(x1, clip[0] + clip[2]);
      y1 = Math.min(y1, clip[1] + clip[3]);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, empty: x1 <= x0 || y1 <= y0 };
  }

  // 玩家面朝 +z；玩家右手在 -x（和原版一致）
  var PARTS = [
    { name: 'head', u: 0,  v: 0,  w: 8, h: 8,  d: 8, cx: 0,  cy: 28, cz: 0 },
    { name: 'body', u: 16, v: 16, w: 8, h: 12, d: 4, cx: 0,  cy: 18, cz: 0 },
    { name: 'armR', u: 40, v: 16, w: 4, h: 12, d: 4, cx: -6, cy: 18, cz: 0 },
    { name: 'armL', u: 32, v: 48, w: 4, h: 12, d: 4, cx: 6,  cy: 18, cz: 0 },
    { name: 'legR', u: 0,  v: 16, w: 4, h: 12, d: 4, cx: -2, cy: 6,  cz: 0 },
    { name: 'legL', u: 16, v: 48, w: 4, h: 12, d: 4, cx: 2,  cy: 6,  cz: 0 }
  ];

  /**
   * 生成所有面：{ part, key, uv:[u,v,w,h], corners:[4 个 [x,y,z]] }
   * corners 顺序 = 纹理左上 → 右上 → 右下 → 左下（从外面看）
   */
  function buildFaces(parts) {
    var out = [];
    var list = parts || PARTS;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var uv = uvRects(p.u, p.v, p.w, p.h, p.d);
      var x0 = p.cx - p.w / 2, x1 = p.cx + p.w / 2;
      var y0 = p.cy - p.h / 2, y1 = p.cy + p.h / 2;
      var z0 = p.cz - p.d / 2, z1 = p.cz + p.d / 2;
      var defs = {
        front:  [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
        back:   [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
        right:  [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
        left:   [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
        top:    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
        bottom: [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]]
      };
      for (var key in defs) {
        out.push({ part: p.name, key: key, uv: uv[key], corners: defs[key] });
      }
    }
    return out;
  }

  /** 绕 view.pivot（默认模型中心 (0,16,0)）旋转：先 Y(yaw) 再 X(pitch) */
  function rotPoint(p, view) {
    var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    var pv = view.pivot || [0, 16, 0];
    var x = p[0] - pv[0];
    var y = p[1] - pv[1];
    var z = p[2] - pv[2];
    var x1 = x * cy + z * sy;
    var z1 = -x * sy + z * cy;
    var y1 = y * cp - z1 * sp;
    var z2 = y * sp + z1 * cp;
    return [x1, y1, z2];
  }

  function project(p, view) {
    var r = rotPoint(p, view);
    return { x: view.cx + r[0] * view.scale, y: view.cy - r[1] * view.scale, z: r[2] };
  }

  /** 一个面投影后的四个点 + 平均深度（越大越靠近观察者） */
  function quadOf(face, view) {
    var pts = [];
    var depth = 0;
    for (var i = 0; i < 4; i++) {
      var q = project(face.corners[i], view);
      pts.push(q);
      depth += q.z;
    }
    return { pts: pts, depth: depth / 4 };
  }

  function pointInQuad(px, py, pts) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4];
      var cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      var s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /** 鼠标点 → 命中哪个面 + 对应纹理像素 */
  function pickAt(faces, view, mx, my) {
    var best = null;
    for (var i = 0; i < faces.length; i++) {
      var q = quadOf(faces[i], view);
      if (!pointInQuad(mx, my, q.pts)) continue;
      if (!best || q.depth > best.q.depth) best = { face: faces[i], q: q };
    }
    if (!best) return null;

    var p0 = best.q.pts[0], p1 = best.q.pts[1], p3 = best.q.pts[3];
    var a = p1.x - p0.x, b = p1.y - p0.y;
    var c = p3.x - p0.x, d = p3.y - p0.y;
    var det = a * d - b * c;
    if (Math.abs(det) < 1e-9) return null;

    var dx = mx - p0.x, dy = my - p0.y;
    var u = (d * dx - c * dy) / det;
    var v = (-b * dx + a * dy) / det;
    if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return null;

    var uv = best.face.uv;
    return {
      face: best.face,
      u: u,
      v: v,
      tx: Math.floor(uv[0] + u * uv[2]),
      ty: Math.floor(uv[1] + v * uv[3])
    };
  }

  /* ============================ 编辑器 ============================ */

  var COLORS = [
    '#ffffff', '#d8d8d8', '#9a9a9a', '#5a5a5a', '#2b2b2b', '#000000',
    '#f6c9a8', '#e0a070', '#b07040', '#7a4a28',
    '#e04a4a', '#e07b39', '#e0c33a', '#4fbf6a', '#3a9fd8', '#6a5ae0',
    '#c04ae0', '#f069a8', '#5ad8c8', '#8a6a4a'
  ];

  function createEditor(dom) {
    var canvas = dom.view;
    var ctx = canvas.getContext('2d');
    var flat = dom.flat;
    var fctx = flat.getContext('2d');

    var tex = document.createElement('canvas');
    tex.width = TEX;
    tex.height = TEX;
    var tctx = tex.getContext('2d', { willReadFrequently: true });

    var faces = buildFaces();

    var state = {
      yaw: -0.5,
      pitch: 0.18,
      zoom: 1,
      w: 600,
      h: 640,
      tool: 'brush',
      size: 1,
      color: '#f6c9a8',
      dragging: null,
      last: null,
      undo: [],
      redo: [],
      hover: null,
      focus: null,          // null = 整个模型；'head'/'body'/... = 只显示这个部件
      autoRotate: false
    };

    var BASE = 12; // 基准缩放（模型高 32 格）

    /* ---------------- 视角 ---------------- */

    function partInfo(name) {
      for (var i = 0; i < PARTS.length; i++) {
        if (PARTS[i].name === name) return PARTS[i];
      }
      return null;
    }

    function viewState() {
      var pivot = [0, 16, 0];
      var s = Math.min(state.w / 26, state.h / 40) * state.zoom;
      var cy = state.h / 2 + s * 1.2;

      if (state.focus) {
        var p = partInfo(state.focus);
        if (p) {
          pivot = [p.cx, p.cy, p.cz];
          // 聚焦时把这个部件放大到画面尺寸的 ~1/1.8
          var biggest = Math.max(p.w, p.h, p.d);
          s = Math.min(state.w, state.h) / (biggest * 1.8) * state.zoom;
          cy = state.h / 2;
        }
      }

      return {
        yaw: state.yaw,
        pitch: state.pitch,
        scale: Math.max(2, s),
        cx: state.w / 2,
        cy: cy,
        pivot: pivot
      };
    }

    /** 当前可见的面（聚焦模式只返回该部件） */
    function visibleFaces() {
      if (!state.focus) return faces;
      var out = [];
      for (var i = 0; i < faces.length; i++) {
        if (faces[i].part === state.focus) out.push(faces[i]);
      }
      return out;
    }

    /* ---------------- 画布尺寸 ---------------- */

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = global.devicePixelRatio || 1;
      state.w = Math.max(200, rect.width);
      state.h = Math.max(200, rect.height);
      canvas.width = Math.round(state.w * dpr);
      canvas.height = Math.round(state.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }

    /* ---------------- 渲染 ---------------- */

    function drawChecker() {
      var s = 12;
      for (var y = 0; y < state.h; y += s) {
        for (var x = 0; x < state.w; x += s) {
          var on = ((x / s) + (y / s)) % 2 === 0;
          ctx.fillStyle = on ? '#211a15' : '#1b1510';
          ctx.fillRect(x, y, s, s);
        }
      }
    }

    function render() {
      var view = viewState();
      drawChecker();

      var show = visibleFaces();
      var list = [];
      for (var i = 0; i < show.length; i++) {
        list.push({ face: show[i], q: quadOf(show[i], view) });
      }
      list.sort(function (a, b) { return a.q.depth - b.q.depth; }); // 远的先画

      for (var j = 0; j < list.length; j++) {
        drawFace(list[j].face, list[j].q);
      }

      drawFlat();
    }

    function drawFace(face, q) {
      var p = q.pts;
      var uv = face.uv;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      ctx.lineTo(p[1].x, p[1].y);
      ctx.lineTo(p[2].x, p[2].y);
      ctx.lineTo(p[3].x, p[3].y);
      ctx.closePath();
      ctx.clip();

      ctx.imageSmoothingEnabled = false;

      // 纹理像素 → 四边形（1 个纹理像素 = 1 个变换单位）
      var a = (p[1].x - p[0].x) / uv[2], b = (p[1].y - p[0].y) / uv[2];
      var c = (p[3].x - p[0].x) / uv[3], d = (p[3].y - p[0].y) / uv[3];
      ctx.transform(a, b, c, d, p[0].x, p[0].y);
      ctx.drawImage(tex, uv[0], uv[1], uv[2], uv[3], 0, 0, uv[2], uv[3]);
      ctx.restore();
    }

    function drawFlat() {
      var size = flat.width;
      fctx.imageSmoothingEnabled = false;
      fctx.clearRect(0, 0, size, size);
      fctx.fillStyle = '#1b1510';
      fctx.fillRect(0, 0, size, size);
      fctx.drawImage(tex, 0, 0, TEX, TEX, 0, 0, size, size);

      // 网格
      fctx.strokeStyle = 'rgba(255,255,255,0.06)';
      fctx.lineWidth = 1;
      var step = size / TEX;
      if (step >= 3) {
        for (var i = 0; i <= TEX; i += 8) {
          fctx.beginPath();
          fctx.moveTo(i * step, 0);
          fctx.lineTo(i * step, size);
          fctx.stroke();
          fctx.beginPath();
          fctx.moveTo(0, i * step);
          fctx.lineTo(size, i * step);
          fctx.stroke();
        }
      }

      // 高亮鼠标所在的面
      if (state.hover) {
        var uv = state.hover.face.uv;
        fctx.strokeStyle = '#e07b39';
        fctx.lineWidth = 2;
        fctx.strokeRect(uv[0] * step, uv[1] * step, uv[2] * step, uv[3] * step);
      }
    }

    /* ---------------- 纹理操作 ---------------- */

    function pushUndo() {
      try {
        state.undo.push(tctx.getImageData(0, 0, TEX, TEX));
        if (state.undo.length > 60) state.undo.shift();
        state.redo.length = 0;
      } catch (e) { /* ignore */ }
    }

    function doUndo() {
      if (!state.undo.length) return;
      state.redo.push(tctx.getImageData(0, 0, TEX, TEX));
      tctx.putImageData(state.undo.pop(), 0, 0);
      render();
    }

    function doRedo() {
      if (!state.redo.length) return;
      state.undo.push(tctx.getImageData(0, 0, TEX, TEX));
      tctx.putImageData(state.redo.pop(), 0, 0);
      render();
    }

    /**
     * 画一个笔刷方块。
     * clip = 当前面自己的 UV 矩形 [u,v,w,h] —— 笔刷超出这个矩形就被裁掉，
     * 这样画到面的边缘时绝不会"漏"进隔壁区域的纹理里。
     */
    function paintTexel(tx, ty, tool, color, size, clip) {
      var r = brushRect(tx, ty, size, clip);
      if (r.empty) return;
      if (tool === 'eraser') {
        tctx.clearRect(r.x, r.y, r.w, r.h);
      } else {
        tctx.fillStyle = color;
        tctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }

    /**
     * 两笔之间补点，快速拖动也不断线。
     * ★ 只允许在「同一个面」内插值：跨面时如果照直连线，
     *   这条线会从当前 UV 岛穿过别的岛（就是你发现的"沾染"bug）。
     */
    function paintLine(from, to, tool, color, size) {
      if (!from || !to || from.face !== to.face) return;
      var clip = to.face.uv;
      var steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.tx - from.tx), Math.abs(to.ty - from.ty))));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        paintTexel(
          Math.round(from.tx + (to.tx - from.tx) * t),
          Math.round(from.ty + (to.ty - from.ty) * t),
          tool, color, size, clip
        );
      }
    }

    function pickColorAt(tx, ty) {
      var d = tctx.getImageData(tx, ty, 1, 1).data;
      if (d[3] === 0) return null;
      return '#' + [d[0], d[1], d[2]].map(function (v) {
        return ('0' + v.toString(16)).slice(-2);
      }).join('');
    }

    function floodFill(tx, ty, color, clip) {
      var img = tctx.getImageData(0, 0, TEX, TEX);
      var data = img.data;
      var start = (ty * TEX + tx) * 4;
      var target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
      var rgb = hexToRgb(color);
      if (target[0] === rgb[0] && target[1] === rgb[1] && target[2] === rgb[2] && target[3] === 255) return;

      // 限定在这个面自己的 UV 矩形内，绝不跑到隔壁岛
      var x0 = 0, y0 = 0, x1 = TEX, y1 = TEX;
      if (clip) {
        x0 = clip[0]; y0 = clip[1];
        x1 = clip[0] + clip[2]; y1 = clip[1] + clip[3];
      }

      var stack = [[tx, ty]];
      var seen = new Uint8Array(TEX * TEX);
      while (stack.length) {
        var pt = stack.pop();
        var x = pt[0], y = pt[1];
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        var idx = y * TEX + x;
        if (seen[idx]) continue;
        seen[idx] = 1;
        var o = idx * 4;
        if (data[o] !== target[0] || data[o + 1] !== target[1] ||
            data[o + 2] !== target[2] || data[o + 3] !== target[3]) continue;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      tctx.putImageData(img, 0, 0);
    }

    function hexToRgb(hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return [255, 255, 255];
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    /* ---------------- 交互 ---------------- */

    function toLocal(e) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (state.w / rect.width),
        y: (e.clientY - rect.top) * (state.h / rect.height)
      };
    }

    function applyTool(hit) {
      if (!hit) return;
      if (state.tool === 'picker') {
        var c = pickColorAt(hit.tx, hit.ty);
        if (c) {
          state.color = c;
          if (dom.color) dom.color.value = c;
        }
        return;
      }
      if (state.tool === 'fill') {
        // 油漆桶限制在这个面自己的 UV 矩形里，不跨岛
        floodFill(hit.tx, hit.ty, state.color, hit.face.uv);
        return;
      }
      paintTexel(hit.tx, hit.ty, state.tool, state.color, state.size, hit.face.uv);
    }

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      var pt = toLocal(e);
      var hit = pickAt(visibleFaces(), viewState(), pt.x, pt.y);

      if (e.button === 0 && hit) {
        pushUndo();
        state.dragging = 'paint';
        applyTool(hit);
        state.last = hit;
        render();
        saveSoon();
      } else {
        state.dragging = 'rotate';
        state.lastX = pt.x;
        state.lastY = pt.y;
      }
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      var pt = toLocal(e);
      var hit = pickAt(visibleFaces(), viewState(), pt.x, pt.y);

      if (state.dragging === 'paint' && hit) {
        // 同一个面才连线；跨面只画当前这一笔（否则会穿过别的 UV 岛）
        if (state.last && state.last.face === hit.face) {
          paintLine(state.last, hit, state.tool, state.color, state.size);
        } else {
          applyTool(hit);
        }
        state.last = hit;
        render();
        saveSoon();
      } else if (state.dragging === 'rotate') {
        state.yaw += (pt.x - state.lastX) * 0.012;
        state.pitch += (pt.y - state.lastY) * 0.012;
        state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch));
        state.lastX = pt.x;
        state.lastY = pt.y;
        render();
      } else {
        var changed = (state.hover && state.hover.face) !== (hit && hit.face);
        state.hover = hit;
        if (changed) render();
        canvas.style.cursor = hit ? (state.tool === 'picker' ? 'crosshair' : 'crosshair') : 'grab';
      }
    });

    function endDrag() {
      state.dragging = null;
      state.last = null;
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', function () {
      if (!state.dragging) { state.hover = null; render(); }
    });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = e.deltaY > 0 ? 0.92 : 1.08;
      state.zoom = Math.max(0.35, Math.min(3.5, state.zoom * k));
      render();
    }, { passive: false });

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button === 2) { state.dragging = 'rotate'; }
    });

    /* ---------------- 部件聚焦：放大单个部件，随便转 ---------------- */

    function focusPart(name) {
      if (!name || !partInfo(name)) return;
      state.focus = name;
      state.yaw = -0.5;
      state.pitch = 0.2;
      state.zoom = 1;
      state.hover = null;
      render();
      if (dom.onFocus) dom.onFocus(name);
    }

    function exitFocus() {
      if (!state.focus) return;
      state.focus = null;
      state.hover = null;
      state.zoom = 1;
      render();
      if (dom.onFocus) dom.onFocus(null);
    }

    global.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

      if (e.key === 'e' || e.key === 'E') {
        if (state.focus) exitFocus();
        else if (state.hover) focusPart(state.hover.face.part);
      } else if (e.key === 'Escape' && state.focus) {
        exitFocus();
      }
    });

    /* ---------------- 文件 ---------------- */

    function exportPNG(name) {
      if (!tex.toBlob) return;
      tex.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name || 'my-skin.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      }, 'image/png');
    }

    function importPNG(file) {
      if (!file) return;
      var img = new Image();
      img.onload = function () {
        pushUndo();
        tctx.clearRect(0, 0, TEX, TEX);
        tctx.imageSmoothingEnabled = false;
        if (img.width === 64 && img.height === 32) {
          tctx.drawImage(img, 0, 0);                 // 老版 64×32 皮肤
        } else {
          tctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, TEX, TEX);
        }
        render();
        saveSoon();
      };
      img.src = URL.createObjectURL(file);
    }

    /* ---------------- 默认小人 ---------------- */

    function fillPartUV(name, color) {
      for (var i = 0; i < faces.length; i++) {
        if (faces[i].part !== name) continue;
        var uv = faces[i].uv;
        tctx.fillStyle = color;
        tctx.fillRect(uv[0], uv[1], uv[2], uv[3]);
      }
    }

    function faceUV(part, key) {
      for (var i = 0; i < faces.length; i++) {
        if (faces[i].part === part && faces[i].key === key) return faces[i].uv;
      }
      return null;
    }

    function defaultSkin() {
      tctx.clearRect(0, 0, TEX, TEX);
      fillPartUV('head', '#f6c9a8');
      fillPartUV('armR', '#f6c9a8');
      fillPartUV('armL', '#f6c9a8');
      fillPartUV('body', '#3f7fbf');
      fillPartUV('legR', '#3a3a55');
      fillPartUV('legL', '#3a3a55');

      // 头发（头顶 + 额头一条）
      var top = faceUV('head', 'top');
      tctx.fillStyle = '#4a3526';
      tctx.fillRect(top[0], top[1], top[2], top[3]);
      var front = faceUV('head', 'front');
      tctx.fillRect(front[0], front[1], front[2], 2);

      // 眼睛
      tctx.fillStyle = '#2b211a';
      tctx.fillRect(front[0] + 1, front[1] + 3, 2, 2);
      tctx.fillRect(front[0] + 5, front[1] + 3, 2, 2);

      // 衣服领口
      var bFront = faceUV('body', 'front');
      tctx.fillStyle = '#2f5f92';
      tctx.fillRect(bFront[0], bFront[1], bFront[2], 2);

      // 鞋
      var legF = faceUV('legR', 'front');
      tctx.fillStyle = '#22222e';
      tctx.fillRect(legF[0], legF[1] + 10, legF[2], 2);
      var legF2 = faceUV('legL', 'front');
      tctx.fillRect(legF2[0], legF2[1] + 10, legF2[2], 2);
    }

    /* ---------------- 自动保存 ---------------- */

    var saveTimer = null;
    function saveSoon() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          global.localStorage.setItem('mcskin.auto', tex.toDataURL('image/png'));
        } catch (e) { /* ignore */ }
      }, 600);
    }

    function loadAuto() {
      try {
        var data = global.localStorage.getItem('mcskin.auto');
        if (!data) return false;
        var img = new Image();
        img.onload = function () {
          tctx.clearRect(0, 0, TEX, TEX);
          tctx.drawImage(img, 0, 0);
          render();
        };
        img.src = data;
        return true;
      } catch (e) {
        return false;
      }
    }

    /* ---------------- 对外接口 ---------------- */

    var api = {
      render: render,
      resize: resize,
      undo: doUndo,
      redo: doRedo,
      exportPNG: exportPNG,
      importPNG: importPNG,
      reset: function () { pushUndo(); defaultSkin(); render(); saveSoon(); },
      setTool: function (t) { state.tool = t; },
      setSize: function (s) { state.size = s; },
      setColor: function (c) { state.color = c; },
      getColor: function () { return state.color; },
      setView: function (yaw, pitch) { state.yaw = yaw; state.pitch = pitch; render(); },
      setAutoRotate: function (on) { state.autoRotate = !!on; },
      focusPart: focusPart,
      exitFocus: exitFocus,
      getFocus: function () { return state.focus; },
      getHoverPart: function () { return state.hover ? state.hover.face.part : null; },
      clear: function () { pushUndo(); tctx.clearRect(0, 0, TEX, TEX); render(); saveSoon(); },
      state: state
    };

    // 自动旋转
    (function loop() {
      if (state.autoRotate && !state.dragging) {
        state.yaw += 0.008;
        render();
      }
      requestAnimationFrame(loop);
    })();

    // 初始化：有自动保存就恢复，否则画默认小人
    if (!loadAuto()) defaultSkin();
    resize();
    global.addEventListener('resize', resize);

    return api;
  }

  /* ============================ 导出 ============================ */

  var Skin3D = {
    TEX: TEX,
    PARTS: PARTS,
    COLORS: COLORS,
    uvRects: uvRects,
    brushRect: brushRect,
    buildFaces: buildFaces,
    rotPoint: rotPoint,
    project: project,
    quadOf: quadOf,
    pointInQuad: pointInQuad,
    pickAt: pickAt,
    createEditor: createEditor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Skin3D;
  global.Skin3D = Skin3D;
})(typeof window !== 'undefined' ? window : globalThis);
