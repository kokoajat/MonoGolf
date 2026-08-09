// Kokoaa pelin yhdeksi HTML-tiedostoksi (dist/index.html).
//
// Moduulit liitetään peräkkäin riippuvuusjärjestyksessä ja import/export-rivit
// poistetaan. Kaikki tunnisteet ovat yksilöllisiä moduulien kesken, joten
// yhdistäminen samaan näkyvyysalueeseen on turvallista.
//
//   node tools/bundle.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = [
  'src/physics.js',
  'src/world.js',
  'src/courses.js',
  'src/sensors.js',
  'src/audio.js',
  'src/render.js',
  'src/game.js',
  'src/main.js',
];

function stripModuleSyntax(source, file) {
  const out = source
    .replace(/^import\s+[^;]*;[ \t]*$/gm, '')
    .replace(/^export\s+\{[^}]*\};[ \t]*$/gm, '')
    .replace(/^export\s+(const|let|var|function|class|async)\b/gm, '$1');
  const leftover = out.match(/^\s*(import|export)\b.*/m);
  if (leftover) {
    throw new Error(`${file}: moduulisyntaksia jäi jäljelle: ${leftover[0].trim()}`);
  }
  return out.trim();
}

const parts = MODULES.map((rel) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  return `// ===== ${rel} ${'='.repeat(Math.max(0, 66 - rel.length))}\n${stripModuleSyntax(src, rel)}`;
});

// Kooste on yksi tiedosto: erillisiä manifestia, kuvakkeita tai service
// workeria ei ole, joten niihin viittaaminen tuottaisi vain 404-virheitä.
const prelude = 'window.__MONOGOLF_SINGLE_FILE__ = true;';

const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').trim();
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html
  .replace(/[ \t]*<link rel="manifest"[^>]*>\n/, '')
  .replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n/, '');

const before = html;
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="styles\.css" \/>\n/,
  `    <style>\n${css}\n    </style>\n`,
);
html = html.replace(
  /[ \t]*<script type="module" src="src\/main\.js"><\/script>\n/,
  `    <script>\n${prelude}\n\n${parts.join('\n\n')}\n    </script>\n`,
);
if (html === before) {
  throw new Error('index.html: tyyli- tai skriptiviittausta ei löytynyt');
}
html = html.replace(
  '<title>',
  '<!-- Koostettu tiedostosta index.html + src/*.js komennolla: node tools/bundle.mjs -->\n    <title>',
);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'index.html');
fs.writeFileSync(outFile, html);
console.log(`dist/index.html kirjoitettu (${(html.length / 1024).toFixed(1)} kt)`);
