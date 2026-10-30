export interface Job {
  id: string; title: string; company: string; via: 'Agency' | 'Direct' | 'Platform'; location: string;
  mode: string; modeNote: string; contract: string; contractNote: string; salary: string; posted: string;
  stack: string; kind: 'Frontend' | 'Adjacent'; source: string; url: string; notes: string;
  clearance: string; clearanceNote: string;
}
export interface JobsFile {
  updatedAt: string; region?: string;
  sources: { searched: string[]; blocked?: string[]; counts?: Record<string, number>; verifiedOn?: string; notes?: string };
  jobs: Job[];
}
/** Annual equivalent for sorting; day rates × 220 working days. -1 when no figure is given. */
export function salaryValue(s: string): number {
  const m = s.replace(/,/g, '').match(/£(\d+)/);
  if (!m) return -1;
  const n = Number(m[1]);
  return /\/day/i.test(s) ? n * 220 : n;
}
