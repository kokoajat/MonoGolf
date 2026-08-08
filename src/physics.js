// Fysiikkamoottori: jäykän pallon liike tasossa (ylhäältä kuvattuna).
//
// Yksiköt ovat SI-yksiköitä: metri, sekunti, kilogramma. Rata on n. 3,6 m x 8 m.
// Malli sisältää:
//   * vierintävastuksen (pinnasta riippuva μ)
//   * kimmoisan törmäyksen seiniin (restituutiokerroin e)
//   * kitkaimpulssin kosketuspisteessä -> pallo saa kierteen laidasta
//   * pystyakselin kierteen (ω) aiheuttaman kaartavan sivukiihtyvyyden
//   * liikkuvat esteet (kosketuspisteen nopeus otetaan huomioon)

export const BALL_RADIUS = 0.0213; // m (oikea golfpallo)
export const BALL_MASS = 0.0459; // kg
export const BALL_INERTIA = 0.4 * BALL_MASS * BALL_RADIUS * BALL_RADIUS; // kiinteä pallo: 2/5 m r^2
export const GRAVITY = 9.81; // m/s^2

// Yläraja on mitoitettu radan kokoon: 6 m/s riittää kimpoilemaan
// 3,6 m pitkän väylän päästä päähän useamman kerran.
export const MAX_SPEED = 6.0; // m/s
export const REST_SPEED = 0.035; // m/s, tämän alle pysähtyneeksi
export const REST_TIME = 0.12; // s, kuinka kauan hitaana ennen pysähtymistä

// Kierteen aiheuttama sivuttaiskiihtyvyys: a = SPIN_CURVE * ω * |v|
const SPIN_CURVE = 0.0021;
// Kierteen vaimeneminen (1/s), kerrotaan pinnan kitkalla
const SPIN_DAMP = 5.0;

// Suurin sallittu siirtymä aliaskeleessa suhteessa pallon säteeseen.
// Estää läpitunneloitumisen ohuista seinistä.
const MAX_STEP_FRACTION = 0.35;
const MAX_SUBSTEPS = 400;

export function createBall(x, y) {
  return { x, y, vx: 0, vy: 0, w: 0, resting: true, restTimer: 0 };
}

export function ballSpeed(ball) {
  return Math.hypot(ball.vx, ball.vy);
}

export function launchBall(ball, dirX, dirY, speed) {
  const len = Math.hypot(dirX, dirY) || 1;
  const s = Math.min(speed, MAX_SPEED);
  ball.vx = (dirX / len) * s;
  ball.vy = (dirY / len) * s;
  ball.w = 0;
  ball.resting = false;
  ball.restTimer = 0;
}

/**
 * Etenee yhden ruudunpäivityksen verran. Jakaa askeleen riittävän pieniin
 * aliaskeliin, jotta törmäykset havaitaan luotettavasti.
 *
 * @param {object} ball
 * @param {object} world  buildWorld():n palauttama maailma
 * @param {number} dt     kulunut aika sekunteina
 * @param {object[]} events  tähän listaan kerätään tapahtumat (bounce/water/holed/ob)
 */
export function stepBall(ball, world, dt, events = []) {
  if (dt <= 0) return events;
  let remaining = Math.min(dt, 0.05); // suojaus välilehden taustalta palatessa
  let guard = 0;

  while (remaining > 1e-6 && guard++ < MAX_SUBSTEPS) {
    const speed = Math.hypot(ball.vx, ball.vy);
    // Aliaskel niin pieni, ettei pallo liiku yli murto-osaa säteestään.
    let h = remaining;
    if (speed > 1e-6) {
      h = Math.min(h, (MAX_STEP_FRACTION * BALL_RADIUS) / speed);
    }
    h = Math.max(h, 1e-5);
    remaining -= h;

    world.advance(h);
    integrate(ball, world, h, events);
    resolveCollisions(ball, world, h, events);

    if (checkCup(ball, world, events)) return events;
    if (checkHazards(ball, world, events)) return events;
    if (ball.resting) break;
  }
  return events;
}

function integrate(ball, world, h, events) {
  const surf = world.surfaceAt(ball.x, ball.y);
  let speed = Math.hypot(ball.vx, ball.vy);

  // 1) Vierintävastus hidastaa nopeutta suoraan (ei koskaan käännä suuntaa).
  if (speed > 1e-9) {
    const decel = surf.mu * GRAVITY;
    const newSpeed = Math.max(0, speed - decel * h);
    const scale = speed > 0 ? newSpeed / speed : 0;
    ball.vx *= scale;
    ball.vy *= scale;
    speed = newSpeed;
  }

  // 2) Pinnan kiihtyvyys (kaltevuus, kiihdytyslaatta).
  let ax = surf.ax;
  let ay = surf.ay;

  // 3) Kierteen kaartava vaikutus: kohtisuoraan liikesuuntaan nähden.
  if (speed > 0.05 && Math.abs(ball.w) > 0.01) {
    const nx = ball.vx / speed;
    const ny = ball.vy / speed;
    const aSide = SPIN_CURVE * ball.w * speed * surf.grip;
    ax += -ny * aSide;
    ay += nx * aSide;
  }

  ball.vx += ax * h;
  ball.vy += ay * h;

  // Nopeusrajoitin (numeerinen turvaraja)
  const s2 = Math.hypot(ball.vx, ball.vy);
  if (s2 > MAX_SPEED) {
    ball.vx = (ball.vx / s2) * MAX_SPEED;
    ball.vy = (ball.vy / s2) * MAX_SPEED;
  }

  // 4) Kierteen vaimennus
  ball.w *= Math.exp(-SPIN_DAMP * surf.mu * h);

  // 5) Sijainnin integrointi
  ball.x += ball.vx * h;
  ball.y += ball.vy * h;

  // 6) Pysähtymisen tunnistus: hidas eikä mitään mikä kiihdyttäisi uudelleen
  const finalSpeed = Math.hypot(ball.vx, ball.vy);
  const drive = Math.hypot(surf.ax, surf.ay);
  if (finalSpeed < REST_SPEED && drive < surf.mu * GRAVITY) {
    ball.restTimer += h;
    if (ball.restTimer >= REST_TIME) {
      ball.vx = 0;
      ball.vy = 0;
      ball.w = 0;
      ball.resting = true;
    }
  } else {
    ball.restTimer = 0;
    ball.resting = false;
  }
}

function resolveCollisions(ball, world, h, events) {
  const segments = world.segments;
  for (let i = 0; i < segments.length; i++) {
    collideSegment(ball, segments[i], world, events);
  }
  const circles = world.circles;
  for (let i = 0; i < circles.length; i++) {
    collideCircle(ball, circles[i], world, events);
  }
}

function collideSegment(ball, seg, world, events) {
  const abx = seg.bx - seg.ax;
  const aby = seg.by - seg.ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((ball.x - seg.ax) * abx + (ball.y - seg.ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const px = seg.ax + abx * t;
  const py = seg.ay + aby * t;
  let dx = ball.x - px;
  let dy = ball.y - py;
  let dist = Math.hypot(dx, dy);
  const contactDist = BALL_RADIUS + (seg.t || 0);
  if (dist >= contactDist) return;

  if (dist < 1e-9) {
    // Pallon keskipiste tasan segmentillä: käytä segmentin normaalia.
    const l = Math.sqrt(len2) || 1;
    dx = -aby / l;
    dy = abx / l;
    dist = 1e-9;
  }
  const nx = dx / dist;
  const ny = dy / dist;

  // Työnnä pallo pois seinän sisältä
  const push = contactDist - dist;
  ball.x += nx * (push + 1e-6);
  ball.y += ny * (push + 1e-6);

  const wall = seg.velocityAt ? seg.velocityAt(px, py) : ZERO_VEL;
  applyContactImpulse(ball, nx, ny, wall, seg.e, seg.mu, world, events);
}

function collideCircle(ball, circle, world, events) {
  let dx = ball.x - circle.x;
  let dy = ball.y - circle.y;
  let dist = Math.hypot(dx, dy);
  const contactDist = BALL_RADIUS + circle.r;
  if (dist >= contactDist) return;
  if (dist < 1e-9) {
    dx = 0;
    dy = -1;
    dist = 1e-9;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  ball.x += nx * (contactDist - dist + 1e-6);
  ball.y += ny * (contactDist - dist + 1e-6);

  const wall = circle.velocityAt
    ? circle.velocityAt(circle.x + nx * circle.r, circle.y + ny * circle.r)
    : ZERO_VEL;
  applyContactImpulse(ball, nx, ny, wall, circle.e, circle.mu, world, events);
}

const ZERO_VEL = { x: 0, y: 0 };

/**
 * Kimmoisa törmäys + Coulombin kitkaimpulssi kosketuspisteessä.
 * n osoittaa seinästä palloon päin.
 */
function applyContactImpulse(ball, nx, ny, wallVel, e, mu, world, events) {
  // Tangentti = normaali käännettynä +90°
  const tx = -ny;
  const ty = nx;

  // Suhteellinen nopeus seinään nähden
  const rvx = ball.vx - wallVel.x;
  const rvy = ball.vy - wallVel.y;
  const vn = rvx * nx + rvy * ny;

  if (vn > 0) return; // erkanee jo, ei impulssia

  // Normaali-impulssi
  const jn = -(1 + e) * vn * BALL_MASS;
  ball.vx += (jn / BALL_MASS) * nx;
  ball.vy += (jn / BALL_MASS) * ny;

  // Kosketuspisteen tangentiaalinen nopeus:
  // v_kosketus = v + ω ẑ × r_vec,  r_vec = -n * R  =>  tangentiaalisesti v·t - ω R
  const vt = rvx * tx + rvy * ty - ball.w * BALL_RADIUS;

  // Liukumisen pysäyttävä impulssi jäykälle pallolle:
  // j = -vt / (1/m + R²/I)   (R²/I = 5/(2m))
  const denom = 1 / BALL_MASS + (BALL_RADIUS * BALL_RADIUS) / BALL_INERTIA;
  let jt = -vt / denom;
  const maxFriction = mu * Math.abs(jn);
  if (Math.abs(jt) > maxFriction) jt = Math.sign(jt) * maxFriction;

  ball.vx += (jt / BALL_MASS) * tx;
  ball.vy += (jt / BALL_MASS) * ty;
  // Momentti: r_vec × F  =>  -R * jt
  ball.w += (-BALL_RADIUS * jt) / BALL_INERTIA;

  ball.resting = false;
  ball.restTimer = 0;

  const impact = Math.abs(vn);
  if (impact > 0.25) {
    events.push({ type: 'bounce', x: ball.x, y: ball.y, impact });
  }
}

function checkCup(ball, world, events) {
  const cup = world.cup;
  const dx = ball.x - cup.x;
  const dy = ball.y - cup.y;
  const dist = Math.hypot(dx, dy);
  const speed = Math.hypot(ball.vx, ball.vy);

  if (dist < cup.r - BALL_RADIUS * 0.35) {
    if (speed < cup.captureSpeed) {
      ball.vx = 0;
      ball.vy = 0;
      ball.w = 0;
      ball.resting = true;
      ball.x = cup.x;
      ball.y = cup.y;
      events.push({ type: 'holed', speed });
      return true;
    }
    // Liian kova vauhti: pallo kiertää reunan (lip out) ja hidastuu.
    const nx = dist > 1e-9 ? dx / dist : 1;
    const ny = dist > 1e-9 ? dy / dist : 0;
    const steer = 0.55;
    ball.vx -= nx * steer * speed * 0.12;
    ball.vy -= ny * steer * speed * 0.12;
    ball.vx *= 0.94;
    ball.vy *= 0.94;
    events.push({ type: 'lipout', x: ball.x, y: ball.y });
  }
  return false;
}

function checkHazards(ball, world, events) {
  const surf = world.surfaceAt(ball.x, ball.y);
  if (surf.water) {
    events.push({ type: 'water', x: ball.x, y: ball.y });
    return true;
  }
  if (!world.contains(ball.x, ball.y)) {
    events.push({ type: 'out', x: ball.x, y: ball.y });
    return true;
  }
  return false;
}
