// QR-koodin lukeminen kameralla selaimen omalla BarcodeDetectorilla.
//
// Erillistä kirjastoa ei käytetä. Tuki on Chromessa (Android); iOS-Safarissa
// rajapintaa ei ole, jolloin laiteparin muodostus ei onnistu skannaamalla.

export function scannerSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export async function qrFormatAvailable() {
  if (!scannerSupported()) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

export class QrScanner {
  /**
   * @param {HTMLVideoElement} video  esikatselu, johon kamerakuva ohjataan
   * @param {(text: string) => void} onResult  kutsutaan jokaisesta luennasta
   */
  constructor(video, onResult) {
    this.video = video;
    this.onResult = onResult;
    this.stream = null;
    this.timer = null;
    this.detector = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    if (!(await qrFormatAvailable())) {
      throw new Error('Tämä selain ei osaa lukea QR-koodeja kameralla.');
    }
    this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
    this.running = true;
    this.timer = setInterval(() => this._tick(), 120);
  }

  async _tick() {
    if (!this.running || this.video.readyState < 2) return;
    try {
      const codes = await this.detector.detect(this.video);
      for (const code of codes) {
        if (code.rawValue) this.onResult(code.rawValue);
      }
    } catch {
      /* yksittäinen epäonnistunut ruutu ei haittaa */
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}
