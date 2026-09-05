import { describe, expect, it } from 'vitest';
import { blobToDataUrl, dataUrlToBlob, scaledSize } from './downscale-image';
import { PHASE_IMAGE_MAX_EDGE } from '@/domain/phase-image';

describe('scaledSize', () => {
  it('scales the long edge down and keeps the aspect ratio', () => {
    expect(scaledSize(2400, 1800)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(1800, 2400)).toEqual({ width: 1200, height: 1600 });
  });

  it('never scales a small picture up', () => {
    // A photo of a scrap of paper is not improved by interpolating it to 1600px, and the
    // re-encode would make it bigger than the original.
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(PHASE_IMAGE_MAX_EDGE, 900)).toEqual({
      width: PHASE_IMAGE_MAX_EDGE,
      height: 900,
    });
  });

  it('handles a square and an extreme panorama without collapsing an edge to zero', () => {
    expect(scaledSize(3000, 3000)).toEqual({ width: 1600, height: 1600 });
    // A 80:1 strip still has to have at least one pixel of height.
    expect(scaledSize(8000, 100).height).toBeGreaterThanOrEqual(1);
  });

  it('respects a caller-supplied edge', () => {
    expect(scaledSize(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe('the export round trip', () => {
  const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 256));

  it('survives a blob going out to base64 and back', async () => {
    const original = new Blob([bytes(1000)], { type: 'image/webp' });

    const dataUrl = await blobToDataUrl(original);
    expect(dataUrl.startsWith('data:image/webp;base64,')).toBe(true);

    const restored = dataUrlToBlob(dataUrl);
    expect(restored.type).toBe('image/webp');
    expect(restored.size).toBe(original.size);
    // Re-encoding the restored blob must reproduce the same data URL, byte for byte —
    // a stronger claim than comparing sizes, and it needs no `arrayBuffer` in jsdom.
    expect(await blobToDataUrl(restored)).toBe(dataUrl);
  });

  it('survives a blob larger than the chunk size', async () => {
    // The reason the encoder chunks at all: `String.fromCharCode(...bytes)` on a real image
    // overflows the call stack, and a coach's drawing is ~200 KB.
    const big = new Blob([bytes(200_000)], { type: 'image/jpeg' });

    const encoded = await blobToDataUrl(big);
    const restored = dataUrlToBlob(encoded);
    expect(restored.size).toBe(200_000);
    expect(await blobToDataUrl(restored)).toBe(encoded);
  });

  it('keeps a type even when the blob has none', async () => {
    const dataUrl = await blobToDataUrl(new Blob([bytes(4)]));
    expect(dataUrl.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });

  it('refuses something that is not a data URL rather than returning nonsense', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow();
  });
});
