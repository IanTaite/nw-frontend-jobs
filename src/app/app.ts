import {
  Component,
  DestroyRef,
  WritableSignal,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { AI_LABEL, Job, JobsFile, REGION_LABEL, Region, salaryValue } from './jobs';
import { QueryParam, flagParam, stringParam, syncQueryParams } from './query-params';

const SORTS = ['newest', 'discovered', 'salary', 'company', 'ai'] as const;
type Sort = (typeof SORTS)[number];
/** Pause after the last keystroke before the search is applied. */
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-root',
  imports: [DatePipe],
  templateUrl: './app.html',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly data = signal<JobsFile | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);

  /** The applied search: drives filtering and the URL. Follows `searchText` after a pause in typing. */
  private readonly q = signal('');
  /** What's in the search box, updated on every keystroke. Resets to `q` when `q` changes elsewhere (URL, reset). */
  protected readonly searchText = linkedSignal(() => this.q());
  private searchTimer?: ReturnType<typeof setTimeout>;
  protected readonly region = signal('All');
  protected readonly mode = signal('All');
  protected readonly contract = signal('All');
  protected readonly kind = signal('All');
  protected readonly via = signal('All');
  protected readonly clearance = signal('All');
  /** Minimum AI usage level ('All' = no filter). */
  protected readonly aiMin = signal('All');
  protected readonly sort = signal<Sort>('newest');
  protected readonly newOnly = signal(false);
  /** Time used for the 24-hour 'New' window; refreshed on each load and every minute. */
  private readonly now = signal(Date.now());

  protected readonly jobs = computed(() => this.data()?.jobs ?? []);
  protected readonly closed = computed(() =>
    [...(this.data()?.closed ?? [])].sort((a, b) =>
      (b.closedAt ?? '').localeCompare(a.closedAt ?? ''),
    ),
  );
  protected readonly newIds = computed(() => new Set(this.data()?.newSinceLastRun ?? []));
  protected readonly opts = computed(() => {
    const uniq = (f: (j: Job) => string) => [...new Set(this.jobs().map(f))].sort();
    return {
      mode: uniq((j) => j.mode),
      contract: uniq((j) => j.contract),
      clearance: uniq((j) => j.clearance),
    };
  });

  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    const r = this.jobs().filter(
      (j) =>
        (this.region() === 'All' || j.region === this.region()) &&
        (this.mode() === 'All' || j.mode === this.mode()) &&
        (this.contract() === 'All' || j.contract === this.contract()) &&
        (this.kind() === 'All' || j.kind === this.kind()) &&
        (this.via() === 'All' || j.via === this.via()) &&
        (!this.newOnly() || this.newIds().has(j.id)) &&
        (this.aiMin() === 'All' || (j.aiLevel ?? 0) >= Number(this.aiMin())) &&
        (this.clearance() === 'All' ||
          (this.clearance() === 'Any'
            ? j.clearance !== 'None stated'
            : j.clearance === this.clearance())) &&
        (!q ||
          [j.title, j.company, j.location, j.stack, j.notes, j.salary]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
    const s = this.sort();
    return [...r].sort((a, b) =>
      s === 'discovered'
        ? b.firstSeen.localeCompare(a.firstSeen) || b.posted.localeCompare(a.posted)
        : s === 'salary'
          ? salaryValue(b.salary) - salaryValue(a.salary)
          : s === 'company'
            ? a.company.localeCompare(b.company)
            : s === 'ai'
              ? (b.aiLevel ?? 0) - (a.aiLevel ?? 0) || b.posted.localeCompare(a.posted)
              : b.posted.localeCompare(a.posted),
    );
  });

  protected readonly counts = computed(() => {
    const c = (f: (j: Job) => boolean) => this.jobs().filter(f).length;
    return [
      { label: 'Postings', value: this.jobs().length, tone: 'text-brand-mid' },
      { label: 'New this refresh', value: this.newIds().size, tone: 'text-new' },
      { label: 'North West', value: c((j) => j.region === 'north-west'), tone: 'text-ink' },
      { label: 'Remote UK', value: c((j) => j.region === 'remote-uk'), tone: 'text-ink' },
      { label: 'Hybrid', value: c((j) => j.mode === 'Hybrid'), tone: 'text-ink' },
      { label: 'Remote', value: c((j) => j.mode === 'Remote'), tone: 'text-ink' },
      { label: 'Office-only', value: c((j) => j.mode === 'Office'), tone: 'text-ink' },
      { label: 'Permanent', value: c((j) => j.contract === 'Permanent'), tone: 'text-ink' },
      { label: 'Contract', value: c((j) => j.contract === 'Contract'), tone: 'text-ink' },
      { label: 'Direct employer', value: c((j) => j.via === 'Direct'), tone: 'text-ink' },
      {
        label: 'Clearance needed',
        value: c((j) => j.clearance !== 'None stated'),
        tone: 'text-warn-fg',
      },
    ];
  });

  /** Filters mirrored to the query string. Values from the URL are applied before the first render. */
  private readonly queryParams: QueryParam[] = [
    stringParam('q', this.q, ''),
    stringParam('region', this.region, 'All', Object.keys(REGION_LABEL) as Region[]),
    stringParam('mode', this.mode, 'All'),
    stringParam('contract', this.contract, 'All'),
    stringParam('clearance', this.clearance, 'All'),
    stringParam('kind', this.kind, 'All', ['Frontend', 'Adjacent']),
    stringParam('via', this.via, 'All', ['Direct', 'Agency', 'Platform']),
    stringParam('ai', this.aiMin, 'All', ['1', '2', '3', '4', '5']),
    stringParam<Sort>('sort', this.sort, 'newest', SORTS),
    flagParam('new', this.newOnly),
  ];

  constructor() {
    syncQueryParams(this.queryParams);
    this.load();
    const t = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(t);
      clearTimeout(this.searchTimer);
    });
  }

  protected load() {
    this.loading.set(true);
    this.error.set(null);
    // Relative URL so it works under any base path; cache-buster so an hourly refresh shows immediately.
    this.http.get<JobsFile>(`jobs.json?t=${Date.now()}`).subscribe({
      next: (d) => {
        this.now.set(Date.now());
        this.data.set(d);
        this.dropUnknownOptions();
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load jobs.json.');
        this.loading.set(false);
      },
    });
  }

  /** Search box input: applied after a pause, or straight away when the box is cleared. */
  protected onSearch(value: string) {
    this.searchText.set(value);
    clearTimeout(this.searchTimer);
    if (!value.trim()) this.q.set(value);
    else this.searchTimer = setTimeout(() => this.q.set(value), SEARCH_DEBOUNCE_MS);
  }

  protected reset() {
    clearTimeout(this.searchTimer);
    for (const p of this.queryParams) p.write(p.defaultValue);
    this.searchText.set(this.q()); // q may already be '' while the box still holds unapplied text
  }

  /** Mode, contract and clearance options come from the data, so a URL value not in it falls back to 'All'. */
  private dropUnknownOptions() {
    const o = this.opts();
    const check = (s: WritableSignal<string>, known: string[]) => {
      if (s() !== 'All' && !known.includes(s())) s.set('All');
    };
    check(this.mode, o.mode);
    check(this.contract, o.contract);
    check(this.clearance, ['Any', ...o.clearance]);
  }

  protected val(e: Event) {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
  protected viaLabel(v: string) {
    return v === 'Direct'
      ? 'Direct employer'
      : v === 'Agency'
        ? 'Recruiter agency'
        : 'Hiring platform';
  }
  protected regionLabel(r?: string) {
    return r ? (REGION_LABEL[r as keyof typeof REGION_LABEL] ?? r) : '';
  }
  protected readonly aiDots = [1, 2, 3, 4, 5];
  protected aiLabel(l?: number) {
    return AI_LABEL[l ?? 0] ?? AI_LABEL[0];
  }
  protected withNote(v: string, n: string) {
    return n ? `${v} (${n})` : v;
  }
}
