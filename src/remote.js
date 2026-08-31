// Kaukosäädin: kaksi puhelinta yhdistetään suoraan WebRTC-datakanavalla.
//
// Välityspalvelinta ei ole, joten kättely tehdään QR-koodeilla: näyttö näyttää
// tarjouksen, maila skannaa sen ja näyttää vastauksen, jonka näyttö skannaa.
// Tarjous ja vastaus ovat kokonaisina SDP-kuvauksina liian pitkiä QR-koodiin,
// joten niistä poimitaan vain se, mitä yhteyden muodostus vaatii, ja kuvaus
// kootaan takaisin vastaanottavassa päässä.

const CHUNK_BYTES = 260; // yhden QR-ruudun hyötykuorma

/** Heksamuotoinen sormenjälki tiiviimpään base64-muotoon ja takaisin. */
function fingerprintToB64(hex) {
  const bytes = hex.split(':').map((h) => parseInt(h, 16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '');
}

function fingerprintFromB64(b64) {
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = [];
  for (let i = 0; i < bin.length; i++) {
    out.push(bin.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase());
  }
  return out.join(':');
}

const TYPE_CODE = { host: 'h', srflx: 's', prflx: 'p', relay: 'r' };
const CODE_TYPE = { h: 'host', s: 'srflx', p: 'prflx', r: 'relay' };

/**
 * Tiivistää SDP:n QR-kokoiseksi merkkijonoksi.
 * Muoto: rooli|ufrag|pwd|fingerprint|setup|ehdokkaat
 */
export function packDescription(desc) {
  const sdp = desc.sdp;
  const pick = (re) => {
    const m = sdp.match(re);
    return m ? m[1] : '';
  };
  const ufrag = pick(/^a=ice-ufrag:(.+)$/m);
  const pwd = pick(/^a=ice-pwd:(.+)$/m);
  const fp = pick(/^a=fingerprint:sha-256 (.+)$/m);
  const setup = pick(/^a=setup:(.+)$/m);

  const candidates = [];
  const re = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\S+)/gm;
  let m;
  while ((m = re.exec(sdp))) {
    const [, , component, transport, , address, port, type] = m;
    // Vain UDP-ehdokkaat ja ensimmäinen komponentti ovat datakanavalle
    // merkityksellisiä; TCP-ehdokkaat kasvattaisivat koodia turhaan.
    if (transport.toLowerCase() !== 'udp' || component !== '1') continue;
    const code = TYPE_CODE[type];
    if (!code) continue;
    const entry = `${code}${address},${port}`;
    if (!candidates.includes(entry)) candidates.push(entry);
  }

  return [
    desc.type === 'offer' ? 'o' : 'a',
    ufrag,
    pwd,
    fingerprintToB64(fp),
    setup === 'actpass' ? 'p' : setup === 'active' ? 'a' : 's',
    candidates.join(';'),
  ].join('|');
}

/** Kokoaa tiivistetystä muodosta kelvollisen SDP-kuvauksen. */
export function unpackDescription(packed) {
  const [kind, ufrag, pwd, fpB64, setupCode, candidateBlob] = packed.split('|');
  if (!ufrag || !pwd || !fpB64) throw new Error('Virheellinen parikoodi');
  const type = kind === 'o' ? 'offer' : 'answer';
  const setup = setupCode === 'p' ? 'actpass' : setupCode === 'a' ? 'active' : 'passive';

  const lines = [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fingerprintFromB64(fpB64)}`,
    `a=setup:${setup}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];

  const candidates = candidateBlob ? candidateBlob.split(';').filter(Boolean) : [];
  candidates.forEach((entry, index) => {
    const type2 = CODE_TYPE[entry[0]];
    const [address, port] = entry.slice(1).split(',');
    if (!type2 || !address || !port) return;
    // Prioriteetit eivät säily tiivistyksessä, mutta vain keskinäinen
    // järjestys merkitsee: paikalliset ehdokkaat ennen heijastettuja.
    const base = type2 === 'host' ? 2122260223 : 1686052607;
    const priority = base - index;
    const extra = type2 === 'srflx' ? ' raddr 0.0.0.0 rport 0' : '';
    lines.push(
      `a=candidate:${index + 1} 1 udp ${priority} ${address} ${port} typ ${type2}${extra}`,
    );
  });
  lines.push('a=end-of-candidates');

  return { type, sdp: lines.join('\r\n') + '\r\n' };
}

/** Pilkkoo hyötykuorman QR-ruutuihin: "i/n|data". */
export function toChunks(payload) {
  const total = Math.max(1, Math.ceil(payload.length / CHUNK_BYTES));
  const chunks = [];
  for (let i = 0; i < total; i++) {
    chunks.push(`${i + 1}/${total}|${payload.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)}`);
  }
  return chunks;
}

/** Kerää ruudut takaisin kokonaisuudeksi. */
export class ChunkCollector {
  constructor() {
    this.parts = new Map();
    this.total = 0;
  }
  add(text) {
    const m = /^(\d+)\/(\d+)\|([\s\S]*)$/.exec(text);
    if (!m) return null;
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (this.total && this.total !== total) this.parts.clear();
    this.total = total;
    this.parts.set(index, m[3]);
    if (this.parts.size !== total) return null;
    let out = '';
    for (let i = 1; i <= total; i++) out += this.parts.get(i);
    return out;
  }
  get progress() {
    return this.total ? this.parts.size / this.total : 0;
  }
  reset() {
    this.parts.clear();
    this.total = 0;
  }
}

/**
 * Yhteys toiseen laitteeseen. Näyttö luo tarjouksen (host), maila vastaa.
 * Tapahtumat: open, close, message, state.
 */
export class RemoteLink extends EventTarget {
  constructor(role) {
    super();
    this.role = role; // 'host' | 'controller'
    this.pc = null;
    this.channel = null;
    this.state = 'idle';
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setState(state) {
    this.state = state;
    this._emit('state', { state });
  }

  _createPeer() {
    // Julkinen STUN auttaa, jos laitteet eivät ole samassa verkossa. Yhteys
    // syntyy silti ilman sitä, kun molemmat ovat samassa lähiverkossa.
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pc.oniceconnectionstatechange = () => {
      // Välitetään raaka ICE-tila käyttöliittymälle, jotta "Yhdistetään…"
      // ei jää mykäksi: epäonnistuminen pitää näyttää ja selittää.
      this._emit('ice', { state: pc.iceConnectionState });
      if (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState)) {
        this._setState(pc.iceConnectionState === 'failed' ? 'failed' : 'closed');
      }
    };
    this.pc = pc;
    return pc;
  }

  _bindChannel(channel) {
    this.channel = channel;
    channel.onopen = () => {
      this._setState('connected');
      this._emit('open');
    };
    channel.onclose = () => {
      this._setState('closed');
      this._emit('close');
    };
    channel.onmessage = (e) => {
      try {
        this._emit('message', JSON.parse(e.data));
      } catch {
        /* virheellinen viesti ohitetaan */
      }
    };
  }

  /** Odottaa, että kaikki ICE-ehdokkaat on kerätty (ei trickleä ilman kanavaa). */
  _waitForIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      pc.addEventListener('icegatheringstatechange', check);
      // Osa selaimista jättää tilan kesken; jatketaan sillä mitä saatiin.
      const timer = setTimeout(done, 3000);
    });
  }

  /** Näyttö: luo tarjouksen, joka näytetään QR-koodina. */
  async createOffer() {
    const pc = this._createPeer();
    this._bindChannel(pc.createDataChannel('monogolf', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await this._waitForIce(pc);
    this._setState('waiting-answer');
    return packDescription(pc.localDescription);
  }

  /** Näyttö: ottaa vastaan mailan vastauksen. */
  async acceptAnswer(packed) {
    await this.pc.setRemoteDescription(unpackDescription(packed));
    this._setState('connecting');
  }

  /** Maila: lukee tarjouksen ja tuottaa vastauksen QR-koodiksi. */
  async createAnswer(packedOffer) {
    const pc = this._createPeer();
    pc.ondatachannel = (e) => this._bindChannel(e.channel);
    await pc.setRemoteDescription(unpackDescription(packedOffer));
    await pc.setLocalDescription(await pc.createAnswer());
    await this._waitForIce(pc);
    this._setState('connecting');
    return packDescription(pc.localDescription);
  }

  send(message) {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(message));
    return true;
  }

  get connected() {
    return this.channel?.readyState === 'open';
  }

  close() {
    try {
      this.channel?.close();
      this.pc?.close();
    } catch {
      /* jo suljettu */
    }
    this.channel = null;
    this.pc = null;
    this._setState('idle');
  }
}
