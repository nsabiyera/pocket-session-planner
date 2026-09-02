/**
 * The id-generation port.
 *
 * Ids are UUID v4 everywhere except methodology presets, which use stable slugs so a
 * two-year-old session still resolves its origin (see `src/domain/ids.ts`). UUIDs are what
 * make import/merge safe: re-importing your own export is a clean no-op, and importing
 * another coach's squad can never collide.
 */
export interface IdGenerator {
  uuid(): string;
}

/**
 * `crypto.randomUUID` requires a secure context. That is satisfied on https and on
 * localhost, which covers every way this app is legitimately served — but a LAN
 * device-test over plain http is a real workflow, so fall back rather than crash.
 */
export const cryptoIdGenerator: IdGenerator = {
  uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return uuidFromRandomBytes();
  },
};

function uuidFromRandomBytes(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Version 4, variant 10xx — per RFC 4122.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
