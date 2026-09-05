import {
  PHASE_IMAGE_MAX_EDGE,
  PHASE_IMAGE_QUALITY,
  type PhaseImageType,
} from '@/domain/phase-image';

/**
 * Turn whatever came out of the camera into something a phone can keep a season of.
 *
 * A modern phone photograph is 3-12 MB and four thousand pixels wide. Stored raw, twenty of
 * them would be a hundred megabytes of a coach's storage quota — and this app asks the browser
 * to *persist* its data, which is a request a browser is more likely to honour, and less
 * likely to evict, when the app is not hoarding. Downscaling first is not an optimisation
 * here; it is what makes the feature storable at all.
 *
 * WebP where the browser will encode it, JPEG otherwise. Both are lossy, which is correct for
 * a photograph of a whiteboard — PNG would be several times larger for no visible gain.
 */

export interface DownscaledImage {
  readonly blob: Blob;
  readonly contentType: PhaseImageType;
  readonly width: number;
  readonly height: number;
}

/** Long edge to {@link PHASE_IMAGE_MAX_EDGE}, aspect ratio kept, never scaled *up*. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge = PHASE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode, downscale and re-encode.
 *
 * `createImageBitmap` rather than an `<img>` and a load event: it decodes off the main
 * thread, so a 12 MP photo does not freeze the plan screen, and it honours EXIF orientation
 * — without which every picture taken in portrait comes back on its side.
 */
export async function downscaleImage(
  file: Blob,
  maxEdge = PHASE_IMAGE_MAX_EDGE,
): Promise<DownscaledImage> {
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    const { width, height } = scaledSize(source.width, source.height, maxEdge);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser will not give us a canvas to resize with.');
    context.drawImage(source, 0, 0, width, height);

    const contentType = preferredType();
    const blob = await toBlob(canvas, contentType);

    return { blob, contentType, width, height };
  } finally {
    // Bitmaps hold their pixels outside the JS heap; without this a coach adding six photos
    // in a row keeps six full-size decodes alive until GC feels like it.
    source.close();
  }
}

/** WebP is roughly a third smaller than JPEG at the same quality, where it is supported. */
function preferredType(): PhaseImageType {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
}

function toBlob(canvas: HTMLCanvasElement, type: PhaseImageType): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        // Only reachable if the canvas is tainted or out of memory, neither of which the
        // coach can act on — so the caller turns this into "that photo would not load".
        else reject(new Error('The browser could not encode that image.'));
      },
      type,
      PHASE_IMAGE_QUALITY,
    );
  });
}

/**
 * For the export, where JSON leaves no choice but base64.
 *
 * Hand-rolled rather than `FileReader`, and chunked rather than one spread: both matter.
 * `String.fromCharCode(...bytes)` on a 200 KB image overflows the call stack, and the manual
 * version works under jsdom, so the round-trip is covered by tests rather than by hope.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = await readBytes(blob);

  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/**
 * `Blob.arrayBuffer()` where it exists, `FileReader` where it does not.
 *
 * Every browser since 2019 has the direct method — but Safari only gained it in 14, and
 * jsdom still lacks it, so the fallback both widens support and lets the round trip above be
 * covered by tests rather than only by a browser.
 */
async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that image.'));
    reader.readAsArrayBuffer(blob);
  });
}

/** And back again, on import. Synchronous — there is nothing to await. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('That is not a data URL.');

  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return new Blob([bytes], { type });
}
