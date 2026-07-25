// Attitude indicator. The entire ball (sky, ground, hatching, horizon,
// pitch ladder, numerals) pre-renders into one oversized bitmap per resize;
// a frame is: blit face, clip + rotate + translate + blit ball, bank pointer,
// blit aircraft-symbol overlay. No per-frame fillText.

import { TAU, RAD, P, font, layer, drawFace } from './gauge.js';

const BALL_OVERSIZE = 1.6;   // covers rotation plus max pitch translation
const PITCH_RANGE = 30;      // deg of pitch across one ball radius

export function createAttitude(canvas) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    scale: 1, css: 0,
    geom: null, ball: null, ballSide: 0, statics: null, overlay: null,
  };
}

export function rebuild(a) {
  const css = a.canvas.clientWidth;
  if (!css || !a.canvas.width) return;
  a.css = css;
  a.scale = a.canvas.width / css;
  const cx = css / 2;
  const faceR = css / 2 - 1;
  const ballR = faceR * 0.8;
  a.geom = { cx, cy: cx, faceR, ballR, pxPerDeg: ballR / PITCH_RANGE };
  buildBall(a);
  buildStatics(a);
  buildOverlay(a);
}

function buildBall(a) {
  const { ballR, pxPerDeg } = a.geom;
  const side = Math.ceil(ballR * 2 * BALL_OVERSIZE);
  a.ballSide = side;
  const { canvas, ctx } = layer(side, side, a.scale);
  a.ball = canvas;
  const c = side / 2; // bitmap center = horizon

  ctx.fillStyle = P.sky;
  ctx.fillRect(0, 0, side, c);
  ctx.fillStyle = P.earth;
  ctx.fillRect(0, c, side, side - c);

  // sparse section hatching on the ground — a non-color "down" cue
  ctx.strokeStyle = P.hatch;
  ctx.lineWidth = Math.max(1, 2 / a.scale); // never thinner than 2 device px
  ctx.beginPath();
  const spacing = 14;
  for (let x = -side; x < side; x += spacing) {
    ctx.moveTo(x, c + 6);
    ctx.lineTo(x + (side - c), side);
  }
  ctx.stroke();

  // horizon
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, c);
  ctx.lineTo(side, c);
  ctx.stroke();

  // pitch ladder
  const majorHalf = ballR * 0.3;
  const minorHalf = ballR * 0.15;
  const textPx = Math.max(9, Math.round(ballR * 0.1));
  ctx.font = font(textPx);
  ctx.textBaseline = 'middle';
  for (let deg = 5; deg <= PITCH_RANGE; deg += 5) {
    const major = deg % 10 === 0;
    const half = major ? majorHalf : minorHalf;
    ctx.strokeStyle = major ? P.ink : P.inkSoft;
    ctx.lineWidth = major ? 2 : 1.5;
    for (const sign of [-1, 1]) {
      const y = c - sign * deg * pxPerDeg; // +deg (nose up) sits above horizon
      ctx.beginPath();
      ctx.moveTo(c - half, y);
      ctx.lineTo(c + half, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = P.ink;
        ctx.textAlign = 'right';
        ctx.fillText(String(deg), c - half - 6, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(deg), c + half + 6, y);
      }
    }
  }
}

function buildStatics(a) {
  const { cx, cy, faceR, ballR } = a.geom;
  const { canvas, ctx } = layer(a.css, a.css, a.scale);
  a.statics = canvas;

  drawFace(ctx, cx, cy, faceR);

  // fixed roll scale, muted, majors at 0/30/60, minors at 10/20/45
  const r1 = ballR + 3;
  for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const major = deg % 30 === 0;
    const r2 = major ? faceR - 5 : r1 + (faceR - 8 - r1) * 0.55;
    const ang = (-90 + deg) * RAD;
    ctx.strokeStyle = P.muted;
    ctx.lineWidth = major ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang));
    ctx.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang));
    ctx.stroke();
  }

  // fixed zero-bank index at top, pointing at the ball
  ctx.fillStyle = P.ink;
  const iy = cy - ballR - 2;
  ctx.beginPath();
  ctx.moveTo(cx, iy);
  ctx.lineTo(cx - 5.5, iy - 9);
  ctx.lineTo(cx + 5.5, iy - 9);
  ctx.closePath();
  ctx.fill();
}

function buildOverlay(a) {
  const { cx, cy, ballR } = a.geom;
  const { canvas, ctx } = layer(a.css, a.css, a.scale);
  a.overlay = canvas;

  // miniature aircraft reference — the one orange element on this gauge
  const outer = ballR * 0.52;
  const inner = ballR * 0.17;
  const lw = 3.5;
  ctx.strokeStyle = P.signal;
  ctx.fillStyle = P.signal;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * outer, cy);
    ctx.lineTo(cx + s * inner, cy);
    ctx.lineTo(cx + s * inner, cy + ballR * 0.07);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, TAU);
  ctx.fill();
}

export function draw(a, sim) {
  if (!a.geom) return;
  const { ctx, scale, geom } = a;
  const { cx, cy, ballR, pxPerDeg } = geom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
  ctx.drawImage(a.statics, 0, 0);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ballR, 0, TAU);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-sim.roll * RAD);
  ctx.translate(0, sim.pitch * pxPerDeg); // nose up -> horizon drops
  // exact fractional source rect: layer() ceil-pads the bitmap, so mapping
  // the whole bitmap to ballSide css px would resample and drift the center
  ctx.drawImage(a.ball, 0, 0, a.ballSide * scale, a.ballSide * scale,
    -a.ballSide / 2, -a.ballSide / 2, a.ballSide, a.ballSide);
  ctx.restore();

  // bank pointer rides the ball against the fixed scale
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-sim.roll * RAD);
  ctx.fillStyle = P.ink;
  ctx.beginPath();
  ctx.moveTo(0, -ballR + 3);
  ctx.lineTo(-5.5, -ballR + 12);
  ctx.lineTo(5.5, -ballR + 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(a.overlay, 0, 0);
}
