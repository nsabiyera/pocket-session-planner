'use client';

import { useSyncExternalStore } from 'react';
import { createStore } from '@/lib/store';
import { haptic } from '@/lib/haptics';

/**
 * Undo toasts, not confirmation dialogs.
 *
 * Wet capacitive screens produce ghost touches, so a confirmation modal just adds a second
 * mis-tap opportunity in front of the destructive action. An undo toast puts the recovery
 * *after* the action, where a stray touch cannot trigger it.
 */

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly action?: { label: string; run: () => void | Promise<void> };
  readonly tone: 'default' | 'warn' | 'stop';
}

const DEFAULT_MS = 8000;

const toasts = createStore<readonly Toast[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function showToast(
  message: string,
  options: { action?: Toast['action']; tone?: Toast['tone']; durationMs?: number } = {},
): number {
  const id = nextId++;
  const toast: Toast = {
    id,
    message,
    tone: options.tone ?? 'default',
    ...(options.action ? { action: options.action } : {}),
  };

  toasts.setState((current) => [...current, toast]);
  haptic(options.tone === 'stop' ? 'warn' : 'confirm');

  timers.set(
    id,
    setTimeout(() => dismissToast(id), options.durationMs ?? DEFAULT_MS),
  );
  return id;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.setState((current) => current.filter((toast) => toast.id !== id));
}

export function __clearToastsForTest(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.setState([]);
}

const EMPTY: readonly Toast[] = [];

export function ToastHost() {
  const current = useSyncExternalStore(toasts.subscribe, toasts.getSnapshot, () => EMPTY);
  if (current.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {current.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast-message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(toast.id);
                void toast.action?.run();
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <button
              type="button"
              className="toast-action toast-action--dismiss"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
