// Kokoaa pelin yhdeksi HTML-tiedostoksi.
//
//   node tools/bundle.mjs              -> dist/ (julkaistava sivusto)
//   node tools/bundle.mjs --standalone -> dist/monogolf.html (yksi tiedosto)
//
// Miksi kooste myös julkaisuun: kun tyylit ja moduulit ovat erillisinä
// tiedostoina, selain tai CDN voi tarjoilla uuden index.html:n vanhan
// styles.css:n ja src/*.js:n kanssa. Silloin peliin ilmestyy painikkeita,
// joita vanha koodi ei tunne. Yhtenä tiedostona sivu päivittyy atomisesti.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = process.argv.includes('--standalone');

const MODULES = [
  'src/physics.js',
  'src/world.js',
  'src/courses.js',
  'src/sensors.js',
  'src/audio.js',
  'src/render.js',
  'src/qr.js',
  'src/golfswing.js',
  'src/wakelock.js',
  'src/remote.js',
  'src/scanner.js',
  'src/remoteui.js',
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

/**
 * Ylimmän tason nimet moduulista. Kooste sijoittaa kaikki moduulit samaan
 * näkyvyysalueeseen, joten sama nimi kahdessa moduulissa on syntaksivirhe,
 * joka kaataa koko sivun. Tarkistus tehdään käännösaikana, koska ajossa se
 * näkyisi vain tyhjänä ruutuna.
 */
function topLevelNames(source) {
  const names = new Set();
  const re = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
  return names;
}

const seenNames = new Map();
const parts = MODULES.map((rel) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const stripped = stripModuleSyntax(src, rel);
  for (const name of topLevelNames(stripped)) {
    if (seenNames.has(name)) {
      throw new Error(
        `Nimitörmäys koosteessa: "${name}" määritellään sekä tiedostossa ` +
          `${seenNames.get(name)} että ${rel}. Nimeä toinen uudelleen.`,
      );
    }
    seenNames.set(name, rel);
  }
  return `// ===== ${rel} ${'='.repeat(Math.max(0, 66 - rel.length))}\n${stripped}`;
});

const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').trim();
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

if (STANDALONE) {
  // Yksittäisen tiedoston mukana ei kulje manifestia, kuvakkeita eikä
  // service workeria, joten niihin viittaaminen tuottaisi vain 404-virheitä.
  html = html
    .replace(/[ \t]*<link rel="manifest"[^>]*>\n/, '')
    .replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n/, '');
}
const prelude = STANDALONE ? 'window.__MONOGOLF_SINGLE_FILE__ = true;\n\n' : '';

const before = html;
html = html.replace(
  /[ \t]*<link rel="stylesheet" href="styles\.css" \/>\n/,
  `    <style>\n${css}\n    </style>\n`,
);
html = html.replace(
  /[ \t]*<script type="module" src="src\/main\.js"><\/script>\n/,
  `    <script>\n${prelude}${parts.join('\n\n')}\n    </script>\n`,
);
if (html === before) {
  throw new Error('index.html: tyyli- tai skriptiviittausta ei löytynyt');
}
html = html.replace(
  '<title>',
  '<!-- Koostettu komennolla: node tools/bundle.mjs -->\n    <title>',
);

const outDir = path.join(root, 'dist');
// Sivustokäännös siivoaa hakemiston; yksittäistiedosto kirjoitetaan sen viereen.
if (!STANDALONE) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (STANDALONE) {
  const outFile = path.join(outDir, 'monogolf.html');
  fs.writeFileSync(outFile, html);
  console.log(`dist/monogolf.html (${(html.length / 1024).toFixed(1)} kt)`);
} else {
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.copyFileSync(
    path.join(root, 'manifest.webmanifest'),
    path.join(outDir, 'manifest.webmanifest'),
  );
  fs.cpSync(path.join(root, 'icons'), path.join(outDir, 'icons'), { recursive: true });

  // Service workerin versio sidotaan sisältöön, jotta uusi julkaisu ei jää
  // vanhan välimuistin taakse.
  const stamp = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
  const sw = fs
    .readFileSync(path.join(root, 'sw.js'), 'utf8')
    .replace(/const VERSION = '[^']*';/, `const VERSION = 'monogolf-${stamp}';`);
  fs.writeFileSync(path.join(outDir, 'sw.js'), sw);

  const files = fs.readdirSync(outDir);
  console.log(
    `dist/: ${files.join(', ')} – index.html ${(html.length / 1024).toFixed(1)} kt, sw ${stamp}`,
  );
}
