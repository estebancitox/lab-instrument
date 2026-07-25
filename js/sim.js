// Flight-state simulation. Pure — no DOM, no canvas.
// Units: altitude ft, ias kt, vs fpm, angles deg. All trig on radians,
// converted at the call site; constants live here and nowhere else.

const RAD = Math.PI / 180;
const G = 9.80665;            // m/s^2
const KT_TO_MS = 0.514444;
const FPM_PER_KT = 101.269;   // 1 kt of vertical speed = 101.269 ft/min

export const ENV = {
  altFloor: 500, altCeil: 12000,
  altSoftBand: 400,           // vs fades to 0 across this many ft at the limits
  apAltMin: 3000, apAltMax: 9000, apAltMargin: 500,
  iasMin: 95, iasMax: 155, trim: 125,
  userRollMax: 45, userPitchMax: 15,
  formulaMinKt: 40,           // floor for V in the turn formula, never for display
};

const DYN = {
  rollOmega: 2.4,             // rad/s, critically damped target tracking
  pitchOmega: 1.6,
  iasTau: 4,                  // s, first-order ias approach to equilibrium
  pitchToIas: 3.5,            // kt of equilibrium ias lost per deg nose-up
  keyRollRate: 45,            // deg/s of target change while a key is held
  keyPitchRate: 12,
  rollRecenterTau: 1.2,       // s, target roll decay when hands-off
};

export function createSim() {
  return {
    t: 0,
    mode: 'ap',                    // 'ap' | 'man'
    alt: 4520, ias: 128, hdg: 214, vs: 0,
    pitch: 0, roll: 0, pitchRate: 0, rollRate: 0,
    tgtPitch: 0, tgtRoll: 0,
    ap: { timeLeft: 0, name: '', pitch: 0, roll: 0 },
    phase: Math.random() * 1000,   // atmosphere phase offset per visit
  };
}

// The composed frame shown under prefers-reduced-motion: a gentle climbing
// right turn with every value mid-scale. vs derives from the same formula
// the live sim uses, so the readout is never inconsistent.
export function setComposedFrame(sim) {
  sim.alt = 4520; sim.ias = 128; sim.hdg = 214;
  sim.pitch = 2; sim.roll = 8;
  sim.tgtPitch = 2; sim.tgtRoll = 8;
  sim.pitchRate = 0; sim.rollRate = 0;
  sim.vs = sim.ias * Math.sin(sim.pitch * RAD) * FPM_PER_KT;
}

// input: { rollAxis: -1|0|1, pitchAxis: -1|0|1, dragging: bool } — only read
// in manual mode. While dragging, targets are set directly via setDragTargets.
export function step(sim, dt, input) {
  sim.t += dt;
  const w = atmosphere(sim.t + sim.phase);

  if (sim.mode === 'ap') {
    sim.ap.timeLeft -= dt;
    if (sim.ap.timeLeft <= 0) pickManeuver(sim);
    sim.tgtPitch = sim.ap.pitch;
    sim.tgtRoll = sim.ap.roll;
  } else if (input && !input.dragging) {
    if (input.rollAxis) {
      sim.tgtRoll = clamp(sim.tgtRoll + input.rollAxis * DYN.keyRollRate * dt,
        -ENV.userRollMax, ENV.userRollMax);
    } else {
      sim.tgtRoll *= Math.exp(-dt / DYN.rollRecenterTau);
    }
    if (input.pitchAxis) {
      sim.tgtPitch = clamp(sim.tgtPitch + input.pitchAxis * DYN.keyPitchRate * dt,
        -ENV.userPitchMax, ENV.userPitchMax);
    } // pitch holds on release
  }

  // command layer: clamps guarantee tan() below is never evaluated near 90 deg
  const tp = clamp(sim.tgtPitch, -ENV.userPitchMax, ENV.userPitchMax) + w.pitch;
  const tr = clamp(sim.tgtRoll, -ENV.userRollMax, ENV.userRollMax) + w.roll;

  spring(sim, 'pitch', 'pitchRate', tp, DYN.pitchOmega, dt);
  spring(sim, 'roll', 'rollRate', tr, DYN.rollOmega, dt);

  // kinematics
  const v = Math.max(sim.ias, ENV.formulaMinKt) * KT_TO_MS;
  const hdgRateDeg = (G / v) * Math.tan(sim.roll * RAD) / RAD; // rad/s -> deg/s
  sim.hdg = ((sim.hdg + hdgRateDeg * dt) % 360 + 360) % 360;

  let vs = sim.ias * Math.sin(sim.pitch * RAD) * FPM_PER_KT;
  // soft floor/ceiling in the kinematics layer — applies in BOTH modes
  if (vs < 0) vs *= clamp((sim.alt - ENV.altFloor) / ENV.altSoftBand, 0, 1);
  if (vs > 0) vs *= clamp((ENV.altCeil - sim.alt) / ENV.altSoftBand, 0, 1);
  sim.vs = vs;
  sim.alt += (vs / 60) * dt;

  const iasEq = clamp(ENV.trim - sim.pitch * DYN.pitchToIas + w.trim,
    ENV.iasMin, ENV.iasMax);
  sim.ias += (iasEq - sim.ias) * (dt / DYN.iasTau);
}

export function setDragTargets(sim, roll, pitch) {
  sim.tgtRoll = clamp(roll, -ENV.userRollMax, ENV.userRollMax);
  sim.tgtPitch = clamp(pitch, -ENV.userPitchMax, ENV.userPitchMax);
}

export function setMode(sim, mode) {
  if (sim.mode === mode) return;
  sim.mode = mode;
  if (mode === 'ap') sim.ap.timeLeft = 0; // pick a fresh maneuver immediately
  // man: keep current targets so the handoff never jumps
}

// critically damped spring: x'' = w^2 (target - x) - 2 w x', semi-implicit Euler
function spring(s, xKey, vKey, target, omega, dt) {
  const a = omega * omega * (target - s[xKey]) - 2 * omega * s[vKey];
  s[vKey] += a * dt;
  s[xKey] += s[vKey] * dt;
}

// Two incommensurate sines per axis: never dead-still, never visibly periodic.
function atmosphere(t) {
  const TAU = Math.PI * 2;
  return {
    pitch: 0.35 * Math.sin(TAU * 0.073 * t) + 0.2 * Math.sin(TAU * 0.031 * t + 1.7),
    roll: 0.4 * Math.sin(TAU * 0.057 * t + 0.9) + 0.25 * Math.sin(TAU * 0.023 * t + 2.4),
    trim: 1.5 * Math.sin(TAU * 0.019 * t + 4.0),
  };
}

const MOVES = [
  { name: 'cruise', w: 2.5, roll: () => 0, pitch: () => 0 },
  { name: 'turn', w: 2.0, roll: s => s * rand(10, 20), pitch: () => 0 },
  { name: 'climb', w: 1.2, roll: () => 0, pitch: () => rand(3, 6) },
  { name: 'descent', w: 1.2, roll: () => 0, pitch: () => -rand(3, 6) },
  { name: 'climbturn', w: 1.8, roll: s => s * rand(10, 18), pitch: () => rand(3, 5) },
  { name: 'descturn', w: 1.8, roll: s => s * rand(10, 18), pitch: () => -rand(3, 5) },
];

// Single-pass selection, guaranteed to terminate: the envelope guard adjusts
// the picked maneuver's pitch instead of rejecting and re-picking, and a
// level maneuver is always admissible by construction.
function pickManeuver(sim) {
  let total = 0;
  const weights = MOVES.map(m => {
    const w = m.name === sim.ap.name ? m.w * 0.4 : m.w; // avoid repeats
    total += w;
    return w;
  });
  let r = Math.random() * total;
  let move = MOVES[0];
  for (let i = 0; i < MOVES.length; i++) {
    r -= weights[i];
    if (r <= 0) { move = MOVES[i]; break; }
  }

  // S-turn feel: turns tend to alternate direction
  const prevSign = Math.sign(sim.ap.roll) || (Math.random() < 0.5 ? -1 : 1);
  const turnSign = Math.random() < 0.65 ? -prevSign : prevSign;

  const dur = rand(6, 15);
  let pitch = move.pitch();

  // equilibrium-based envelope guard with inner margins
  const iasEq = clamp(ENV.trim - pitch * DYN.pitchToIas, ENV.iasMin, ENV.iasMax);
  const vsEq = iasEq * Math.sin(pitch * RAD) * FPM_PER_KT;
  const predictedAlt = sim.alt + (vsEq / 60) * dur;
  if (predictedAlt > ENV.apAltMax - ENV.apAltMargin && pitch > 0) pitch = -pitch;
  else if (predictedAlt < ENV.apAltMin + ENV.apAltMargin && pitch < 0) pitch = -pitch;

  sim.ap = { timeLeft: dur, name: move.name, pitch, roll: move.roll(turnSign) };
}

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
