import { ApplicationRef, Service, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, filter, first, fromEvent, interval, merge } from 'rxjs';

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

    // Poll every 5 minutes once the app is stable. A suspended page (installed
    // PWA, background tab) does not run that timer, so also check when it is shown again.
    const appIsStable$ = this.appRef.isStable.pipe(first((stable) => stable));
    const poll$ = concat(appIsStable$, interval(5 * 60 * 1000));
    const resumed$ = merge(
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'visible'),
      ),
      fromEvent(window, 'pageshow').pipe(
        filter((event) => (event as PageTransitionEvent).persisted),
      ),
    );
    merge(poll$, resumed$).subscribe(async () => {
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
