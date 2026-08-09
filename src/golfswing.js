// Golf-lyönnin tunnistus gyrodatasta.
//
// Malli vastaa oikeaa lyöntiä: ohjain nollataan lyöntiasennossa, jolloin
// kuvitteellinen pallo on mailan lavan kohdalla. Sen jälkeen
//
//   * ohjainta kiertämällä käännetään lyöntisuuntaa (kierto pystyakselin
//     ympäri, eli sama liike kuin jalkalinjan kääntäminen),
//   * taaksevienti tunnistetaan siitä että maila poikkeaa lyöntiasennosta,
//   * osuma tapahtuu sillä hetkellä kun maila palaa takaisin lyöntiasentoon.
//
// Asento seurataan integroimalla kulmanopeus kvaternioksi. Gyro on tähän
// oikea anturi: se mittaa kiertoa suoraan eikä sekoa lyönnin kiihtyvyyksistä,
// toisin kuin painovoimasta pääteltävä asento.

const DEG = Math.PI / 180;

// Taaksevienti on tunnistettu, kun maila poikkeaa tämän verran lyöntiasennosta.
const BACKSWING_MIN = 35 * DEG;
// Osuma tulkitaan tapahtuvaksi, kun maila palaa tätä lähemmäs lyöntiasentoa.
const IMPACT_ANGLE = 12 * DEG;
// Osuman on tapahduttava liikkeessä, ei hitaasti takaisin siirtämällä.
const MIN_IMPACT_RATE = 60 * DEG;
// Lyönnin jälkeen palataan tähtäystilaan, kun liike on rauhoittunut.
const CALM_RATE = 45 * DEG;
const CALM_HOLD = 0.35;

// Tehon kalibrointi mailan kulmanopeudesta (rad/s).
const POWER_MIN_RATE = 110 * DEG;
const POWER_MAX_RATE = 800 * DEG;

// Suunnan etumerkki: ohjainta myötäpäivään (ylhäältä katsottuna) kääntämällä
// tähtäys kääntyy oikealle. Ruudun y kasvaa alaspäin, joten kulma pienenee.
const AIM_SIGN = -1;

const clampRange = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Kvaternion kertolasku (w, x, y, z). */
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function qnormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/**
 * Jakaa kierron kahteen osaan annetun akselin suhteen:
 * twist = kierto akselin ympäri (tähtäys), swing = poikkeama siitä (lyöntiliike).
 */
function swingTwist(q, axis) {
  const d = q[1] * axis[0] + q[2] * axis[1] + q[3] * axis[2];
  let twist = qnormalize([q[0], axis[0] * d, axis[1] * d, axis[2] * d]);
  // Sama kierto kahdella etumerkillä; valitaan lyhyempi.
  if (twist[0] < 0) twist = twist.map((x) => -x);
  const twistAngle = 2 * Math.atan2(d < 0 ? -Math.abs(d) : Math.abs(d), Math.abs(q[0]));
  const inv = [twist[0], -twist[1], -twist[2], -twist[3]];
  const swing = qmul(q, inv);
  const swingAngle = 2 * Math.acos(clampRange(Math.abs(swing[0]), -1, 1));
  return { twistAngle, swingAngle };
}

/**
 * Tapahtumat:
 *   aim    { angle }  – tähtäyskulma radiaaneina nollauskohdasta
 *   phase  { phase }  – 'idle' | 'address' | 'backswing' | 'follow'
 *   impact { power, rate } – osuma lyöntiasennossa
 */
export class GolfSwing extends EventTarget {
  constructor() {
    super();
    this.enabled = false;
    this.phase = 'idle';
    this.q = [1, 0, 0, 0];
    this.axis = [0, 0, 1];
    this.aim = 0;
    this.aimOffset = 0;
    this.peakRate = 0;
    this.calmFor = 0;
    this.lastAimSent = 0;
    this.hasGyro = false;
    this._onRaw = this._onRaw.bind(this);
  }

  attach(motion) {
    this.motion = motion;
    motion.addEventListener('raw', this._onRaw);
  }

  detach() {
    if (this.motion) this.motion.removeEventListener('raw', this._onRaw);
    this.motion = null;
    this.enabled = false;
  }

  /**
   * Nollaa lyöntiasennon: nykyinen asento on kuvitteellisen pallon kohta ja
   * nykyinen suunta on tähtäyksen nollakohta.
   */
  zero(gravity) {
    const g = gravity || this.lastGravity;
    // Pystyakseli laitteen koordinaatistossa: painovoima osoittaa levossa ylös.
    this.axis = g ? normalize3([g.x, g.y, g.z]) : [0, 0, 1];
    this.q = [1, 0, 0, 0];
    this.aim = 0;
    this.aimOffset = 0;
    this.peakRate = 0;
    this.calmFor = 0;
    this.enabled = true;
    this._setPhase('address');
    this.dispatchEvent(new CustomEvent('aim', { detail: { angle: 0 } }));
  }

  stop() {
    this.enabled = false;
    this._setPhase('idle');
  }

  _setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.dispatchEvent(new CustomEvent('phase', { detail: { phase } }));
  }

  _onRaw(e) {
    const { rotationRate, gravity, dt } = e.detail;
    if (gravity) this.lastGravity = gravity;
    if (!rotationRate || rotationRate.alpha === null) return;
    this.hasGyro = true;
    if (!this.enabled) return;

    // devicemotion antaa asteina sekunnissa: alpha z-akselin, beta x-akselin
    // ja gamma y-akselin ympäri.
    const wx = (rotationRate.beta || 0) * DEG;
    const wy = (rotationRate.gamma || 0) * DEG;
    const wz = (rotationRate.alpha || 0) * DEG;
    const rate = Math.hypot(wx, wy, wz);

    // Asennon integrointi: q ← q ⊗ Δq, missä Δq on kierto ω·dt.
    const theta = rate * dt;
    if (theta > 1e-6) {
      const s = Math.sin(theta / 2) / rate;
      this.q = qnormalize(qmul(this.q, [Math.cos(theta / 2), wx * s, wy * s, wz * s]));
    }

    const { twistAngle, swingAngle } = swingTwist(this.q, this.axis);

    if (this.phase === 'address') {
      // Tähtäys seuraa kiertoa pystyakselin ympäri.
      const angle = (twistAngle - this.aimOffset) * AIM_SIGN;
      if (Math.abs(angle - this.aim) > 0.5 * DEG) {
        this.aim = angle;
        this.dispatchEvent(new CustomEvent('aim', { detail: { angle } }));
      }
      if (swingAngle > BACKSWING_MIN) {
        // Tähtäys lukitaan taaksevienniksi ajaksi: lyöntiliike kiertää
        // mailaa myös pystyakselin ympäri, eikä se saa siirtää tähtäystä.
        this.peakRate = 0;
        this._setPhase('backswing');
      }
      return;
    }

    if (this.phase === 'backswing') {
      this.peakRate = Math.max(this.peakRate, rate);
      if (swingAngle < IMPACT_ANGLE && rate > MIN_IMPACT_RATE) {
        const power = clampRange(
          (this.peakRate - POWER_MIN_RATE) / (POWER_MAX_RATE - POWER_MIN_RATE),
          0,
          1,
        );
        this.calmFor = 0;
        this._setPhase('follow');
        this.dispatchEvent(new CustomEvent('impact', { detail: { power, rate: this.peakRate } }));
      }
      return;
    }

    if (this.phase === 'follow') {
      this.calmFor = rate < CALM_RATE ? this.calmFor + dt : 0;
      if (this.calmFor >= CALM_HOLD) {
        // Palataan tähtäystilaan hyppäämättä: nykyinen asento vastaa
        // edellistä tähtäystä, joten siirretään nollakohtaa.
        this.aimOffset = twistAngle - this.aim * AIM_SIGN;
        this._setPhase('address');
      }
    }
  }
}

export const SWING_TUNING = {
  BACKSWING_MIN,
  IMPACT_ANGLE,
  POWER_MIN_RATE,
  POWER_MAX_RATE,
};
