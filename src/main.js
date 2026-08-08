import { Game } from './game.js';

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
