/**
 * Win confetti: two side cannons on a 2D canvas over the scene.
 *
 * No library and no per-frame allocation — the pool is built once in the
 * constructor and `burst` only rewrites the numbers in it. The canvas is
 * `pointer-events: none` like the rest of the overlay, so a player who taps
 * "Ascend" through a cloud of paper still hits the button.
 *
 * It runs its own `requestAnimationFrame` loop and stops as soon as the last
 * particle dies, because the result screen is otherwise a still image and the
 * app's main loop has nothing to draw there.
 */

import './confetti.css';

/** Particles per cannon. Two cannons, so twice this many. */
const PER_CANNON = 70;

/** Seconds a particle lives. Long enough to cross the screen and settle out. */
const LIFE = 2.6;

/** Pixels per second squared. Heavier than real paper: this is a phone screen. */
const GRAVITY = 900;

/** Fraction of velocity kept per second, applied to both axes. */
const DRAG = 0.72;

/** The three staffs' colours plus gold, so the win reads as ours. */
const COLORS = ['#ff9d5c', '#a48cff', '#7fe6ff', '#ffd76a', '#f4f1ff'];

/** Frame delta ceiling: a backgrounded tab must not teleport the paper. */
const MAX_DT = 0.05;

const MAX_PIXEL_RATIO = 2;

/** A player who asked the system for less motion did not ask for confetti. */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  width: number;
  height: number;
  /** Seconds left. Zero means the slot is free. */
  life: number;
  color: string;
}

export class Confetti {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly particles: Particle[] = [];

  private live = 0;
  private rafId: number | null = null;
  private lastTime = 0;
  private pixelRatio = 1;
  private seed = 0x9e37_79b9;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');

    for (let i = 0; i < PER_CANNON * 2; i++) {
      this.particles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        spin: 0,
        width: 0,
        height: 0,
        life: 0,
        color: '#ffffff',
      });
    }
  }

  /** Fires both cannons. Calling it again restarts the burst. */
  burst(): void {
    if (this.context === null || prefersReducedMotion()) return;

    // Unhidden first: a `hidden` canvas measures 0 by 0, so sizing the backing
    // store before this would give every burst a one-pixel screen to fly in.
    this.canvas.hidden = false;
    this.resize();
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;

    let index = 0;
    for (const particle of this.particles) {
      const fromLeft = index < PER_CANNON;
      index++;

      // Both cannons aim up and inward, about 60 degrees off horizontal.
      const speed = 900 + this.random() * 700;
      const direction = -Math.PI / 3 + (this.random() - 0.5) * 0.7;

      particle.x = fromLeft ? width * 0.06 : width * 0.94;
      particle.y = height * 0.98;
      particle.vx = Math.cos(direction) * speed * (fromLeft ? 1 : -1);
      particle.vy = Math.sin(direction) * speed;
      particle.angle = this.random() * Math.PI * 2;
      particle.spin = (this.random() - 0.5) * 18;
      particle.width = 5 + this.random() * 7;
      particle.height = 8 + this.random() * 10;
      particle.life = LIFE * (0.7 + this.random() * 0.45);
      particle.color = COLORS[Math.floor(this.random() * COLORS.length)] ?? '#ffffff';
    }

    this.live = this.particles.length;
    this.lastTime = 0;
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.frame);
  }

  /** Clears the canvas and stops the loop. Safe to call when idle. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const particle of this.particles) particle.life = 0;
    this.live = 0;
    this.clear();
    this.canvas.hidden = true;
  }

  dispose(): void {
    this.stop();
  }

  private readonly frame = (time: number): void => {
    const dt = this.lastTime === 0 ? 0 : Math.min(MAX_DT, (time - this.lastTime) / 1000);
    this.lastTime = time;

    this.step(dt);
    this.draw();

    if (this.live === 0) {
      this.rafId = null;
      this.canvas.hidden = true;
      return;
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    if (dt === 0) return;
    const drag = Math.pow(DRAG, dt);
    let live = 0;

    for (const particle of this.particles) {
      if (particle.life <= 0) continue;

      particle.vx *= drag;
      particle.vy = particle.vy * drag + GRAVITY * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += particle.spin * dt;
      particle.life -= dt;
      if (particle.life > 0) live++;
    }
    this.live = live;
  }

  private draw(): void {
    const context = this.context;
    if (context === null) return;
    this.clear();

    for (const particle of this.particles) {
      if (particle.life <= 0) continue;

      // Paper flutters: a flat rectangle seen edge-on is a line.
      const flutter = Math.abs(Math.cos(particle.angle));
      context.save();
      context.globalAlpha = Math.min(1, particle.life * 2.5);
      context.fillStyle = particle.color;
      context.translate(particle.x, particle.y);
      context.rotate(particle.angle * 0.35);
      context.fillRect(
        -particle.width * 0.5 * flutter,
        -particle.height * 0.5,
        Math.max(1, particle.width * flutter),
        particle.height,
      );
      context.restore();
    }
  }

  private clear(): void {
    const context = this.context;
    if (context === null) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  /** Backing store in device pixels; everything above draws in CSS pixels. */
  private resize(): void {
    const ratio = Math.min(MAX_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round((this.canvas.clientWidth || 1) * ratio));
    const height = Math.max(1, Math.round((this.canvas.clientHeight || 1) * ratio));
    this.pixelRatio = ratio;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** Mulberry32: a win looks the same twice, and nothing calls `Math.random`. */
  private random(): number {
    this.seed = (this.seed + 0x6d2b_79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }
}
