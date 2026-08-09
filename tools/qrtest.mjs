// Varmistaa QR-generaattorin oikeellisuuden dekoodaamalla tulos jsQR:llä.
//
//   node tools/qrtest.mjs
//
// jsQR on pelkkä kehitysriippuvuus; pelissä itsessään ei ole riippuvuuksia.

import { createRequire } from 'node:module';
import { encodeQR, __internals } from '../src/qr.js';

const require = createRequire(import.meta.url);
let jsQR;
try {
  jsQR = require('jsqr').default || require('jsqr');
} catch {
  console.error('jsQR puuttuu. Asenna kehitysriippuvuudet: npm install');
  process.exit(2);
}

/** Moduulimatriisi RGBA-bittikartaksi, jonka jsQR osaa lukea. */
function toBitmap(modules, size, scale = 4, quiet = 4) {
  const total = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(total * total * 4).fill(255);
  for (let y = 0; y < total; y++) {
    for (let x = 0; x < total; x++) {
      const mr = Math.floor(y / scale) - quiet;
      const mc = Math.floor(x / scale) - quiet;
      const dark = mr >= 0 && mc >= 0 && mr < size && mc < size && modules[mr][mc] === 1;
      if (dark) {
        const i = (y * total + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: total, height: total };
}

function check(text, level) {
  const { modules, size, version } = encodeQR(text, { level });
  const bmp = toBitmap(modules, size);
  const result = jsQR(bmp.data, bmp.width, bmp.height);
  const ok = result && result.data === text;
  return { ok, version, size, got: result ? result.data : null };
}

// jsQR:n oma versiotaulukko on virheellinen versiolle 23: se odottaa
// kohdistuskeskipistettä 74, kun standardin kaava antaa 78. Oma taulukko
// tarkistetaan alla kaavaa vasten, joten v23 jätetään jsQR-kierroksen
// ulkopuolelle sen sijaan että muutettaisiin oikeaa arvoa vääräksi.
const JSQR_BROKEN_VERSIONS = new Set([23]);

// Kohdistuskuvioiden taulukko johdetaan ISO/IEC 18004 liitteen E kaavasta.
function specAlign(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.floor((ver * 4 + n * 2 + 1) / (n * 2 - 2)) * 2;
  const out = [];
  for (let i = 0, pos = ver * 4 + 10; i < n - 1; i++, pos -= step) out.unshift(pos);
  out.unshift(6);
  return out;
}

let tableErrors = 0;
for (let v = 1; v <= 40; v++) {
  const want = JSON.stringify(specAlign(v));
  const got = JSON.stringify(__internals.ALIGN_POS[v - 1]);
  if (want !== got) {
    console.log(`v${v}: kohdistuskeskipisteet ${got}, standardi ${want}`);
    tableErrors++;
  }
  const { modules, size } = __internals.createMatrix(v);
  // Vapaiden datamoduulien määrän on vastattava koodisanojen bittimäärää.
  let free = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c] === -1) free++;
  const remainder = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0][v - 1];
  const totalBits = __internals.dataCodewords(v, 'L') * 8;
  const ecBits = free - remainder - totalBits;
  if (ecBits < 0 || free !== totalBits + ecBits + remainder) {
    console.log(`v${v}: vapaita moduuleja ${free}`);
    tableErrors++;
  }
}

const cases = [];
// Lyhyet ja pitkät hyötykuormat, myös ei-ASCII ja realistinen SDP-tiiviste.
cases.push(['M', 'MONOGOLF']);
cases.push(['M', 'o|1|1|abcd|K7xPqR2mNvW9sT4uY6zB1cD3|' + 'A'.repeat(43)]);
cases.push(['L', 'ääkkösiä ja symboleja: /?&=#%+*']);

// Versiopyyhkäisy: jokainen versio jokaisella korjaustasolla. Toteutus on
// kirjoitettu itse, joten koko alue kannattaa käydä läpi.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/|,.:;';
const filler = (n) => Array.from({ length: n }, (_, i) => alphabet[(i * 37) % alphabet.length]).join('');
for (const level of ['L', 'M', 'Q', 'H']) {
  const seen = new Set();
  for (let len = 1; len <= 2900; len += 7) {
    let v;
    try {
      v = encodeQR(filler(len), { level }).version;
    } catch {
      break;
    }
    if (seen.has(v)) continue;
    seen.add(v);
    cases.push([level, filler(len)]);
  }
}

let fails = 0;
const verbose = process.argv.includes('--verbose');
if (verbose) {
  console.log('taso  versio  koko  tavuja  tulos');
  console.log('-'.repeat(46));
}
for (const [level, text] of cases) {
  const bytes = new TextEncoder().encode(text).length;
  const version = encodeQR(text, { level }).version;
  if (JSQR_BROKEN_VERSIONS.has(version)) continue;
  let r;
  try {
    r = check(text, level);
  } catch (err) {
    console.log(`${level}     -       -     ${String(bytes).padStart(6)}  VIRHE: ${err.message}`);
    fails++;
    continue;
  }
  if (!r.ok) fails++;
  if (verbose || !r.ok) {
    console.log(
      `${level}     ${String(r.version).padStart(2)}      ${String(r.size).padStart(3)}   ` +
        `${String(bytes).padStart(6)}  ${r.ok ? 'ok' : 'EI VASTAA: ' + JSON.stringify(r.got)?.slice(0, 40)}`,
    );
  }
}
if (verbose) console.log('-'.repeat(46));
if (fails || tableErrors) {
  console.log(`${fails} dekoodausta ja ${tableErrors} taulukkoriviä epäonnistui.`);
  process.exitCode = 1;
} else {
  console.log(
    `${cases.length} tapausta dekoodattu oikein (versio 23 ohitettu jsQR:n oman ` +
      'taulukkovirheen vuoksi), ja kohdistustaulukko vastaa standardia.',
  );
}
