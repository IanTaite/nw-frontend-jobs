import { Component, inject } from '@angular/core';
import { ThemeMode, ThemeService } from './theme';

/** Light / System / Dark segmented control. */
@Component({
  selector: 'app-theme-toggle',
  template: `
    <div
      role="group"
      aria-label="Colour theme"
      class="inline-flex shrink-0 rounded-lg border border-brand-muted/40 p-0.5"
    >
      @for (o of options; track o.mode) {
        <button
          type="button"
          (click)="theme.mode.set(o.mode)"
          [attr.aria-pressed]="theme.mode() === o.mode"
          [title]="o.label"
          class="rounded-md p-1.5 text-brand-muted hover:text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-pressed:bg-brand-fg/15 aria-pressed:text-brand-fg"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            @switch (o.mode) {
              @case ('light') {
                <circle cx="12" cy="12" r="4" />
                <path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                />
              }
              @case ('system') {
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              }
              @case ('dark') {
                <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
              }
            }
          </svg>
          <span class="sr-only">{{ o.label }}</span>
        </button>
      }
    </div>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly options: { mode: ThemeMode; label: string }[] = [
    { mode: 'light', label: 'Light theme' },
    { mode: 'system', label: 'Match system theme' },
    { mode: 'dark', label: 'Dark theme' },
  ];
}
