#!/usr/bin/env node
// Hourly refresh helper for public/jobs.json.
//  1. Merges optional newly searched candidates (--candidates file.json: a JSON array of job objects,
//     or an object with a `jobs` array) into the current list, matched by `id`.
//     - known id      -> keep its original firstSeen (never overwritten); other fields take the fresh values
//     - id in closed  -> reopened: moves back to jobs with its original firstSeen (not counted as new)
//     - unknown id    -> firstSeen = now, added to newSinceLastRun
//  2. Re-checks every open posting URL; closed or dead ones move to `closed` with closedAt + closedReason.
//     Postings that can't be checked (blocked or timed out) are kept, never dropped on a guess.
//  3. Prunes `closed` entries older than 30 days, stamps updatedAt, recounts sources.counts, writes atomically.
// Usage: node scripts/verify-jobs.mjs [--candidates new.json] [--dry-run] [--no-fetch] [--in f] [--out f]
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry-run');
const noFetch = args.includes('--no-fetch'); // test the merge logic offline
const inFile = opt('--in', 'public/jobs.json');
const outFile = opt('--out', inFile);
const candFile = opt('--candidates', null);
const CLOSED_KEEP_DAYS = 30;
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
  if (noFetch) return { job, status: 'unknown', why: 'not fetched (--no-fetch)' };
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

const now = new Date().toISOString();
const data = JSON.parse(readFileSync(inFile, 'utf8'));
data.closed ??= [];
const strip = ({ closedAt, closedReason, ...j }) => j;

// 1. Merge candidates by id.
const byId = new Map(data.jobs.map(j => [j.id, j]));
const closedById = new Map(data.closed.map(j => [j.id, j]));
const newIds = [];
const reopened = [];
if (candFile) {
  const raw = JSON.parse(readFileSync(candFile, 'utf8'));
  const cands = Array.isArray(raw) ? raw : raw.jobs;
  for (const c of cands) {
    if (!c.id) { console.warn(`skipped candidate without id: ${c.title}`); continue; }
    const known = byId.get(c.id);
    const wasClosed = closedById.get(c.id);
    if (known) {
      byId.set(c.id, { ...strip(c), firstSeen: known.firstSeen });               // never overwrite firstSeen
    } else if (wasClosed) {
      byId.set(c.id, { ...strip(c), firstSeen: wasClosed.firstSeen });           // reopened
      closedById.delete(c.id); reopened.push(c.id);
    } else {
      byId.set(c.id, { ...strip(c), firstSeen: now }); newIds.push(c.id);        // newly discovered
    }
  }
}
// Any job missing firstSeen (hand-added) is treated as discovered now.
for (const j of byId.values()) if (!j.firstSeen) { j.firstSeen = now; if (!newIds.includes(j.id)) newIds.push(j.id); }

// 2. Verify every open posting.
const results = [];
for (const job of byId.values()) { results.push(await check(job)); if (!noFetch) await new Promise(r => setTimeout(r, 800)); }
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.job.id.padEnd(22)} ${r.job.company}${r.why ? ' — ' + r.why : ''}${newIds.includes(r.job.id) ? ' [NEW]' : ''}`);

const keep = results.filter(r => r.status === 'open' || r.status === 'unknown').map(r => r.job);
const dropped = results.filter(r => r.status === 'gone' || r.status === 'closed')
  .map(r => ({ ...r.job, closedAt: now, closedReason: r.why }));

// 3. Closed list: newly dropped first, then earlier ones still within 30 days.
const cutoff = Date.now() - CLOSED_KEEP_DAYS * 864e5;
const closed = [...dropped, ...closedById.values()].filter(j => Date.parse(j.closedAt) >= cutoff);
const newSinceLastRun = newIds.filter(id => keep.some(j => j.id === id));

console.log(`\n${keep.length} open (${newSinceLastRun.length} new, ${reopened.length} reopened), ${dropped.length} moved to closed, ` +
  `${results.filter(r => r.status === 'unknown').length} could not be checked (kept), ${closed.length} in closed list.`);

if (!dry) {
  data.jobs = keep;
  data.closed = closed;
  data.newSinceLastRun = newSinceLastRun;
  data.updatedAt = now;
  data.sources.counts = keep.reduce((a, j) => ((a[j.source] = (a[j.source] ?? 0) + 1), a), {});
  const ordered = { $schema: data.$schema, updatedAt: data.updatedAt, region: data.region, sources: data.sources,
    newSinceLastRun: data.newSinceLastRun, jobs: data.jobs, closed: data.closed };
  writeFileSync(outFile + '.tmp', JSON.stringify(ordered, null, 2) + '\n');
  renameSync(outFile + '.tmp', outFile); // atomic swap so the live site never reads half a file
  console.log(`Wrote ${outFile} (updatedAt ${data.updatedAt})`);
}
