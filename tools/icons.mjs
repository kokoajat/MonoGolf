// Generoi sovelluskuvakkeet SVG:stä PNG:ksi Chromiumilla.
//
//   node tools/icons.mjs
//
// Kuvakkeet tarvitaan web app manifestiin ja iOS:n aloitusnäyttöön, eikä
// niitä voi tarjota SVG:nä molemmille alustoille.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(c);
    } catch {
      /* kokeillaan seuraavaa */
    }
  }
  console.error('Playwrightia ei löytynyt. Asenna: npm i -D playwright');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');
fs.mkdirSync(outDir, { recursive: true });

/** @param {boolean} maskable  Turva-alue Androidin rajaaville kuvakkeille. */
const svg = (maskable) => {
  const pad = maskable ? 0.14 : 0;
  const s = 1 - pad * 2;
  const t = `translate(${pad * 512} ${pad * 512}) scale(${s})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="felt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f8f4e"/><stop offset="1" stop-color="#1d5c33"/>
    </linearGradient>
    <radialGradient id="ball" cx="0.35" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c3ccd6"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#0d1a12"/>
  <g transform="${t}">
    <rect x="24" y="24" width="464" height="464" rx="96" fill="url(#felt)"/>
    <rect x="24" y="24" width="464" height="464" rx="96" fill="none" stroke="#8a5a33" stroke-width="26"/>
    <circle cx="330" cy="168" r="44" fill="#101613"/>
    <path d="M330 168 V54" stroke="#f3f3f3" stroke-width="13" stroke-linecap="round"/>
    <path d="M336 58 L436 92 L336 126 Z" fill="#e33b2e"/>
    <circle cx="192" cy="356" r="58" fill="url(#ball)"/>
    <circle cx="212" cy="336" r="12" fill="#dc3c32"/>
  </g>
</svg>`;
};

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].find((p) => fs.existsSync(p));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const page = await browser.newPage();

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg(t.maskable)}`,
  );
  await page.screenshot({ path: path.join(outDir, t.file), omitBackground: false });
  console.log(`icons/${t.file} (${t.size}×${t.size})`);
}

await browser.close();
