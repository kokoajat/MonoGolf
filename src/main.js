import { Game } from './game.js';
import { encodeQR, drawQR } from './qr.js';
import {
  RemoteLink,
  packDescription,
  unpackDescription,
  toChunks,
  ChunkCollector,
} from './remote.js';

function start() {
  const root = document.getElementById('app');
  // Estää selaimen kumitusefektin ja tuplanapautuszoomin pelin päällä.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  window.game = new Game(root);
  // Julkinen rajapinta testejä ja vianetsintää varten. Koosteessa erillisiä
  // moduulitiedostoja ei ole, joten tämä on ainoa tapa päästä niihin käsiksi.
  window.MonoGolf = {
    encodeQR,
    drawQR,
    RemoteLink,
    packDescription,
    unpackDescription,
    toChunks,
    ChunkCollector,
  };

  // Service worker tekee pelistä asennettavan ja pelattavan ilman verkkoa.
  // Yhden tiedoston koosteessa sitä ei ole, joten rekisteröinti ohitetaan.
  if ('serviceWorker' in navigator && !window.__MONOGOLF_SINGLE_FILE__) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
        /* esim. file:// tai ei-suojattu yhteys */
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
