// Kaukosäätimen käyttöliittymä: laiteparin muodostus QR-koodeilla sekä
// mailapuhelimen oma näkymä.
//
// Kättely etenee neljässä vaiheessa:
//   1. Näyttö luo tarjouksen ja näyttää sen QR-koodina.
//   2. Maila skannaa koodin ja muodostaa vastauksen.
//   3. Maila näyttää vastauksen QR-koodina.
//   4. Näyttö skannaa sen, ja datakanava aukeaa.

import { drawQR } from './qr.js';
import { RemoteLink, toChunks, ChunkCollector } from './remote.js';
import { QrScanner, qrFormatAvailable } from './scanner.js';
import { MotionInput, motionSupported } from './sensors.js';
import { GolfSwing } from './golfswing.js';

const FRAME_MS = 400; // QR-ruutujen vaihtoväli, kun koodi ei mahdu yhteen

export class RemoteUI {
  constructor(game) {
    this.game = game;
    this.el = game.el;
    this.link = null;
    this.role = null;
    this.scanner = null;
    this.collector = new ChunkCollector();
    this.frames = [];
    this.frameIndex = 0;
    this.frameTimer = null;
    this.motion = null;
    this.golf = null;
    this.swingMode = 'golf'; // 'golf' | 'heilautus'
    this.lastMotionSent = 0;
    this.lastAimSent = 0;

    this.el.remoteClose.addEventListener('click', () => this.cancel());
    this.el.btnRoleScreen.addEventListener('click', () => this.startHost());
    this.el.btnRoleClub.addEventListener('click', () => this.startController());
    this.el.controllerLeave.addEventListener('click', () => this.cancel());
    this.el.controllerZero.addEventListener('click', () => this.zeroStance());
    this.el.controllerMode.addEventListener('click', () => this.toggleSwingMode());
  }

  // --- Näkymän hallinta -----------------------------------------------------

  open() {
    // Mikään kortti tai valikko ei saa jäädä parikytkennän päälle.
    this.game.hideCard();
    this.game.setMenuOpen(false);
    this.el.remote.hidden = false;
    this.el.remoteRoles.hidden = false;
    this.el.remoteStage.hidden = true;
    this.setStatus(
      'Valitse, kumpi tämä laite on. Näytöllä pelataan, mailaa heilautetaan.',
    );
  }

  cancel() {
    this.stopScanner();
    this.stopFrames();
    if (this.link) this.link.close();
    this.link = null;
    this.role = null;
    this.collector.reset();
    if (this.golf) {
      this.golf.detach();
      this.golf = null;
    }
    if (this.motion) {
      this.motion.stop();
      this.motion = null;
    }
    this.el.remote.hidden = true;
    this.el.controller.hidden = true;
    this.game.setRemote(null);
  }

  setStatus(text) {
    this.el.remoteStatus.textContent = text;
  }

  setStep(title) {
    this.el.remoteTitle.textContent = title;
    this.el.remoteRoles.hidden = true;
    this.el.remoteStage.hidden = false;
  }

  showCode(payload) {
    this.frames = toChunks(payload);
    this.frameIndex = 0;
    this.el.remoteQrWrap.hidden = false;
    this.el.remoteScanWrap.hidden = true;
    const render = () => {
      drawQR(this.el.remoteQr, this.frames[this.frameIndex], {
        level: 'M',
        pixelSize: 520,
        dark: '#0d1a12',
      });
      this.el.remoteFrames.textContent =
        this.frames.length > 1 ? `ruutu ${this.frameIndex + 1}/${this.frames.length}` : '';
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    };
    render();
    this.stopFrames();
    if (this.frames.length > 1) this.frameTimer = setInterval(render, FRAME_MS);
  }

  stopFrames() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
  }

  async scan(onPayload) {
    this.el.remoteQrWrap.hidden = true;
    this.el.remoteScanWrap.hidden = false;
    this.collector.reset();
    this.scanner = new QrScanner(this.el.remoteVideo, (text) => {
      const payload = this.collector.add(text);
      if (this.collector.total > 1) {
        this.el.remoteFrames.textContent =
          `luettu ${this.collector.parts.size}/${this.collector.total}`;
      }
      if (payload) {
        this.stopScanner();
        onPayload(payload);
      }
    });
    try {
      await this.scanner.start();
    } catch (err) {
      this.setStatus(err.message);
    }
  }

  stopScanner() {
    if (this.scanner) this.scanner.stop();
    this.scanner = null;
  }

  // --- Roolit ---------------------------------------------------------------

  /** Tämä laite on näyttö: luo tarjous, näytä se, skannaa mailan vastaus. */
  async startHost() {
    this.role = 'host';
    this.setStep('Näyttö · vaihe 1/2');
    this.setStatus('Luodaan parikoodia…');
    this.link = new RemoteLink('host');
    this.bindLink();
    try {
      const offer = await this.link.createOffer();
      this.showCode(offer);
      this.setStatus('Skannaa tämä koodi mailapuhelimella. Paina sitten Jatka.');
      this.el.remoteNext.hidden = false;
      this.el.remoteNext.textContent = 'Jatka: skannaa mailan koodi';
      this.el.remoteNext.onclick = () => {
        this.el.remoteNext.hidden = true;
        this.setStep('Näyttö · vaihe 2/2');
        this.setStatus('Suuntaa kamera mailapuhelimen näyttämään koodiin.');
        this.stopFrames();
        this.scan((answer) => this.finishHost(answer));
      };
    } catch (err) {
      this.setStatus('Yhteyden avaus epäonnistui: ' + err.message);
    }
  }

  async finishHost(answer) {
    this.setStatus('Yhdistetään…');
    try {
      await this.link.acceptAnswer(answer);
    } catch (err) {
      this.setStatus('Parikoodi ei kelvannut: ' + err.message);
    }
  }

  /** Tämä laite on maila: skannaa näytön koodi ja näytä vastaus. */
  async startController() {
    this.role = 'controller';
    this.setStep('Maila · vaihe 1/2');
    this.setStatus('Suuntaa kamera näyttöpuhelimen koodiin.');
    this.link = new RemoteLink('controller');
    this.bindLink();
    if (!(await qrFormatAvailable())) {
      this.setStatus(
        'Tämä selain ei osaa lukea QR-koodeja. Kokeile Chromea Androidilla tai käytä ' +
          'peliä yhdellä puhelimella.',
      );
      return;
    }
    this.scan(async (offer) => {
      this.setStep('Maila · vaihe 2/2');
      try {
        const answer = await this.link.createAnswer(offer);
        this.showCode(answer);
        this.setStatus('Näytä tämä koodi näyttöpuhelimen kameralle.');
      } catch (err) {
        this.setStatus('Parikoodi ei kelvannut: ' + err.message);
      }
    });
  }

  // --- Yhteys ---------------------------------------------------------------

  bindLink() {
    this.link.addEventListener('open', () => this.onConnected());
    this.link.addEventListener('close', () => {
      if (this.role === 'controller') {
        this.el.controllerStatus.textContent = 'Yhteys katkesi.';
      } else {
        this.game.setStatus('Kaukosäädin irrotettiin.');
        this.game.setRemote(null);
      }
    });
    this.link.addEventListener('message', (e) => this.onMessage(e.detail));
  }

  onConnected() {
    this.stopFrames();
    this.stopScanner();
    this.el.remote.hidden = true;
    if (this.role === 'host') {
      this.game.setRemote(this.link);
      this.game.setStatus('Kaukosäädin yhdistetty. Tähtää ruudulta ja heilauta mailaa.');
    } else {
      this.startControllerMode();
    }
  }

  onMessage(msg) {
    // Näyttöpuolella viestit käsittelee peli itse (ks. Game#setRemote).
    if (this.role === 'host') return;
    if (msg.t === 'state') {
      this.el.controllerHole.textContent = `${msg.hole}/18 · ${msg.name}`;
      this.el.controllerStrokes.textContent = `${msg.strokes} lyöntiä · par ${msg.par}`;
      this.el.controllerStatus.textContent = msg.status || '';
      this.el.controller.classList.toggle('armed', !!msg.ready);
      if (this.motion) {
        if (msg.ready) this.motion.arm();
        else this.motion.disarm();
      }
    } else if (msg.t === 'shot') {
      navigator.vibrate?.(60);
      this.setPower(0);
    }
  }

  // --- Mailatila ------------------------------------------------------------

  async startControllerMode() {
    this.el.controller.hidden = false;
    this.el.controllerStatus.textContent = 'Yhdistetty. Odotetaan näyttöä…';
    if (!motionSupported()) {
      this.el.controllerStatus.textContent =
        'Tässä laitteessa ei ole liikeantureita – mailaksi ei ole apua.';
      return;
    }
    this.motion = new MotionInput();
    const ok = await this.motion.enable();
    if (!ok) {
      this.el.controllerStatus.textContent =
        'Anturilupa puuttuu. Salli liikeanturit ja yhdistä uudelleen.';
      return;
    }

    // Liikemittari näytölle kummassakin tilassa.
    this.motion.addEventListener('motion', (e) => {
      const now = performance.now();
      if (now - this.lastMotionSent < 100) return;
      this.lastMotionSent = now;
      this.link.send({ t: 'motion', level: e.detail.level });
    });

    // Vanha tila: teho heilautuksen nopeudesta, lyönti kun ohjain pysähtyy.
    this.motion.addEventListener('swingprogress', (e) => {
      if (this.swingMode === 'heilautus') this.setPower(e.detail.power);
    });
    this.motion.addEventListener('swingcancel', () => this.setPower(0));
    this.motion.addEventListener('swing', (e) => {
      if (this.swingMode !== 'heilautus') return;
      this.link.send({ t: 'swing', power: e.detail.power });
      navigator.vibrate?.(40);
    });

    // Golf-tila: gyro antaa suunnan, osuma tulee kun maila palaa
    // lyöntiasentoon.
    this.golf = new GolfSwing();
    this.golf.attach(this.motion);
    this.golf.addEventListener('aim', (e) => {
      const now = performance.now();
      this.setNeedle(e.detail.angle);
      if (now - this.lastAimSent < 60) return;
      this.lastAimSent = now;
      this.link.send({ t: 'aim', angle: e.detail.angle });
    });
    this.golf.addEventListener('phase', (e) => this.setPhase(e.detail.phase));
    this.golf.addEventListener('impact', (e) => {
      this.setPower(e.detail.power);
      this.link.send({ t: 'swing', power: e.detail.power });
      navigator.vibrate?.(60);
    });

    this.applySwingMode();
  }

  toggleSwingMode() {
    this.swingMode = this.swingMode === 'golf' ? 'heilautus' : 'golf';
    this.applySwingMode();
  }

  applySwingMode() {
    const golf = this.swingMode === 'golf';
    this.el.controllerMode.textContent = golf ? 'Tila: golf-lyönti' : 'Tila: heilautus';
    this.el.controllerZero.hidden = !golf;
    this.el.controller.classList.toggle('golf', golf);
    if (!golf && this.golf) this.golf.stop();
    this.setPower(0);
    this.el.controllerStatus.textContent = golf
      ? 'Ota lyöntiasento ja paina Nollaa lyöntiasento.'
      : 'Heilauta ohjainta. Pallo lähtee kun pysäytät sen.';
    this.link?.send({ t: 'mode', mode: this.swingMode });
  }

  /** Nollaa lyöntiasennon: tästä kohdasta lasketaan suunta ja osuma. */
  zeroStance() {
    if (!this.golf) return;
    if (!this.golf.hasGyro) {
      this.el.controllerStatus.textContent =
        'Gyroa ei löytynyt tästä laitteesta. Vaihda heilautustilaan.';
      return;
    }
    this.golf.zero(this.motion.gravity);
    this.setNeedle(0);
    this.link.send({ t: 'zero' });
    navigator.vibrate?.(30);
    this.el.controllerStatus.textContent =
      'Lyöntiasento nollattu. Käännä ohjainta tähdätäksesi ja lyö.';
  }

  setNeedle(angle) {
    // Nuoli kääntyy samaan suuntaan kuin tähtäys ruudulla.
    this.el.aimNeedle.setAttribute('transform', `rotate(${(angle * 180) / Math.PI})`);
  }

  setPhase(phase) {
    const c = this.el.controller;
    c.classList.toggle('phase-backswing', phase === 'backswing');
    const labels = {
      idle: 'Nollaa lyöntiasento',
      address: 'Tähtää ja lyö',
      backswing: 'Taaksevienti',
      follow: 'Lyönti!',
    };
    this.el.swingPhase.textContent = labels[phase] || '';
  }

  setPower(p) {
    const pct = Math.max(0, Math.min(1, p)) * 100;
    this.el.controllerPower.style.width = `${pct}%`;
  }
}
