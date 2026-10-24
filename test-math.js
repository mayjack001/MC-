/* 皮肤编辑器 · 核心数学自测（node test-math.js） */
const S = require('./skin3d.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

console.log('=== 1. UV 布局 ===');
const head = S.uvRects(0, 0, 8, 8, 8);
check('头顶 (8,0,8,8)', JSON.stringify(head.top) === '[8,0,8,8]', head.top);
check('头底 (16,0,8,8)', JSON.stringify(head.bottom) === '[16,0,8,8]', head.bottom);
check('头右 (0,8,8,8)', JSON.stringify(head.right) === '[0,8,8,8]', head.right);
check('头前 (8,8,8,8)', JSON.stringify(head.front) === '[8,8,8,8]', head.front);
check('头左 (16,8,8,8)', JSON.stringify(head.left) === '[16,8,8,8]', head.left);
check('头后 (24,8,8,8)', JSON.stringify(head.back) === '[24,8,8,8]', head.back);

const body = S.uvRects(16, 16, 8, 12, 4);
check('身体前 (20,20,8,12)', JSON.stringify(body.front) === '[20,20,8,12]', body.front);
check('身体顶 (20,16,8,4)', JSON.stringify(body.top) === '[20,16,8,4]', body.top);

const armR = S.uvRects(40, 16, 4, 12, 4);
check('右臂前 (44,20,4,12)', JSON.stringify(armR.front) === '[44,20,4,12]', armR.front);
check('右臂顶 (44,16,4,4)', JSON.stringify(armR.top) === '[44,16,4,4]', armR.top);

const legR = S.uvRects(0, 16, 4, 12, 4);
check('右腿前 (4,20,4,12)', JSON.stringify(legR.front) === '[4,20,4,12]', legR.front);
const legL = S.uvRects(16, 48, 4, 12, 4);
check('左腿前 (20,52,4,12)', JSON.stringify(legL.front) === '[20,52,4,12]', legL.front);
const armL = S.uvRects(32, 48, 4, 12, 4);
check('左臂前 (36,52,4,12)', JSON.stringify(armL.front) === '[36,52,4,12]', armL.front);

console.log('\n=== 2. 模型面 ===');
const faces = S.buildFaces();
check('一共 36 个面（6 块 × 6 面）', faces.length === 36, faces.length);
const keys = {};
faces.forEach(f => { keys[f.key] = (keys[f.key] || 0) + 1; });
check('每种朝向各 6 个', ['front','back','right','left','top','bottom'].every(k => keys[k] === 6), keys);
check('所有 UV 都在 0..64 内', faces.every(f => f.uv[0] >= 0 && f.uv[1] >= 0 &&
  f.uv[0] + f.uv[2] <= 64 && f.uv[1] + f.uv[3] <= 64));

console.log('\n=== 3. 投影 ===');
const view = { yaw: 0, pitch: 0, scale: 1, cx: 0, cy: 0 };
let p = S.project([0, 16, 0], view);
check('原点(0,16,0) → (0,0)', Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9, p);
p = S.project([0, 32, 0], view);
check('头顶(0,32,0) → y=-16', Math.abs(p.y + 16) < 1e-9, p);
p = S.project([8, 16, 0], view);
check('右侧(8,16,0) → x=8', Math.abs(p.x - 8) < 1e-9, p);
p = S.project([0, 16, 5], view);
check('前方 z=5 深度更大（更近）', p.z > 0, p);

console.log('\n=== 4. 点击 → 纹素 反解 ===');
// 正面视角下，每块的前脸都应该能被点中，且纹素落在它自己的 UV 矩形中心
const parts = ['head', 'body', 'armR', 'armL', 'legR', 'legL'];
let allOk = true, detail = {};
for (const name of parts) {
  const f = faces.find(x => x.part === name && x.key === 'front');
  const q = S.quadOf(f, view);
  const cx = (q.pts[0].x + q.pts[1].x + q.pts[2].x + q.pts[3].x) / 4;
  const cy = (q.pts[0].y + q.pts[1].y + q.pts[2].y + q.pts[3].y) / 4;
  const hit = S.pickAt(faces, view, cx, cy);
  const wantX = f.uv[0] + f.uv[2] / 2;
  const wantY = f.uv[1] + f.uv[3] / 2;
  const ok = hit && hit.face === f &&
             Math.abs(hit.tx + 0.5 - wantX) <= 1 &&
             Math.abs(hit.ty + 0.5 - wantY) <= 1;
  if (!ok) { allOk = false; detail[name] = { hit, want: [wantX, wantY] }; }
}
check('6 块的前脸都能被精准点中', allOk, detail);

// 点空白处应返回 null
const outside = S.pickAt(faces, view, 500, 500);
check('点空白处 → null', outside === null, outside);

// 背面视角：背面可点中
const backView = { yaw: Math.PI, pitch: 0, scale: 1, cx: 0, cy: 0 };
const backFace = faces.find(x => x.part === 'body' && x.key === 'back');
const bq = S.quadOf(backFace, backView);
const bcx = (bq.pts[0].x + bq.pts[1].x + bq.pts[2].x + bq.pts[3].x) / 4;
const bcy = (bq.pts[0].y + bq.pts[1].y + bq.pts[2].y + bq.pts[3].y) / 4;
const bhit = S.pickAt(faces, backView, bcx, bcy);
check('背面视角能点中身体背面', bhit && bhit.face === backFace, bhit && bhit.face.key);

// 顶面视角
const topView = { yaw: 0, pitch: 1.2, scale: 1, cx: 0, cy: 0 };
const topFace = faces.find(x => x.part === 'head' && x.key === 'top');
const tq = S.quadOf(topFace, topView);
const tcx = (tq.pts[0].x + tq.pts[1].x + tq.pts[2].x + tq.pts[3].x) / 4;
const tcy = (tq.pts[0].y + tq.pts[1].y + tq.pts[2].y + tq.pts[3].y) / 4;
const thit = S.pickAt(faces, topView, tcx, tcy);
check('俯视能点中头顶', thit && thit.face === topFace, thit && thit.face.key);

console.log('\n=== 5. 四边形判定 ===');
const sq = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
check('点在方形内', S.pointInQuad(5, 5, sq) === true);
check('点在方形外', S.pointInQuad(15, 5, sq) === false);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
