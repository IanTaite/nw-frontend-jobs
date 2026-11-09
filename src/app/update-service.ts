import { ApplicationRef, Service, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, filter, first, interval } from 'rxjs';

@Service()
export class UpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  readonly updateAvailable = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return; // false under `ng serve`

    // Show the banner when a new version has finished downloading
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.updateAvailable.set(true));

    // Poll every 5 minutes, but only after the app is stable
    const appIsStable$ = this.appRef.isStable.pipe(first((stable) => stable));
    concat(appIsStable$, interval(5 * 60 * 1000)).subscribe(async () => {
      try {
        await this.swUpdate.checkForUpdate();
      } catch (err) {
        console.error('SW update check failed', err);
      }
    });

    // Broken cache state: the only fix is a reload
    this.swUpdate.unrecoverable.subscribe(() => document.location.reload());
  }

  reload(): void {
    document.location.reload();
  }
}