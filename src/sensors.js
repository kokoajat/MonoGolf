// Puhelimen liikeanturien luku ja heilautuksen tunnistus.
//
// Periaate: devicemotion antaa kiihtyvyyden laitteen koordinaatistossa.
// Painovoima erotetaan alipäästösuodattimella, jolloin jäljelle jää pelkkä
// käden liike. Kun liikkeen voimakkuus ylittää kynnyksen, aloitetaan
// heilautusikkuna: siitä poimitaan huippukiihtyvyys (= lyönnin voima) ja
// kiihdytysvaiheen suunta (= lyönnin suunta).
//
// Kun pallo on liikkeellä, kuuntelija sammutetaan kokonaan (disarm), jolloin
// puhelimen heiluttelu ei enää vaikuta peliin.

const START_THRESHOLD = 6.0; // m/s^2, liikkeen tunnistus alkaa
const STILL_THRESHOLD = 1.8; // m/s^2, tätä hiljaisempi = puhelin paikallaan
const STILL_HOLD = 0.2; // s, kuinka kauan paikallaan ennen laukaisua
const MAX_WINDOW = 4.0; // s, varmistusraja jos puhelin ei pysähdy koskaan
// Teho luetaan heilautuksen huippunopeudesta (m/s), joka saadaan
// integroimalla kiihtyvyys.
const SWING_V_MIN = 0.35; // m/s -> teho 0
const SWING_V_MAX = 2.6; // m/s -> teho 1
const VELOCITY_LEAK = 0.5; // s, integroinnin vuotoaikavakio
const GRAVITY_ALPHA = 0.88; // alipäästösuodattimen kerroin
const GRAVITY_GATE = 1.5; // m/s^2, tätä suurempi poikkeama = liikettä, ei päivitetä
const GRAVITY_REACQUIRE = 0.8; // s, uuden asennon vakiintumisaika

export function motionSupported() {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

export function needsMotionPermission() {
  return (
    motionSupported() && typeof window.DeviceMotionEvent.requestPermission === 'function'
  );
}

export class MotionInput extends EventTarget {
  constructor() {
    super();
    this.listening = false;
    this.armed = false;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
    this.gravity = { x: 0, y: 0, z: 0 };
    this.gravityReady = false;
    this._lastAcc = null;
    this._offSince = 0;
    this.level = 0; // viimeisin liikkeen voimakkuus (mittarille)
    this.lastEventAt = 0;
    this.sampleRate = 0;

    this.swing = null;
    this._swingTimer = null;
    this._onMotion = this._onMotion.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
    this.tilt = { beta: 0, gamma: 0, alpha: 0 };
    this.hasOrientation = false;
  }

  /** Pyytää luvan (iOS 13+) ja aloittaa kuuntelun. */
  async enable() {
    if (!motionSupported()) {
      this.permission = 'unsupported';
      return false;
    }
    try {
      if (needsMotionPermission()) {
        const res = await window.DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          this.permission = 'denied';
          return false;
        }
      }
      if (
        typeof window.DeviceOrientationEvent !== 'undefined' &&
        typeof window.DeviceOrientationEvent.requestPermission === 'function'
      ) {
        try {
          await window.DeviceOrientationEvent.requestPermission();
        } catch {
          /* suuntatieto on vapaaehtoinen */
        }
      }
    } catch (err) {
      this.permission = 'denied';
      return false;
    }
    this.permission = 'granted';
    this._startListening();
    return true;
  }

  _startListening() {
    if (this.listening) return;
    window.addEventListener('devicemotion', this._onMotion, { passive: true });
    window.addEventListener('deviceorientation', this._onOrientation, { passive: true });
    this.listening = true;
  }

  stop() {
    if (!this.listening) return;
    window.removeEventListener('devicemotion', this._onMotion);
    window.removeEventListener('deviceorientation', this._onOrientation);
    this.listening = false;
    this.armed = false;
    this._clearSwing();
  }

  /** Anturit vaikuttavat peliin vain kun ne on viritetty. */
  arm() {
    if (!this.listening) return;
    this.armed = true;
    this._clearSwing();
  }

  disarm() {
    this.armed = false;
    this._clearSwing();
  }

  _clearSwing() {
    this.swing = null;
    this.level = 0;
    if (this._swingTimer) {
      clearTimeout(this._swingTimer);
      this._swingTimer = null;
    }
  }

  _onOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    this.hasOrientation = true;
    this.tilt = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
  }

  _onMotion(e) {
    const now = performance.now() / 1000;
    const dt = this.lastEventAt ? now - this.lastEventAt : 1 / 60;
    this.lastEventAt = now;
    if (dt > 0) this.sampleRate = 0.9 * this.sampleRate + 0.1 * (1 / dt);

    let lin = null;
    const withG = e.accelerationIncludingGravity;
    const pure = e.acceleration;

    if (pure && pure.x !== null && (pure.x !== 0 || pure.y !== 0 || pure.z !== 0)) {
      lin = { x: pure.x || 0, y: pure.y || 0, z: pure.z || 0 };
      if (withG && withG.x !== null) {
        this.gravity = {
          x: (withG.x || 0) - lin.x,
          y: (withG.y || 0) - lin.y,
          z: (withG.z || 0) - lin.z,
        };
        this.gravityReady = true;
      }
    } else if (withG && withG.x !== null) {
      const a = { x: withG.x || 0, y: withG.y || 0, z: withG.z || 0 };
      if (!this.gravityReady) {
        this.gravity = a;
        this.gravityReady = true;
        this._offSince = 0;
      } else {
        // Painovoima-arviota päivitetään vain kun laite on rauhassa. Jos
        // suodatin seuraisi heilautusta, se söisi osan signaalista ja jättäisi
        // liikkeen ajaksi pysyvän harhan, joka näkyisi vääränä suuntana.
        const dev = Math.hypot(
          a.x - this.gravity.x,
          a.y - this.gravity.y,
          a.z - this.gravity.z,
        );
        if (dev < GRAVITY_GATE) {
          const k = GRAVITY_ALPHA;
          this.gravity = {
            x: k * this.gravity.x + (1 - k) * a.x,
            y: k * this.gravity.y + (1 - k) * a.y,
            z: k * this.gravity.z + (1 - k) * a.z,
          };
          this._offSince = 0;
        } else {
          // Laite on käännetty toiseen asentoon: kun lukema on pysynyt
          // tasaisena hetken, painovoima haetaan uudestaan.
          const steady =
            this._lastAcc &&
            Math.hypot(
              a.x - this._lastAcc.x,
              a.y - this._lastAcc.y,
              a.z - this._lastAcc.z,
            ) < 0.6;
          if (!this._offSince) this._offSince = now;
          if (steady && now - this._offSince > GRAVITY_REACQUIRE) {
            this.gravity = { ...a };
            this._offSince = 0;
          }
        }
      }
      this._lastAcc = a;
      lin = {
        x: a.x - this.gravity.x,
        y: a.y - this.gravity.y,
        z: a.z - this.gravity.z,
      };
    }
    if (!lin) return;

    const mag = Math.hypot(lin.x, lin.y, lin.z);
    this.level = mag;
    this.dispatchEvent(new CustomEvent('motion', { detail: { level: mag } }));

    if (!this.armed) return;
    this._trackSwing(lin, mag, now, Math.max(0.004, Math.min(0.05, dt)));
  }

  _trackSwing(lin, mag, now, dt) {
    if (!this.swing) {
      if (mag < START_THRESHOLD) return;
      this.swing = {
        start: now,
        vx: 0,
        vy: 0,
        vz: 0,
        peakSpeed: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 0,
        stillSince: 0,
        samples: 0,
      };
      // Varmistus: jos anturitapahtumat loppuvat kesken liikkeen
      // (selain voi hidastaa niitä), lyönti laukaistaan silti.
      this._swingTimer = setTimeout(() => this._finishSwing(), MAX_WINDOW * 1000 + 40);
      this.dispatchEvent(new CustomEvent('swingstart'));
    }

    const s = this.swing;
    s.samples++;

    // Kiihtyvyys integroidaan nopeudeksi. Nopeus kertoo mihin puhelin
    // todella liikkui; pelkkä kiihtyvyyden huippu ei kelpaa, koska
    // heilautuksen voimakkain piikki on usein lopun jarrutus, joka osoittaa
    // vastakkaiseen suuntaan.
    s.vx += lin.x * dt;
    s.vy += lin.y * dt;
    s.vz += lin.z * dt;

    // Vuoto estää anturin nollapoikkeamaa kasvamasta valenopeudeksi.
    const leak = Math.exp(-dt / VELOCITY_LEAK);
    s.vx *= leak;
    s.vy *= leak;
    s.vz *= leak;

    const speed = Math.hypot(s.vx, s.vy, s.vz);

    // Suunta kertyy nopeudella painotettuna integraalina vain siltä ajalta,
    // kun puhelin oikeasti liikkuu. Yksittäinen viivästynyt anturitapahtuma
    // ei näin käännä lyöntiä: aiemmin suunta luettiin huippunopeuden
    // hetkestä, jolloin yksi iso piikki jarrutusvaiheessa riitti.
    if (mag >= STILL_THRESHOLD) {
      const w = speed * dt;
      s.dirX += s.vx * w;
      s.dirY += s.vy * w;
      s.dirZ += s.vz * w;
      if (speed > s.peakSpeed) s.peakSpeed = speed;
    }

    // Puhelin on paikallaan kun kiihtyvyys on pysynyt tyynenä yhtäjaksoisesti
    // STILL_HOLD-ajan. Kädessä pidettävä puhelin ei pysy näin pitkään
    // kiihtyvyydettömänä kesken liikkeen, joten tämä erottaa pysähdyksen
    // luotettavasti ja ilman viivettä. Integroitua nopeutta ei käytetä tähän:
    // siihen jää anturin nollapoikkeamasta jäännös, joka viivästyttäisi
    // laukaisua sekunnilla.
    if (mag < STILL_THRESHOLD) {
      if (!s.stillSince) s.stillSince = now;
    } else {
      s.stillSince = 0;
    }
    const still = s.stillSince ? now - s.stillSince : 0;

    this.dispatchEvent(
      new CustomEvent('swingprogress', {
        detail: { power: powerFromSpeed(s.peakSpeed), moving: !s.stillSince, still },
      }),
    );

    if (still >= STILL_HOLD || now - s.start >= MAX_WINDOW) this._finishSwing();
  }

  _finishSwing() {
    const s = this.swing;
    if (!s) return;
    this._clearSwing();
    if (s.samples < 3 || s.peakSpeed < SWING_V_MIN) {
      this.dispatchEvent(new CustomEvent('swingcancel'));
      return;
    }

    // Laitteen koordinaatisto (puhelin vaaka-asennossa, näyttö ylöspäin):
    //   +x = puhelimen oikea reuna, +y = puhelimen yläreuna (eteenpäin)
    // Ruudun koordinaatistossa y kasvaa alaspäin, joten eteenpäin = -y.
    // Kertymä on nopeuden suuntainen; normalisoidaan ja verrataan sen
    // vaakaosuutta kokonaisuuteen.
    const total = Math.hypot(s.dirX, s.dirY, s.dirZ) || 1;
    const dx = s.dirX / total;
    const dy = -s.dirY / total;
    const flat = Math.hypot(dx, dy);

    // Pystysuora ravistus ei kelpaa suunnaksi: vaaditaan että liikkeestä
    // riittävä osa tapahtui radan tasossa.
    const usable = s.peakSpeed >= SWING_V_MIN && flat >= 0.45;
    const direction = usable ? { x: dx / flat, y: dy / flat } : null;

    this.dispatchEvent(
      new CustomEvent('swing', {
        detail: {
          // Teho lasketaan vaakasuorasta osuudesta, jotta pelkkä
          // ylös-alas-heiluttelu ei tuota täyttä lyöntiä.
          power: powerFromSpeed(s.peakSpeed * flat),
          peak: s.peakSpeed,
          flat,
          direction,
          duration: performance.now() / 1000 - s.start,
        },
      }),
    );
  }
}

export function powerFromSpeed(speed) {
  const p = (speed - SWING_V_MIN) / (SWING_V_MAX - SWING_V_MIN);
  return Math.max(0, Math.min(1, p));
}
