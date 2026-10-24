const S = require('./skin3d.js');
let ok = 0, bad = 0;
const ck = (n, c) => { if (c) { ok++; console.log("  OK  " + n); } else { bad++; console.log("  FAIL " + n); } };

const v0 = { yaw: 0, pitch: 0, scale: 10, cx: 300, cy: 400 };
const p0 = S.project([0, 16, 0], v0);
ck("默认 pivot：模型中心投影到 (cx,cy)", Math.abs(p0.x - 300) < 1e-9 && Math.abs(p0.y - 400) < 1e-9);

const v1 = { yaw: 0.3, pitch: 0.2, scale: 30, cx: 300, cy: 400, pivot: [0, 28, 0] };
const head = S.PARTS.find(p => p.name === "head");
const p1 = S.project([head.cx, head.cy, head.cz], v1);
ck("聚焦头部：头部中心始终在画面中心", Math.abs(p1.x - 300) < 1e-9 && Math.abs(p1.y - 400) < 1e-9);

const faces = S.buildFaces().filter(f => f.part === "head");
// 注意：yaw=+90° 时朝向观察者的是 -x 面（玩家右侧），yaw=-90° 才是 +x 面（玩家左侧）
const angles = {
  front: [0, 0], back: [Math.PI, 0],
  left: [-Math.PI / 2, 0], right: [Math.PI / 2, 0],
  top: [0, 1.4], bottom: [0, -1.4],
};
let hitAll = true;
for (const key of ["front", "back", "left", "right", "top", "bottom"]) {
  const f = faces.find(x => x.key === key);
  const [yaw, pitch] = angles[key];
  const v = { yaw, pitch, scale: 30, cx: 300, cy: 400, pivot: [0, 28, 0] };
  const q = S.quadOf(f, v);
  const cx = (q.pts[0].x + q.pts[1].x + q.pts[2].x + q.pts[3].x) / 4;
  const cy = (q.pts[0].y + q.pts[1].y + q.pts[2].y + q.pts[3].y) / 4;
  const hit = S.pickAt(faces, v, cx, cy);
  if (!hit || hit.face !== f) { hitAll = false; console.log("    没点中:", key, "→ 实际点中", hit && hit.face.key); }
}
ck("聚焦后头部 6 个面都能点中（正/背/左/右/顶/底）", hitAll);

console.log("\n结果: " + ok + " 通过, " + bad + " 失败");
process.exit(bad ? 1 : 0);
