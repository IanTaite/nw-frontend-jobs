import { Component, inject } from '@angular/core';
import { UpdateService } from './update-service';

/** Toast shown when the service worker has downloaded a new version of the app. */
@Component({
  selector: 'app-update-banner',
  template: `
    <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      @if (sw.updateAvailable()) {
        <button
          type="button"
          (click)="sw.reload()"
          class="pointer-events-auto flex items-center gap-2 rounded-lg border-2 border-accent-ring bg-brand px-4 py-3 font-medium text-brand-fg shadow-lg transition-opacity duration-200 starting:opacity-0 hover:bg-brand-mid focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            class="size-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          Update available – click to reload
        </button>
      }
    </div>
  `,
})
export class UpdateBanner {
  protected readonly sw = inject(UpdateService);
}
