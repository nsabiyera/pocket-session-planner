import { err, ok, type Result } from '@/lib/result';
import { downscaleImage } from '@/lib/downscale-image';
import { asPhaseImageId, type PhaseId, type PhaseImageId, type SessionId } from '@/domain/ids';
import {
  MAX_IMAGES_PER_PHASE,
  PHASE_IMAGE_MAX_BYTES,
  PhaseImageSchema,
  type PhaseImage,
} from '@/domain/phase-image';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { now, type ServiceContext } from '../context';

/**
 * Attaching the drawing of a practice, and taking it away again.
 *
 * Two writes per attach — the blob into `phase_images`, the id onto the phase — and they are
 * wrapped in one transaction. A half-applied attach would leave either an orphaned blob
 * eating the storage quota, or a phase pointing at an image that does not exist and rendering
 * a broken box in Do mode.
 */

export type PhaseImageError =
  | { kind: 'session_not_found' }
  | { kind: 'phase_not_found' }
  | { kind: 'too_many' }
  | { kind: 'too_large'; bytes: number }
  | { kind: 'unreadable' };

export function describePhaseImageError(error: PhaseImageError): string {
  switch (error.kind) {
    case 'too_many':
      return `That phase already has ${MAX_IMAGES_PER_PHASE} pictures.`;
    case 'too_large':
      return 'That picture is too big to store, even after resizing.';
    case 'unreadable':
      return 'That file would not open as a picture.';
    default:
      return 'That phase is no longer in the plan.';
  }
}

/**
 * Photograph in, drawing attached.
 *
 * The file is downscaled **before** anything is written, so the failure modes a coach can
 * actually hit — a HEIC the browser will not decode, a screenshot that is not an image at
 * all — happen before the database is touched.
 */
export async function attachPhaseImage(
  ctx: ServiceContext,
  sessionId: SessionId,
  phaseId: PhaseId,
  file: Blob,
  caption = '',
): Promise<Result<PhaseImage, PhaseImageError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });

  const phase = session.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) return err({ kind: 'phase_not_found' });
  if (phase.imageIds.length >= MAX_IMAGES_PER_PHASE) return err({ kind: 'too_many' });

  let scaled;
  try {
    scaled = await downscaleImage(file);
  } catch {
    return err({ kind: 'unreadable' });
  }
  if (scaled.blob.size > PHASE_IMAGE_MAX_BYTES) {
    return err({ kind: 'too_large', bytes: scaled.blob.size });
  }

  const at = now(ctx);
  const image: PhaseImage = {
    ...PhaseImageSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: at,
      updatedAt: at,
      id: asPhaseImageId(ctx.ids.uuid()),
      sessionId,
      contentType: scaled.contentType,
      bytes: scaled.blob.size,
      width: scaled.width,
      height: scaled.height,
      caption,
      capturedAt: at,
    }),
    blob: scaled.blob,
  };

  // Both writes or neither — see the module note.
  await ctx.store.transact(['phase_images', 'sessions'], 'readwrite', async (store) => {
    await store.phaseImages.put(image);
    await store.sessions.put({
      ...session,
      updatedAt: at,
      phases: session.phases.map((candidate) =>
        candidate.id === phaseId
          ? { ...candidate, imageIds: [...candidate.imageIds, image.id] }
          : candidate,
      ),
    });
  });

  return ok(image);
}

/**
 * Remove the drawing, and the bytes with it.
 *
 * A **hard** delete, unlike almost everything else in this app. A soft-deleted image would go
 * on occupying the storage quota it was removed to free, and there is nothing to recover
 * later: the coach still has the original in their camera roll.
 */
export async function detachPhaseImage(
  ctx: ServiceContext,
  sessionId: SessionId,
  phaseId: PhaseId,
  imageId: PhaseImageId,
): Promise<Result<void, PhaseImageError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });
  if (!session.phases.some((candidate) => candidate.id === phaseId)) {
    return err({ kind: 'phase_not_found' });
  }

  const at = now(ctx);
  await ctx.store.transact(['phase_images', 'sessions'], 'readwrite', async (store) => {
    await store.sessions.put({
      ...session,
      updatedAt: at,
      phases: session.phases.map((candidate) =>
        candidate.id === phaseId
          ? { ...candidate, imageIds: candidate.imageIds.filter((id) => id !== imageId) }
          : candidate,
      ),
    });
    await store.phaseImages.hardDelete(imageId);
  });

  return ok(undefined);
}

/** The drawings for one phase, in the order the coach attached them. */
export async function loadPhaseImages(
  ctx: ServiceContext,
  imageIds: readonly PhaseImageId[],
): Promise<PhaseImage[]> {
  if (imageIds.length === 0) return [];
  return ctx.store.phaseImages.getMany(imageIds);
}
