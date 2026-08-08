// Kevyet äänitehosteet WebAudiolla – ei ulkoisia tiedostoja.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  resume() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        this.enabled = false;
        return;
      }
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.resume();
  }

  _tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.2, sweep = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  hit(power = 1) {
    this._tone({ freq: 320 + power * 200, type: 'triangle', dur: 0.09, gain: 0.16 });
  }

  bounce(impact) {
    const p = Math.min(1, impact / 4);
    this._tone({
      freq: 180 + p * 420,
      type: 'square',
      dur: 0.045,
      gain: 0.03 + p * 0.09,
      sweep: -80,
    });
  }

  splash() {
    this._tone({ freq: 420, type: 'sine', dur: 0.35, gain: 0.15, sweep: -320 });
  }

  holed() {
    if (!this.enabled || !this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'sine', dur: 0.18, gain: 0.18 }), i * 90);
    });
  }

  fanfare() {
    if (!this.enabled || !this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.2 }), i * 140);
    });
  }
}
