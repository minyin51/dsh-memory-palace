import { createCanvas, GlobalFonts } from 'file:///C:/Users/24482/.dsh/profiles/desktop/node_modules/@napi-rs/canvas/index.js';

const W = 1280, H = 720;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// 背景渐变
const g = ctx.createLinearGradient(0, 0, W, H);
g.addColorStop(0, '#0b1020');
g.addColorStop(0.55, '#101a33');
g.addColorStop(1, '#1b1030');
ctx.fillStyle = g;
ctx.fillRect(0, 0, W, H);

// 网格光斑
ctx.save();
for (let i = 0; i < 6; i++) {
  const r = 620 - i * 90;
  const rg = ctx.createRadialGradient(W * 0.78, H * 0.34, 0, W * 0.78, H * 0.34, r);
  rg.addColorStop(0, `rgba(96,165,250,${0.05 + i * 0.012})`);
  rg.addColorStop(1, 'rgba(96,165,250,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
}
ctx.restore();

// 字体
const fontOk = GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'MSYH');
if (!fontOk) {
  GlobalFonts.registerFromPath('C:/Windows/Fonts/simhei.ttf', 'MSYH');
}

// 小角标
ctx.font = '24px MSYH';
ctx.fillStyle = '#7dd3fc';
ctx.fillText('DSH PLUGIN · MIT 开源', 96, 140);

// 主标题
ctx.font = 'bold 96px MSYH';
ctx.fillStyle = '#ffffff';
ctx.fillText('大肥鱼的记忆宫殿', 92, 292);

// 副标题
ctx.font = '40px MSYH';
ctx.fillStyle = '#c7d2fe';
ctx.fillText('我给大肥鱼创造了记忆宫殿', 96, 372);

// 分隔线
ctx.fillStyle = 'rgba(125,211,252,0.55)';
ctx.fillRect(96, 424, 132, 4);

// 三条卖点
ctx.font = '28px MSYH';
ctx.fillStyle = '#94a3b8';
ctx.fillText('每轮只召回最相关的 3–5 条', 96, 492);
ctx.fillText('注入不到 500 token', 96, 540);
ctx.fillText('纯本地 JSON · 不联网', 96, 588);

// 右下装饰：记忆条目卡片
const cardX = 812, cardY = 430, cardW = 376, cardH = 196;
ctx.save();
ctx.globalAlpha = 0.95;
ctx.fillStyle = 'rgba(15,23,42,0.9)';
ctx.strokeStyle = 'rgba(125,211,252,0.35)';
ctx.lineWidth = 2;
ctx.beginPath();
ctx.roundRect(cardX, cardY, cardW, cardH, 18);
ctx.fill();
ctx.stroke();

ctx.font = '22px MSYH';
ctx.fillStyle = '#38bdf8';
ctx.fillText('<memory>', cardX + 26, cardY + 46);
ctx.font = '22px MSYH';
ctx.fillStyle = '#e2e8f0';
ctx.fillText('[身份] 名字小明', cardX + 26, cardY + 92);
ctx.fillText('[关系] 老婆小伊', cardX + 26, cardY + 132);
ctx.fillText('[偏好] 喜欢猫', cardX + 26, cardY + 172);
ctx.restore();

const out = 'C:/Users/24482/Documents/deepseek-harness/default-workspace/dsh-memory-palace/cover.png';
const fs = await import('node:fs');
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('written', out, canvas.width + 'x' + canvas.height);
