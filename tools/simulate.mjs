// Ratojen tarkistin: ajaa fysiikan headless-tilassa ja varmistaa, että
// jokainen väylä on kelvollinen ja läpäistävissä.
//
//   node tools/simulate.mjs                 # kaikki tarkistukset
//   node tools/simulate.mjs --hole 13       # yksi väylä
//   node tools/simulate.mjs --rounds 6      # ahneen botin kierrosmäärä

import { COURSES } from '../src/courses.js';
import { buildWorld, pointInPolygon } from '../src/world.js';
import {
  createBall,
  stepBall,
  launchBall,
  BALL_RADIUS,
  MAX_SPEED,
  GRAVITY,
  STATIC_FRICTION,
} from '../src/physics.js';
import { SURFACES } from '../src/world.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const ONLY = args.includes('--hole') ? getArg('--hole', 0) : null;
const RANDOM_SHOTS = getArg('--random', 250);
const ROUNDS = getArg('--rounds', 5);
const CANDIDATES = getArg('--candidates', 14);
const MAX_STROKES = getArg('--max-strokes', 8);

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearance(world, x, y) {
  let min = Infinity;
  for (const s of world.segments) {
    const abx = s.bx - s.ax;
    const aby = s.by - s.ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-12 ? ((x - s.ax) * abx + (y - s.ay) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (s.ax + abx * t), y - (s.ay + aby * t)) - (s.t || 0);
    if (d < min) min = d;
  }
  for (const c of world.circles) {
    const d = Math.hypot(x - c.x, y - c.y) - c.r;
    if (d < min) min = d;
  }
  return min;
}

/**
 * Etäisyyskenttä reikään: BFS vapaan tilan ruudukossa. Tarvitaan, koska
 * suora linnuntie-etäisyys ei kelpaa sokkeloilla (esim. spiraali).
 */
function distanceField(world, cell = 0.035) {
  const cols = Math.ceil(world.width / cell);
  const rows = Math.ceil(world.height / cell);
  const free = new Uint8Array(cols * rows);
  const cx = (i) => (i + 0.5) * cell;
  const cy = (j) => (j + 0.5) * cell;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = cx(i);
      const y = cy(j);
      if (!world.contains(x, y)) continue;
      if (world.surfaceAt(x, y).water) continue;
      if (clearanceStatic(world, x, y) < BALL_RADIUS * 1.05) continue;
      free[j * cols + i] = 1;
    }
  }

  const dist = new Float32Array(cols * rows).fill(Infinity);
  const ci = Math.min(cols - 1, Math.max(0, Math.floor(world.cup.x / cell)));
  const cj = Math.min(rows - 1, Math.max(0, Math.floor(world.cup.y / cell)));
  const queue = [cj * cols + ci];
  dist[cj * cols + ci] = 0;
  free[cj * cols + ci] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const i = idx % cols;
    const j = (idx - i) / cols;
    const d = dist[idx];
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nIdx = nj * cols + ni;
      if (!free[nIdx] || dist[nIdx] < Infinity) continue;
      dist[nIdx] = d + cell;
      queue.push(nIdx);
    }
  }

  return {
    cols,
    rows,
    cell,
    reachable: queue.length,
    at(x, y) {
      const i = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
      const j = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
      const d = dist[j * cols + i];
      if (Number.isFinite(d)) return d;
      // Umpisolussa (esim. seinän vieressä): etsi lähin kelvollinen arvo.
      let best = Infinity;
      for (let r = 1; r <= 3 && best === Infinity; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
            const v = dist[nj * cols + ni];
            if (v < best) best = v;
          }
        }
      }
      return Number.isFinite(best) ? best + 0.1 : 50;
    },
    /** Suunta, johon etäisyys reikään pienenee nopeimmin. */
    downhill(x, y) {
      let bestAngle = 0;
      let bestVal = Infinity;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const v = this.at(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3);
        if (v < bestVal) {
          bestVal = v;
          bestAngle = a;
        }
      }
      return bestAngle;
    },
  };
}

function clearanceStatic(world, x, y) {
  let min = Infinity;
  for (const s of world.staticSegments) {
    const abx = s.bx - s.ax;
    const aby = s.by - s.ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-12 ? ((x - s.ax) * abx + (y - s.ay) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (s.ax + abx * t), y - (s.ay + aby * t)) - (s.t || 0);
    if (d < min) min = d;
  }
  for (const c of world.staticCircles) {
    const d = Math.hypot(x - c.x, y - c.y) - c.r;
    if (d < min) min = d;
  }
  return min;
}

/** Simuloi yhden lyönnin loppuun asti. Muuttaa ball- ja world-tilaa. */
function playShot(world, ball, angle, speed, maxTime = 25) {
  launchBall(ball, Math.cos(angle), Math.sin(angle), speed);
  let t = 0;
  const dt = 1 / 120;
  while (t < maxTime) {
    const events = [];
    stepBall(ball, world, dt, events);
    t += dt;
    for (const e of events) {
      if (e.type === 'holed') return 'holed';
      if (e.type === 'water') return 'water';
      if (e.type === 'out') return 'out';
    }
    if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y)) return 'nan';
    if (ball.resting) return 'rest';
  }
  return 'timeout';
}

const snapshot = (world, ball) => ({ time: world.time, ball: { ...ball } });
const restore = (world, ball, snap) => {
  world.time = snap.time;
  Object.assign(ball, snap.ball);
  world.advance(0);
};

/** Törmäystesti: satunnaisia lyöntejä, etsitään karkaamisia ja NaN-tiloja. */
function robustnessPass(hole, seed) {
  const rnd = mulberry32(seed);
  const world = buildWorld(hole);
  const ball = createBall(world.tee.x, world.tee.y);
  const counts = {};
  let safe = { x: ball.x, y: ball.y };
  for (let i = 0; i < RANDOM_SHOTS; i++) {
    const res = playShot(world, ball, rnd() * Math.PI * 2, 0.6 + rnd() * (MAX_SPEED - 0.6));
    counts[res] = (counts[res] || 0) + 1;
    if (res === 'rest') {
      safe = { x: ball.x, y: ball.y };
    } else {
      ball.x = safe.x;
      ball.y = safe.y;
      ball.vx = ball.vy = ball.w = 0;
      ball.resting = true;
      if (res === 'nan') break;
    }
  }
  return counts;
}

/** Ahne botti: kokeilee joukon lyöntejä ja valitsee reikää lähimmän lopputuloksen. */
function greedyRound(hole, seed, field) {
  const rnd = mulberry32(seed);
  const world = buildWorld(hole);
  const ball = createBall(world.tee.x, world.tee.y);
  let strokes = 0;

  for (let stroke = 0; stroke < MAX_STROKES; stroke++) {
    const before = snapshot(world, ball);
    let best = null;
    for (let i = 0; i < CANDIDATES; i++) {
      restore(world, ball, before);
      const aim = field.downhill(ball.x, ball.y);
      const angle = i === 0 ? aim : aim + (rnd() - 0.5) * 2.2;
      const dist = field.at(ball.x, ball.y);
      const speed = Math.min(MAX_SPEED, 0.8 + rnd() * 3.5 + dist * 0.45);
      const res = playShot(world, ball, angle, speed);
      const d = field.at(ball.x, ball.y);
      let score = d;
      if (res === 'holed') score = -100;
      if (res === 'water') score = d + 4;
      if (res === 'out' || res === 'nan' || res === 'timeout') score = d + 20;
      if (!best || score < best.score) {
        best = { score, angle, speed, res };
      }
    }
    restore(world, ball, before);
    const res = playShot(world, ball, best.angle, best.speed);
    strokes++;
    if (res === 'holed') return { holed: true, strokes };
    if (res === 'water') strokes++;
    if (res !== 'rest') {
      // vesi / karkaaminen: takaisin tiiaukselle
      ball.x = world.tee.x;
      ball.y = world.tee.y;
      ball.vx = ball.vy = ball.w = 0;
      ball.resting = true;
    }
  }
  return { holed: false, strokes };
}

const started = Date.now();
let failures = 0;
const rows = [];

COURSES.forEach((hole, index) => {
  const number = index + 1;
  if (ONLY && ONLY !== number) return;
  const world = buildWorld(hole);
  const problems = [];

  if (!pointInPolygon(hole.boundary, world.tee.x, world.tee.y)) problems.push('tee ulkona');
  if (!pointInPolygon(hole.boundary, world.cup.x, world.cup.y)) problems.push('reikä ulkona');
  if (world.surfaceAt(world.tee.x, world.tee.y).water) problems.push('tee vedessä');
  if (world.surfaceAt(world.cup.x, world.cup.y).water) problems.push('reikä vedessä');

  const teeClear = clearance(world, world.tee.x, world.tee.y);
  const cupClear = clearance(world, world.cup.x, world.cup.y);
  if (teeClear < BALL_RADIUS * 2) problems.push(`tee ahtaalla (${teeClear.toFixed(3)})`);
  if (cupClear < world.cup.r + BALL_RADIUS * 2) problems.push(`reikä ahtaalla (${cupClear.toFixed(3)})`);

  // Kaltevuudet ja kiihdytyslaatat eivät saa osua epävakaalle välille, jossa
  // pallo lähtisi liikkeelle mutta pysähtyisi heti takaisin (nykiminen).
  for (const zone of world.zones) {
    if (zone.type !== 'slope' && zone.type !== 'boost') continue;
    const drive = Math.hypot(zone.ax || 0, zone.ay || 0);
    const rolling = SURFACES.green.mu * GRAVITY;
    if (drive > STATIC_FRICTION * rolling && drive <= rolling * 1.05) {
      problems.push(`${zone.type}-kiihtyvyys ${drive.toFixed(2)} epävakaalla välillä`);
    }
  }

  const counts = robustnessPass(hole, number * 7919 + 13);
  if (counts.out) problems.push(`karkasi radalta x${counts.out}`);
  if (counts.nan) problems.push(`NaN x${counts.nan}`);
  if (counts.timeout > RANDOM_SHOTS * 0.06) problems.push(`ei pysähdy x${counts.timeout}`);

  const field = distanceField(world);
  const teeDist = field.at(world.tee.x, world.tee.y);
  if (!Number.isFinite(teeDist) || teeDist >= 50) problems.push('reikä ei ole saavutettavissa');

  let holed = 0;
  let best = Infinity;
  let sum = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const r = greedyRound(hole, number * 104729 + i * 7919, field);
    if (r.holed) {
      holed++;
      sum += r.strokes;
      best = Math.min(best, r.strokes);
    }
  }
  if (holed === 0) problems.push('botti ei päässyt reikään');
  else if (best > hole.par + 3) problems.push(`paras tulos ${best} (par ${hole.par})`);

  if (problems.length) failures++;
  rows.push({
    number,
    name: hole.name,
    par: hole.par,
    teeClear,
    cupClear,
    rate: holed / ROUNDS,
    best,
    avg: holed ? sum / holed : null,
    counts,
    problems,
  });
});

console.log('  # väylä                par  tee/reikä   upotti  paras  ka.   huomiot');
console.log('-'.repeat(88));
for (const r of rows) {
  console.log(
    String(r.number).padStart(3) +
      ' ' +
      r.name.padEnd(21) +
      String(r.par).padStart(2) +
      '   ' +
      (r.teeClear.toFixed(2) + '/' + r.cupClear.toFixed(2)).padEnd(11) +
      (r.rate * 100).toFixed(0).padStart(4) +
      '%  ' +
      String(r.best === Infinity ? '-' : r.best).padStart(5) +
      '  ' +
      (r.avg ? r.avg.toFixed(1) : '-').padStart(4) +
      '   ' +
      (r.problems.join(', ') || 'ok'),
  );
}
console.log('-'.repeat(88));
console.log(`kesto ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (failures) {
  console.log(`${failures} väylällä huomautuksia.`);
  process.exitCode = 1;
} else {
  console.log('Kaikki väylät ok.');
}
