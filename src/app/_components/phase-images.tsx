'use client';

import { useEffect, useState } from 'react';
import { formatBytes, type PhaseImage } from '@/domain/phase-image';
import { Sheet } from './ui';

/**
 * Showing a photographed drawing.
 *
 * **Object URLs, revoked on unmount.** The blob comes out of IndexedDB as bytes; the only way
 * to put it in an `<img>` is a URL that points at it. Each one pins the whole blob in memory
 * until it is revoked, so a coach flicking through five phases in Do mode would otherwise
 * accumulate every drawing they had looked at.
 */
/**
 * A stable identity per blob, so the hook below can tell "the same pictures, re-rendered"
 * from "different pictures".
 *
 * A `WeakMap` because the key is the blob itself: when the last reference to an image goes,
 * so does its entry, and nothing here can leak a blob into a long-lived cache.
 */
let nextBlobKey = 0;
const blobKeys = new WeakMap<Blob, number>();

function blobKey(blob: Blob): number {
  const existing = blobKeys.get(blob);
  if (existing !== undefined) return existing;

  nextBlobKey += 1;
  blobKeys.set(blob, nextBlobKey);
  return nextBlobKey;
}

function useObjectUrls(images: readonly PhaseImage[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);

  /*
   * **Keyed on the blobs, not on the array.**
   *
   * A parent that builds `images` inline — the phases list does, once per phase per render —
   * hands over a new array every time. Depending on that identity would revoke and recreate
   * every object URL on every render, which flickers the thumbnails and churns memory. The
   * key changes only when the actual blobs do.
   */
  const key = images.map((image) => blobKey(image.blob)).join(',');

  useEffect(() => {
    const created = images.map((image) => URL.createObjectURL(image.blob));
    setUrls(created);
    return () => {
      created.forEach((url) => URL.revokeObjectURL(url));
      setUrls([]);
    };
    // Depends on `key` (blob identity) alone — see the note above.
  }, [key]);

  return urls;
}

/**
 * The Do-mode view: thumbnails that open full-screen.
 *
 * This is the whole reason the feature exists. At 7:40 the coach cannot remember which way
 * round the gates went, and the drawing they made at the kitchen table is one tap away —
 * from the phase sheet, not the main surface, because a drawing is a *reminder* and the
 * timer and the observation chips are the work.
 */
export function PhaseImageStrip({
  images,
  heading = 'The drawing',
}: {
  images: readonly PhaseImage[];
  /** Null on a plan card, where the picture is self-evident and the card is already busy. */
  heading?: string | null;
}) {
  const urls = useObjectUrls(images);
  const [open, setOpen] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <section className="stack stack--tight">
      {heading ? <h3>{heading}</h3> : null}
      <ul className="image-strip">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              className="image-thumb"
              aria-label={image.caption || `Open drawing ${index + 1} full screen`}
              onClick={() => setOpen(index)}
            >
              {/*
                A plain `<img>` on purpose: the source is a blob URL, which `next/image`
                cannot optimise and would only wrap in more markup.
              */}
              {urls[index] ? (
                <img src={urls[index]} alt={image.caption || 'Drawing of the practice'} />
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={open !== null}
        title={(open !== null && images[open]?.caption) || 'The drawing'}
        onClose={() => setOpen(null)}
      >
        {open !== null && urls[open] ? (
          <figure className="image-full">
            {/* Blob URL — see the note on the thumbnail above. */}
            <img src={urls[open]} alt={images[open]?.caption || 'Drawing of the practice'} />
            {images[open]?.caption ? <figcaption>{images[open]?.caption}</figcaption> : null}
          </figure>
        ) : null}
      </Sheet>
    </section>
  );
}

/**
 * The plan-time editor: the same thumbnails, plus attach and remove.
 *
 * `capture="environment"` on the input is what makes a phone offer the camera first rather
 * than the photo library — a coach drawing a practice at the kitchen table photographs it
 * there and then, and the extra tap into a gallery is the one that stops them bothering.
 */
export function PhaseImageEditor({
  images,
  busy,
  full,
  onAdd,
  onRemove,
}: {
  images: readonly PhaseImage[];
  busy: boolean;
  full: boolean;
  onAdd: (file: File) => void;
  onRemove: (image: PhaseImage) => void;
}) {
  const urls = useObjectUrls(images);

  return (
    <div className="field">
      <label>Drawing of the practice</label>

      {images.length > 0 ? (
        <ul className="image-strip">
          {images.map((image, index) => (
            <li key={image.id} className="image-strip-item">
              {/* Blob URL — see the note on the strip above. */}
              {urls[index] ? (
                <img src={urls[index]} alt={image.caption || 'Drawing of the practice'} />
              ) : null}
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => onRemove(image)}
              >
                Remove
              </button>
              <span className="card-meta tabular">{formatBytes(image.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="card-meta">That is as many pictures as one phase can hold.</p>
      ) : (
        <label className="btn btn--block tap">
          {busy ? 'Adding…' : images.length === 0 ? 'Add a photo' : 'Add another'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset first: picking the same file twice in a row fires no change event
              // otherwise, and the coach thinks the second attach silently failed.
              event.target.value = '';
              if (file) onAdd(file);
            }}
          />
        </label>
      )}
    </div>
  );
}
