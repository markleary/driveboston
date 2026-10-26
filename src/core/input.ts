/** Keyboard state mapped to driving intents. Touch and gamepad can map onto the same intents later. */
export interface DriveIntent {
  throttle: number; // -1 reverse .. 1 forward
  steer: number; // -1 left .. 1 right
  handbrake: boolean;
  boost: boolean;
}

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedOnce = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.down.add(e.code);
      this.pressedOnce.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per key press; consumed on read. */
  consume(code: string): boolean {
    const was = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return was;
  }

  /** Clears one-shot presses not consumed this frame. Call at the end of every frame. */
  endFrame(): void {
    this.pressedOnce.clear();
  }

  driveIntent(): DriveIntent {
    const forward = this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0;
    const back = this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0;
    const left = this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0;
    const right = this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0;
    return {
      throttle: forward - back,
      steer: right - left,
      handbrake: this.isDown('Space'),
      boost: this.isDown('ShiftLeft') || this.isDown('ShiftRight'),
    };
  }
}
