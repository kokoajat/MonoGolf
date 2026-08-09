// 18 minigolfväylää.
//
// Väylät piirretään ruudukkoyksiköissä (3,6 x 8,0) ja skaalataan lopuksi
// oikeaan minigolf-mittakaavaan: 1,62 m x 3,60 m. Näin golfpallon todellinen
// halkaisija (4,3 cm) on järkevässä suhteessa väylän leveyteen, aivan kuten
// oikealla minigolfradalla.

import { box } from './world.js';

const W = 3.6;
const H = 8.0;
/** Ruudukkoyksiköstä metriksi. */
const SCALE = 0.45;
const M = 0.25; // reunuksen leveys
const L = M; // vasen reuna
const R = W - M; // oikea reuna
const T = 0.4; // yläreuna
const B = H - 0.3; // alareuna

/** Perusväylä: suorakaide pyöristetyin kulmin, jotta nurkista saa kimmokkeita. */
function frame(radius = 0.5) {
  return roundedRect(L, T, R - L, B - T, radius);
}

/** Kapselinmuotoinen väylä: päädyt puoliympyröinä. */
function stadium(inset = 0.25) {
  const x = L + inset;
  const w = R - L - inset * 2;
  return roundedRect(x, T, w, B - T, w / 2, 10);
}


// --- Muotoapurit ------------------------------------------------------------

/** Kaaren pisteet. Kulmat radiaaneina, y kasvaa alaspäin. */
function arcPoints(cx, cy, r, a0, a1, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function circlePoly(cx, cy, r, steps = 40) {
  return arcPoints(cx, cy, r, 0, Math.PI * 2 - (Math.PI * 2) / steps, steps - 1);
}

/** Pyöristetty suorakaide. Säde r leikkautuu automaattisesti sopivaksi. */
function roundedRect(x, y, w, h, r, steps = 6) {
  const rad = Math.min(r, w / 2, h / 2);
  return [
    ...arcPoints(x + w - rad, y + rad, rad, -Math.PI / 2, 0, steps),
    ...arcPoints(x + w - rad, y + h - rad, rad, 0, Math.PI / 2, steps),
    ...arcPoints(x + rad, y + h - rad, rad, Math.PI / 2, Math.PI, steps),
    ...arcPoints(x + rad, y + rad, rad, Math.PI, Math.PI * 1.5, steps),
  ];
}

/** Kaareva seinä: ulkokaari ja sisäkaari yhdeksi renkaan palaksi. */
function arcWall(cx, cy, r, a0, a1, thickness = 0.22, steps = 14) {
  return {
    poly: [
      ...arcPoints(cx, cy, r + thickness / 2, a0, a1, steps),
      ...arcPoints(cx, cy, r - thickness / 2, a1, a0, steps),
    ],
  };
}

const deg = (d) => (d * Math.PI) / 180;
const sandCircle = (x, y, r) => ({ type: 'sand', circle: [x, y, r] });
const waterCircle = (x, y, r) => ({ type: 'water', circle: [x, y, r] });

const rect = (x, y, w, h) => ({ poly: box(x, y, w, h) });
const post = (x, y, r, opts = {}) => ({ circle: [x, y, r], ...opts });
const sand = (x, y, w, h) => ({ type: 'sand', rect: [x, y, w, h] });
const water = (x, y, w, h) => ({ type: 'water', rect: [x, y, w, h] });
const ice = (x, y, w, h) => ({ type: 'ice', rect: [x, y, w, h] });
const rough = (x, y, w, h) => ({ type: 'rough', rect: [x, y, w, h] });
const slope = (x, y, w, h, ax, ay) => ({ type: 'slope', rect: [x, y, w, h], ax, ay });
const boost = (x, y, w, h, ax, ay) => ({ type: 'boost', rect: [x, y, w, h], ax, ay });

const DESIGNS = [
  // 1 --------------------------------------------------------------------
  {
    name: 'Avaus',
    par: 2,
    hint: 'Suora väylä. Kokeile heilautuksen voimakkuutta – pallo kimpoaa laidoista.',
    boundary: frame(),
    obstacles: [],
    zones: [],
    tee: [1.8, 7.0],
    cup: [1.8, 1.2],
  },

  // 2 --------------------------------------------------------------------
  {
    name: 'Portti',
    par: 2,
    hint: 'Kaksi kapeaa aukkoa pylväiden välissä. Suoraan keskeltä ei pääse.',
    boundary: frame(),
    obstacles: [
      post(1.8, 4.15, 0.52),
      post(0.52, 4.15, 0.28),
      post(3.08, 4.15, 0.28),
    ],
    zones: [],
    tee: [1.8, 7.0],
    cup: [1.8, 1.3],
  },

  // 3 --------------------------------------------------------------------
  {
    name: 'Kulma',
    par: 3,
    hint: 'Käytä laitakimmoketta kulman kiertämiseen.',
    boundary: [
      [L, B],
      [L, 2.05],
      [R, 2.05],
      [R, 3.65],
      [1.55, 3.65],
      [1.55, B],
    ],
    obstacles: [],
    zones: [rough(1.6, 2.1, 0.5, 1.5)],
    tee: [0.9, 7.2],
    cup: [2.9, 2.85],
  },

  // 4 --------------------------------------------------------------------
  {
    name: 'Vastakulma',
    par: 3,
    hint: 'Kulmassa oleva tolppa on kaveri – kimmota siitä vasemmalle.',
    boundary: [
      [R, B],
      [R, 2.05],
      [L, 2.05],
      [L, 3.65],
      [2.05, 3.65],
      [2.05, B],
    ],
    obstacles: [post(2.42, 2.62, 0.2, { e: 0.94 })],
    zones: [],
    tee: [2.7, 7.2],
    cup: [0.85, 2.85],
  },

  // 5 --------------------------------------------------------------------
  {
    name: 'Kapeikko',
    par: 3,
    hint: 'Kaksi porrastettua aukkoa. Vauhti pois, muuten kimpoat takaisin.',
    boundary: frame(),
    obstacles: [
      rect(L, 5.5, 1.55, 0.28),
      rect(2.35, 5.5, 1.0, 0.28),
      rect(L, 3.5, 1.0, 0.28),
      rect(1.8, 3.5, 1.55, 0.28),
    ],
    zones: [],
    tee: [1.8, 7.0],
    cup: [1.8, 1.3],
  },

  // 6 --------------------------------------------------------------------
  {
    name: 'Kimmoke',
    par: 3,
    hint: 'Kaarevat seinät ohjaavat kimmokkeen. Suoraa linjaa ei ole.',
    boundary: frame(),
    obstacles: [
      arcWall(0.6, 4.4, 2.1, deg(-72), deg(6), 0.26),
      arcWall(3.0, 2.3, 2.1, deg(108), deg(186), 0.26),
    ],
    zones: [],
    tee: [1.8, 7.0],
    cup: [0.72, 1.25],
  },

  // 7 --------------------------------------------------------------------
  {
    name: 'Hiekkasärkät',
    par: 3,
    hint: 'Hiekassa pallo pysähtyy nopeasti. Kierrä särkät.',
    boundary: frame(),
    obstacles: [post(1.8, 4.35, 0.18)],
    zones: [
      sandCircle(0.95, 5.6, 0.72),
      sandCircle(2.6, 4.0, 0.78),
      sandCircle(1.35, 2.35, 0.62),
      sandCircle(2.95, 6.2, 0.45),
    ],
    tee: [1.0, 7.0],
    cup: [2.7, 1.3],
  },

  // 8 --------------------------------------------------------------------
  {
    name: 'Vesieste',
    par: 3,
    hint: 'Kapea silta keskellä. Vesi maksaa rangaistuslyönnin.',
    boundary: frame(),
    obstacles: [],
    zones: [water(L, 3.3, 1.25, 1.1), water(2.1, 3.3, 1.25, 1.1)],
    tee: [1.8, 7.0],
    cup: [1.8, 1.2],
  },

  // 9 --------------------------------------------------------------------
  {
    name: 'Mylly',
    par: 3,
    hint: 'Ajoita lyönti siipien väliin.',
    boundary: frame(),
    obstacles: [rect(L, 3.6, 0.55, 0.4), rect(2.8, 3.6, 0.55, 0.4)],
    zones: [],
    movers: [{ kind: 'rotor', pivot: [1.8, 3.8], count: 3, len: 1.0, omega: 1.5 }],
    tee: [1.8, 7.0],
    cup: [1.8, 1.2],
  },

  // 10 -------------------------------------------------------------------
  {
    name: 'Ylämäki',
    par: 3,
    hint: 'Rinne valuttaa pallon takaisin. Tarvitset vauhtia – muttet liikaa.',
    boundary: frame(),
    obstacles: [rect(L, 2.35, 1.0, 0.25), rect(2.35, 2.35, 1.0, 0.25)],
    // Rinteen kiihtyvyys on selvästi yli viheriön vierintävastuksen (1,13 m/s²),
    // joten pallo todella kiihtyy alamäkeen eikä jää ryömimään.
    zones: [slope(L, 2.6, 3.1, 2.7, 0, 2.0)],
    tee: [1.8, 7.0],
    cup: [1.8, 1.35],
  },

  // 11 -------------------------------------------------------------------
  {
    name: 'Flipperi',
    par: 3,
    hint: 'Pyöreä areena ja kimmoisat tolpat. Pehmeä lyönti kannattaa.',
    boundary: stadium(0.1),
    obstacles: [
      post(1.0, 5.0, 0.22, { e: 0.95 }),
      post(2.6, 5.0, 0.22, { e: 0.95 }),
      post(1.8, 3.9, 0.26, { e: 0.95 }),
      post(0.9, 2.9, 0.2, { e: 0.95 }),
      post(2.7, 2.9, 0.2, { e: 0.95 }),
    ],
    zones: [],
    tee: [1.8, 7.0],
    cup: [1.8, 1.15],
  },

  // 12 -------------------------------------------------------------------
  {
    name: 'Siksak',
    par: 4,
    hint: 'Neljä vinoa mutkaa. Malta pitää vauhti kurissa.',
    boundary: frame(),
    // Vinot seinät ohjaavat kimmokkeen seuraavaan aukkoon.
    obstacles: [
      { poly: [[L, 6.15], [2.65, 5.75], [2.65, 6.0], [L, 6.4]] },
      { poly: [[0.95, 4.45], [R, 4.85], [R, 5.1], [0.95, 4.7]] },
      { poly: [[L, 3.55], [2.65, 3.15], [2.65, 3.4], [L, 3.8]] },
      { poly: [[0.95, 1.85], [R, 2.25], [R, 2.5], [0.95, 2.1]] },
    ],
    zones: [],
    tee: [1.8, 7.3],
    cup: [1.8, 1.2],
  },

  // 13 -------------------------------------------------------------------
  {
    name: 'Liukuovet',
    par: 4,
    hint: 'Kaksi liikkuvaa palkkia. Odota aukkoa – ja huomioi että palkki myös lyö palloa.',
    boundary: frame(),
    obstacles: [],
    zones: [],
    // Liikeradan ääripäissä palkin ja laidan väliin jää aina yli 0,3 m,
    // joten pallo ei voi jäädä puristuksiin.
    movers: [
      { kind: 'slider', rect: [1.15, 5.3, 1.3, 0.25], axis: [1, 0], amp: 0.6, omega: 1.1 },
      {
        kind: 'slider',
        rect: [1.15, 3.4, 1.3, 0.25],
        axis: [1, 0],
        amp: 0.6,
        omega: 1.35,
        phase: Math.PI,
      },
    ],
    tee: [1.8, 7.0],
    cup: [1.8, 1.2],
  },

  // 14 -------------------------------------------------------------------
  {
    name: 'Saari',
    par: 3,
    hint: 'Pyöreä lampi ja sen keskellä saari. Kapeat kannakset kiertävät reunoja.',
    boundary: frame(),
    obstacles: [],
    zones: [
      // Rengasmainen lampi. Keskellä oleva saari ja sinne johtava kapea
      // kannas piirretään veden päälle: myöhempi vyöhyke voittaa.
      waterCircle(1.8, 3.1, 1.42),
      { type: 'green', circle: [1.8, 3.1, 0.66] },
      // Kannas päättyy rantaviivaan, ei sen yli.
      { type: 'green', rect: [1.62, 3.1, 0.36, 1.47] },
      waterCircle(0.62, 5.5, 0.42),
      waterCircle(2.98, 5.5, 0.42),
    ],
    tee: [1.8, 7.0],
    cup: [1.8, 3.1],
  },

  // 15 -------------------------------------------------------------------
  {
    name: 'Jäärata',
    par: 3,
    hint: 'Jäällä pallo ei hidastu juuri lainkaan. Hiekkakulmat pysäyttävät.',
    boundary: frame(),
    obstacles: [post(1.8, 4.2, 0.25)],
    zones: [ice(L, 1.8, 3.1, 4.2), sand(L, 1.0, 0.8, 0.8), sand(2.55, 1.0, 0.8, 0.8)],
    tee: [1.8, 7.2],
    cup: [1.8, 1.35],
  },

  // 16 -------------------------------------------------------------------
  {
    name: 'Spiraali',
    par: 4,
    hint: 'Sisään alhaalta, kierros rengasta pitkin ja sisäkehälle ylhäältä.',
    boundary: frame(),
    obstacles: [
      // Ulkokehä: aukko alhaalla, muuten umpinainen renkaan pala.
      arcWall(1.8, 3.4, 1.42, deg(110), deg(430), 0.22, 40),
      // Sisäkehä: aukko ylhäällä, vastakkaisella puolella.
      arcWall(1.8, 3.4, 0.72, deg(290), deg(610), 0.2, 28),
    ],
    zones: [],
    tee: [1.8, 7.0],
    cup: [1.8, 3.4],
  },

  // 17 -------------------------------------------------------------------
  {
    name: 'Risteys',
    par: 4,
    hint: 'Oikealla kiihdytyslaatta ja vesi, vasemmalla hidas mutta turvallinen reitti.',
    boundary: frame(),
    obstacles: [rect(1.7, 2.2, 0.2, 3.6), rect(L, 4.4, 0.85, 0.2)],
    zones: [
      boost(2.05, 5.0, 0.85, 0.6, 0, -7.5),
      water(2.55, 3.0, 0.8, 1.05),
      sand(0.4, 3.1, 0.75, 1.0),
    ],
    tee: [1.8, 7.2],
    cup: [1.8, 1.1],
  },

  // 18 -------------------------------------------------------------------
  {
    name: 'Finaali',
    par: 5,
    hint: 'Tolpat, liukuovi, vesi ja mylly. Onnea matkaan.',
    boundary: frame(),
    obstacles: [post(1.1, 6.0, 0.2, { e: 0.95 }), post(2.5, 6.0, 0.2, { e: 0.95 })],
    zones: [
      water(L, 3.6, 1.3, 0.8),
      water(2.05, 3.6, 1.3, 0.8),
      slope(L, 1.3, 3.1, 1.5, 0, 1.5),
    ],
    movers: [
      { kind: 'slider', rect: [1.2, 4.8, 1.2, 0.24], axis: [1, 0], amp: 0.65, omega: 1.25 },
      { kind: 'rotor', pivot: [1.8, 2.45], count: 3, len: 0.72, omega: 2.0, hubRadius: 0.08 },
    ],
    tee: [1.8, 7.3],
    cup: [1.8, 0.95],
  },
];

// --- Skaalaus ---------------------------------------------------------------

const sp = (p) => [p[0] * SCALE, p[1] * SCALE];
const spoly = (poly) => poly.map(sp);
const srect = (r) => [r[0] * SCALE, r[1] * SCALE, r[2] * SCALE, r[3] * SCALE];

/**
 * Skaalaa väylän geometrian metreiksi.
 *
 * Pituudet kerrotaan SCALElla, mutta kiihtyvyyksiä (kaltevuus, kiihdytyslaatta)
 * ei: g·sin θ ei riipu radan koosta, ja koska lyöntinopeudet skaalautuvat
 * kertoimella √SCALE, vaikutus säilyy samana suhteessa lyöntiin.
 *
 * Liikkuvien esteiden kulmanopeus kerrotaan 1/√SCALE:lla, jotta ajoitus
 * pysyy yhtä tiukkana kuin suunnitellussa mittakaavassa.
 */
function scaleHole(hole) {
  const timeScale = 1 / Math.sqrt(SCALE);
  return {
    ...hole,
    width: W * SCALE,
    height: H * SCALE,
    boundary: spoly(hole.boundary),
    tee: sp(hole.tee),
    cup: sp(hole.cup),
    obstacles: (hole.obstacles || []).map((ob) =>
      ob.poly
        ? { ...ob, poly: spoly(ob.poly) }
        : { ...ob, circle: [ob.circle[0] * SCALE, ob.circle[1] * SCALE, ob.circle[2] * SCALE] },
    ),
    zones: (hole.zones || []).map((z) => {
      const out = { ...z };
      if (z.rect) out.rect = srect(z.rect);
      if (z.poly) out.poly = spoly(z.poly);
      if (z.circle) out.circle = [z.circle[0] * SCALE, z.circle[1] * SCALE, z.circle[2] * SCALE];
      return out;
    }),
    movers: (hole.movers || []).map((m) => {
      const out = { ...m, omega: (m.omega ?? 1) * timeScale };
      if (m.pivot) out.pivot = sp(m.pivot);
      if (m.len != null) out.len = m.len * SCALE;
      if (m.kind === 'rotor') {
        out.thickness = (m.thickness ?? 0.05) * SCALE;
        out.hubRadius = (m.hubRadius ?? 0.09) * SCALE;
      }
      if (m.rect) out.rect = srect(m.rect);
      if (m.amp != null) out.amp = m.amp * SCALE;
      return out;
    }),
  };
}

export const COURSES = DESIGNS.map(scaleHole);
export const TOTAL_PAR = COURSES.reduce((sum, c) => sum + c.par, 0);
export const COURSE_WIDTH = W * SCALE;
export const COURSE_HEIGHT = H * SCALE;
export const DESIGN_SCALE = SCALE;
