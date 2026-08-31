// Golf-lyönnin tunnistus gyrodatasta.
//
// Malli vastaa oikeaa lyöntiä: ohjain nollataan lyöntiasennossa, jolloin
// kuvitteellinen pallo on mailan lavan kohdalla. Sen jälkeen
//
//   * ohjainta hitaasti kiertämällä käännetään lyöntisuuntaa (kierto
//     pystyakselin ympäri, eli sama liike kuin jalkalinjan kääntäminen),
//   * taaksevienti tunnistetaan nopeasta poikkeamasta lyöntiasennosta –
//     kiertoakselista riippumatta,
//   * osuma tapahtuu sillä hetkellä kun maila palaa vauhdilla takaisin
//     lyöntiasentoon.
//
// Tähtäys ja lyönti erotellaan NOPEUDELLA, ei kiertoakselilla: oikeassa
// heilautuksessa hartiat ja ranteet kiertävät mailaa myös pystyakselin
// ympäri, joten akseliin perustuva jako tulkitsi laitetesteissä heilautuksen
// tähtäykseksi ja tähtäyskierron lyönniksi. Hidas liike on aina tähtäystä,
// nopea aina lyöntiliikettä.
//
// Asento seurataan integroimalla kulmanopeus kvaternioksi. Gyro on tähän
// oikea anturi: se mittaa kiertoa suoraan eikä sekoa lyönnin kiihtyvyyksistä,
// toisin kuin painovoimasta pääteltävä asento.

const DEG = Math.PI / 180;

// Tätä hitaampi liike on tähtäystä: lyöntiasento (qCalm) seuraa mukana eikä
// taaksevienti ala. Tätä nopeampi jäädyttää lyöntiasennon vertailukohdaksi.
const AIM_TRACK_RATE = 90 * DEG;
// Taaksevienti on tunnistettu, kun maila poikkeaa tämän verran lyöntiasennosta.
const BACKSWING_MIN = 35 * DEG;
// Osuma tulkitaan tapahtuvaksi, kun maila palaa tätä lähemmäs lyöntiasentoa.
const IMPACT_ANGLE = 12 * DEG;
// Jos paluu on niin nopea, ettei mikään näyte osu osumaikkunaan, osuma
// kirjataan lähimmässä kohdassa: kulma alkoi taas kasvaa tämän rajan alla.
const PASS_ANGLE = 25 * DEG;
// Osuman on tapahduttava liikkeessä, ei hitaasti takaisin siirtämällä.
const MIN_IMPACT_RATE = 60 * DEG;
// Lyönnin jälkeen palataan tähtäystilaan, kun liike on rauhoittunut.
const CALM_RATE = 45 * DEG;
const CALM_HOLD = 0.35;

// Tehon kalibrointi mailan kulmanopeudesta (rad/s).
const POWER_MIN_RATE = 110 * DEG;
const POWER_MAX_RATE = 800 * DEG;

// Gyron nollavirheen kompensointi. Tyypillinen virhe on 0,1–1 °/s, mikä
// siirtäisi lyöntikohtaa jopa kymmeniä asteita minuutissa ja veisi osuma-
// alueen alta parissa minuutissa. Virhe opitaan aina kun laite on lähes
// liikkumatta ja vähennetään jokaisesta näytteestä.
const BIAS_MAX_RATE = 3 * DEG; // tätä hiljaisempi = laite paikallaan
const BIAS_TAU = 1.5; // s, oppimisen aikavakio

// Keskeytetty taaksevienti: maila palaa lyöntiasentoon hitaasti lyömättä.
// Ilman paluupolkua tähtäys jäisi lukkoon seuraavaan lyöntiin asti.
const CANCEL_HOLD = 0.4; // s rauhassa lyöntikohdan lähellä
// Jos maila jää taaksevientiin pitkäksi aikaa liikkumatta (esim. nopea
// tähtäyskääntö tulkittiin taaksevienniksi), nykyisestä asennosta tehdään
// uusi lyöntiasento – muuten vaihe jäisi lukkoon.
const BACKSWING_RESET_HOLD = 1.2; // s liikkumatta missä tahansa asennossa

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

function qconj(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Kahden asennon välinen kulma (rad), kiertoakselista riippumatta. */
function angleBetween(qa, qb) {
  const rel = qmul(qconj(qa), qb);
  return 2 * Math.acos(clampRange(Math.abs(rel[0]), -1, 1));
}

/**
 * Kierron osuus annetun akselin ympäri (twist). Käytetään tähtäykseen:
 * pystyakselin kierto on jalkalinjan kääntämistä.
 */
function twistAround(q, axis) {
  const d = q[1] * axis[0] + q[2] * axis[1] + q[3] * axis[2];
  return 2 * Math.atan2(d, Math.abs(q[0]));
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
    this.bias = [0, 0, 0];
    this.cancelFor = 0;
    // Lyöntiasento: seuraa mukana hitaassa liikkeessä, jäätyy nopeassa.
    this.qCalm = [1, 0, 0, 0];
    this.prevRel = 0;
    this.stillFor = 0;
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
    this.qCalm = [1, 0, 0, 0];
    this.prevRel = 0;
    this.aim = 0;
    this.aimOffset = 0;
    this.peakRate = 0;
    this.calmFor = 0;
    this.cancelFor = 0;
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

    // devicemotion antaa asteina sekunnissa: alpha z-akselin, beta x-akselin
    // ja gamma y-akselin ympäri.
    const rawX = (rotationRate.beta || 0) * DEG;
    const rawY = (rotationRate.gamma || 0) * DEG;
    const rawZ = (rotationRate.alpha || 0) * DEG;

    // Nollavirhe opitaan laitteen ollessa lähes paikallaan – myös ennen
    // nollausta, jolloin kalibrointi on valmiina heti alusta.
    if (Math.hypot(rawX, rawY, rawZ) < BIAS_MAX_RATE) {
      const k = 1 - Math.exp(-dt / BIAS_TAU);
      this.bias[0] += (rawX - this.bias[0]) * k;
      this.bias[1] += (rawY - this.bias[1]) * k;
      this.bias[2] += (rawZ - this.bias[2]) * k;
    }
    if (!this.enabled) return;

    const wx = rawX - this.bias[0];
    const wy = rawY - this.bias[1];
    const wz = rawZ - this.bias[2];
    const rate = Math.hypot(wx, wy, wz);

    // Asennon integrointi: q ← q ⊗ Δq, missä Δq on kierto ω·dt.
    const theta = rate * dt;
    if (theta > 1e-6) {
      const s = Math.sin(theta / 2) / rate;
      this.q = qnormalize(qmul(this.q, [Math.cos(theta / 2), wx * s, wy * s, wz * s]));
    }

    const twistAngle = twistAround(this.q, this.axis);
    // Poikkeama lyöntiasennosta, kiertoakselista riippumatta. Akselia ei voi
    // käyttää erotteluun: oikea heilautus kiertää mailaa myös pystyakselin
    // ympäri, joten jako tehdään nopeudella.
    const relAngle = angleBetween(this.qCalm, this.q);

    if (this.phase === 'address') {
      if (rate < AIM_TRACK_RATE) {
        // Hidas liike on tähtäystä: lyöntiasento seuraa mukana, jolloin
        // nopea liike mitataan aina viimeisimmästä rauhallisesta asennosta.
        this.qCalm = this.q;
        const angle = (twistAngle - this.aimOffset) * AIM_SIGN;
        if (Math.abs(angle - this.aim) > 0.5 * DEG) {
          this.aim = angle;
          this.dispatchEvent(new CustomEvent('aim', { detail: { angle } }));
        }
      } else if (relAngle > BACKSWING_MIN) {
        // Nopea poikkeama lyöntiasennosta = taaksevienti. Tähtäys lukitaan
        // sen ajaksi, ettei heilautus siirrä sitä.
        this.peakRate = rate;
        this.cancelFor = 0;
        this.stillFor = 0;
        this.prevRel = relAngle;
        this._setPhase('backswing');
      }
      return;
    }

    if (this.phase === 'backswing') {
      this.peakRate = Math.max(this.peakRate, rate);
      const closing =
        relAngle < IMPACT_ANGLE ||
        // Paluu voi olla niin nopea, ettei mikään näyte osu osumaikkunaan:
        // osuma kirjataan kun kulma kääntyi kasvuun lähellä lyöntiasentoa.
        (relAngle < PASS_ANGLE && relAngle > this.prevRel + 0.5 * DEG);
      if (closing && rate > MIN_IMPACT_RATE) {
        const power = clampRange(
          (this.peakRate - POWER_MIN_RATE) / (POWER_MAX_RATE - POWER_MIN_RATE),
          0,
          1,
        );
        this.calmFor = 0;
        this._setPhase('follow');
        this.dispatchEvent(
          new CustomEvent('impact', { detail: { power, rate: this.peakRate } }),
        );
      } else if (relAngle < IMPACT_ANGLE && rate <= MIN_IMPACT_RATE) {
        // Maila laskettiin rauhassa takaisin: taaksevienti peruuntuu eikä
        // lyöntiä synny. Nollakohta siirretään, ettei tähtäys hypähdä.
        this.cancelFor += dt;
        if (this.cancelFor >= CANCEL_HOLD) {
          this.cancelFor = 0;
          this.qCalm = this.q;
          this.aimOffset = twistAngle - this.aim * AIM_SIGN;
          this._setPhase('address');
        }
      } else {
        this.cancelFor = 0;
      }
      // Pitkään liikkumatta missä tahansa asennossa: tämä ei ollut lyönti.
      // Nykyisestä asennosta tulee uusi lyöntiasento, ettei vaihe jää lukkoon.
      this.stillFor = rate < CALM_RATE ? (this.stillFor || 0) + dt : 0;
      if (this.phase === 'backswing' && this.stillFor >= BACKSWING_RESET_HOLD) {
        this.qCalm = this.q;
        this.aimOffset = twistAngle - this.aim * AIM_SIGN;
        this._setPhase('address');
      }
      this.prevRel = relAngle;
      return;
    }

    if (this.phase === 'follow') {
      this.calmFor = rate < CALM_RATE ? this.calmFor + dt : 0;
      if (this.calmFor >= CALM_HOLD) {
        // Palataan tähtäystilaan hyppäämättä: nykyinen asento vastaa
        // edellistä tähtäystä, joten lyöntiasento ja nollakohta siirretään.
        this.qCalm = this.q;
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
