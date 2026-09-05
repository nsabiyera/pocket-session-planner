import { z } from 'zod';
import { PhaseImageIdSchema, SessionIdSchema } from './ids';
import { IsoDateTimeSchema, optionalText, RecordMetaSchema } from './primitives';

/**
 * **The drawing of the practice.**
 *
 * A coach plans a session on paper, a whiteboard or a tactics app, and then re-types a
 * fraction of it into `organisation`. The picture is the plan; the text is a summary of the
 * plan. This lets the picture come too — photographed at the kitchen table, and put back
 * under a thumb at 7:40 when the rondo is not working and the coach cannot remember which
 * way round the gates went.
 *
 * ---
 *
 * **Why this is the first new store since the microscope.**
 *
 * Every field added across the practice-design roadmap rode `nullable().default()` on an
 * existing document, precisely to avoid the ADR 0001 migration tax. Images cannot: they are
 * binary, they are large, and putting a 250 KB blob inside the session document would drag
 * it through every read — including the timer's write-through path in Do mode, which
 * re-serialises the session on every tap. So the bytes live in their own store, and the phase
 * holds only ids. That is the same reason observations are not embedded in sessions.
 *
 * **Blobs, not data URLs.** IndexedDB stores `Blob` natively via structured clone, at their
 * real byte length. Base64 would cost a third more space and a decode on every render. The
 * data URL exists only at the export boundary, where JSON leaves no choice.
 */

/** JPEG and WebP only — both compress photographs well; PNG does not, and SVG can execute. */
export const PHASE_IMAGE_TYPES = ['image/jpeg', 'image/webp'] as const;
export type PhaseImageType = (typeof PHASE_IMAGE_TYPES)[number];

/**
 * The long edge every capture is scaled down to.
 *
 * A whiteboard drawing has to be readable at arm's length on a phone, not printable. 1600px
 * is about four times the CSS width of the screen it will be shown on, which survives a pinch
 * zoom and still lands around 200-300 KB as JPEG.
 */
export const PHASE_IMAGE_MAX_EDGE = 1600;

/** Quality for the re-encode. High enough that pen on whiteboard stays crisp. */
export const PHASE_IMAGE_QUALITY = 0.82;

/**
 * The ceiling for one stored image, after downscaling.
 *
 * Not a limit on what the coach may photograph — the downscaler runs first, and this only
 * catches the case where it somehow produced something enormous. A coach should never meet
 * this; if they do, the app has a bug rather than they have a problem.
 */
export const PHASE_IMAGE_MAX_BYTES = 2_000_000;

/** More than this per phase and the sheet becomes a gallery rather than a plan. */
export const MAX_IMAGES_PER_PHASE = 3;

export const PhaseImageSchema = RecordMetaSchema.extend({
  id: PhaseImageIdSchema,
  /**
   * Which session it was captured for. **Not the phase** — the phase references the image,
   * not the other way round, so a phase carried forward and re-run points at the same
   * drawing rather than losing it. This is only for cleanup and for the export scope.
   */
  sessionId: SessionIdSchema,
  contentType: z.enum(PHASE_IMAGE_TYPES),
  /** Real byte length of `blob`, kept so Settings can total it without reading every blob. */
  bytes: z.number().int().min(1).max(PHASE_IMAGE_MAX_BYTES),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  /** What the coach called it, if anything. Optional — the picture is usually the label. */
  caption: optionalText(120).default(''),
  capturedAt: IsoDateTimeSchema,
});
export type PhaseImageMeta = z.infer<typeof PhaseImageSchema>;

/**
 * The stored record: everything above, plus the bytes.
 *
 * The blob is outside the zod schema on purpose. `z.instanceof(Blob)` would make every
 * domain test that touches this need a DOM, and the parser's job here is the metadata — the
 * bytes are validated by the browser that decoded them.
 */
export interface PhaseImage extends PhaseImageMeta {
  readonly blob: Blob;
}

/** `240 KB`, `1.4 MB` — for the one place a coach should ever see a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
