// Radan geometrian kääntäminen fysiikkamoottorin ymmärtämään muotoon.
//
// Kaikki seinät esitetään janoina (segments). Jana törmää palloon kummalta
// puolelta tahansa, joten sama esitys käy sekä radan ulkoreunalle että radan
// sisällä oleville esteille.

export const SURFACES = {
  green: { mu: 0.115, grip: 1.0, name: 'viheriö' },
  rough: { mu: 0.33, grip: 1.0, name: 'karheikko' },
  sand: { mu: 0.62, grip: 1.2, name: 'hiekka' },
  ice: { mu: 0.035, grip: 0.35, name: 'jää' },
};

const DEFAULT_WALL = { e: 0.82, mu: 0.28 };
const CUP_RADIUS = 0.056; // oikean minigolfreiän mitta (halkaisija 11 cm)
const CUP_CAPTURE_SPEED = 1.3; // tätä kovempaa pallo pyyhkäisee reiän yli

export function buildWorld(hole) {
  return new World(hole);
}

export class World {
  constructor(hole) {
    this.hole = hole;
    this.time = 0;
    this.boundary = hole.boundary;
    this.width = hole.width ?? 3.6;
    this.height = hole.height ?? 8.0;

    this.staticSegments = [];
    this.staticCircles = [];
    this.bounds = boundsOf(hole.boundary);

    // Ulkoreuna
    addPolygonSegments(this.staticSegments, hole.boundary, {
      e: hole.wallRestitution ?? DEFAULT_WALL.e,
      mu: DEFAULT_WALL.mu,
      t: 0,
      kind: 'rail',
    });

    // Kiinteät esteet
    for (const ob of hole.obstacles || []) {
      if (ob.poly) {
        addPolygonSegments(this.staticSegments, ob.poly, {
          e: ob.e ?? DEFAULT_WALL.e,
          mu: ob.mu ?? DEFAULT_WALL.mu,
          t: 0,
          kind: ob.kind || 'block',
        });
      } else if (ob.circle) {
        this.staticCircles.push({
          x: ob.circle[0],
          y: ob.circle[1],
          r: ob.circle[2],
          e: ob.e ?? 0.9,
          mu: ob.mu ?? 0.2,
          kind: ob.kind || 'post',
        });
      }
    }

    this.movers = (hole.movers || []).map(createMover);
    this.zones = hole.zones || [];

    this.cup = {
      x: hole.cup[0],
      y: hole.cup[1],
      r: CUP_RADIUS,
      captureSpeed: CUP_CAPTURE_SPEED,
    };
    this.tee = { x: hole.tee[0], y: hole.tee[1] };

    this.segments = this.staticSegments.slice();
    this.circles = this.staticCircles.slice();
    this.advance(0);
  }

  /** Siirtää liikkuvat esteet eteenpäin ja kokoaa törmäyslistat uudelleen. */
  advance(dt) {
    this.time += dt;
    if (this.movers.length === 0) return;
    this.segments = this.staticSegments.slice();
    this.circles = this.staticCircles.slice();
    for (const mover of this.movers) {
      mover.update(this.time);
      for (const s of mover.segments) this.segments.push(s);
      for (const c of mover.circles) this.circles.push(c);
    }
  }

  /** Pinnan ominaisuudet pisteessä: kitka, kiihtyvyys, vesi. */
  surfaceAt(x, y) {
    let mu = SURFACES.green.mu;
    let grip = SURFACES.green.grip;
    let ax = 0;
    let ay = 0;
    let water = false;
    let type = 'green';

    for (const zone of this.zones) {
      if (!zoneContains(zone, x, y)) continue;
      if (zone.type === 'water') {
        water = true;
        type = 'water';
        continue;
      }
      if (zone.type === 'slope' || zone.type === 'boost') {
        ax += zone.ax || 0;
        ay += zone.ay || 0;
        if (zone.type === 'boost') type = 'boost';
        continue;
      }
      const surf = SURFACES[zone.type];
      if (surf) {
        // Myöhempi pintavyöhyke voittaa aiemman, myös veden: näin veden
        // päälle voi piirtää saaren tai kannaksen.
        mu = surf.mu;
        grip = surf.grip;
        type = zone.type;
        water = false;
      }
    }
    return { mu, grip, ax, ay, water, type };
  }

  contains(x, y) {
    return pointInPolygon(this.boundary, x, y);
  }
}

// --- Geometria-apurit -------------------------------------------------------

function addPolygonSegments(list, poly, opts) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    list.push({
      ax: a[0],
      ay: a[1],
      bx: b[0],
      by: b[1],
      e: opts.e,
      mu: opts.mu,
      t: opts.t || 0,
      kind: opts.kind,
    });
  }
}

function boundsOf(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function zoneContains(zone, x, y) {
  if (zone.rect) {
    const [rx, ry, rw, rh] = zone.rect;
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
  if (zone.circle) {
    const [cx, cy, cr] = zone.circle;
    return Math.hypot(x - cx, y - cy) <= cr;
  }
  if (zone.poly) return pointInPolygon(zone.poly, x, y);
  return false;
}

/** Suorakulmio nelikulmiona (myötäpäivään ruutukoordinaateissa). */
export function box(x, y, w, h) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

// --- Liikkuvat esteet -------------------------------------------------------

function createMover(spec) {
  if (spec.kind === 'rotor') return new Rotor(spec);
  if (spec.kind === 'slider') return new Slider(spec);
  throw new Error('Tuntematon liikkuva este: ' + spec.kind);
}

/** Pyörivä myllynsiipi: n kappaletta janoja navan ympärillä. */
class Rotor {
  constructor(spec) {
    this.spec = spec;
    this.pivot = spec.pivot;
    this.count = spec.count ?? 3;
    this.len = spec.len ?? 0.9;
    this.omega = spec.omega ?? 1.5;
    this.phase = spec.phase ?? 0;
    this.thickness = spec.thickness ?? 0.045;
    this.angle = this.phase;
    this.segments = [];
    this.circles = [
      {
        x: this.pivot[0],
        y: this.pivot[1],
        r: spec.hubRadius ?? 0.09,
        e: 0.75,
        mu: 0.3,
        kind: 'hub',
      },
    ];
    for (let i = 0; i < this.count; i++) {
      this.segments.push({
        ax: 0,
        ay: 0,
        bx: 0,
        by: 0,
        e: spec.e ?? 0.72,
        mu: spec.mu ?? 0.35,
        t: this.thickness,
        kind: 'blade',
        velocityAt: (px, py) => this.velocityAt(px, py),
      });
    }
    this.update(0);
  }

  velocityAt(px, py) {
    // v = ω ẑ × r
    const rx = px - this.pivot[0];
    const ry = py - this.pivot[1];
    return { x: -this.omega * ry, y: this.omega * rx };
  }

  update(time) {
    this.angle = this.phase + this.omega * time;
    for (let i = 0; i < this.count; i++) {
      const a = this.angle + (i * Math.PI * 2) / this.count;
      const seg = this.segments[i];
      seg.ax = this.pivot[0];
      seg.ay = this.pivot[1];
      seg.bx = this.pivot[0] + Math.cos(a) * this.len;
      seg.by = this.pivot[1] + Math.sin(a) * this.len;
    }
  }
}

/** Edestakaisin liukuva palkki. */
class Slider {
  constructor(spec) {
    this.spec = spec;
    this.base = spec.rect; // [x, y, w, h] keskiasennossa
    this.axis = normalize(spec.axis ?? [1, 0]);
    this.amp = spec.amp ?? 0.6;
    this.omega = spec.omega ?? 1.0;
    this.phase = spec.phase ?? 0;
    this.offset = 0;
    this.vel = { x: 0, y: 0 };
    this.circles = [];
    this.segments = [];
    for (let i = 0; i < 4; i++) {
      this.segments.push({
        ax: 0,
        ay: 0,
        bx: 0,
        by: 0,
        e: spec.e ?? 0.8,
        mu: spec.mu ?? 0.3,
        t: 0,
        kind: 'slider',
        velocityAt: () => this.vel,
      });
    }
    this.update(0);
  }

  update(time) {
    const s = Math.sin(this.phase + this.omega * time);
    const c = Math.cos(this.phase + this.omega * time);
    this.offset = this.amp * s;
    this.vel = {
      x: this.axis[0] * this.amp * this.omega * c,
      y: this.axis[1] * this.amp * this.omega * c,
    };
    const [x, y, w, h] = this.base;
    const ox = x + this.axis[0] * this.offset;
    const oy = y + this.axis[1] * this.offset;
    this.rect = [ox, oy, w, h];
    const pts = box(ox, oy, w, h);
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const seg = this.segments[i];
      seg.ax = a[0];
      seg.ay = a[1];
      seg.bx = b[0];
      seg.by = b[1];
    }
  }
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
