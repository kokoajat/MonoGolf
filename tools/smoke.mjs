// Selaintesti: käynnistää pelin Chromiumissa, pelaa muutaman lyönnin
// kosketusohjauksella ja tarkistaa ettei konsoliin tule virheitä.
//
//   node tools/smoke.mjs [--shots 3] [--hole 1] [--shot-dir /polku]

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Playwright saa löytyä joko projektista tai globaalista asennuksesta.
function loadPlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const c of candidates) {
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
const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = Number(getArg('--shots', 3));
const SHOT_DIR = getArg('--shot-dir', path.join(root, '.shots'));
// Oletuksena testataan moduuliversiota; --entry dist/index.html testaa koosteen.
const ENTRY = getArg('--entry', '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/${ENTRY}`;

fs.mkdirSync(SHOT_DIR, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(
    (p) => fs.existsSync(p),
  );
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOT_DIR, '01-intro.png') });

await page.getByRole('button', { name: 'Pelaa kosketuksella' }).click();
await page.getByRole('button', { name: 'Pelaa', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOT_DIR, '02-hole1.png') });

// Pelaa muutama lyönti: vedä pallosta alaspäin (ritsa) -> pallo lähtee ylös.
for (let i = 0; i < SHOTS; i++) {
  const info = await page.evaluate(() => {
    const g = window.game;
    const r = g.renderer;
    const rect = g.el.canvas.getBoundingClientRect();
    const [bx, by] = [
      rect.left + (r.offsetX + g.ball.x * r.scale) / r.dpr,
      rect.top + (r.offsetY + g.ball.y * r.scale) / r.dpr,
    ];
    return { bx, by, state: g.state, strokes: g.strokes, hole: g.holeIndex + 1 };
  });
  await page.mouse.move(info.bx, info.by);
  await page.mouse.down();
  await page.mouse.move(info.bx + 8, info.by + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    state: window.game.state,
    strokes: window.game.strokes,
    speed: Math.hypot(window.game.ball.vx, window.game.ball.vy),
  }));
  if (after.strokes !== info.strokes + 1) {
    errors.push(`lyönti ${i + 1}: lyöntilaskuri ei kasvanut (${info.strokes} -> ${after.strokes})`);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, `03-shot${i + 1}-rolling.png`) });
  // odota kunnes pallo pysähtyy tai reikä menee
  await page
    .waitForFunction(() => window.game.state !== 'rolling', null, { timeout: 30000 })
    .catch(() => errors.push(`lyönti ${i + 1}: pallo ei pysähtynyt 30 s aikana`));
  await page.waitForTimeout(200);
  const rest = await page.evaluate(() => ({
    state: window.game.state,
    x: window.game.ball.x,
    y: window.game.ball.y,
    strokes: window.game.strokes,
    inside: window.game.world.contains(window.game.ball.x, window.game.ball.y),
  }));
  console.log(
    `lyönti ${i + 1}: tila=${rest.state} lyöntejä=${rest.strokes} paikka=(${rest.x.toFixed(2)}, ${rest.y.toFixed(2)}) radalla=${rest.inside}`,
  );
  if (!rest.inside && rest.state !== 'holed') errors.push(`lyönti ${i + 1}: pallo radan ulkopuolella`);
  await page.screenshot({ path: path.join(SHOT_DIR, `04-shot${i + 1}-rest.png`) });
  if (rest.state === 'holed') {
    await page.getByRole('button', { name: /Seuraava väylä/ }).click();
    await page.waitForTimeout(300);
  }
}

// --- Anturiohjaus: syötetään synteettisiä devicemotion-tapahtumia ----------
{
  await page.evaluate(() => {
    window.game.hideCard();
    window.game.loadHole(0);
  });
  const enabled = await page.evaluate(async () => {
    const ok = await window.game.motion.enable();
    window.game.mode = 'swing';
    window.game.updateChrome();
    window.game.armIfReady();
    return { ok, listening: window.game.motion.listening, armed: window.game.motion.armed };
  });
  if (!enabled.ok || !enabled.armed) {
    errors.push(`antureita ei saatu viritettyä: ${JSON.stringify(enabled)}`);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, '06-sensors-on.png') });
  // Lupapainike katoaa kun lupa on myönnetty, eikä jätä tilamerkkiä jälkeensä.
  if (await page.locator('#btnSensors').isVisible()) {
    errors.push('anturipainike jäi näkyviin luvan jälkeen');
  }

  // Pitkä, yhtäjaksoinen liike: lyönti ei saa lähteä ennen kuin puhelin
  // pysähtyy, vaikka liikettä jatkettaisiin sekunnin ajan.
  const sustained = await page.evaluate(async () => {
    const fire = (ay) =>
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          accelerationIncludingGravity: { x: 0, y: ay, z: 9.81 },
          interval: 16,
        }),
      );
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 20; i++) {
      fire(0);
      await sleep(16);
    }
    // ~1 s edestakaista heiluttelua
    for (let i = 0; i < 60; i++) {
      fire(i % 2 === 0 ? 14 : -12);
      await sleep(16);
    }
    const during = {
      strokes: window.game.strokes,
      state: window.game.state,
      swinging: !!window.game.motion.swing,
      power: window.game.aim.power,
    };
    // puhelin pysähtyy
    for (let i = 0; i < 16; i++) {
      fire(0);
      await sleep(16);
    }
    await sleep(150);
    return { during, after: { strokes: window.game.strokes, state: window.game.state } };
  });
  console.log('pitkä liike:', JSON.stringify(sustained));
  if (sustained.during.strokes !== 0) {
    errors.push('lyönti lähti kesken liikkeen (pitäisi odottaa pysähtymistä)');
  }
  if (!sustained.during.swinging) errors.push('pitkää liikettä ei tunnistettu');
  if (sustained.after.strokes !== 1) errors.push('lyönti ei lähtenyt puhelimen pysähtyessä');

  // Palautetaan väylä alkutilaan seuraavaa testiä varten.
  await page
    .waitForFunction(() => window.game.state !== 'rolling', null, { timeout: 30000 })
    .catch(() => errors.push('pitkän liikkeen lyönti ei pysähtynyt'));
  await page.evaluate(() => {
    window.game.hideCard();
    window.game.loadHole(0);
    window.game.mode = 'swing';
    window.game.armIfReady();
  });
  await page.waitForTimeout(100);

  // Heilautus eteenpäin: puhelin vaakatasossa (painovoima z-akselilla),
  // kiihtyvyys +y kiihdytysvaiheessa ja -y jarrutuksessa.
  const swing = await page.evaluate(async () => {
    const fire = (ax, ay, az) =>
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          accelerationIncludingGravity: { x: ax, y: ay, z: az + 9.81 },
          interval: 16,
        }),
      );
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25; i++) {
      fire(0, 0, 0);
      await sleep(16);
    } // painovoiman suodatin asettuu
    // kiihdytys eteenpäin, jarrutus, ja sen jälkeen tasainen paikallaanolo
    const profile = [4, 11, 19, 24, 22, 14, 4, -6, -12, -8, -3, -1].concat(new Array(14).fill(0));
    for (const a of profile) {
      fire(0, a, 0);
      await sleep(16);
    }
    await sleep(200);
    const g = window.game;
    return {
      state: g.state,
      strokes: g.strokes,
      armed: g.motion.armed,
      vx: g.ball.vx,
      vy: g.ball.vy,
      speed: Math.hypot(g.ball.vx, g.ball.vy),
    };
  });
  console.log('heilautus:', JSON.stringify(swing));
  if (swing.strokes !== 1) errors.push('heilautus ei laukaissut lyöntiä');
  if (swing.vy >= 0) errors.push(`pallo ei lähtenyt eteenpäin (vy=${swing.vy})`);
  if (Math.abs(swing.vx) > Math.abs(swing.vy)) errors.push('heilautuksen suunta väärin');
  if (swing.armed) errors.push('anturit jäivät päälle pallon vieriessä');

  // Toinen heilautus vierimisen aikana ei saa vaikuttaa
  const during = await page.evaluate(async () => {
    const fire = (ay) =>
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          accelerationIncludingGravity: { x: 0, y: ay, z: 9.81 },
          interval: 16,
        }),
      );
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = window.game.strokes;
    for (const a of [10, 26, 30, 18, -10, -4, 0, 0]) {
      fire(a);
      await sleep(16);
    }
    await sleep(150);
    return { before, after: window.game.strokes, state: window.game.state };
  });
  if (during.after !== during.before) {
    errors.push('heilautus pallon vieriessä muutti lyöntimäärää');
  }
  await page
    .waitForFunction(() => window.game.state !== 'rolling', null, { timeout: 30000 })
    .catch(() => errors.push('anturilyönnin jälkeen pallo ei pysähtynyt'));
  await page.screenshot({ path: path.join(SHOT_DIR, '06-sensor-shot.png') });
  const holedByHand = await page.evaluate(() => window.game.state === 'holed');
  if (holedByHand) {
    await page.getByRole('button', { name: /Seuraava väylä|Katso tuloskortti/ }).click();
    await page.waitForTimeout(200);
  }
}

// Tarkista tuloskortti
await page.locator('#btnScore').click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOT_DIR, '05-scorecard.png') });
const rows = await page.locator('.scorecard tbody tr').count();
if (rows !== 18) errors.push(`tuloskortissa ${rows} riviä, pitäisi olla 18`);

// Kortin ollessa auki heilautus ei saa laukaista lyöntiä
const whileCard = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = window.game.strokes;
  for (const a of [8, 22, 28, 16, -8, -3, 0, 0, 0, 0, 0, 0]) {
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: 0, y: a, z: 9.81 },
        interval: 16,
      }),
    );
    await sleep(16);
  }
  await sleep(200);
  return { before, after: window.game.strokes, armed: window.game.motion.armed };
});
if (whileCard.after !== whileCard.before || whileCard.armed) {
  errors.push(`heilautus laukesi kortin ollessa auki: ${JSON.stringify(whileCard)}`);
}

// Käy kaikki väylät läpi renderöinnin varmistamiseksi
await page.getByRole('button', { name: 'Takaisin peliin' }).click();
for (let h = 0; h < 18; h++) {
  await page.evaluate((i) => {
    window.game.hideCard();
    window.game.loadHole(i);
  }, h);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SHOT_DIR, `hole-${String(h + 1).padStart(2, '0')}.png`) });
}

await browser.close();
server.close();

if (errors.length) {
  console.error('\nVIRHEITÄ:');
  for (const e of errors) console.error(' - ' + e);
  process.exitCode = 1;
} else {
  console.log('\nSelaintesti ok. Kuvat: ' + SHOT_DIR);
}
