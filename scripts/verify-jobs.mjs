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
import { pathToFileURL } from 'node:url';

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
const CLOSED = [/(no longer|not currently|not) accepting applications/i, /this job (has )?(expired|is no longer available)/i,
  /job (is )?no longer (live|available|advertised)/i, /position has been filled/i, /vacancy has (now )?closed/i];

// The only list of "this advert is not a real vacancy" phrases. refresh-jobs.md points here.
// Explicit statements only. A real role that tells people not to send speculative CVs or general
// applications does not match, and nor does a "register your interest" button on a real job.
export const NOT_A_VACANCY = [
  /does not represent a live vacancy/i,
  /do not represent a live vacancy/i,
  /not representing a live vacancy/i,
  /not a live (?:role|vacancy|position)/i,
  /isn'?t a live (?:role|vacancy|position)/i,
  /this (?:advert(?:isement)?|ad|posting|listing) (?:is|does) not (?:represent )?a live/i,
  /there is no (?:live |current |open )?vacancy/i,
  /no live vacancy/i,
  /no specific (?:role|vacancy|position) (?:is |currently )?(?:available|open)/i,
  /not (?:currently )?recruiting for (?:a |any )?specific (?:role|vacancy|position)/i,
  /speculative (?:advert(?:isement)?|vacancy|role|opportunity)/i,
  /this is (?:a )?speculative (?:advert(?:isement)?|application|vacancy|role|opportunity)/i,
  /(?:build(?:ing)?|grow(?:ing)?|expand(?:ing)?) (?:a |our |the )?(?:talent|candidate) (?:pool|pipeline)/i,
  /(?:talent|candidate) (?:pool|pipeline) for future/i,
  /add(?:ing)? you to (?:our |a )?(?:talent|candidate) (?:pool|pipeline)/i,
  /register your interest in future/i,
  /opportunity to register your interest/i,
  /added to (?:our|a) database (?:of candidates )?to be considered for future/i,
  /(?:this (?:advert(?:isement)?|ad|posting)|register your interest)[^.?!]{0,80}for future opportunities/i,
  /for future opportunities only/i,
  /example of the roles we recruit/i,
  /examples? of (?:the )?roles we (?:recruit|hire|place)/i,
  /this is a general application/i,
  /general application for future/i,
  /proactive (?:advert(?:isement)?|vacancy)/i,
];

export function visibleText(html) {
  let s = String(html);
  const desc = s.match(/class="show-more-less-html__markup"[^>]*>([\s\S]*?)<\/div>/i);
  if (desc) s = desc[1];
  else {
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  }
  return s.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the exact matched words, or null. Callers quote that in the closed reason.
// A sentence that denies speculative or general applications ("do not send speculative applications")
// is a real role, so those two phrase families are skipped when the same sentence negates them.
export function notAVacancyMatch(text) {
  const s = String(text);
  for (const re of NOT_A_VACANCY) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = global.exec(s))) {
      if (/speculative|general application/i.test(m[0])) {
        const start = Math.max(0, s.lastIndexOf('.', m.index) + 1, s.lastIndexOf('!', m.index) + 1, s.lastIndexOf('?', m.index) + 1);
        const ends = ['.', '!', '?'].map(c => { const i = s.indexOf(c, m.index + m[0].length); return i === -1 ? s.length : i; });
        const sentence = s.slice(start, Math.min(...ends));
        if (/\b(?:not|no|without|don't|do not|never|avoid|unsolicited)\b/i.test(sentence)) continue;
      }
      return m[0];
    }
  }
  return null;
}

export function checkUrl(job) {
  const m = job.url.match(/linkedin\.com\/jobs\/view\/.*-(\d+)\/?$/);
  // LinkedIn job pages need sign-in for bots; the public guest endpoint returns the same posting.
  return m ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${m[1]}` : job.url;
}

// scripts/excluded.json: { "<job id>": "reason" } for roles the user has ruled out or seen marked closed
// (e.g. LinkedIn "Not currently accepting applications" visible only when signed in). Never reopened by searches.
let EXCLUDED = {};
try { EXCLUDED = JSON.parse(readFileSync(new URL('./excluded.json', import.meta.url), 'utf8')); } catch {}

async function check(job) {
  if (EXCLUDED[job.id]) return { job, status: 'closed', why: EXCLUDED[job.id] };
  if (noFetch) return { job, status: 'unknown', why: 'not fetched (--no-fetch)' };
  try {
    const res = await fetch(checkUrl(job), { headers: { 'user-agent': UA, 'accept-language': 'en-GB' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (res.status === 404 || res.status === 410) return { job, status: 'gone', why: `HTTP ${res.status}` };
    if (!res.ok) return { job, status: 'unknown', why: `HTTP ${res.status}` }; // blocked/rate-limited: keep, don't guess
    const body = await res.text();
    const hit = CLOSED.find(r => r.test(body));
    if (hit) return { job, status: 'closed', why: `page says "${body.match(hit)[0]}"` };
    const notReal = notAVacancyMatch(visibleText(body));
    if (notReal) return { job, status: 'closed', why: `Advert says it is not a live vacancy ("${notReal}")` };
    // Reed/Totaljobs redirect expired ads to a search page that no longer contains the job id.
    const id = job.id.split('-')[1];
    if (!/linkedin/.test(job.url) && !res.url.includes(id)) return { job, status: 'gone', why: `redirected to ${res.url}` };
    return { job, status: 'open' };
  } catch (e) {
    return { job, status: 'unknown', why: String(e.cause?.code ?? e.name) };
  }
}

// Search scope per role: 'north-west' (based in North West England, any work mode) or
// 'remote-uk' (fully remote, open to UK-based candidates, not tied to the North West).
// Set `region` on candidates; when it's missing, keep the known value or infer it from location/mode.
const NW = /manchester|liverpool|merseyside|cheshire|lancashire|cumbria|salford|stockport|bolton|wigan|oldham|rochdale|bury|trafford|warrington|chester|crewe|macclesfield|knutsford|alderley|handforth|wilmslow|preston|blackpool|blackburn|burnley|accrington|lancaster|carlisle|kendal|st helens|wirral|birkenhead|southport|runcorn|widnes|\bm\d|\bsk\d|north west/i;
const UK_WIDE = /\b(uk|united kingdom)\b|incl\./i;
export function inferRegion(j) {
  if (NW.test(j.location) && !(j.mode === 'Remote' && UK_WIDE.test(j.location))) return 'north-west';
  return 'remote-uk';
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();

async function main() {
const now = new Date().toISOString();
const data = JSON.parse(readFileSync(inFile, 'utf8'));
data.closed ??= [];
const strip = ({ closedAt, closedReason, ...j }) => j;
const withRegion = (c, prev) => ({ ...c, region: c.region ?? prev?.region ?? inferRegion(c) });
// foundVia: how a role was found (e.g. "LinkedIn search: Manchester", "Tavily", "Reed search"). Stored only, never shown in the UI.
// Accumulates across runs (union with earlier values); it is not removed when a later run finds the role another way.
const withFoundVia = (c, prev) => {
  const all = [...new Set([...(prev?.foundVia ?? []), ...(c.foundVia ?? [])])];
  const { foundVia, ...rest } = c;
  return all.length ? { ...rest, foundVia: all } : rest;
};

// aiLevel/aiNote: expected use of AI tools (0-5) judged from the description. A candidate that carries them
// replaces the old values; a candidate without them keeps the earlier rating.
// claudeMention follows the same rule: it is re-judged whenever the candidate carries an aiLevel (a fresh read
// of the description), otherwise the earlier value is kept.
const withAi = (c, prev) => (c.aiLevel === undefined && prev?.aiLevel !== undefined)
  ? { ...c, aiLevel: prev.aiLevel, aiNote: prev.aiNote ?? '', ...(c.claudeMention === undefined && prev.claudeMention !== undefined ? { claudeMention: prev.claudeMention } : {}) }
  : c;

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
    if (EXCLUDED[c.id]) { console.warn(`skipped excluded candidate ${c.id}`); continue; }
    const known = byId.get(c.id);
    const wasClosed = closedById.get(c.id);
    if (known) {
      byId.set(c.id, { ...withAi(withFoundVia(withRegion(strip(c), known), known), known), firstSeen: known.firstSeen });               // never overwrite firstSeen
    } else if (wasClosed) {
      byId.set(c.id, { ...withAi(withFoundVia(withRegion(strip(c), wasClosed), wasClosed), wasClosed), firstSeen: wasClosed.firstSeen });           // reopened
      closedById.delete(c.id); reopened.push(c.id);
    } else {
      byId.set(c.id, { ...withRegion(strip(c)), firstSeen: now }); newIds.push(c.id);        // newly discovered
    }
  }
}
// Any job missing region gets one inferred (old data), logged so it can be checked.
for (const j of byId.values()) if (!j.region) { j.region = inferRegion(j); console.warn(`region inferred for ${j.id}: ${j.region}`); }
// Any job missing firstSeen (hand-added) is treated as discovered now.
for (const j of byId.values()) if (!j.firstSeen) { j.firstSeen = now; if (!newIds.includes(j.id)) newIds.push(j.id); }

// 2. Verify every open posting.
const results = [];
// One at a time. LinkedIn is paced slowly (3-5 s between pages) and a 429 gets one retry after a longer wait; the rest keep the short delay.
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const job of byId.values()) {
  const li = /linkedin/.test(job.url);
  let r = await check(job);
  if (li && !noFetch && r.status === 'unknown' && /429/.test(r.why ?? '')) { await sleep(20000); r = await check(job); }
  results.push(r);
  if (!noFetch) await sleep(li ? 3000 + Math.random() * 2000 : 800);
}
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
}
