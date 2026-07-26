// Airspeed indicator: linear dial 40-200 kt over a 320-degree sweep.
// Arc treatment: solid muted arc for the normal range, diagonal-hatched
// band (the ball's hatch language) for caution, and a single orange radial
// at the never-exceed speed - the one orange element on this gauge.
// Everything but the needle is static.

import { RAD, P, font, layer, drawFace, drawNeedle } from './gauge.js';

const V_MIN = 40;
const V_MAX = 200;
const SWEEP = 320;                  // deg; the remaining 40 deg gap sits at top
const NORMAL = [95, 155];           // kt, matches the sim's soft envelope
const CAUTION = [155, 180];
const VNE = 180;

const DEG_PER_KT = SWEEP / (V_MAX - V_MIN);
// canvas polar angle (0 = +x); straight up is -90 deg
const angleOf = v => (-90 + (Math.min(V_MAX, Math.max(V_MIN, v)) - V_MIN) * DEG_PER_KT) * RAD;

export function createAirspeed(canvas) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    scale: 1, css: 0,
    geom: null, statics: null,
  };
}

export function rebuild(a) {
  const css = a.canvas.clientWidth;
  if (!css || !a.canvas.width) return;
  a.css = css;
  a.scale = a.canvas.width / css;
  const cx = css / 2;
  a.geom = { cx, cy: cx, faceR: css / 2 - 1 };
  buildStatics(a);
}

function buildStatics(a) {
  const { cx, cy, faceR } = a.geom;
  const { canvas, ctx } = layer(a.css, a.css, a.scale);
  a.statics = canvas;

  drawFace(ctx, cx, cy, faceR);

  // normal range: solid muted arc in the rim band
  const rBand = faceR * 0.925;
  const bandW = Math.max(3, faceR * 0.05);
  ctx.strokeStyle = P.muted;
  ctx.lineWidth = bandW;
  ctx.beginPath();
  ctx.arc(cx, cy, rBand, angleOf(NORMAL[0]), angleOf(NORMAL[1]));
  ctx.stroke();

  // caution range: diagonal hatch across the same band. Strokes tilt 2 kt
  // outward; the terminal stroke's outer tip lands exactly on the VNE mark
  // so hatching never crosses the never-exceed boundary.
  ctx.strokeStyle = P.inkSoft;
  ctx.lineWidth = Math.max(1, 2 / a.scale);
  const r1 = rBand - bandW / 2;
  const r2 = rBand + bandW / 2;
  const tilt = 4 * RAD;
  const tiltKt = tilt / (DEG_PER_KT * RAD);
  const hatch = v => {
    const a1 = angleOf(v);
    ctx.moveTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
    ctx.lineTo(cx + r2 * Math.cos(a1 + tilt), cy + r2 * Math.sin(a1 + tilt));
  };
  ctx.beginPath();
  for (let v = CAUTION[0]; v <= CAUTION[1] - tiltKt; v += 1.4) hatch(v);
  hatch(CAUTION[1] - tiltKt);
  ctx.stroke();

  // never-exceed: one orange radial crossing the band
  ctx.strokeStyle = P.signal;
  ctx.lineWidth = 3;
  const av = angleOf(VNE);
  ctx.beginPath();
  ctx.moveTo(cx + faceR * 0.86 * Math.cos(av), cy + faceR * 0.86 * Math.sin(av));
  ctx.lineTo(cx + faceR * 0.97 * Math.cos(av), cy + faceR * 0.97 * Math.sin(av));
  ctx.stroke();

  // ticks: majors every 20 kt, minors every 10, inside the band
  for (let v = V_MIN; v <= V_MAX; v += 10) {
    const major = v % 20 === 0;
    const ang = angleOf(v);
    const rA = faceR * (major ? 0.8 : 0.85);
    const rB = faceR * 0.89;
    ctx.strokeStyle = major ? P.ink : P.inkSoft;
    ctx.lineWidth = major ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + rA * Math.cos(ang), cy + rA * Math.sin(ang));
    ctx.lineTo(cx + rB * Math.cos(ang), cy + rB * Math.sin(ang));
    ctx.stroke();
  }

  // numerals every 20 kt
  ctx.fillStyle = P.ink;
  ctx.font = font(Math.round(faceR * 0.125), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = V_MIN; v <= V_MAX; v += 20) {
    const ang = angleOf(v);
    ctx.fillText(String(v), cx + faceR * 0.63 * Math.cos(ang), cy + faceR * 0.63 * Math.sin(ang));
  }

  // scale caption
  ctx.fillStyle = P.muted;
  ctx.font = font(Math.max(8, Math.round(faceR * 0.085)));
  ctx.fillText('KNOTS', cx, cy - faceR * 0.36);
}

export function draw(a, sim) {
  if (!a.geom) return;
  const { ctx, scale, geom } = a;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
  ctx.drawImage(a.statics, 0, 0);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const v = Math.min(V_MAX, Math.max(V_MIN, sim.ias));
  drawNeedle(ctx, geom.cx, geom.cy, (v - V_MIN) * DEG_PER_KT * RAD, geom.faceR);
}
