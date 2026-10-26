import { describe, expect, it } from 'vitest';

// Pure helpers that do not need a browser live here. The loop itself depends on
// requestAnimationFrame, so its accumulator arithmetic is checked by a model.
function accumulate(frames: number[], step = 1 / 60): number {
  let acc = 0;
  let steps = 0;
  for (const dt of frames) {
    acc += Math.min(0.1, dt);
    let n = 0;
    while (acc >= step && n < 6) {
      acc -= step;
      steps += 1;
      n += 1;
    }
    if (n === 6) acc = 0;
  }
  return steps;
}

describe('fixed-step accumulator model', () => {
  it('runs one step per 60 Hz frame', () => {
    expect(accumulate(new Array(120).fill(1 / 60))).toBe(120);
  });
  it('catches up after a slow frame without spiralling', () => {
    expect(accumulate([0.05, 1 / 60])).toBe(4);
    expect(accumulate([5])).toBe(6);
  });
});
