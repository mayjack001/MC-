const S = require('./skin3d.js');
let pass = 0, fail = 0;
const ck = (n, c, e) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' → ' + JSON.stringify(e) : '')); } };

console.log('=== 6. 贴图变换矩阵（对应 drawFace 里的 ctx.transform）===');
const views = [
  { yaw: 0, pitch: 0, scale: 10, cx: 300, cy: 300 },
  { yaw: -0.6, pitch: 0.28, scale: 12, cx: 310, cy: 360 },
  { yaw: 2.2, pitch: -0.3, scale: 8, cx: 200, cy: 250 },
];
const faces = S.buildFaces();
let allOk = true, bad = {};
for (const v of views) {
  for (const f of faces) {
    const q = S.quadOf(f, v);
    const p = q.pts;
    const uv = f.uv;
    // drawFace 里的矩阵
    const a = (p[1].x - p[0].x) / uv[2], b = (p[1].y - p[0].y) / uv[2];
    const c = (p[3].x - p[0].x) / uv[3], d = (p[3].y - p[0].y) / uv[3];
    const e = p[0].x, f2 = p[0].y;
    // 纹理四角 → 期望的四边形四角
    const corners = [[0,0],[uv[2],0],[uv[2],uv[3]],[0,uv[3]]];
    const want = [p[0], p[1], p[2], p[3]];
    for (let i = 0; i < 4; i++) {
      const [tx, ty] = corners[i];
      const gx = a * tx + c * ty + e;
      const gy = b * tx + d * ty + f2;
      if (Math.abs(gx - want[i].x) > 0.5 || Math.abs(gy - want[i].y) > 0.5) {
        allOk = false;
        bad[f.part + ':' + f.key] = { got: [gx, gy], want: [want[i].x, want[i].y], i };
      }
    }
  }
}
ck('全部 36 面 × 3 视角，纹理四角都精确贴到四边形四角', allOk, bad);

console.log('\n=== 7. 深度排序（远的先画）===');
const v0 = { yaw: 0, pitch: 0, scale: 10, cx: 0, cy: 0 };
const front = faces.find(f => f.part === 'body' && f.key === 'front');
const back = faces.find(f => f.part === 'body' && f.key === 'back');
ck('正面视角：身体正面比背面更靠近观察者',
  S.quadOf(front, v0).depth > S.quadOf(back, v0).depth,
  { front: S.quadOf(front, v0).depth, back: S.quadOf(back, v0).depth });

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
