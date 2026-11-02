import { WritableSignal, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/** One piece of UI state mirrored to a query-string parameter. */
export interface QueryParam {
  key: string;
  /** The value as it appears in the URL; when it equals `defaultValue` the parameter is omitted. */
  read: () => string;
  write: (raw: string) => void;
  defaultValue: string;
  /** Rejects unknown values (hand-edited or stale URLs); they fall back to the default. */
  isValid?: (raw: string) => boolean;
}

/** A string signal. Pass `allowed` to restrict the values accepted from the URL. */
export function stringParam<T extends string>(
  key: string, state: WritableSignal<T>, defaultValue: T, allowed?: readonly T[],
): QueryParam {
  return {
    key, defaultValue,
    read: () => state(),
    write: raw => state.set(raw as T),
    isValid: allowed && (raw => raw === defaultValue || (allowed as readonly string[]).includes(raw)),
  };
}

/** A boolean signal, written as `key=1` when true and omitted when false. */
export function flagParam(key: string, state: WritableSignal<boolean>): QueryParam {
  return { key, defaultValue: '', read: () => (state() ? '1' : ''), write: raw => state.set(raw === '1' || raw === 'true') };
}

/**
 * Seeds each param from the current query string (missing or invalid → default), then keeps the
 * query string in step with the signals. Default values are removed from the URL. Uses replaceState,
 * so filter changes don't add browser-history entries. Call from an injection context.
 */
export function syncQueryParams(params: readonly QueryParam[]): void {
  const win = inject(DOCUMENT).defaultView;
  if (!win) return;

  const initial = new URLSearchParams(win.location.search);
  for (const p of params) {
    const raw = initial.get(p.key);
    p.write(raw !== null && (p.isValid?.(raw) ?? true) ? raw : p.defaultValue);
  }

  effect(() => {
    const url = new URL(win.location.href);
    for (const p of params) {
      const value = p.read();
      if (value === p.defaultValue) url.searchParams.delete(p.key);
      else url.searchParams.set(p.key, value);
    }
    if (url.href !== win.location.href) win.history.replaceState(win.history.state, '', url);
  });
}
