// Radan piirto 2D-canvakselle. Maailmakoordinaatit ovat metrejä ja
// muunnetaan pikseleiksi yhdellä skaalauskertoimella.

import { BALL_RADIUS } from './physics.js';

const COLORS = {
  surround: '#1b2a1f',
  green: '#2f8f4e',
  greenDark: '#26773f',
  stripe: 'rgba(255,255,255,0.045)',
  rail: '#8a5a33',
  railTop: '#b0763f',
  wood: '#7b4b2a',
  woodLight: '#a4693b',
  sand: '#e2c98b',
  water: '#2f7fd4',
  waterDeep: '#1e5fa8',
  ice: '#cfe9f5',
  rough: '#27713d',
  boost: '#ffcf4d',
  slope: 'rgba(255,255,255,0.12)',
  cup: '#101613',
  ball: '#ffffff',
  aim: 'rgba(255,255,255,0.85)',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.trail = [];
  }

  resize(world) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const pad = 6 * dpr;
    this.scale = Math.min((w - pad * 2) / world.width, (h - pad * 2) / world.height);
    this.offsetX = (w - world.width * this.scale) / 2;
    this.offsetY = (h - world.height * this.scale) / 2;
    // Koristeiden mittayksikkö suhteessa väylän leveyteen (suunnitteluleveys 3,6).
    this.u = world.width / 3.6;
  }

  toScreen(x, y) {
    return [this.offsetX + x * this.scale, this.offsetY + y * this.scale];
  }

  toWorld(px, py) {
    return [
      (px * this.dpr - this.offsetX) / this.scale,
      (py * this.dpr - this.offsetY) / this.scale,
    ];
  }

  clearTrail() {
    this.trail.length = 0;
  }

  pushTrail(x, y) {
    this.trail.push([x, y]);
    if (this.trail.length > 90) this.trail.shift();
  }

  draw(state) {
    const { world, ball, aim, time } = state;
    const ctx = this.ctx;
    this.resize(world);
    const s = this.scale;

    ctx.save();
    ctx.fillStyle = COLORS.surround;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.drawGreen(ctx, world);
    this.drawZones(ctx, world);
    this.drawCup(ctx, world, time);
    this.drawTee(ctx, world);
    this.drawObstacles(ctx, world);
    this.drawMovers(ctx, world);
    this.drawRails(ctx, world);
    this.drawTrail(ctx);
    if (aim && aim.visible) this.drawAim(ctx, ball, aim);
    this.drawBall(ctx, ball);

    ctx.restore();
  }

  pathPolygon(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }

  drawGreen(ctx, world) {
    ctx.save();
    this.pathPolygon(ctx, world.boundary);
    ctx.clip();

    const grad = ctx.createLinearGradient(0, 0, 0, world.height);
    grad.addColorStop(0, COLORS.green);
    grad.addColorStop(1, COLORS.greenDark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, world.width, world.height);

    // Leikkuuraidat
    ctx.fillStyle = COLORS.stripe;
    const stripe = 0.64 * this.u;
    for (let y = 0; y < world.height; y += stripe) {
      ctx.fillRect(0, y, world.width, stripe / 2);
    }
    ctx.restore();
  }

  drawZones(ctx, world) {
    ctx.save();
    this.pathPolygon(ctx, world.boundary);
    ctx.clip();
    for (const zone of world.zones) {
      const shape = () => this.pathZone(ctx, zone);
      if (zone.type === 'water') {
        shape();
        const g = ctx.createLinearGradient(0, 0, 0, world.height);
        g.addColorStop(0, COLORS.water);
        g.addColorStop(1, COLORS.waterDeep);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.02 * this.u;
        ctx.stroke();
      } else if (zone.type === 'sand') {
        shape();
        ctx.fillStyle = COLORS.sand;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,90,40,0.35)';
        ctx.lineWidth = 0.02 * this.u;
        ctx.stroke();
      } else if (zone.type === 'ice') {
        shape();
        ctx.fillStyle = COLORS.ice;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.02 * this.u;
        ctx.stroke();
      } else if (zone.type === 'rough') {
        shape();
        ctx.fillStyle = COLORS.rough;
        ctx.fill();
      } else if (zone.type === 'slope') {
        shape();
        ctx.fillStyle = COLORS.slope;
        ctx.fill();
        this.drawArrows(ctx, zone, 'rgba(255,255,255,0.5)');
      } else if (zone.type === 'boost') {
        shape();
        ctx.fillStyle = 'rgba(255,207,77,0.55)';
        ctx.fill();
        this.drawArrows(ctx, zone, 'rgba(90,60,0,0.7)');
      }
    }
    ctx.restore();
  }

  pathZone(ctx, zone) {
    if (zone.rect) {
      const [x, y, w, h] = zone.rect;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    } else if (zone.circle) {
      ctx.beginPath();
      ctx.arc(zone.circle[0], zone.circle[1], zone.circle[2], 0, Math.PI * 2);
    } else if (zone.poly) {
      this.pathPolygon(ctx, zone.poly);
    }
  }

  /** Nuolet kaltevuuden / kiihdytyslaatan suuntaan. */
  drawArrows(ctx, zone, color) {
    if (!zone.rect) return;
    const [x, y, w, h] = zone.rect;
    const ax = zone.ax || 0;
    const ay = zone.ay || 0;
    const len = Math.hypot(ax, ay);
    if (len < 1e-6) return;
    const dx = ax / len;
    const dy = ay / len;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.028 * this.u;
    const step = 0.45 * this.u;
    for (let py = y + step / 2; py < y + h; py += step) {
      for (let px = x + step / 2; px < x + w; px += step) {
        const a = 0.11 * this.u;
        ctx.beginPath();
        ctx.moveTo(px - dx * a, py - dy * a);
        ctx.lineTo(px + dx * a, py + dy * a);
        ctx.moveTo(px + dx * a, py + dy * a);
        ctx.lineTo(px + dx * a * 0.3 - dy * a * 0.5, py + dy * a * 0.3 + dx * a * 0.5);
        ctx.moveTo(px + dx * a, py + dy * a);
        ctx.lineTo(px + dx * a * 0.3 + dy * a * 0.5, py + dy * a * 0.3 - dx * a * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawObstacles(ctx, world) {
    for (const ob of world.hole.obstacles || []) {
      if (ob.poly) {
        this.pathPolygon(ctx, ob.poly);
        ctx.fillStyle = COLORS.wood;
        ctx.fill();
        ctx.strokeStyle = COLORS.woodLight;
        ctx.lineWidth = 0.025 * this.u;
        ctx.stroke();
      } else if (ob.circle) {
        const [x, y, r] = ob.circle;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        const bouncy = (ob.e ?? 0.9) > 0.92;
        g.addColorStop(0, bouncy ? '#ff8f6b' : '#c98a55');
        g.addColorStop(1, bouncy ? '#c8391b' : '#7b4b2a');
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.02 * this.u;
        ctx.stroke();
      }
    }
  }

  drawMovers(ctx, world) {
    for (const mover of world.movers) {
      if (mover.rect) {
        const [x, y, w, h] = mover.rect;
        ctx.fillStyle = '#5f6d78';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#93a4b1';
        ctx.lineWidth = 0.022 * this.u;
        ctx.strokeRect(x, y, w, h);
      }
      if (mover.pivot) {
        ctx.save();
        ctx.strokeStyle = '#d94f3d';
        ctx.lineCap = 'round';
        ctx.lineWidth = (mover.thickness || 0.05 * this.u) * 2;
        for (const seg of mover.segments) {
          ctx.beginPath();
          ctx.moveTo(seg.ax, seg.ay);
          ctx.lineTo(seg.bx, seg.by);
          ctx.stroke();
        }
        for (const c of mover.circles) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          ctx.fillStyle = '#f2e6d0';
          ctx.fill();
          ctx.strokeStyle = '#8a6a45';
          ctx.lineWidth = 0.02 * this.u;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  drawRails(ctx, world) {
    ctx.save();
    ctx.strokeStyle = COLORS.rail;
    ctx.lineWidth = 0.14 * this.u;
    this.pathPolygon(ctx, world.boundary);
    ctx.stroke();
    ctx.strokeStyle = COLORS.railTop;
    ctx.lineWidth = 0.05 * this.u;
    this.pathPolygon(ctx, world.boundary);
    ctx.stroke();
    ctx.restore();
  }

  drawTee(ctx, world) {
    const { x, y } = world.tee;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.018 * this.u;
    ctx.beginPath();
    ctx.arc(x, y, 0.09 * this.u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 0.045 * this.u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawCup(ctx, world, time) {
    const cup = world.cup;
    ctx.save();
    // Reikä
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, cup.r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.cup;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.014 * this.u;
    ctx.stroke();

    // Lippu. Tanko lyhenee, jos reikä on lähellä radan yläreunaa,
    // jottei lippu piirry laidan yli.
    const u = this.u;
    const room = cup.y - world.bounds.minY - 0.03 * u;
    const pole = Math.max(0.24 * u, Math.min(0.62 * u, room));
    const flag = pole * 0.39;
    const sway = Math.sin(time * 2.2) * 0.03 * u;
    ctx.strokeStyle = '#f3f3f3';
    ctx.lineWidth = 0.022 * u;
    ctx.beginPath();
    ctx.moveTo(cup.x, cup.y);
    ctx.lineTo(cup.x + sway * 0.4, cup.y - pole);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cup.x + sway * 0.4, cup.y - pole);
    ctx.lineTo(cup.x + sway * 0.4 + flag * 1.4, cup.y - pole + flag * 0.5 + sway);
    ctx.lineTo(cup.x + sway * 0.4, cup.y - pole + flag);
    ctx.closePath();
    ctx.fillStyle = '#e33b2e';
    ctx.fill();
    ctx.restore();
  }

  drawTrail(ctx) {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const t = i / this.trail.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.28 * t})`;
      ctx.lineWidth = BALL_RADIUS * 1.2 * t;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBall(ctx, ball) {
    const r = BALL_RADIUS;
    ctx.save();
    // Varjo
    ctx.beginPath();
    ctx.arc(ball.x + r * 0.35, ball.y + r * 0.45, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    const g = ctx.createRadialGradient(
      ball.x - r * 0.35,
      ball.y - r * 0.4,
      r * 0.1,
      ball.x,
      ball.y,
      r,
    );
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#f2f4f7');
    g.addColorStop(1, '#c3ccd6');
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Kierteen osoitin
    const spinAngle = ball.spinAngle || 0;
    ctx.beginPath();
    ctx.arc(
      ball.x + Math.cos(spinAngle) * r * 0.5,
      ball.y + Math.sin(spinAngle) * r * 0.5,
      r * 0.18,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(220,60,50,0.85)';
    ctx.fill();
    ctx.restore();
  }

  drawAim(ctx, ball, aim) {
    const { dirX, dirY, power } = aim;
    const u = this.u;
    const len = (0.35 + power * 1.15) * u;
    const ex = ball.x + dirX * len;
    const ey = ball.y + dirY * len;
    ctx.save();
    ctx.setLineDash([0.06 * u, 0.05 * u]);
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 0.028 * u;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    // Kärkinuoli
    const a = Math.atan2(dirY, dirX);
    const head = 0.12 * u;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a - 0.4) * head, ey - Math.sin(a - 0.4) * head);
    ctx.lineTo(ex - Math.cos(a + 0.4) * head, ey - Math.sin(a + 0.4) * head);
    ctx.closePath();
    ctx.fillStyle = `hsl(${(1 - power) * 110}, 90%, 60%)`;
    ctx.fill();

    // Voimakaari pallon ympärillä
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS * 2.6, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.strokeStyle = `hsl(${(1 - power) * 110}, 90%, 60%)`;
    ctx.lineWidth = 0.03 * u;
    ctx.stroke();
    ctx.restore();
  }
}
