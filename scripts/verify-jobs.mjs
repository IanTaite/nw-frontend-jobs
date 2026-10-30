#!/usr/bin/env node
// Re-checks every posting in public/jobs.json, drops closed or dead ones, stamps updatedAt.
// Usage: node scripts/verify-jobs.mjs [--dry-run] [--in public/jobs.json] [--out public/jobs.json]
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry-run');
const inFile = opt('--in', 'public/jobs.json');
const outFile = opt('--out', inFile);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Phrases that mean the posting is closed even if the page returns 200.
const CLOSED = [/no longer accepting applications/i, /this job (has )?(expired|is no longer available)/i,
  /job (is )?no longer (live|available|advertised)/i, /position has been filled/i, /vacancy has (now )?closed/i];

function checkUrl(job) {
  const m = job.url.match(/linkedin\.com\/jobs\/view\/.*-(\d+)\/?$/);
  // LinkedIn job pages need sign-in for bots; the public guest endpoint returns the same posting.
  return m ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${m[1]}` : job.url;
}

async function check(job) {
  try {
    const res = await fetch(checkUrl(job), { headers: { 'user-agent': UA, 'accept-language': 'en-GB' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (res.status === 404 || res.status === 410) return { job, status: 'gone', why: `HTTP ${res.status}` };
    if (!res.ok) return { job, status: 'unknown', why: `HTTP ${res.status}` }; // blocked/rate-limited: keep, don't guess
    const body = await res.text();
    const hit = CLOSED.find(r => r.test(body));
    if (hit) return { job, status: 'closed', why: `page says "${body.match(hit)[0]}"` };
    // Reed/Totaljobs redirect expired ads to a search page that no longer contains the job id.
    const id = job.id.split('-')[1];
    if (!/linkedin/.test(job.url) && !res.url.includes(id)) return { job, status: 'gone', why: `redirected to ${res.url}` };
    return { job, status: 'open' };
  } catch (e) {
    return { job, status: 'unknown', why: String(e.cause?.code ?? e.name) };
  }
}

const data = JSON.parse(readFileSync(inFile, 'utf8'));
const results = [];
for (const job of data.jobs) { results.push(await check(job)); await new Promise(r => setTimeout(r, 800)); }

for (const r of results) console.log(`${r.status.padEnd(7)} ${r.job.id.padEnd(22)} ${r.job.company}${r.why ? ' — ' + r.why : ''}`);
const keep = results.filter(r => r.status === 'open' || r.status === 'unknown').map(r => r.job);
const dropped = results.length - keep.length;
console.log(`\n${keep.length} kept, ${dropped} dropped, ${results.filter(r => r.status === 'unknown').length} could not be checked (kept).`);

if (!dry) {
  data.jobs = keep;
  data.updatedAt = new Date().toISOString();
  data.sources.counts = keep.reduce((a, j) => ((a[j.source] = (a[j.source] ?? 0) + 1), a), {});
  writeFileSync(outFile + '.tmp', JSON.stringify(data, null, 2) + '\n');
  renameSync(outFile + '.tmp', outFile); // atomic swap so the live site never reads half a file
  console.log(`Wrote ${outFile} (updatedAt ${data.updatedAt})`);
}
