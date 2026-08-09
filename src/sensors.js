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
const STILL_HOLD = 0.16; // s, kuinka kauan paikallaan ennen laukaisua
const MAX_WINDOW = 4.0; // s, varmistusraja jos puhelin ei pysähdy koskaan
const PEAK_MIN = 7.0; // m/s^2 -> teho 0
const PEAK_MAX = 34.0; // m/s^2 -> teho 1
const GRAVITY_ALPHA = 0.88; // alipäästösuodattimen kerroin

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
      } else {
        const k = GRAVITY_ALPHA;
        this.gravity = {
          x: k * this.gravity.x + (1 - k) * a.x,
          y: k * this.gravity.y + (1 - k) * a.y,
          z: k * this.gravity.z + (1 - k) * a.z,
        };
      }
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
    this._trackSwing(lin, mag, now);
  }

  _trackSwing(lin, mag, now) {
    if (!this.swing) {
      if (mag < START_THRESHOLD) return;
      this.swing = {
        start: now,
        peak: 0,
        peakAt: now,
        stillSince: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 0,
        samples: 0,
      };
      // Varmistus: jos anturitapahtumat loppuvat kesken heilautuksen
      // (selain voi hidastaa niitä), lyönti laukaistaan silti.
      this._swingTimer = setTimeout(() => this._finishSwing(), MAX_WINDOW * 1000 + 40);
      this.dispatchEvent(new CustomEvent('swingstart'));
    }

    const s = this.swing;
    s.samples++;

    if (mag > s.peak) {
      s.peak = mag;
      s.peakAt = now;
      // Suunta luetaan kiihdytysvaiheesta: painotetaan näytteitä
      // huippuun asti, jolloin jarrutusvaihe ei käännä suuntaa.
      s.dirX = 0;
      s.dirY = 0;
      s.dirZ = 0;
    }
    if (now <= s.peakAt + 0.04) {
      s.dirX += lin.x * mag;
      s.dirY += lin.y * mag;
      s.dirZ += lin.z * mag;
    }

    // Puhelin lasketaan paikallaan olevaksi vasta kun liike on tyyntynyt
    // yhtäjaksoisesti STILL_HOLD-ajan. Niin kauan kuin puhelinta liikutetaan,
    // suuntaa ja voimaa vain kerätään talteen.
    if (mag < STILL_THRESHOLD) {
      if (!s.stillSince) s.stillSince = now;
    } else {
      s.stillSince = 0;
    }
    const still = s.stillSince ? now - s.stillSince : 0;

    this.dispatchEvent(
      new CustomEvent('swingprogress', {
        detail: { power: powerFromPeak(s.peak), moving: !s.stillSince, still },
      }),
    );

    if (still >= STILL_HOLD || now - s.start >= MAX_WINDOW) this._finishSwing();
  }

  _finishSwing() {
    const s = this.swing;
    if (!s) return;
    this._clearSwing();
    if (s.samples < 2 || s.peak < PEAK_MIN) {
      this.dispatchEvent(new CustomEvent('swingcancel'));
      return;
    }

    // Laitteen koordinaatisto (puhelin vaaka-asennossa, näyttö ylöspäin):
    //   +x = puhelimen oikea reuna, +y = puhelimen yläreuna (eteenpäin)
    // Ruudun koordinaatistossa y kasvaa alaspäin, joten eteenpäin = -y.
    let dx = s.dirX;
    let dy = -s.dirY;
    const len = Math.hypot(dx, dy);
    let direction = null;
    if (len > 1e-3) {
      direction = { x: dx / len, y: dy / len };
    }

    this.dispatchEvent(
      new CustomEvent('swing', {
        detail: {
          power: powerFromPeak(s.peak),
          peak: s.peak,
          direction,
          duration: performance.now() / 1000 - s.start,
        },
      }),
    );
  }
}

export function powerFromPeak(peak) {
  const p = (peak - PEAK_MIN) / (PEAK_MAX - PEAK_MIN);
  return Math.max(0, Math.min(1, p));
}
