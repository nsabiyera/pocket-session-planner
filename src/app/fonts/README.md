# Fonts

`--font-display` currently resolves to the system stack. The app ships **no webfont**.

That is a deliberate gap rather than an oversight, and it is a gap you may want to close.

## Why there is no font file here

The design calls for one variable display face (Archivo, ~28 kB woff2). It must be
**self-hosted** — a Google Fonts `<link>` renders the app unstyled in airplane mode, which is
the single condition this app exists to work in. `hodorhub`'s `layout.tsx` uses exactly such a
link; do not copy that pattern here.

No font binary has been committed, so the tokens fall back to a system stack that is legible
at every size the design uses. Nothing is broken; the headings simply look like the platform.

## Adding one

1. Drop the woff2 in this directory, e.g. `archivo-variable.woff2`.
2. Load it with `next/font/local` in `src/app/layout.tsx`:

   ```ts
   import localFont from 'next/font/local';

   const display = localFont({
     src: './fonts/archivo-variable.woff2',
     variable: '--font-display-face',
     display: 'swap',
     weight: '400 700',
   });
   ```

   …then add `className={display.variable}` to `<html>`.

3. Point the token at it in `globals.css`:

   ```css
   --font-display: var(--font-display-face), system-ui, -apple-system, sans-serif;
   ```

4. Add the emitted font URL to `PUBLIC_ASSETS` in `next.config.mjs` if it is not already
   picked up by the precache manifest, and re-run the offline check. A font that is not
   precached is a font that disappears on the pitch.
