// Testaa kaukosäätimen yhteyden kahden selainsivun välillä.
//
//   node tools/remotetest.mjs
//
// QR-koodit ja kamera ohitetaan: tiivistetyt kuvaukset siirretään suoraan
// sivulta toiselle. Näin varmistuu SDP:n tiivistys ja purku, datakanava sekä
// pelin reagointi kaukosäätimen heilautukseen.

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(c);
    } catch {
      /* seuraava */
    }
  }
  console.error('Playwrightia ei löytynyt.');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : '.';
const root = path.resolve(repoRoot, rootArg);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
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
const base = `http://127.0.0.1:${server.address().port}/`;

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].find((p) => fs.existsSync(p));

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  // Ilman mDNS-piilotusta ehdokkaat ovat suoria IP-osoitteita, mikä tekee
  // testistä vakaan myös eristetyssä ajoympäristössä.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const errors = [];
async function newPage(label) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`);
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return page;
}

const host = await newPage('näyttö');
const controller = await newPage('maila');

// --- Kättely ---------------------------------------------------------------
const offer = await host.evaluate(async () => {
  const { RemoteLink } = window.MonoGolf;
  window.link = new RemoteLink('host');
  window.received = [];
  window.link.addEventListener('message', (e) => window.received.push(e.detail));
  return window.link.createOffer();
});
console.log(`tarjous ${offer.length} merkkiä, ehdokkaita ${offer.split('|')[5].split(';').filter(Boolean).length}`);
if (offer.length > 900) errors.push(`tarjous on liian pitkä QR-koodiin (${offer.length})`);

const answer = await controller.evaluate(async (packed) => {
  const { RemoteLink } = window.MonoGolf;
  window.link = new RemoteLink('controller');
  window.received = [];
  window.link.addEventListener('message', (e) => window.received.push(e.detail));
  return window.link.createAnswer(packed);
}, offer);
console.log(`vastaus ${answer.length} merkkiä`);

await host.evaluate((packed) => window.link.acceptAnswer(packed), answer);

const opened = await Promise.all([
  host.waitForFunction(() => window.link.connected, null, { timeout: 20000 }).then(
    () => true,
    () => false,
  ),
  controller.waitForFunction(() => window.link.connected, null, { timeout: 20000 }).then(
    () => true,
    () => false,
  ),
]);
if (!opened[0] || !opened[1]) {
  errors.push(`datakanava ei auennut (näyttö ${opened[0]}, maila ${opened[1]})`);
} else {
  console.log('datakanava auki molemmissa päissä');
}

// --- Viestit molempiin suuntiin --------------------------------------------
if (opened[0] && opened[1]) {
  await controller.evaluate(() => window.link.send({ t: 'swing', power: 0.62 }));
  await host.evaluate(() => window.link.send({ t: 'state', hole: 3, strokes: 2 }));
  await host.waitForTimeout(500);

  const atHost = await host.evaluate(() => window.received);
  const atController = await controller.evaluate(() => window.received);
  console.log('näyttö vastaanotti:', JSON.stringify(atHost));
  console.log('maila vastaanotti:', JSON.stringify(atController));
  if (atHost[0]?.t !== 'swing' || atHost[0]?.power !== 0.62) {
    errors.push('heilautusviesti ei mennyt perille');
  }
  if (atController[0]?.t !== 'state' || atController[0]?.hole !== 3) {
    errors.push('tilaviesti ei mennyt perille');
  }
}

// --- Peli reagoi mailan heilautukseen ---------------------------------------
if (opened[0] && opened[1]) {
  const played = await host.evaluate(async () => {
    const g = window.game;
    g.hideCard();
    g.loadHole(0);
    g.setRemote(window.link);
    // Suunta tulee ruudulta: osoitetaan suoraan ylöspäin.
    g.aim.dirX = 0;
    g.aim.dirY = -1;
    const before = { strokes: g.strokes, mode: g.mode, armed: g.motion.armed };
    window.link.dispatchEvent(
      new CustomEvent('message', { detail: { t: 'swing', power: 0.8 } }),
    );
    await new Promise((r) => setTimeout(r, 100));
    return {
      before,
      after: { strokes: g.strokes, state: g.state, vy: g.ball.vy, vx: g.ball.vx },
    };
  });
  console.log('peli mailan heilautuksesta:', JSON.stringify(played));
  if (played.before.mode !== 'aim') errors.push('kaukosäädin ei vaihtanut tähtäystilaan');
  if (played.before.armed) errors.push('näytön omat anturit jäivät päälle');
  if (played.after.strokes !== 1) errors.push('mailan heilautus ei laukaissut lyöntiä');
  if (!(played.after.vy < 0)) errors.push(`pallo ei lähtenyt tähtäyssuuntaan (vy=${played.after.vy})`);

  // Mailalle lähtee tilannekuva pelistä.
  await host.waitForTimeout(400);
  const seen = await controller.evaluate(() =>
    window.received.filter((m) => m.t === 'state').slice(-1)[0],
  );
  console.log('mailan saama tila:', JSON.stringify(seen));
  if (!seen || seen.hole !== 1) errors.push('maila ei saanut väylätietoa');
}

// --- Tiivistys ja purku edestakaisin ---------------------------------------
const roundTrip = await host.evaluate(async () => {
  const { packDescription, unpackDescription, toChunks, ChunkCollector } = window.MonoGolf;
  const pc = new RTCPeerConnection();
  pc.createDataChannel('x');
  await pc.setLocalDescription(await pc.createOffer());
  const packed = packDescription(pc.localDescription);
  const sdp = unpackDescription(packed);
  // Kelpaako koottu kuvaus selaimelle sellaisenaan?
  const pc2 = new RTCPeerConnection();
  let accepted = true;
  try {
    await pc2.setRemoteDescription(sdp);
  } catch (err) {
    accepted = err.message;
  }
  const chunks = toChunks(packed);
  const collector = new ChunkCollector();
  let assembled = null;
  for (const c of [...chunks].reverse()) assembled = collector.add(c) || assembled;
  pc.close();
  pc2.close();
  return { accepted, chunks: chunks.length, assembled: assembled === packed };
});
console.log('purettu kuvaus kelpaa selaimelle:', roundTrip.accepted === true ? 'kyllä' : roundTrip.accepted);
console.log(`ruutuja ${roundTrip.chunks}, kokoaminen epäjärjestyksessä ${roundTrip.assembled ? 'ok' : 'EI'}`);
if (roundTrip.accepted !== true) errors.push('koottu SDP ei kelvannut selaimelle');
if (!roundTrip.assembled) errors.push('ruutujen kokoaminen epäonnistui');

// --- Gyro-lyönti: tähtäys, osuma ja väärät laukaisut ------------------------
{
  const golf = await controller.evaluate(async () => {
    const { GolfSwing } = window.MonoGolf;
    const source = new EventTarget();
    const swing = new GolfSwing();
    swing.attach(source);
    const events = [];
    swing.addEventListener('impact', (e) => events.push({ t: 'impact', ...e.detail }));
    swing.addEventListener('phase', (e) => events.push({ t: 'phase', ...e.detail }));

    const dt = 1 / 60;
    // rotationRate: alpha = z-akseli, beta = x, gamma = y (astetta/s)
    const feed = (alpha, beta, gamma, seconds) => {
      for (let t = 0; t < seconds; t += dt) {
        source.dispatchEvent(
          new CustomEvent('raw', {
            detail: {
              rotationRate: { alpha, beta, gamma },
              gravity: { x: 0, y: 0, z: 9.81 },
              dt,
            },
          }),
        );
      }
    };

    feed(0, 0, 0, 0.1); // gyro havaitaan
    swing.zero({ x: 0, y: 0, z: 9.81 }); // pystyakseli = laitteen z

    // 1. Pelkkä kääntely tähtää eikä saa laukaista lyöntiä.
    feed(60, 0, 0, 0.5); // 30° pystyakselin ympäri
    const aimAfterTurn = (swing.aim * 180) / Math.PI;
    const firedOnTurn = events.some((e) => e.t === 'impact');

    // 2. Taaksevienti ja paluu lyöntiasentoon.
    feed(0, 200, 0, 0.5); // 100° taakse
    const phaseAfterBack = swing.phase;
    feed(0, -600, 0, 0.18); // takaisin nollaan kovaa
    const impact = events.find((e) => e.t === 'impact');

    // 3. Lyönnin jälkeen palataan tähtäystilaan eikä tähtäys hyppää.
    feed(0, 0, 0, 0.5);
    const aimAfterSwing = (swing.aim * 180) / Math.PI;

    return {
      aimAfterTurn,
      firedOnTurn,
      phaseAfterBack,
      impact: impact ? { power: +impact.power.toFixed(2) } : null,
      phaseAfterSwing: swing.phase,
      aimAfterSwing,
    };
  });
  console.log('gyro-lyönti:', JSON.stringify(golf));
  if (Math.abs(Math.abs(golf.aimAfterTurn) - 30) > 4) {
    errors.push(`tähtäyskulma ${golf.aimAfterTurn.toFixed(1)}°, odotettu ±30°`);
  }
  if (golf.firedOnTurn) errors.push('pelkkä kääntely laukaisi lyönnin');
  if (golf.phaseAfterBack !== 'backswing') errors.push('taaksevientiä ei tunnistettu');
  if (!golf.impact) errors.push('osumaa ei tunnistettu paluuhetkellä');
  else if (golf.impact.power < 0.4 || golf.impact.power > 1) {
    errors.push(`osuman teho ${golf.impact.power} ei ole järkevä`);
  }
  if (golf.phaseAfterSwing !== 'address') errors.push('lyönnin jälkeen ei palattu tähtäykseen');
  if (Math.abs(golf.aimAfterSwing - golf.aimAfterTurn) > 4) {
    errors.push('tähtäys hyppäsi lyönnin jälkeen');
  }
}

// --- Näyttö kääntää tähtäystä mailan kulman mukaan --------------------------
if (opened[0] && opened[1]) {
  const aimed = await host.evaluate(async () => {
    const g = window.game;
    g.hideCard();
    g.loadHole(0);
    g.setRemote(window.link);
    const fire = (msg) =>
      window.link.dispatchEvent(new CustomEvent('message', { detail: msg }));
    fire({ t: 'zero' });
    const atZero = Math.atan2(g.aim.dirY, g.aim.dirX);
    const toCup = Math.atan2(g.world.cup.y - g.ball.y, g.world.cup.x - g.ball.x);
    fire({ t: 'aim', angle: 0.5 });
    const turned = Math.atan2(g.aim.dirY, g.aim.dirX);
    return { atZero, toCup, turned };
  });
  const d = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  console.log(
    `nollaus osoittaa reikään: ${d(aimed.atZero, aimed.toCup) < 0.01 ? 'kyllä' : 'ei'}, ` +
      `0,5 rad kääntö: ${d(aimed.turned, aimed.atZero).toFixed(3)} rad`,
  );
  if (d(aimed.atZero, aimed.toCup) > 0.01) errors.push('nollaus ei suunnannut reikään');
  if (Math.abs(d(aimed.turned, aimed.atZero) - 0.5) > 0.01) {
    errors.push('gyrokulma ei kääntänyt tähtäystä oikein');
  }
}

// --- Ruudulla näkyvä QR-koodi luetaan takaisin pikseleistä ------------------
{
  const shown = await host.evaluate(async () => {
    const g = window.game;
    g.remoteUI.cancel();
    g.remoteUI.open();
    await g.remoteUI.startHost();
    const canvas = document.querySelector('#remoteQr');
    return {
      payload: g.remoteUI.frames[0],
      frames: g.remoteUI.frames.length,
      png: canvas.toDataURL('image/png'),
      width: canvas.width,
    };
  });
  const png = Buffer.from(shown.png.split(',')[1], 'base64');
  fs.mkdirSync(path.join(repoRoot, '.shots'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.shots', 'remote-qr.png'), png);
  await host.screenshot({ path: path.join(repoRoot, '.shots', 'remote-pairing.png') });

  // Dekoodataan ruudulta luettu kuva samalla kirjastolla kuin QR-testissä.
  const decoded = await host.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    // Käytetään selaimen omaa lukijaa jos on, muuten palautetaan pikselit.
    if ('BarcodeDetector' in window) {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(c);
        return { via: 'BarcodeDetector', text: codes[0]?.rawValue ?? null };
      }
    }
    return { via: 'pixels', width: data.width, height: data.height, bytes: [...data.data] };
  }, shown.png);

  let text = decoded.text;
  if (decoded.via === 'pixels') {
    const jsQR = require('jsqr').default || require('jsqr');
    const res = jsQR(Uint8ClampedArray.from(decoded.bytes), decoded.width, decoded.height);
    text = res ? res.data : null;
  }
  console.log(
    `ruudun QR (${shown.width} px, ${shown.frames} ruutua, luettu ${decoded.via}): ` +
      (text === shown.payload ? 'vastaa parikoodia' : 'EI VASTAA'),
  );
  if (text !== shown.payload) errors.push('ruudulla näkyvä QR-koodi ei vastaa parikoodia');
}

await browser.close();
server.close();

if (errors.length) {
  console.error('\nVIRHEITÄ:');
  for (const e of errors) console.error(' - ' + e);
  process.exitCode = 1;
} else {
  console.log('\nKaukosäätimen yhteystesti ok.');
}
