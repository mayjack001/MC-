const S = require('./skin3d.js');
let ok = 0, bad = 0;
const ck = (n, c, e) => { if (c) { ok++; console.log("  OK  " + n); } else { bad++; console.log("  FAIL " + n + " " + JSON.stringify(e)); } };

const headFront = [8, 8, 8, 8];   // 头部正面 x:8~16, y:8~16

let r = S.brushRect(12, 12, 1, headFront);
ck("1px 笔刷在内部：1x1", r.x === 12 && r.y === 12 && r.w === 1 && r.h === 1, r);

r = S.brushRect(15, 12, 8, headFront);
ck("8px 贴右边缘：裁到 x=12..16", r.x === 12 && r.w === 4 && r.x + r.w === 16, r);

r = S.brushRect(12, 15, 8, headFront);
ck("8px 贴下边缘：裁到 y=12..16", r.y === 12 && r.h === 4, r);

r = S.brushRect(20, 12, 1, headFront);
ck("点在区域外：empty", r.empty === true, r);

r = S.brushRect(15, 12, 8, null);
ck("不传 clip：完整 8x8", r.w === 8 && r.h === 8 && r.x === 12, r);

r = S.brushRect(15, 15, 4, headFront);
ck("4px 贴角：裁成 2x2 (14,14)", r.x === 14 && r.y === 14 && r.w === 2 && r.h === 2, r);

// 关键断言：裁剪后绝不会碰到 clip 之外的任何像素
let leak = 0;
for (let s of [1, 2, 4, 8]) {
  for (let tx = 0; tx < 64; tx += 3) {
    for (let ty = 0; ty < 64; ty += 3) {
      const q = S.brushRect(tx, ty, s, headFront);
      if (q.empty) continue;
      if (q.x < 8 || q.y < 8 || q.x + q.w > 16 || q.y + q.h > 16) leak++;
    }
  }
}
ck("穷举检验：任何位置/大小都不会画出 UV 区域（0 次越界）", leak === 0, { leak });

console.log("\n结果: " + ok + " 通过, " + bad + " 失败");
process.exit(bad ? 1 : 0);
