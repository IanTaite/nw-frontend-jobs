import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Job, JobsFile, salaryValue } from './jobs';

type Sort = 'newest' | 'salary' | 'company';

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
  readonly mode = signal('All');
  readonly contract = signal('All');
  readonly kind = signal('All');
  readonly via = signal('All');
  readonly clearance = signal('All');
  readonly sort = signal<Sort>('newest');

  readonly jobs = computed(() => this.data()?.jobs ?? []);
  readonly opts = computed(() => {
    const uniq = (f: (j: Job) => string) => [...new Set(this.jobs().map(f))].sort();
    return { mode: uniq(j => j.mode), contract: uniq(j => j.contract), clearance: uniq(j => j.clearance) };
  });

  readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    const r = this.jobs().filter(j =>
      (this.mode() === 'All' || j.mode === this.mode()) &&
      (this.contract() === 'All' || j.contract === this.contract()) &&
      (this.kind() === 'All' || j.kind === this.kind()) &&
      (this.via() === 'All' || j.via === this.via()) &&
      (this.clearance() === 'All' || (this.clearance() === 'Any' ? j.clearance !== 'None stated' : j.clearance === this.clearance())) &&
      (!q || [j.title, j.company, j.location, j.stack, j.notes, j.salary].join(' ').toLowerCase().includes(q)));
    const s = this.sort();
    return [...r].sort((a, b) =>
      s === 'salary' ? salaryValue(b.salary) - salaryValue(a.salary)
      : s === 'company' ? a.company.localeCompare(b.company)
      : b.posted.localeCompare(a.posted));
  });

  readonly counts = computed(() => {
    const c = (f: (j: Job) => boolean) => this.jobs().filter(f).length;
    return [
      { label: 'Postings', value: this.jobs().length },
      { label: 'Hybrid', value: c(j => j.mode === 'Hybrid') },
      { label: 'Remote', value: c(j => j.mode === 'Remote') },
      { label: 'Office-only', value: c(j => j.mode === 'Office') },
      { label: 'Permanent', value: c(j => j.contract === 'Permanent') },
      { label: 'Contract', value: c(j => j.contract === 'Contract') },
      { label: 'Direct employer', value: c(j => j.via === 'Direct') },
      { label: 'Clearance needed', value: c(j => j.clearance !== 'None stated') },
    ];
  });

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    // Relative URL so it works under any base path; cache-buster so an hourly refresh shows immediately.
    this.http.get<JobsFile>(`jobs.json?t=${Date.now()}`).subscribe({
      next: d => { this.data.set(d); this.loading.set(false); },
      error: () => { this.error.set('Could not load jobs.json.'); this.loading.set(false); },
    });
  }

  reset() {
    this.q.set(''); this.mode.set('All'); this.contract.set('All'); this.kind.set('All');
    this.via.set('All'); this.clearance.set('All'); this.sort.set('newest');
  }

  val(e: Event) { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
  viaLabel(v: string) { return v === 'Direct' ? 'Direct employer' : v === 'Agency' ? 'Recruiter agency' : 'Hiring platform'; }
  withNote(v: string, n: string) { return n ? `${v} (${n})` : v; }
}
