// Pelin ohjaus: tilakone, syötteet, kierroksen kulku ja käyttöliittymä.

import { COURSES, TOTAL_PAR } from './courses.js';
import { buildWorld } from './world.js';
import {
  createBall,
  stepBall,
  launchBall,
  MAX_SPEED,
  BALL_RADIUS,
  STATIC_FRICTION,
  GRAVITY,
} from './physics.js';
import { Renderer } from './render.js';
import { MotionInput, motionSupported, needsMotionPermission } from './sensors.js';
import { Sfx } from './audio.js';

const MIN_SHOT_SPEED = 0.65;
const MAX_SHOT_SPEED = MAX_SPEED;
const MAX_DRAG_METERS = 0.9; // täysi voima tällä vetomatkalla
const SHOT_TIME_LIMIT = 22; // s, tämän jälkeen palloa hidastetaan pakolla
// Kameran lähennys pallon vieriessä.
//
// Zoom valitaan kerran lyönnin alussa eikä sitä sidota hetkelliseen nopeuteen:
// jokainen lyönti päättyy hitaaseen palloon, joten nopeuteen sidottu zoom oli
// aina tiukimmillaan juuri lyönnin lopussa. Lähellä reikää, jossa putit ovat
// lyhyitä ja peräkkäisiä, kamera ei ehtinyt palata lainkaan.
const PLAY_ZOOM = 1.5;
// Lyhyt putti ei tarvitse kameraliikettä ollenkaan.
const ZOOM_MIN_SHOT_SPEED = 1.3; // m/s

const STORAGE_KEY = 'monogolf.v1';

const MODES = [
  {
    id: 'swing',
    label: 'Tila: heilautus',
    hint: 'Pidä puhelinta vaakatasossa näyttö ylöspäin ja heilauta siihen suuntaan, johon haluat lyödä. Pallo lähtee vasta kun puhelin on taas paikallaan.',
    needsMotion: true,
  },
  {
    id: 'aim',
    label: 'Tila: tähtäys',
    hint: 'Aseta suunta sormella radalta ja heilauta puhelinta. Pallo lähtee kun puhelin pysähtyy.',
    needsMotion: true,
  },
  {
    id: 'touch',
    label: 'Tila: kosketus',
    hint: 'Vedä pallosta taaksepäin ja päästä irti – kuin ritsalla.',
    needsMotion: false,
  },
];

export class Game {
  constructor(root) {
    this.el = {
      canvas: root.querySelector('#course'),
      holeNumber: root.querySelector('#holeNumber'),
      holeName: root.querySelector('#holeName'),
      par: root.querySelector('#par'),
      strokes: root.querySelector('#strokes'),
      total: root.querySelector('#total'),
      status: root.querySelector('#status'),
      hint: root.querySelector('#hint'),
      powerFill: root.querySelector('#powerFill'),
      powerLabel: root.querySelector('#powerLabel'),
      motionFill: root.querySelector('#motionFill'),
      motionRow: root.querySelector('#motionRow'),
      btnSensors: root.querySelector('#btnSensors'),
      btnMode: root.querySelector('#btnMode'),
      btnReset: root.querySelector('#btnReset'),
      btnSound: root.querySelector('#btnSound'),
      btnScore: root.querySelector('#btnScore'),
      btnNewGame: root.querySelector('#btnNewGame'),
      btnFullscreen: root.querySelector('#btnFullscreen'),
      installHint: root.querySelector('#installHint'),
      menuNote: root.querySelector('#menuNote'),
      overlay: root.querySelector('#overlay'),
      overlayCard: root.querySelector('#overlayCard'),
      topbar: root.querySelector('.topbar'),
      hud: root.querySelector('#hud'),
      menu: root.querySelector('#menu'),
      btnMenu: root.querySelector('#btnMenu'),
      btnMenuClose: root.querySelector('#btnMenuClose'),
    };
    this.root = root;
    this.playing = false;

    this.renderer = new Renderer(this.el.canvas);
    this.sfx = new Sfx();
    this.motion = new MotionInput();

    this.state = 'intro'; // intro | ready | rolling | holed | finished
    this.holeIndex = 0;
    this.strokes = 0;
    this.scores = new Array(COURSES.length).fill(null);
    this.best = {};
    this.mode = motionSupported() ? 'swing' : 'touch';
    this.soundOn = true;
    this.wantsFullscreen = false;

    this.aim = { dirX: 0, dirY: -1, power: 0.5, visible: false, fromTouch: false };
    this.drag = null;
    this.shotTime = 0;
    this.shotZoom = 1;
    this.safeSpot = null;
    this.lastFrame = 0;
    this.time = 0;
    this.insetTop = 0;
    this.insetBottom = 0;

    this.loadProgress();
    this.bindUI();
    this.bindMotion();
    this.bindPointer();

    this.loadHole(this.holeIndex, true);
    this.showIntro();
    requestAnimationFrame((t) => this.loop(t));
  }

  // --- Tallennus ------------------------------------------------------------

  loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.scores) && data.scores.length === COURSES.length) {
        this.scores = data.scores;
      }
      if (typeof data.holeIndex === 'number') {
        this.holeIndex = Math.min(COURSES.length - 1, Math.max(0, data.holeIndex));
      }
      if (data.best && typeof data.best === 'object') this.best = data.best;
      // Loppuun pelattu kierros aloitetaan seuraavalla kerralla alusta,
      // muuten peli avautuisi väylälle 18 ilman mitään pelattavaa.
      if (this.scores.every((x) => x != null)) {
        this.scores = new Array(COURSES.length).fill(null);
        this.holeIndex = 0;
      }
      if (typeof data.soundOn === 'boolean') this.soundOn = data.soundOn;
      if (typeof data.wantsFullscreen === 'boolean') this.wantsFullscreen = data.wantsFullscreen;
      if (typeof data.mode === 'string' && MODES.some((m) => m.id === data.mode)) {
        this.mode = data.mode;
      }
    } catch {
      /* vioittunut tallennus ohitetaan */
    }
  }

  saveProgress() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          scores: this.scores,
          holeIndex: this.holeIndex,
          best: this.best,
          soundOn: this.soundOn,
          mode: this.mode,
          wantsFullscreen: this.wantsFullscreen,
        }),
      );
    } catch {
      /* privaatti selaustila */
    }
  }

  // --- Käyttöliittymä -------------------------------------------------------

  bindUI() {
    this.el.btnSensors.addEventListener('click', () => this.enableSensors());
    this.el.btnMode.addEventListener('click', () => this.cycleMode());
    this.el.btnReset.addEventListener('click', () => {
      this.setMenuOpen(false);
      this.resetHole();
    });
    this.el.btnScore.addEventListener('click', () => {
      this.setMenuOpen(false);
      this.showScorecard();
    });
    this.el.btnNewGame.addEventListener('click', () => {
      this.setMenuOpen(false);
      this.confirmNewGame();
    });
    this.el.btnMenu.addEventListener('click', () => this.toggleMenu());
    this.el.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.updateChrome());
    document.addEventListener('webkitfullscreenchange', () => this.updateChrome());
    this.el.btnMenuClose.addEventListener('click', () => this.setMenuOpen(false));
    this.el.btnSound.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      this.sfx.setEnabled(this.soundOn);
      this.updateChrome();
      this.saveProgress();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lastFrame = 0;
    });
    window.addEventListener('resize', () => this.renderer.resize(this.world));
  }

  bindMotion() {
    this.motion.addEventListener('motion', (e) => {
      const level = Math.min(1, e.detail.level / 25);
      this.el.motionFill.style.width = `${level * 100}%`;
    });
    this.motion.addEventListener('swingstart', () => {
      if (this.state !== 'ready') return;
      this.setStatus('Liike tallennetaan – pysäytä puhelin niin pallo lähtee.');
    });
    this.motion.addEventListener('swingprogress', (e) => {
      if (this.state !== 'ready') return;
      this.setPower(e.detail.power);
    });
    this.motion.addEventListener('swingcancel', () => {
      if (this.state !== 'ready') return;
      this.setPower(0);
      this.setStatus('Liian kevyt liike. Heilauta jämäkämmin.');
    });
    this.motion.addEventListener('swing', (e) => this.onSwing(e.detail));
  }

  bindPointer() {
    const c = this.el.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', () => {
      this.drag = null;
      if (this.mode === 'touch') this.aim.visible = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pointerWorld(e) {
    const rect = this.el.canvas.getBoundingClientRect();
    return this.renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  onPointerDown(e) {
    this.sfx.resume();
    if (this.state !== 'ready' || this.mode === 'swing') return;
    e.preventDefault();
    this.el.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.pointerWorld(e);
    this.drag = { x, y };
    this.updateDragAim(x, y);
  }

  onPointerMove(e) {
    if (!this.drag || this.state !== 'ready') return;
    e.preventDefault();
    const [x, y] = this.pointerWorld(e);
    this.updateDragAim(x, y);
  }

  onPointerUp(e) {
    if (!this.drag || this.state !== 'ready') return;
    e.preventDefault();
    const [x, y] = this.pointerWorld(e);
    this.updateDragAim(x, y);
    this.drag = null;
    if (this.mode === 'touch') {
      if (this.aim.power > 0.04) {
        this.shoot(this.aim.dirX, this.aim.dirY, this.aim.power);
      } else {
        this.aim.visible = false;
        this.setPower(0);
      }
    }
  }

  updateDragAim(x, y) {
    const dx = x - this.ball.x;
    const dy = y - this.ball.y;
    const dist = Math.hypot(dx, dy);
    if (dist < BALL_RADIUS * 0.6) return;

    if (this.mode === 'touch') {
      // Ritsa: vedä pallosta poispäin, lyönti lähtee vastakkaiseen suuntaan.
      this.aim.dirX = -dx / dist;
      this.aim.dirY = -dy / dist;
      this.aim.power = Math.min(1, dist / MAX_DRAG_METERS);
    } else {
      // Tähtäys: nuoli osoittaa sormea kohti, voima tulee heilautuksesta.
      this.aim.dirX = dx / dist;
      this.aim.dirY = dy / dist;
    }
    this.aim.visible = true;
    this.aim.fromTouch = true;
    this.setPower(this.aim.power);
  }

  cycleMode() {
    const i = MODES.findIndex((m) => m.id === this.mode);
    const next = MODES[(i + 1) % MODES.length];
    this.mode = next.id;
    this.aim.visible = this.mode === 'aim';
    this.saveProgress();
    this.updateChrome();
    this.armIfReady();
    this.setStatus(next.hint);
  }

  async enableSensors() {
    this.sfx.resume();
    if (!motionSupported()) {
      this.setStatus('Tämä laite ei tarjoa liikeantureita. Käytä kosketusohjausta.');
      this.mode = 'touch';
      this.updateChrome();
      return;
    }
    const ok = await this.motion.enable();
    if (!ok) {
      this.setStatus(
        this.motion.permission === 'denied'
          ? 'Anturilupa evättiin. Salli liikeanturit selaimen asetuksista tai pelaa kosketuksella.'
          : 'Antureita ei saatu käyttöön.',
      );
      this.mode = 'touch';
      this.updateChrome();
      return;
    }
    if (this.mode === 'touch') this.mode = 'swing';
    this.updateChrome();
    this.armIfReady();
    this.setStatus('Anturit käytössä. ' + MODES.find((m) => m.id === this.mode).hint);
  }

  updateChrome() {
    const hole = COURSES[this.holeIndex];
    const mode = MODES.find((m) => m.id === this.mode);
    this.el.holeNumber.textContent = `${this.holeIndex + 1}/18`;
    this.el.holeName.textContent = hole.name;
    this.el.par.textContent = `Par ${hole.par}`;
    this.el.strokes.textContent = String(this.strokes);
    const played = this.scores.reduce((a, s) => (s == null ? a : a + s), 0);
    const parPlayed = this.scores.reduce((a, s, i) => (s == null ? a : a + COURSES[i].par), 0);
    const diff = played - parPlayed;
    this.el.total.textContent =
      played === 0 && this.scores.every((s) => s == null)
        ? '–'
        : `${played} (${diff > 0 ? '+' : ''}${diff})`;
    this.el.hint.textContent = hole.hint;
    this.el.btnMode.textContent = mode.label;
    const fsUsable = this.fullscreenSupported() && !this.isStandalone();
    this.el.btnFullscreen.hidden = !fsUsable;
    // iOS ei tue Fullscreen APIa: siellä ainoa keino on aloitusnäytölle lisäys.
    this.el.installHint.hidden = fsUsable || this.isStandalone();
    this.el.btnFullscreen.textContent = this.isFullscreen()
      ? 'Poistu koko näytöstä'
      : 'Koko näyttö';
    this.el.btnSound.textContent = this.soundOn ? '🔊' : '🔇';
    this.el.btnSound.setAttribute(
      'aria-label',
      this.soundOn ? 'Äänet päällä' : 'Äänet pois',
    );
    // Anturipainike on kertaluontoinen lupapyyntö: kun lupa on myönnetty,
    // painike katoaa eikä jätä jälkeensä tilamerkkiä. Anturien toiminnan näkee
    // Liike-mittarista.
    const sensorsReady = this.motion.permission === 'granted';
    this.el.btnSensors.hidden = sensorsReady;
    this.el.btnSensors.textContent =
      this.motion.permission === 'denied' ? 'Anturit estetty – yritä uudelleen' : 'Ota anturit käyttöön';
    this.el.motionRow.hidden = !sensorsReady;
  }

  setStatus(text) {
    this.el.status.textContent = text;
  }

  // --- Koko näyttö ----------------------------------------------------------
  //
  // Fullscreen API vaatii käyttäjän eleen ja toimii Androidilla. iOS-Safari ei
  // tue sitä muille kuin videoille, joten siellä selainkehyksistä pääsee eroon
  // vain lisäämällä pelin aloitusnäytölle (manifest, display: fullscreen).

  fullscreenSupported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  isStandalone() {
    return (
      window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)')?.matches ||
      window.navigator.standalone === true
    );
  }

  async requestFullscreen() {
    // Osa selaimista kieltäytyy juurielementistä mutta suostuu sovelluksen
    // säiliöön, joten kokeillaan molempia.
    const targets = [document.documentElement, this.root];
    let lastError = null;
    for (const el of targets) {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: 'hide' });
          return true;
        }
        if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
          return true;
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Fullscreen API puuttuu');
  }

  async toggleFullscreen() {
    this.setMenuNote('');
    try {
      if (this.isFullscreen()) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
        this.wantsFullscreen = false;
      } else {
        await this.requestFullscreen();
        this.wantsFullscreen = true;
        // Peli on pystysuuntainen; lukitus onnistuu vain koko näytössä eikä
        // kaikilla selaimilla – epäonnistuminen ei haittaa.
        try {
          await screen.orientation?.lock?.('portrait');
        } catch {
          /* ei tuettu */
        }
      }
    } catch (err) {
      // Virhe näytetään valikossa: tilarivi on valikon alla piilossa.
      this.setMenuNote(`Selain ei antanut siirtyä koko näyttöön (${err?.name || 'virhe'}).`);
    }
    this.saveProgress();
    this.updateChrome();
  }

  setMenuNote(text) {
    this.el.menuNote.textContent = text;
    this.el.menuNote.hidden = !text;
  }

  /** Palauttaa koko näytön käyttäjän eleestä, jos se oli viime kerralla päällä. */
  restoreFullscreen() {
    if (!this.wantsFullscreen || this.isFullscreen() || !this.fullscreenSupported()) return;
    const el = document.documentElement;
    try {
      el.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
    } catch {
      /* ele ei kelvannut */
    }
  }

  /** Valikko peittää pelialueen, joten anturit eivät saa olla viritettyinä. */
  setMenuOpen(open) {
    this.el.menu.hidden = !open;
    this.el.btnMenu.setAttribute('aria-expanded', String(open));
    if (open) this.motion.disarm();
    else this.armIfReady();
  }

  toggleMenu() {
    if (this.el.menu.hidden) this.setMenuNote('');
    this.setMenuOpen(this.el.menu.hidden);
  }

  setPower(p) {
    const pct = Math.max(0, Math.min(1, p)) * 100;
    this.el.powerFill.style.width = `${pct}%`;
    this.el.powerLabel.textContent = `${Math.round(pct)} %`;
    if (this.mode !== 'touch') this.aim.power = Math.max(0, Math.min(1, p));
  }

  // --- Väylän kulku ---------------------------------------------------------

  loadHole(index, silent = false) {
    this.holeIndex = index;
    const hole = COURSES[index];
    this.world = buildWorld(hole);
    this.ball = createBall(this.world.tee.x, this.world.tee.y);
    this.ball.spinAngle = 0;
    this.strokes = 0;
    this.safeSpot = { x: this.ball.x, y: this.ball.y };
    this.shotTime = 0;
    this.renderer.resetView();
    this.renderer.resize(this.world);
    this.aim = {
      dirX: 0,
      dirY: -1,
      power: this.mode === 'touch' ? 0 : 0.5,
      visible: this.mode === 'aim',
      fromTouch: false,
    };
    this.setPower(0);
    this.state = this.el.overlay.hidden ? 'ready' : 'intro';
    this.updateChrome();
    this.armIfReady();
    if (!silent) this.setStatus(this.readyText());
    this.saveProgress();
  }

  readyText() {
    if (this.mode === 'touch') return 'Vedä pallosta ja päästä irti.';
    if (this.motion.permission !== 'granted') {
      return 'Ota anturit käyttöön tai vaihda kosketusohjaukseen.';
    }
    if (this.mode === 'aim') return 'Aseta suunta sormella ja heilauta puhelinta.';
    return 'Heilauta puhelinta – pallo lähtee kun pysäytät sen.';
  }

  armIfReady() {
    const wantsMotion = this.mode !== 'touch';
    const uiBlocked = !this.el.overlay.hidden || !this.el.menu.hidden;
    if (!uiBlocked && this.state === 'ready' && wantsMotion && this.motion.permission === 'granted') {
      this.motion.arm();
    } else {
      this.motion.disarm();
    }
  }

  onSwing(detail) {
    if (this.state !== 'ready') return;
    if (this.mode === 'touch') return;

    let dirX = this.aim.dirX;
    let dirY = this.aim.dirY;
    if (this.mode === 'swing') {
      if (!detail.direction) {
        this.setStatus('Heilautuksen suuntaa ei tunnistettu – heilauta jämäkämmin.');
        this.setPower(0);
        return;
      }
      dirX = detail.direction.x;
      dirY = detail.direction.y;
    }
    this.shoot(dirX, dirY, detail.power);
  }

  shoot(dirX, dirY, power) {
    const p = Math.max(0, Math.min(1, power));
    const speed = MIN_SHOT_SPEED + Math.pow(p, 1.15) * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
    launchBall(this.ball, dirX, dirY, speed);
    this.shotZoom = speed >= ZOOM_MIN_SHOT_SPEED ? PLAY_ZOOM : 1;
    this.strokes++;
    this.shotTime = 0;
    this.state = 'rolling';
    this.motion.disarm();
    this.setMenuOpen(false);
    this.renderer.clearTrail();
    this.aim.visible = false;
    this.sfx.resume();
    this.sfx.hit(p);
    this.updateChrome();
    this.setStatus('Anturit pois päältä – pallo vierii.');
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'bounce') {
        this.sfx.bounce(e.impact);
        this.renderer.spawnSparks(e.x, e.y, e.impact);
      } else if (e.type === 'holed') {
        this.renderer.spawnHoleBurst(this.world.cup.x, this.world.cup.y);
        this.onHoled();
      } else if (e.type === 'water') {
        this.renderer.spawnSplash(e.x, e.y);
        this.onPenalty('vesi');
      } else if (e.type === 'out') {
        this.onPenalty('ulos');
      } else if (e.type === 'lipout') {
        this.flashMessage('Reunalta ohi!');
      }
    }
  }

  onPenalty(kind) {
    this.state = 'ready';
    this.sfx.splash();
    if (kind === 'vesi') {
      this.strokes++;
      this.flashMessage('Vesieste! Rangaistuslyönti.');
      this.setStatus('Pallo vedessä: +1 lyönti, jatketaan edellisestä paikasta.');
    } else {
      this.flashMessage('Pallo karkasi radalta.');
      this.setStatus('Pallo palautettiin radalle.');
    }
    this.ball.x = this.safeSpot.x;
    this.ball.y = this.safeSpot.y;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.w = 0;
    this.ball.resting = true;
    this.renderer.clearTrail();
    this.setPower(0);
    this.aim.visible = this.mode === 'aim';
    this.updateChrome();
    this.armIfReady();
  }

  onHoled() {
    this.state = 'holed';
    this.motion.disarm();
    this.sfx.holed();
    const hole = COURSES[this.holeIndex];
    this.scores[this.holeIndex] = this.strokes;
    const bestKey = String(this.holeIndex);
    if (this.best[bestKey] == null || this.strokes < this.best[bestKey]) {
      this.best[bestKey] = this.strokes;
    }
    this.saveProgress();
    this.updateChrome();

    const diff = this.strokes - hole.par;
    const title = scoreName(this.strokes, hole.par);
    const last = this.holeIndex === COURSES.length - 1;
    this.showCard({
      title,
      lines: [
        `Väylä ${this.holeIndex + 1}: ${hole.name}`,
        `${this.strokes} lyöntiä (par ${hole.par}, ${diff > 0 ? '+' : ''}${diff})`,
        `Paras tuloksesi tällä väylällä: ${this.best[bestKey]}`,
      ],
      actions: [
        {
          label: last ? 'Katso tuloskortti' : 'Seuraava väylä →',
          primary: true,
          onClick: () => {
            if (last) this.finishRound();
            else {
              this.hideCard();
              this.loadHole(this.holeIndex + 1);
            }
          },
        },
        {
          label: 'Pelaa väylä uudelleen',
          onClick: () => {
            this.hideCard();
            this.scores[this.holeIndex] = null;
            this.loadHole(this.holeIndex);
          },
        },
      ],
    });
  }

  resetHole() {
    if (this.state === 'finished') return;
    this.scores[this.holeIndex] = null;
    this.loadHole(this.holeIndex);
    this.setStatus('Väylä aloitettu alusta.');
  }

  finishRound() {
    this.state = 'finished';
    this.sfx.fanfare();
    this.showScorecard(true);
  }

  // --- Kortit / overlay -----------------------------------------------------

  showCard({ title, lines = [], html = '', note = '', actions = [] }) {
    const card = this.el.overlayCard;
    card.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    card.appendChild(h);
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line;
      card.appendChild(p);
    }
    if (html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      card.appendChild(div);
    }
    if (note) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = note;
      card.appendChild(p);
    }
    const row = document.createElement('div');
    row.className = 'card-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.className = a.primary ? 'primary' : '';
      btn.addEventListener('click', () => {
        this.sfx.resume();
        a.onClick();
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
    this.el.overlay.hidden = false;
    if (this.el.menu) this.el.menu.hidden = true;
    // Kortin ollessa auki heilautus ei saa laukaista lyöntiä.
    this.motion.disarm();
  }

  hideCard() {
    this.el.overlay.hidden = true;
    this.armIfReady();
  }

  /** Koko pelin nollaus – varmistetaan, ettei se tapahdu vahingossa. */
  confirmNewGame() {
    const hasRecords = Object.keys(this.best).length > 0;
    this.showCard({
      title: 'Nollataanko peli?',
      lines: [
        'Kierroksen tulokset nollataan ja peli alkaa väylältä 1.',
        hasRecords
          ? 'Väyläkohtaiset ennätyksesi säilyvät, ellet nollaa niitä erikseen.'
          : 'Ennätyksiä ei ole vielä tallennettu.',
      ],
      actions: [
        {
          label: 'Nollaa kierros',
          primary: true,
          onClick: () => this.newGame(false),
        },
        ...(hasRecords
          ? [{ label: 'Nollaa kierros ja ennätykset', onClick: () => this.newGame(true) }]
          : []),
        { label: 'Peruuta', onClick: () => this.hideCard() },
      ],
    });
  }

  newGame(clearRecords) {
    this.scores = new Array(COURSES.length).fill(null);
    if (clearRecords) this.best = {};
    this.hideCard();
    this.loadHole(0);
    this.saveProgress();
    this.startHoleIntro();
  }

  showIntro() {
    const sensorText = motionSupported()
      ? needsMotionPermission()
        ? 'Laitteesi kysyy luvan liikeantureihin – salli se, jotta heilautus toimii.'
        : 'Liikeanturit löytyivät. Ota ne käyttöön alta.'
      : 'Tästä selaimesta ei löydy liikeantureita – peli toimii myös kosketuksella.';

    // Kesken jäänyt kierros jatkuu, mutta se sanotaan ääneen – muuten peli
    // avautuisi selittämättä keskelle kierrosta.
    const resumed = this.holeIndex > 0 || this.scores.some((x) => x != null);
    const lines = [
      '18 väylää minigolfia superpallolla, joka kimpoaa laidoista oikean fysiikan mukaan.',
      'Pidä puhelinta vaakatasossa näyttö ylöspäin ja heilauta sitä siihen suuntaan, johon haluat lyödä. Heilautuksen voimakkuus on lyönnin voima, ja pallo lähtee liikkeelle sillä hetkellä kun pysäytät puhelimen.',
      'Lyönnin jälkeen anturit kytkeytyvät pois – pallo vierii rauhassa loppuun asti.',
      sensorText,
    ];
    if (resumed) {
      lines.splice(3, 0, `Kesken jäänyt kierros jatkuu väylältä ${this.holeIndex + 1}.`);
    }

    const start = (touchOnly) => async () => {
      this.restoreFullscreen();
      if (touchOnly) {
        this.mode = 'touch';
        this.updateChrome();
      } else {
        await this.enableSensors();
      }
      this.hideCard();
      this.startHoleIntro();
    };

    this.showCard({
      title: 'MonoGolf',
      lines,
      actions: [
        {
          label: resumed
            ? `Jatka väylältä ${this.holeIndex + 1}`
            : 'Ota anturit käyttöön ja aloita',
          primary: true,
          onClick: start(false),
        },
        { label: 'Pelaa kosketuksella', onClick: start(true) },
        ...(resumed
          ? [
              {
                label: 'Aloita alusta väylältä 1',
                onClick: () => {
                  this.scores = new Array(COURSES.length).fill(null);
                  this.loadHole(0);
                  this.hideCard();
                  this.startHoleIntro();
                },
              },
            ]
          : []),
      ],
    });
  }

  startHoleIntro() {
    const hole = COURSES[this.holeIndex];
    this.state = 'intro';
    this.showCard({
      title: `Väylä ${this.holeIndex + 1} – ${hole.name}`,
      lines: [`Par ${hole.par}`, hole.hint],
      actions: [
        {
          label: 'Pelaa',
          primary: true,
          onClick: () => {
            this.hideCard();
            this.state = 'ready';
            this.armIfReady();
            this.setStatus(this.readyText());
          },
        },
      ],
    });
  }

  showScorecard(final = false) {
    const rows = COURSES.map((hole, i) => {
      const s = this.scores[i];
      const diff = s == null ? null : s - hole.par;
      const cls = diff == null ? '' : diff < 0 ? 'under' : diff > 0 ? 'over' : 'even';
      const current = i === this.holeIndex ? ' current' : '';
      return `<tr class="${cls}${current}" data-hole="${i}" tabindex="0" title="Siirry väylälle ${i + 1}">
        <td>${i + 1}</td>
        <td class="name">${hole.name}</td>
        <td>${hole.par}</td>
        <td>${s ?? '–'}</td>
        <td>${this.best[String(i)] ?? '–'}</td>
      </tr>`;
    }).join('');

    const played = this.scores.reduce((a, s) => (s == null ? a : a + s), 0);
    const parPlayed = this.scores.reduce((a, s, i) => (s == null ? a : a + COURSES[i].par), 0);
    const diff = played - parPlayed;
    const complete = this.scores.every((s) => s != null);

    const html = `<table class="scorecard">
      <thead><tr><th>#</th><th>Väylä</th><th>Par</th><th>Tulos</th><th>Paras</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td>Yhteensä</td><td>${TOTAL_PAR}</td><td>${played || '–'}</td><td></td></tr></tfoot>
    </table>
    <p class="total-line">${
      complete
        ? `Kierros valmis: ${played} lyöntiä, ${diff > 0 ? '+' : ''}${diff} paria vasten.`
        : `Pelatut väylät: ${played} lyöntiä (${diff > 0 ? '+' : ''}${diff}).`
    }</p>`;

    const actions = [];
    if (final || complete) {
      actions.push({
        label: 'Uusi kierros',
        primary: true,
        onClick: () => {
          this.scores = new Array(COURSES.length).fill(null);
          this.hideCard();
          this.loadHole(0);
          this.startHoleIntro();
        },
      });
    }
    if (!final) {
      actions.push({
        label: 'Takaisin peliin',
        primary: !complete,
        onClick: () => this.hideCard(),
      });
    }
    this.showCard({
      title: final ? 'Kierros pelattu!' : 'Tuloskortti',
      html,
      note: 'Napauta väylää siirtyäksesi sille.',
      actions,
    });

    // Väylän valinta suoraan tuloskortista – näppärä myös jos jokin väylä
    // tuntuu mahdottomalta.
    for (const row of this.el.overlayCard.querySelectorAll('tr[data-hole]')) {
      const jump = () => {
        const i = Number(row.dataset.hole);
        this.hideCard();
        this.loadHole(i);
      };
      row.addEventListener('click', jump);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jump();
        }
      });
    }
  }

  flashMessage(text) {
    this.setStatus(text);
  }

  // --- Pääsilmukka ----------------------------------------------------------

  loop(now) {
    const t = now / 1000;
    let dt = this.lastFrame ? t - this.lastFrame : 0;
    this.lastFrame = t;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    if (this.state === 'ready' && this.ball.resting && this.ballWouldRoll()) {
      // Pallo pysähtyi kaltevalle pinnalle: painovoima jatkaa työtään.
      this.ball.resting = false;
      this.state = 'rolling';
      this.shotZoom = 1;
      this.shotTime = 0;
      this.setStatus('Pallo vierii rinnettä alas.');
      this.motion.disarm();
      this.updateChrome();
    }

    if (this.state === 'rolling') {
      const events = [];
      this.shotTime += dt;
      if (this.shotTime > SHOT_TIME_LIMIT) {
        // Varmistus: hyvin liukkaalla radalla pallo pysäytetään lopulta.
        this.ball.vx *= 0.97;
        this.ball.vy *= 0.97;
      }
      stepBall(this.ball, this.world, dt, events);
      this.renderer.pushTrail(this.ball.x, this.ball.y);
      this.handleEvents(events);
      if (this.state === 'rolling' && this.ball.resting) this.onBallStopped();
    } else {
      this.world.advance(dt);
    }

    const playing = this.state === 'rolling';
    if (playing !== this.playing) {
      this.playing = playing;
      this.root.classList.toggle('is-playing', playing);
    }

    this.syncInsets();
    this.ball.spinAngle = (this.ball.spinAngle || 0) + this.ball.w * dt;

    if (this.state === 'ready' && this.mode === 'swing') {
      // Ennen lyöntiä näytetään viimeksi käytetty suunta ohjeeksi.
      this.aim.visible = false;
    }

    this.renderer.draw({
      world: this.world,
      ball: this.ball,
      aim: this.aim,
      time: this.time,
      dt,
      camera: this.cameraTarget(),
    });

    requestAnimationFrame((n) => this.loop(n));
  }

  /**
   * Kertoo renderöijälle, paljonko tilaa yläpalkki ja tekstipalkki vievät,
   * jotta rata mahtuu niiden väliin. Mitataan DOMista, koska tekstin määrä
   * ja turva-alueet vaihtelevat laitteittain.
   */
  syncInsets() {
    const top = this.el.topbar?.offsetHeight || 0;
    const hud = this.el.hud;
    const stage = this.el.canvas.getBoundingClientRect();
    let bottom = 0;
    if (hud && !hud.hidden) {
      const r = hud.getBoundingClientRect();
      bottom = Math.max(0, stage.bottom - r.top + 8);
    }
    if (top !== this.insetTop || Math.abs(bottom - this.insetBottom) > 1) {
      this.insetTop = top;
      this.insetBottom = bottom;
      this.renderer.setInsets(top, bottom);
    }
  }

  /** Onko pallo pinnalla, joka lähtee vierittämään sitä itsestään? */
  ballWouldRoll() {
    const surf = this.world.surfaceAt(this.ball.x, this.ball.y);
    return Math.hypot(surf.ax, surf.ay) > STATIC_FRICTION * surf.mu * GRAVITY;
  }

  /** Pelin aikana kamera seuraa palloa lähempää, muuten koko väylä näkyy. */
  cameraTarget() {
    if (this.state !== 'rolling') return { zoom: 1, follow: null };
    return { zoom: this.shotZoom || 1, follow: this.ball };
  }

  onBallStopped() {
    this.state = 'ready';
    this.safeSpot = { x: this.ball.x, y: this.ball.y };
    this.setPower(0);
    this.aim.visible = this.mode === 'aim';
    this.armIfReady();
    const dist = Math.hypot(this.world.cup.x - this.ball.x, this.world.cup.y - this.ball.y);
    const surf = this.world.surfaceAt(this.ball.x, this.ball.y);
    const where =
      surf.type === 'sand'
        ? ' Pallo on hiekassa.'
        : surf.type === 'ice'
          ? ' Pallo on jäällä.'
          : '';
    this.setStatus(`${this.readyText()} Reikään ${dist.toFixed(2)} m.${where}`);
  }
}

function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Tuplabogey';
  return `+${d}`;
}

export { MODES };
