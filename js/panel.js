// Panel controller: boot, the single rAF loop, input, readout, pause logic.

import { createSim, step, setComposedFrame, setDragTargets, setMode } from './sim.js';
import { backingSize, applyBacking } from './gauge.js';
import { createAttitude, rebuild, draw } from './attitude.js';

const panel = document.getElementById('panel');
const canvas = document.getElementById('attitude');
const modeFlag = document.getElementById('mode-flag');
const readoutData = document.getElementById('readout-data');
const srStatus = document.getElementById('sr-status');
const modeBtn = document.getElementById('mode-btn');
const motionBtn = document.getElementById('motion-btn');
const themeBtn = document.getElementById('theme-toggle');

const sim = createSim();
const att = createAttitude(canvas);

// ---- run condition: one derived flag, four inputs -------------------------

let pageVisible = !document.hidden;
let intersecting = false;
let userPaused = false;
let rafId = null;
let lastTs = 0;
let readoutAcc = 1; // paint the readout on the first frame
let srAcc = 0;

function ensureLoop() {
  const running = pageVisible && intersecting && !userPaused;
  if (running && rafId === null) {
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);
  } else if (!running && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function frame(ts) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((ts - lastTs) / 1000, 0.05); // no teleporting after pauses
  lastTs = ts;
  if (dt > 0) step(sim, dt, inputState());
  draw(att, sim);
  readoutAcc += dt;
  if (readoutAcc >= 0.1) {
    readoutAcc = 0;
    updateReadout();
  }
  srAcc += dt;
  if (srAcc >= 7) {
    srAcc = 0;
    // summaries only while the user is engaged with the panel — an
    // unconditional 7 s live region would narrate over the whole page
    const engaged = panelWrap.contains(document.activeElement) ||
      performance.now() - lastInteraction < 30000;
    if (engaged) announce(stateSummary());
  }
}

function renderOnce() {
  draw(att, sim);
  updateReadout();
}

// ---- readout --------------------------------------------------------------

const pad = (n, len) => String(n).padStart(len, '0');

function updateReadout() {
  const vs = Math.min(9999, Math.round(Math.abs(sim.vs)));
  readoutData.textContent =
    `  ALT ${pad(Math.round(sim.alt), 5)}` +
    `  IAS ${pad(Math.round(sim.ias), 3)}` +
    `  HDG ${pad(Math.round(sim.hdg) % 360, 3)}` +
    `  VS ${sim.vs < 0 && vs > 0 ? '-' : '+'}${pad(vs, 4)}`;
}

function announce(msg) {
  srStatus.textContent = msg;
}

function stateSummary() {
  const verb = sim.vs > 50 ? `climbing at ${Math.round(sim.vs)} feet per minute`
    : sim.vs < -50 ? `descending at ${Math.round(-sim.vs)} feet per minute`
    : 'in level flight';
  return `${sim.mode === 'ap' ? 'Autopilot on' : 'Manual control'}. ` +
    `Altitude ${Math.round(sim.alt)} feet, airspeed ${Math.round(sim.ias)} knots, ` +
    `heading ${Math.round(sim.hdg) % 360}, ${verb}.`;
}

// ---- mode -----------------------------------------------------------------

function applyMode(mode) {
  setMode(sim, mode);
  const man = mode === 'man';
  modeFlag.textContent = man ? 'MAN' : 'AP';
  modeBtn.textContent = man ? 'Engage autopilot' : 'Take controls';
  panel.classList.toggle('man', man);
  announce(man ? 'Manual control. Arrow keys command pitch and roll.' : 'Autopilot engaged.');
}

modeBtn.addEventListener('click', () => {
  const next = sim.mode === 'ap' ? 'man' : 'ap';
  noteInteraction();
  applyMode(next);
  if (next === 'man') panel.focus();
});

// ---- keyboard: active only while the panel has focus ----------------------

const keys = new Set();
const FLIGHT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const panelWrap = document.querySelector('.panel-wrap');
let lastInteraction = -Infinity;
const noteInteraction = () => { lastInteraction = performance.now(); };

panel.addEventListener('keydown', e => {
  // system chords (Cmd+arrow etc.) pass through; macOS also swallows the
  // keyup of a non-modifier released while Meta is down, which would stick
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (FLIGHT_KEYS.includes(e.key)) {
    e.preventDefault();
    keys.add(e.key);
    noteInteraction();
    if (sim.mode === 'ap') applyMode('man');
  } else if (e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) {
      noteInteraction();
      applyMode(sim.mode === 'ap' ? 'man' : 'ap');
    }
  } else if (e.key === 'Escape') {
    panel.blur();
  }
});
panel.addEventListener('keyup', e => keys.delete(e.key));
panel.addEventListener('blur', () => keys.clear());

function inputState() {
  return {
    rollAxis: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
    pitchAxis: (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0),
    dragging,
  };
}

// ---- pointer drag = virtual stick (manual mode only) ----------------------

let dragging = false;
let dragStart = null;

panel.addEventListener('pointerdown', e => {
  if (sim.mode !== 'man') return; // in AP the panel scrolls like any content
  // primary button + primary pointer only: a right-click's pointerup is
  // eaten by the context menu, and a second touch must not steal the stick
  if (dragging || e.button !== 0 || !e.isPrimary) return;
  dragging = true;
  dragStart = { id: e.pointerId, x: e.clientX, y: e.clientY, roll: sim.tgtRoll, pitch: sim.tgtPitch };
  panel.setPointerCapture(e.pointerId);
  noteInteraction();
});
panel.addEventListener('pointermove', e => {
  if (!dragging || e.pointerId !== dragStart.id) return;
  setDragTargets(sim,
    dragStart.roll + (e.clientX - dragStart.x) * 0.25,
    dragStart.pitch - (e.clientY - dragStart.y) * 0.12); // drag up = climb
});
const endDrag = e => {
  if (dragging && e.pointerId === dragStart.id) dragging = false;
};
panel.addEventListener('pointerup', endDrag);
panel.addEventListener('pointercancel', endDrag);

// ---- motion: user pause + prefers-reduced-motion --------------------------

function applyPaused(paused, label) {
  userPaused = paused;
  motionBtn.textContent = paused ? 'Resume motion' : 'Pause';
  ensureLoop();
  if (label) announce(label);
}

motionBtn.addEventListener('click', () => {
  noteInteraction();
  applyPaused(!userPaused, userPaused ? 'Motion resumed.' : 'Motion paused.');
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
if (reducedMotion.matches) {
  setComposedFrame(sim);
  applyPaused(true, null);
}
reducedMotion.addEventListener('change', e => {
  if (e.matches) { // pause on flip-on; never auto-resume on flip-off
    setComposedFrame(sim);
    applyPaused(true, 'Motion paused because reduced motion is on.');
    renderOnce();
  }
});

// ---- pause when hidden or off-screen --------------------------------------

document.addEventListener('visibilitychange', () => {
  pageVisible = !document.hidden;
  ensureLoop();
});

new IntersectionObserver(entries => {
  intersecting = entries[entries.length - 1].isIntersecting; // newest record
  ensureLoop();
}).observe(panel);

// ---- sizing: exact device pixels, debounced rebuilds ----------------------

let sized = false;
let resizeTimer = 0;

function resizeNow(entry) {
  const size = backingSize(canvas, entry);
  if (!applyBacking(canvas, size) && sized) return;
  sized = true;
  rebuild(att);
  renderOnce();
}

const ro = new ResizeObserver(entries => {
  if (!sized) {
    resizeNow(entries[0]);
    return;
  }
  const entry = entries[0];
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resizeNow(entry), 150);
});
let fallbackSizing = false;
try {
  ro.observe(canvas, { box: 'device-pixel-content-box' });
} catch {
  fallbackSizing = true;
  ro.observe(canvas); // Safari: content-box + dpr math
}
if (fallbackSizing) {
  // zoom fires resize; monitor moves change dpr with no resize at all
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resizeNow(null), 150);
  });
  const watchDpr = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener('change', () => { resizeNow(null); watchDpr(); }, { once: true });
  };
  watchDpr();
}

// ---- fonts: explicit loads (canvas never triggers @font-face fetches) -----
// First paint never waits on fonts; when they settle, re-render statics once.

Promise.all([
  document.fonts.load('400 16px "IBM Plex Mono"'),
  document.fonts.load('600 16px "IBM Plex Mono"'),
]).catch(() => {}).then(() => {
  if (sized) {
    rebuild(att);
    renderOnce();
  }
});

// ---- theme toggle (parity with the portfolio) -----------------------------

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && systemDark.matches);
};
function themeLabel() {
  const next = isDark() ? 'day' : 'night';
  themeBtn.textContent = next;
  themeBtn.setAttribute('aria-label', `Switch to ${next} theme`); // name contains label
  const color = isDark() ? '#14171B' : '#F3F5F6';
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', color);
  }
}
themeBtn.hidden = false;
themeLabel();
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  themeLabel();
});
systemDark.addEventListener('change', themeLabel);

// ---- boot -----------------------------------------------------------------

applyMode('ap');
announce(''); // clear any stale content; summaries start once the loop runs
updateReadout();
ensureLoop();
