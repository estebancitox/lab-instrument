// Shared canvas utilities for all instruments.

export const TAU = Math.PI * 2;
export const RAD = Math.PI / 180;
export const DPR_CAP = 3; // bounds bitmap memory on very-high-density phones

export const P = {
  plate: '#14171b',
  face: '#252c35',
  ring: 'rgba(139, 147, 156, 0.35)',
  ink: '#e6e9ea',
  inkSoft: 'rgba(230, 233, 234, 0.55)',
  muted: '#8b939c',
  signal: '#ff8a50',
  sky: '#5d6f85',
  earth: '#221c17',
  hatch: '#3a322b',
};

export const font = (px, weight = 400) =>
  `${weight} ${px}px "IBM Plex Mono", ui-monospace, monospace`;

// Integer device-pixel backing size. Uses the exact device-pixel content box
// when the observer provides it (and the cap is not in play); otherwise rounds
// cssSize * dpr so transform and backing store always agree.
export function backingSize(canvas, entry) {
  const dpr = window.devicePixelRatio || 1;
  const box = entry && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
  if (box && dpr <= DPR_CAP) return { w: box.inlineSize, h: box.blockSize };
  const capped = Math.min(dpr, DPR_CAP);
  return {
    w: Math.round(canvas.clientWidth * capped),
    h: Math.round(canvas.clientHeight * capped),
  };
}

export function applyBacking(canvas, size) {
  if (canvas.width === size.w && canvas.height === size.h) return false;
  canvas.width = size.w;
  canvas.height = size.h;
  return true;
}

// Offscreen layer at device resolution, addressed in CSS-px coordinates.
export function layer(cssW, cssH, scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(cssW * scale));
  c.height = Math.max(1, Math.ceil(cssH * scale));
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas: c, ctx };
}

// Vertical 0–9 digit strip (plus a wrap-around 0) at device resolution.
// Drum wheels blit slices of this per frame instead of rasterizing text.
export function makeDigitStrip(fontPx, scale, color, bg) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font(fontPx, 600);
  const cellW = Math.ceil(probe.measureText('0').width + fontPx * 0.5);
  const cellH = Math.ceil(fontPx * 1.4);
  const { canvas, ctx } = layer(cellW, cellH * 11, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cellW, cellH * 11);
  ctx.fillStyle = color;
  ctx.font = font(fontPx, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 11; i++) {
    ctx.fillText(String(i % 10), cellW / 2, i * cellH + cellH / 2);
  }
  return { canvas, cellW, cellH };
}

// Odometer wheel position for the 10^k digit of v, in [0, 10): the ones
// wheel rolls continuously; each higher wheel rolls only while the wheels
// below it sweep their final 10%, like a mechanical carry.
export function wheelPos(v, k) {
  const base = 10 ** k;
  if (k === 0) return v % 10;
  const digit = Math.floor(v / base) % 10;
  const lower = v % base;
  const carry = base * 0.1;
  const t = Math.max(0, (lower - (base - carry)) / carry);
  return digit + t;
}

// Shared needle: tapered lance with counterweight tail, plus the hub.
// rot is rotation from straight-up, in radians.
export function drawNeedle(ctx, cx, cy, rot, faceR) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = P.ink;
  ctx.beginPath();
  ctx.moveTo(0, -faceR * 0.8);       // tip
  ctx.lineTo(-2.4, -faceR * 0.06);
  ctx.lineTo(-3.2, faceR * 0.2);     // counterweight tail
  ctx.lineTo(3.2, faceR * 0.2);
  ctx.lineTo(2.4, -faceR * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = P.face;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

// Instrument face: flat fill plus a hairline ring. No shadows, no gradients.
export function drawFace(ctx, cx, cy, r) {
  ctx.fillStyle = P.face;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = P.ring;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, TAU);
  ctx.stroke();
}
