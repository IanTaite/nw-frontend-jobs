import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Job, JobsFile, REGION_LABEL, salaryValue } from './jobs';

type Sort = 'newest' | 'discovered' | 'salary' | 'company';

@Component({
  selector: 'app-root',
  imports: [DatePipe],
  templateUrl: './app.html',
})
export class App {
  private http = inject(HttpClient);

  readonly data = signal<JobsFile | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);

  readonly q = signal('');
  readonly region = signal('All');
  readonly mode = signal('All');
  readonly contract = signal('All');
  readonly kind = signal('All');
  readonly via = signal('All');
  readonly clearance = signal('All');
  readonly sort = signal<Sort>('newest');
  readonly newOnly = signal(false);
  /** Time used for the 24-hour 'New' window; refreshed on each load and every minute. */
  readonly now = signal(Date.now());

  readonly jobs = computed(() => this.data()?.jobs ?? []);
  readonly closed = computed(() => [...(this.data()?.closed ?? [])].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')));
  readonly newIds = computed(() => new Set(this.data()?.newSinceLastRun ?? []));
  readonly opts = computed(() => {
    const uniq = (f: (j: Job) => string) => [...new Set(this.jobs().map(f))].sort();
    return { mode: uniq(j => j.mode), contract: uniq(j => j.contract), clearance: uniq(j => j.clearance) };
  });

  readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    const r = this.jobs().filter(j =>
      (this.region() === 'All' || j.region === this.region()) &&
      (this.mode() === 'All' || j.mode === this.mode()) &&
      (this.contract() === 'All' || j.contract === this.contract()) &&
      (this.kind() === 'All' || j.kind === this.kind()) &&
      (this.via() === 'All' || j.via === this.via()) &&
      (!this.newOnly() || this.newIds().has(j.id)) &&
      (this.clearance() === 'All' || (this.clearance() === 'Any' ? j.clearance !== 'None stated' : j.clearance === this.clearance())) &&
      (!q || [j.title, j.company, j.location, j.stack, j.notes, j.salary].join(' ').toLowerCase().includes(q)));
    const s = this.sort();
    return [...r].sort((a, b) =>
      s === 'discovered' ? b.firstSeen.localeCompare(a.firstSeen) || b.posted.localeCompare(a.posted)
      : s === 'salary' ? salaryValue(b.salary) - salaryValue(a.salary)
      : s === 'company' ? a.company.localeCompare(b.company)
      : b.posted.localeCompare(a.posted));
  });

  readonly counts = computed(() => {
    const c = (f: (j: Job) => boolean) => this.jobs().filter(f).length;
    return [
      { label: 'Postings', value: this.jobs().length, tone: 'text-brand-mid' },
      { label: 'New this refresh', value: this.newIds().size, tone: 'text-new' },
      { label: 'North West', value: c(j => j.region === 'north-west'), tone: 'text-ink' },
      { label: 'Remote UK', value: c(j => j.region === 'remote-uk'), tone: 'text-ink' },
      { label: 'Hybrid', value: c(j => j.mode === 'Hybrid'), tone: 'text-ink' },
      { label: 'Remote', value: c(j => j.mode === 'Remote'), tone: 'text-ink' },
      { label: 'Office-only', value: c(j => j.mode === 'Office'), tone: 'text-ink' },
      { label: 'Permanent', value: c(j => j.contract === 'Permanent'), tone: 'text-ink' },
      { label: 'Contract', value: c(j => j.contract === 'Contract'), tone: 'text-ink' },
      { label: 'Direct employer', value: c(j => j.via === 'Direct'), tone: 'text-ink' },
      { label: 'Clearance needed', value: c(j => j.clearance !== 'None stated'), tone: 'text-warn-fg' },
    ];
  });

  constructor() {
    this.load();
    const t = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    // Relative URL so it works under any base path; cache-buster so an hourly refresh shows immediately.
    this.http.get<JobsFile>(`jobs.json?t=${Date.now()}`).subscribe({
      next: d => { this.now.set(Date.now()); this.data.set(d); this.loading.set(false); },
      error: () => { this.error.set('Could not load jobs.json.'); this.loading.set(false); },
    });
  }

  reset() {
    this.q.set(''); this.region.set('All'); this.mode.set('All'); this.contract.set('All'); this.kind.set('All');
    this.via.set('All'); this.clearance.set('All'); this.sort.set('newest'); this.newOnly.set(false);
  }

  val(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  viaLabel(v: string) { return v === 'Direct' ? 'Direct employer' : v === 'Agency' ? 'Recruiter agency' : 'Hiring platform'; }
  regionLabel(r?: string) { return r ? REGION_LABEL[r as keyof typeof REGION_LABEL] ?? r : ''; }
  withNote(v: string, n: string) { return n ? `${v} (${n})` : v; }
}
