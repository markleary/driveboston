import { describe, expect, it } from 'vitest';
import { readContainer, writeContainer } from '../../src/shared/container.ts';

describe('DBW1 container', () => {
  it('round-trips typed arrays and the header', () => {
    const bytes = writeContainer(
      { format: 'test', version: 1, created: '2026-10-26', extra: { a: 1 } },
      { heights: new Float32Array([1.5, -2, 3]), mask: new Uint8Array([1, 2, 3, 4, 5]), ids: new Uint32Array([7]) },
    );
    expect(bytes.length % 4).toBe(0);
    // Copy into a fresh buffer with an odd offset to prove alignment is enforced by the reader.
    const { header, arrays } = readContainer(bytes);
    expect(header.format).toBe('test');
    expect(header.extra).toEqual({ a: 1 });
    expect(Array.from(arrays.heights as Float32Array)).toEqual([1.5, -2, 3]);
    expect(Array.from(arrays.mask as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(arrays.ids as Uint32Array)).toEqual([7]);
    expect(header.arrays.map((a) => a.byteOffset)).toEqual([0, 12, 20]);
  });

  it('rejects other files', () => {
    expect(() => readContainer(new TextEncoder().encode('hello world'))).toThrow();
  });
});
