// Pitää näytön hereillä kaukosäädinpelin ajan.
//
// Mailapuhelinta ei kosketa pelatessa, joten ilman tätä Android sammuttaa
// näytön parissa minuutissa – sivu pysähtyy ja yhteys katkeaa. Sama koskee
// näyttöpuhelinta, jota vain katsotaan. Selain vapauttaa lukon aina kun
// välilehti menee piiloon, joten se hankitaan uudelleen kun sivu palaa
// näkyviin.

export class WakeLock {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    this._onVisibility = this._onVisibility.bind(this);
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active() {
    return !!this.sentinel && this.sentinel.released !== true;
  }

  async enable() {
    this.wanted = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    return this._acquire();
  }

  async _acquire() {
    if (!this.supported || document.visibilityState !== 'visible') return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      // Esim. virransäästötila voi evätä pyynnön; peli toimii silti.
      this.sentinel = null;
      return false;
    }
  }

  _onVisibility() {
    if (this.wanted && document.visibilityState === 'visible') this._acquire();
  }

  disable() {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    try {
      this.sentinel?.release();
    } catch {
      /* jo vapautettu */
    }
    this.sentinel = null;
  }
}
