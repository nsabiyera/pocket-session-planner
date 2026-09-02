'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * The small set of shared controls. Deliberately plain: semantic class names against the
 * tokens in `globals.css`, no library, no variants system. Every one of them is sized for a
 * gloved thumb before it is sized for anything else.
 */

export function Screen({
  children,
  mode = false,
}: {
  children: ReactNode;
  /** Do mode is a full-height surface with no bottom nav under it. */
  mode?: boolean;
}) {
  return <main className={mode ? 'screen screen--mode' : 'screen'}>{children}</main>;
}

export function ScreenHead({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <header className="screen-head">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
    </header>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="empty" role="status">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * A segmented control. Rendered as buttons with `aria-pressed` rather than radios, because a
 * radio group's hit target is the label and getting that to 56px fights the browser.
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <label id={`${legend}-label`}>{legend}</label>
      <div className="segmented" role="group" aria-labelledby={`${legend}-label`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * `−5 / value / +5`. Exists so a duration never needs the number keypad — which on iOS
 * covers half the screen and, at 16px, is the one thing guaranteed to slow the create flow
 * past twenty seconds.
 */
export function Stepper({
  label,
  value,
  step = 5,
  min = 5,
  max = 180,
  suffix = 'min',
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="field">
      <label id={id}>{label}</label>
      <div className="stepper" role="group" aria-labelledby={id}>
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          aria-label={`Decrease ${label} by ${step}`}
        >
          −
        </button>
        <output className="stepper-value tabular">
          {value} {suffix}
        </output>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          aria-label={`Increase ${label} by ${step}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Chip({
  label,
  count,
  pressed,
  dimmed,
  size = 'md',
  onClick,
  onLongPress,
}: {
  label: string;
  count?: number;
  pressed?: boolean;
  dimmed?: boolean;
  size?: 'md' | 'lg';
  onClick?: () => void;
  onLongPress?: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const startPress = () => {
    if (!onLongPress) return;
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, 500);
  };

  const endPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <button
      type="button"
      className={['chip', size === 'lg' ? 'chip--lg' : '', dimmed ? 'chip--neglected' : '']
        .filter(Boolean)
        .join(' ')}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onClick={() => {
        // A long press already did its work; do not also fire the tap action.
        if (fired.current) {
          fired.current = false;
          return;
        }
        onClick?.();
      }}
    >
      {label}
      {count !== undefined ? <span className="chip-count tabular">{count}</span> : null}
    </button>
  );
}

/**
 * A bottom sheet built on the native `<dialog>` element, which gives focus trapping, escape
 * handling and inertness for free — all of which a hand-rolled overlay gets subtly wrong.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={onClose} aria-label={title}>
      <div className="sheet-body">
        <div className="row row--between sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** A five-circle rating. Circles, not stars — stars imply a review of the players. */
export function Rating({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <div className="rating" role="group" aria-labelledby={id}>
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            className="rating-dot"
            aria-pressed={value === score}
            aria-label={`${score} out of 5`}
            onClick={() => onChange(score)}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

/** `carried from 14 Mar` — shown on exactly the things carry-forward seeded. */
export function CarriedPill({ from }: { from?: string }) {
  return <span className="pill pill--carried">{from ? `carried from ${from}` : 'carried'}</span>;
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
