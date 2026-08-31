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
  args: [
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    // Näytön parikytkentä pyytää kameraluvan; testissä kamera on tekokuvaa.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
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

    // 4. Laitetesteissä löytynyt vika: oikea heilautus kiertää mailaa myös
    //    pystyakselin ympäri. Nopean pystyakselikierron pitää olla lyönti
    //    (ei tähtäystä), ja paluun pitää laukaista osuma.
    feed(300, 0, 0, 0.4); // 120° pystyakselin ympäri vauhdilla
    const verticalBackswing = swing.phase;
    feed(-500, 0, 0, 0.26); // ripeä paluu lyöntiasentoon
    const verticalImpacts = events.filter((e) => e.t === 'impact').length;
    feed(0, 0, 0, 0.5);
    const aimAfterVertical = (swing.aim * 180) / Math.PI;

    return {
      aimAfterTurn,
      firedOnTurn,
      phaseAfterBack,
      impact: impact ? { power: +impact.power.toFixed(2) } : null,
      phaseAfterSwing: swing.phase,
      aimAfterSwing,
      verticalBackswing,
      verticalImpacts,
      aimAfterVertical,
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
  if (golf.verticalBackswing !== 'backswing') {
    errors.push('nopea pystyakselikierto ei kelvannut taaksevienniksi');
  }
  if (golf.verticalImpacts !== 2) {
    errors.push(`pystyakseliheilautus ei lyönyt (osumia ${golf.verticalImpacts}, odotettu 2)`);
  }
  if (Math.abs(golf.aimAfterVertical - golf.aimAfterSwing) > 4) {
    errors.push('nopea heilautus siirsi tähtäystä');
  }
}

// --- Gyrovirheen kompensointi ja taakseviennin peruutus ---------------------
{
  const fixes = await controller.evaluate(async () => {
    const { GolfSwing, WakeLock } = window.MonoGolf;
    const source = new EventTarget();
    const swing = new GolfSwing();
    swing.attach(source);
    const impacts = [];
    swing.addEventListener('impact', (e) => impacts.push(e.detail));

    const dt = 1 / 60;
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

    // 1. Nollavirhe: gyro näyttää 1,2 °/s vaikka laite on paikallaan.
    //    Ilman kompensointia tähtäys ryömisi 3,6° viidessä sekunnissa.
    feed(1.2, 0, 0, 4); // virhe opitaan ennen nollausta
    swing.zero({ x: 0, y: 0, z: 9.81 });
    feed(1.2, 0, 0, 5);
    const driftDeg = Math.abs((swing.aim * 180) / Math.PI);
    const biasLearned = (swing.bias[2] * 180) / Math.PI;

    // 2. Keskeytetty taaksevienti: hidas paluu ei lyö ja tähtäys vapautuu.
    feed(1.2, 200, 0, 0.5); // 100° taakse
    const inBackswing = swing.phase === 'backswing';
    feed(1.2, -40, 0, 2.4); // hidas paluu lyöntikohdan lähelle
    feed(1.2, 0, 0, 1.0); // ja rauhassa pysyminen
    const cancelled = swing.phase === 'address' && impacts.length === 0;

    // 3. Peruutuksen jälkeen oikea lyönti toimii yhä.
    feed(1.2, 180, 0, 0.6);
    feed(1.2, -500, 0, 0.25);
    const swingWorks = impacts.length === 1;

    // 4. Wake Lock: pyyntö ei kaadu ja tila raportoidaan rehellisesti.
    const wl = new WakeLock();
    let wlResult = 'ei tuettu';
    if (wl.supported) {
      const got = await wl.enable();
      wlResult = got && wl.active ? 'aktiivinen' : 'evätty';
      wl.disable();
    }

    return { driftDeg, biasLearned, inBackswing, cancelled, swingWorks, wlResult };
  });
  console.log('korjaukset:', JSON.stringify({
    ...fixes,
    driftDeg: +fixes.driftDeg.toFixed(2),
    biasLearned: +fixes.biasLearned.toFixed(2),
  }));
  if (fixes.driftDeg > 0.8) {
    errors.push(`tähtäys ryömi ${fixes.driftDeg.toFixed(2)}° nollavirheestä huolimatta`);
  }
  if (Math.abs(fixes.biasLearned - 1.2) > 0.2) {
    errors.push(`nollavirhettä ei opittu (${fixes.biasLearned.toFixed(2)} °/s)`);
  }
  if (!fixes.inBackswing) errors.push('taaksevientiä ei tunnistettu peruutustestissä');
  if (!fixes.cancelled) errors.push('keskeytetty taaksevienti ei palauttanut tähtäystä');
  if (!fixes.swingWorks) errors.push('lyönti ei toiminut peruutuksen jälkeen');
  if (fixes.wlResult === 'evätty') {
    console.log('  (wake lock evättiin tässä ympäristössä – ei virhe)');
  }
}

// --- Osuma ilman näytön lupaa ei laukaise lyöntiä ---------------------------
if (opened[0] && opened[1]) {
  const gated = await controller.evaluate(async () => {
    const ui = window.game.remoteUI;
    // Jäljitellään mailatilaa ilman kameraa: linkki ja golf suoraan.
    ui.link = window.link;
    ui.role = 'controller';
    ui.hostReady = false;
    const { GolfSwing } = window.MonoGolf;
    ui.golf = new GolfSwing();
    let sent = 0;
    const origSend = window.link.send.bind(window.link);
    window.link.send = (m) => {
      if (m.t === 'swing') sent++;
      return origSend(m);
    };
    ui.golf.addEventListener('impact', (e) => {
      // sama käsittelijä kuin startControllerModessa
      if (!ui.hostReady) return;
      window.link.send({ t: 'swing', power: e.detail.power });
    });
    ui.golf.dispatchEvent(new CustomEvent('impact', { detail: { power: 0.5, rate: 5 } }));
    const blockedCount = sent;
    ui.hostReady = true;
    ui.golf.dispatchEvent(new CustomEvent('impact', { detail: { power: 0.5, rate: 5 } }));
    window.link.send = origSend;
    return { blockedCount, allowedCount: sent };
  });
  console.log('osuman suodatus:', JSON.stringify(gated));
  if (gated.blockedCount !== 0) errors.push('lyönti lähti vaikka näyttö ei ollut valmis');
  if (gated.allowedCount !== 1) errors.push('lyönti ei lähtenyt kun näyttö oli valmis');
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

// --- Epäonnistumisen käsittely: syy näkyviin ja uusi yritys -----------------
{
  const failure = await host.evaluate(() => {
    const ui = window.game.remoteUI;
    ui.role = 'host';
    ui.candidates.local = { lan: 2, mdns: 2, public: 0 };
    ui.candidates.remote = { lan: 1, mdns: 0, public: 0 };
    ui.onConnectFailed('aikakatkaisu');
    return {
      visible: !document.querySelector('#remote').hidden,
      status: document.querySelector('#remoteStatus').textContent,
      retry: !document.querySelector('#remoteNext').hidden,
      retryLabel: document.querySelector('#remoteNext').textContent,
    };
  });
  console.log('epäonnistumisnäkymä:', JSON.stringify({ ...failure, status: failure.status.slice(0, 60) + '…' }));
  if (!failure.visible || !failure.retry || failure.retryLabel !== 'Yritä uudelleen') {
    errors.push('epäonnistuminen ei tarjonnut uutta yritystä');
  }
  if (!failure.status.includes('Yhteys ei muodostunut')) {
    errors.push('epäonnistumisen syytä ei näytetty');
  }
  await host.evaluate(() => window.game.remoteUI.cancel());
}

// --- Mobiiliverkko tunnistetaan ja siitä varoitetaan ------------------------
{
  const cellular = await host.evaluate(() => {
    Object.defineProperty(navigator, 'connection', {
      value: { type: 'cellular' },
      configurable: true,
    });
    const ui = window.game.remoteUI;
    ui.open();
    const openStatus = document.querySelector('#remoteStatus').textContent;
    ui.role = 'host';
    ui.candidates.local = { lan: 1, mdns: 0, public: 1 };
    ui.candidates.remote = { lan: 1, mdns: 0, public: 1 };
    ui.onConnectFailed('aikakatkaisu');
    const failStatus = document.querySelector('#remoteStatus').textContent;
    ui.cancel();
    delete navigator.connection;
    return {
      warnsOnOpen: openStatus.includes('mobiiliverkossa'),
      explainsOnFail: failStatus.includes('mobiiliverkossa'),
    };
  });
  console.log('mobiiliverkkovaroitus:', JSON.stringify(cellular));
  if (!cellular.warnsOnOpen) errors.push('mobiiliverkosta ei varoitettu parikytkennän alussa');
  if (!cellular.explainsOnFail) errors.push('mobiiliverkkoa ei mainittu vikanäkymässä');
}

// --- Kameralupa paljastaa oikeat lähiverkko-osoitteet -----------------------
// Ajetaan erillisellä selaimella ILMAN mDNS-poiskytkentää, jotta nähdään
// sama tilanne kuin oikealla puhelimella.
{
  const b2 = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const p2 = await b2.newPage();
  await p2.goto(base, { waitUntil: 'load' });
  const mdnsCheck = await p2.evaluate(async () => {
    const { RemoteLink } = window.MonoGolf;

    const offerCandidates = async () => {
      const link = new RemoteLink('host');
      const offer = await link.createOffer();
      link.close();
      const blob = offer.split('|')[5] || '';
      const hosts = blob.split(';').filter((c) => c[0] === 'h');
      return {
        hosts: hosts.length,
        mdns: hosts.filter((c) => c.includes('.local')).length,
      };
    };

    const before = await offerCandidates();
    const ok = await window.game.remoteUI.warmupCamera();
    const after = await offerCandidates();
    return { cameraGranted: ok, before, after };
  });
  await b2.close();
  console.log('mDNS ennen/jälkeen kameraluvan:', JSON.stringify(mdnsCheck));
  if (!mdnsCheck.cameraGranted) {
    console.log('  (kameraa ei saatu tässä ympäristössä – tarkistus ohitettu)');
  } else if (mdnsCheck.after.hosts > 0 && mdnsCheck.after.mdns === mdnsCheck.after.hosts) {
    errors.push('kameralupa ei paljastanut oikeita lähiverkko-osoitteita');
  }
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
