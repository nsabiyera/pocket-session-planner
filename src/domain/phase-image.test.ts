import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  MAX_IMAGES_PER_PHASE,
  PHASE_IMAGE_MAX_BYTES,
  PHASE_IMAGE_MAX_EDGE,
  PhaseImageSchema,
} from './phase-image';
import { CURRENT_SCHEMA_VERSION } from './primitives';
import { T0, testId } from '@/test/builders';

describe('formatBytes', () => {
  it('reads like a size a person would say out loud', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(163_378)).toBe('160 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });

  it('never shows a coach a fifteen-digit number', () => {
    // The one place a byte count reaches the screen, so it has to stay short at any size.
    for (const bytes of [1, 999, 1023, 1025, 999_999, PHASE_IMAGE_MAX_BYTES]) {
      expect(formatBytes(bytes).length).toBeLessThanOrEqual(8);
    }
  });
});

describe('the stored image record', () => {
  const valid = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: T0,
    updatedAt: T0,
    id: testId('img'),
    sessionId: testId('session'),
    contentType: 'image/webp',
    bytes: 163_378,
    width: PHASE_IMAGE_MAX_EDGE,
    height: 1200,
    caption: '',
    capturedAt: T0,
  };

  it('accepts what the downscaler produces', () => {
    expect(PhaseImageSchema.safeParse(valid).success).toBe(true);
  });

  it('takes only the two formats that compress a photograph well', () => {
    expect(PhaseImageSchema.safeParse({ ...valid, contentType: 'image/jpeg' }).success).toBe(true);
    // PNG is several times larger for a photo, and SVG can execute.
    expect(PhaseImageSchema.safeParse({ ...valid, contentType: 'image/png' }).success).toBe(false);
    expect(PhaseImageSchema.safeParse({ ...valid, contentType: 'image/svg+xml' }).success).toBe(
      false,
    );
  });

  it('refuses something the downscaler could not have produced', () => {
    expect(PhaseImageSchema.safeParse({ ...valid, bytes: 0 }).success).toBe(false);
    expect(PhaseImageSchema.safeParse({ ...valid, bytes: PHASE_IMAGE_MAX_BYTES + 1 }).success).toBe(
      false,
    );
    expect(PhaseImageSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
  });

  it('keeps a phase from becoming a gallery', () => {
    expect(MAX_IMAGES_PER_PHASE).toBe(3);
  });
});
