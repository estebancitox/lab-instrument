// Altimeter: one needle at 1,000 ft per revolution over a 0–9 dial, plus a
// five-wheel rolling drum showing the full altitude. Dial and numerals are
// static; per frame the drum blits slices of a pre-rendered digit strip and
// the needle is one filled path. No per-frame fillText.

import { TAU, RAD, P, font, layer, drawFace, drawNeedle, makeDigitStrip, wheelPos } from './gauge.js';

const WHEELS = [4, 3, 2, 1, 0]; // powers of ten, left to right
const DRUM_BG = '#1b2026';      // recessed slot, one step below the face

export function createAltimeter(canvas) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    scale: 1, css: 0,
    geom: null, statics: null, strip: null,
  };
}

export function rebuild(a) {
  const css = a.canvas.clientWidth;
  if (!css || !a.canvas.width) return;
  a.css = css;
  a.scale = a.canvas.width / css;
  const cx = css / 2;
  const faceR = css / 2 - 1;
  a.geom = { cx, cy: cx, faceR };
  buildStrip(a);
  buildStatics(a);
}

function buildStrip(a) {
  const { faceR } = a.geom;
  const fontPx = Math.max(10, Math.round(faceR * 0.13));
  a.strip = makeDigitStrip(fontPx, a.scale, P.ink, DRUM_BG);
  const { cellW, cellH } = a.strip;
  const w = cellW * WHEELS.length;
  a.geom.drum = {
    x: a.geom.cx - w / 2,
    y: a.geom.cy + faceR * 0.42 - cellH / 2,
    w,
    h: cellH,
    cellW,
    cellH,
  };
}

function buildStatics(a) {
  const { cx, cy, faceR } = a.geom;
  const { canvas, ctx } = layer(a.css, a.css, a.scale);
  a.statics = canvas;

  drawFace(ctx, cx, cy, faceR);

  // 50 ticks: majors every 100 ft (each digit), minors every 20 ft
  for (let i = 0; i < 50; i++) {
    const major = i % 5 === 0;
    const ang = (i * 7.2 - 90) * RAD;
    const r1 = faceR * (major ? 0.84 : 0.89);
    const r2 = faceR * 0.95;
    ctx.strokeStyle = major ? P.ink : P.inkSoft;
    ctx.lineWidth = major ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang));
    ctx.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang));
    ctx.stroke();
  }

  // dial numerals 0–9, one per 100 ft
  ctx.fillStyle = P.ink;
  ctx.font = font(Math.round(faceR * 0.17), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) {
    const ang = (d * 36 - 90) * RAD;
    ctx.fillText(String(d), cx + faceR * 0.68 * Math.cos(ang), cy + faceR * 0.68 * Math.sin(ang));
  }

  // scale caption
  ctx.fillStyle = P.muted;
  ctx.font = font(Math.max(8, Math.round(faceR * 0.085)));
  ctx.fillText('x100 FT', cx, cy - faceR * 0.36);
}

export function draw(a, sim) {
  if (!a.geom) return;
  const { ctx, scale, geom, strip } = a;
  const { cx, cy, faceR, drum } = geom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
  ctx.drawImage(a.statics, 0, 0);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // drum: five wheels, odometer carry
  const alt = Math.min(99999, Math.max(0, sim.alt));
  const cellHDev = drum.cellH * scale;
  const cellWDev = drum.cellW * scale;
  for (let i = 0; i < WHEELS.length; i++) {
    const pos = wheelPos(alt, WHEELS[i]);
    ctx.drawImage(strip.canvas,
      0, pos * cellHDev, cellWDev, cellHDev,
      drum.x + i * drum.cellW, drum.y, drum.cellW, drum.cellH);
  }
  ctx.strokeStyle = P.inkSoft;
  ctx.lineWidth = 1;
  for (let i = 1; i < WHEELS.length; i++) {
    const x = drum.x + i * drum.cellW;
    ctx.beginPath();
    ctx.moveTo(x, drum.y);
    ctx.lineTo(x, drum.y + drum.h);
    ctx.stroke();
  }
  ctx.strokeStyle = P.ring;
  ctx.strokeRect(drum.x - 0.5, drum.y - 0.5, drum.w + 1, drum.h + 1);

  // 1,000 ft per revolution
  drawNeedle(ctx, cx, cy, ((alt % 1000) / 1000) * TAU, faceR);
}
