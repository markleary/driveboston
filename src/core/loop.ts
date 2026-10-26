/**
 * Fixed-step simulation loop with an accumulator. Physics and simulation
 * advance in exact 1/60 s steps; rendering runs once per animation frame with
 * the interpolation fraction for anything that wants to smooth between steps.
 */
export interface LoopCallbacks {
  fixedUpdate: (dt: number) => void;
  frame: (dt: number, alpha: number) => void;
}

export class Loop {
  readonly step = 1 / 60;
  private accumulator = 0;
  private last = 0;
  private handle = 0;
  private running = false;
  /** Frame times in ms for the last 120 frames, for the overlay and perf log. */
  readonly frameTimes = new Float32Array(120);
  private frameIndex = 0;
  frameCount = 0;
  private readonly callbacks: LoopCallbacks;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.handle = requestAnimationFrame(tick);
      // Clamp long gaps (tab hidden, debugger) so the simulation never spirals.
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.frameTimes[this.frameIndex] = now - this.last;
      this.frameIndex = (this.frameIndex + 1) % this.frameTimes.length;
      this.last = now;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.step && steps < 6) {
        this.callbacks.fixedUpdate(this.step);
        this.accumulator -= this.step;
        steps += 1;
      }
      if (steps === 6) this.accumulator = 0;
      this.callbacks.frame(dt, this.accumulator / this.step);
      this.frameCount += 1;
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Median and 95th percentile frame time in ms over the recent window. */
  stats(): { median: number; p95: number } {
    const n = Math.min(this.frameCount, this.frameTimes.length);
    if (n === 0) return { median: 0, p95: 0 };
    const sorted = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b);
    return { median: sorted[Math.floor(n / 2)], p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))] };
  }
}
