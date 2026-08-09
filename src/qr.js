// QR-koodin muodostus ilman ulkoisia kirjastoja.
//
// Tukee tavutilaa (byte mode) ja virheenkorjaustasoja L/M/Q/H, versiot 1–40.
// Palauttaa moduulimatriisin, jonka piirtäminen jää kutsujalle.
//
// Toteutus noudattaa ISO/IEC 18004 -standardia siltä osin kuin tavutila
// vaatii: tietojen koodaus, Reed–Solomon-korjaus, lohkojen lomitus,
// moduulien sijoittelu, kahdeksan maskin pisteytys ja muotoilutiedot.

// --- Galois'n kunta GF(256), generaattori 0x11d -----------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Reed–Solomon-generaattoripolynomi asteelle n. */
function rsGenerator(n) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

// --- Versiotaulukot ---------------------------------------------------------

// [ec-tavuja per lohko, ryhmän 1 lohkot, ryhmän 2 lohkot] tasoille L,M,Q,H.
// Ryhmän 2 lohkoissa on yksi datatavu enemmän kuin ryhmän 1 lohkoissa.
// prettier-ignore
const EC_TABLE = {
  L: [[7,1,0],[10,1,0],[15,1,0],[20,1,0],[26,1,0],[18,2,0],[20,2,0],[24,2,0],[30,2,0],[18,2,2],
      [20,4,0],[24,2,2],[26,4,0],[30,3,1],[22,5,1],[24,5,1],[28,1,5],[30,5,1],[28,3,4],[28,3,5],
      [28,4,4],[28,2,7],[30,4,5],[30,6,4],[26,8,4],[28,10,2],[30,8,4],[30,3,10],[30,7,7],[30,5,10],
      [30,13,3],[30,17,0],[30,17,1],[30,13,6],[30,12,7],[30,6,14],[30,17,4],[30,4,18],[30,20,4],[30,19,6]],
  M: [[10,1,0],[16,1,0],[26,1,0],[18,2,0],[24,2,0],[16,4,0],[18,4,0],[22,2,2],[22,3,2],[26,4,1],
      [30,1,4],[22,6,2],[22,8,1],[24,4,5],[24,5,5],[28,7,3],[28,10,1],[26,9,4],[26,3,11],[26,3,13],
      [26,17,0],[28,17,0],[28,4,14],[28,6,14],[28,8,13],[28,19,4],[28,22,3],[28,3,23],[28,21,7],[28,19,10],
      [28,2,29],[28,10,23],[28,14,21],[28,14,23],[28,12,26],[28,6,34],[28,29,14],[28,13,32],[28,40,7],[28,18,31]],
  Q: [[13,1,0],[22,1,0],[18,2,0],[26,2,0],[18,2,2],[24,4,0],[18,2,4],[22,4,2],[20,4,4],[24,6,2],
      [28,4,4],[26,4,6],[24,8,4],[20,11,5],[30,5,7],[24,15,2],[28,1,15],[28,17,1],[26,17,4],[30,15,5],
      [28,17,6],[30,7,16],[30,11,14],[30,11,16],[30,7,22],[28,28,6],[30,8,26],[30,4,31],[30,1,37],[30,15,25],
      [30,42,1],[30,10,35],[30,29,19],[30,44,7],[30,39,14],[30,46,10],[30,49,10],[30,48,14],[30,43,22],[30,34,34]],
  H: [[17,1,0],[28,1,0],[22,2,0],[16,4,0],[22,2,2],[28,4,0],[26,4,1],[26,4,2],[24,4,4],[28,6,2],
      [24,3,8],[28,7,4],[22,12,4],[24,11,5],[24,11,7],[30,3,13],[28,2,17],[28,2,19],[26,9,16],[28,15,10],
      [30,19,6],[24,34,0],[30,16,14],[30,30,2],[30,22,13],[30,33,4],[30,12,28],[30,11,31],[30,19,26],[30,23,25],
      [30,23,28],[30,19,35],[30,11,46],[30,59,1],[30,22,41],[30,2,64],[30,24,46],[30,42,32],[30,10,67],[30,20,61]],
};

// Kokonaiskoodisanat versioittain (data + virheenkorjaus).
// prettier-ignore
const TOTAL_CODEWORDS = [
  26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,
  1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706,
];

// Kohdistuskuvioiden keskipisteet versioittain.
// prettier-ignore
const ALIGN_POS = [
  [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
  [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
  [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
  [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170],
];

const EC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

function dataCodewords(version, level) {
  const [ecPerBlock, g1, g2] = EC_TABLE[level][version - 1];
  return TOTAL_CODEWORDS[version - 1] - ecPerBlock * (g1 + g2);
}

/** Pienin versio, johon annettu tavumäärä mahtuu tavutilassa. */
function chooseVersion(byteLength, level) {
  for (let v = 1; v <= 40; v++) {
    const countBits = v < 10 ? 8 : 16;
    const capacity = dataCodewords(v, level) * 8 - 4 - countBits;
    if (byteLength * 8 <= capacity) return v;
  }
  return null;
}

// --- Bittivirta -------------------------------------------------------------

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3] |= 0x80 >> (i & 7);
    });
    return out;
  }
}

function buildCodewords(bytes, version, level) {
  const capacity = dataCodewords(version, level);
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // tavutila
  buf.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) buf.put(b, 8);

  // Lopetusmerkki ja tasaus tavurajaan
  const limit = capacity * 8;
  for (let i = 0; i < 4 && buf.length < limit; i++) buf.bits.push(0);
  while (buf.length % 8 !== 0) buf.bits.push(0);

  const data = new Uint8Array(capacity);
  data.set(buf.toBytes().subarray(0, capacity));
  // Täytetavut vuorotellen 0xEC ja 0x11
  const used = buf.toBytes().length;
  for (let i = used; i < capacity; i++) data[i] = i % 2 === used % 2 ? 0xec : 0x11;

  // Lohkotus ja lomitus
  const [ecPerBlock, g1, g2] = EC_TABLE[level][version - 1];
  const blocks = [];
  const shortLen = Math.floor(capacity / (g1 + g2));
  let offset = 0;
  for (let i = 0; i < g1 + g2; i++) {
    const len = i < g1 ? shortLen : shortLen + 1;
    const chunk = data.subarray(offset, offset + len);
    offset += len;
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecPerBlock) });
  }

  const result = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) result.push(b.ec[i]);
  }
  return result;
}

// --- Matriisi ---------------------------------------------------------------

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1));

  const setFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[rr][cc] = edge || core ? 1 : 0;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Ajoituskuviot
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    modules[6][i] = v;
    modules[i][6] = v;
  }

  // Kohdistuskuviot. Pois jätetään vain ne kolme, jotka osuisivat
  // hakukuvioiden päälle. Ajoituskuvion päälle osuvat piirretään – ne
  // korvaavat ajoitusmoduulit, kuten standardi edellyttää.
  const centers = ALIGN_POS[version - 1];
  const last = centers.length - 1;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (onFinder) continue;
      const r = centers[i];
      const c = centers[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          modules[r + dr][c + dc] = ring === 1 ? 0 : 1;
        }
      }
    }
  }

  // Muotoilutietojen paikat varataan, tumma moduuli
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === -1) modules[8][i] = 0;
    if (modules[i][8] === -1) modules[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === -1) modules[8][size - 1 - i] = 0;
    if (modules[size - 1 - i][8] === -1) modules[size - 1 - i][8] = 0;
  }
  modules[size - 8][8] = 1;

  // Versiotiedot (versiot 7+)
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      modules[r][size - 11 + c] = bit;
      modules[size - 11 + c][r] = bit;
    }
  }
  return { modules, size };
}

function versionBits(version) {
  // Versionumero on 6-bittinen, joten jakolaskuun tarvitaan täsmälleen
  // kuusi askelta; useampi sotkisi jakojäännöksen.
  let rem = version << 12;
  for (let i = 0; i < 6; i++) {
    if ((rem >> (17 - i)) & 1) rem ^= 0x1f25 << (5 - i);
  }
  return (version << 12) | (rem & 0xfff);
}

function formatBits(level, mask) {
  const data = (EC_BITS[level] << 3) | mask;
  let rem = data << 10;
  for (let i = 0; i < 5; i++) {
    if ((rem >> (14 - i)) & 1) rem ^= 0x537 << (4 - i);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(base, size, codewords) {
  const modules = base.map((row) => Int8Array.from(row));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // ajoitussarake ohitetaan
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (modules[row][col] !== -1) continue;
        const byte = codewords[bitIndex >> 3];
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        modules[row][col] = bit;
        bitIndex++;
      }
    }
    upward = !upward;
  }
  return modules;
}

function applyMask(modules, base, size, mask) {
  const fn = MASKS[mask];
  const out = modules.map((row) => Int8Array.from(row));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (base[r][c] !== -1) continue; // vain datamoduulit maskataan
      if (fn(r, c)) out[r][c] ^= 1;
    }
  }
  return out;
}

function writeFormat(modules, size, level, mask) {
  const bits = formatBits(level, mask);
  const bit = (i) => (bits >> i) & 1;

  // Ensimmäinen kopio kiertää vasenta ylänurkkaa: sarake 8 alaspäin ja
  // rivi 8 vasemmalle. Indeksit ovat [rivi][sarake].
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

  // Toinen kopio: rivi 8 oikeassa reunassa ja sarake 8 alareunassa.
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);

  modules[size - 8][8] = 1; // aina tumma moduuli
}

/** Standardin mukainen maskin pisteytys; pienin sakko voittaa. */
function penalty(modules, size) {
  let score = 0;

  const runScore = (line) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) s += run - 2;
        run = 1;
      }
    }
    if (run >= 5) s += run - 2;
    return s;
  };
  for (let r = 0; r < size; r++) score += runScore(modules[r]);
  for (let c = 0; c < size; c++) {
    score += runScore(Array.from({ length: size }, (_, r) => modules[r][c]));
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (get, i) => {
    for (let k = 0; k < 7; k++) if (get(i + k) !== pattern[k]) return false;
    const before = [i - 4, i - 3, i - 2, i - 1].every((j) => j < 0 || get(j) === 0);
    const after = [i + 7, i + 8, i + 9, i + 10].every((j) => j >= size || get(j) === 0);
    return before || after;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 7; c++) {
      if (hasPattern((i) => modules[r][i], c)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 7; r++) {
      if (hasPattern((i) => modules[i][c], r)) score += 40;
    }
  }

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Muodostaa QR-koodin.
 *
 * @param {string} text  koodattava teksti (UTF-8)
 * @param {{level?: 'L'|'M'|'Q'|'H'}} opts
 * @returns {{size: number, modules: Int8Array[], version: number}}
 */
export function encodeQR(text, opts = {}) {
  const level = opts.level || 'M';
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, level);
  if (!version) throw new Error(`QR: ${bytes.length} tavua ei mahdu tasolle ${level}`);

  const codewords = buildCodewords(bytes, version, level);
  const { modules: base, size } = createMatrix(version);
  const placed = placeData(base, size, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(placed, base, size, mask);
    writeFormat(candidate, size, level, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, modules: candidate };
  }
  return { size, modules: best.modules, version };
}

// Sisäiset osat testejä varten: tools/qrtest.mjs tarkistaa, että vapaiden
// datamoduulien määrä vastaa koodisanojen bittimäärää.
export const __internals = { createMatrix, buildCodewords, dataCodewords, ALIGN_POS };

/** Piirtää koodin canvakselle mustavalkoisena, hiljainen vyöhyke mukaan lukien. */
export function drawQR(canvas, text, opts = {}) {
  const { size, modules } = encodeQR(text, opts);
  const quiet = opts.quiet ?? 4;
  const total = size + quiet * 2;
  const scale = Math.max(1, Math.floor((opts.pixelSize || 320) / total));
  const px = total * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.light || '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = opts.dark || '#000000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }
  return { size, scale, pixels: px };
}
