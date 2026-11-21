# Hourly refresh of `jobs.json`

The site loads `jobs.json` when the page opens (`HttpClient`, with a `?t=` cache-buster), so you only need to replace that one file on the host. You don't need to rebuild the Angular app.

- Data file: `public/jobs.json` (copied to `dist/jobs-site/browser/jobs.json` by `ng build`)
- Schema: `public/jobs.schema.json` (JSON Schema 2020-12)
- Checker: `scripts/verify-jobs.mjs`

## Search scopes
The data covers two scopes. Every posting carries a `region` field saying which one it falls under:

- **`north-west`**: the role is based in North West England (Greater Manchester, Merseyside, Cheshire, Lancashire, Cumbria), in any work mode (office, hybrid or remote). A remote role whose location is a North West place is `north-west`.
- **`remote-uk`**: the posting says the role is **fully remote** and open to UK-based candidates, and it isn't tied to the North West. This covers remote UK, UK-only remote, and remote Europe/EMEA/global roles that explicitly include the UK with no need to live elsewhere.

Leave out:
- hybrid or office roles based outside the North West (London, Leeds, Bristol and so on);
- EU-only or US-only remote roles, or remote roles that need you to live or hold the right to work outside the UK;
- trainee-only or course ads.

`region` is optional in the schema so older data stays valid. If a candidate has no `region`, `verify-jobs.mjs` keeps the role's previous value, or infers one from `location`/`mode` (North West place → `north-west`, otherwise `remote-uk`) and logs a warning. Set it explicitly on every new candidate.

## Each hourly run

1. **Load** the current `jobs.json`. Each posting's `id` (`<source>-<board job id>`, e.g. `reed-57481500`) stays the same between runs, so it's the key for merging old and new data. Never edit `firstSeen` by hand. The script owns it.

2. **Re-search the sources** for postings from the last 30 days:
   - Run both scopes on every source: the North West searches, and a fully remote UK search (e.g. Reed `remote` filter with location United Kingdom, LinkedIn `location=United Kingdom&f_WT=2`, Tavily "fully remote" "frontend developer" UK).
   - **Tavily** (`user-Tavily` → `tavily_search`). Example queries:
     - "frontend developer" Manchester OR Liverpool OR Cheshire OR Lancashire site:reed.co.uk
     - "frontend developer" "fully remote" UK, "remote UK" "front end developer", "react developer" remote "UK only"
     - the same query with site:totaljobs.com, site:cwjobs.co.uk and site:uk.linkedin.com/jobs/view
     - the same query with "front end developer", "angular developer", "react developer" and "vue developer"
   - **Direct board pages** (curl with a browser user agent). Sort each search **newest first**, and stop paging that search when a page is entirely ids already in `jobs` or `closed`, or every posting on the page is older than this file's `updatedAt`. One new id on a page means you still fetch the next page.
     - Reed: the search page's `__NEXT_DATA__` JSON, with `sortBy=displayDate`. The detail pages give `jobContractType`, `inferredJobLocationType` and `isAgency`. Page with `pageno`.
     - Totaljobs and CWJobs: `__PRELOADED_STATE__["app-unifiedResultlist"]`, with `sort=date` on the search URL.
     - LinkedIn: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=frontend%20developer&location=North%20West%20England&f_TPR=r2592000&sortBy=DD`, and for remote UK `...&location=United%20Kingdom&f_WT=2&f_TPR=r2592000&sortBy=DD`. `sortBy=DD` is newest first. Page with `start`.
   - OutsideIR35 (`https://outsideir35.org.uk/`): public contract (outside IR35) board. Path filters work, e.g. `/jobs/angular`, `/jobs/react/remote`, `/jobs/typescript/remote`, `/jobs/javascript/remote`, `/jobs/react/hybrid`, `/jobs/dotnet/remote`. The list is newest first; there is no sort parameter to add. Pagination uses `?po=50` (offset). Stop when a page is all known ids or older than `updatedAt`. Individual posts are `/jobs/<slug>/<alphanumericId>` and are readable without login; some newer rows show "Unlock to Apply" (OIR35+) where the company name is hidden but the overview/requirements remain visible. `robots.txt` allows `/`. Fetch **one page at a time** with a 2–3 second gap. Board job ids are alphanumeric (e.g. `7UMLyrNRil`), so role ids look like `outsideir35-7UMLyrNRil`. Query-string title/location filters are unreliable from curl (client-side); prefer the path filters above. No public RSS/API documented — HTML listings only.
   - Indeed, Adzuna, Jobserve and Technojobs blocked the box on 30 Oct 2026. Keep listing them under `sources.blocked` until they work.

3. **For each new posting**, open the posting page and read the description:
   - LinkedIn: use the guest endpoint `/jobs-guest/jobs/api/jobPosting/<id>`. The description is in `.show-more-less-html__markup`, and the job type is in the criteria list.
   - Reed and Totaljobs: use the detail page.
   - Use `tavily_extract` when a curl fetch fails.

4. **Fill every field from the posting text only.** If the posting doesn't give something, use `"Not stated"`, or `""` for the note fields. Never guess.
   - `mode`: Hybrid, Remote, Office or Not stated. `modeNote` quotes the posting (e.g. "3 days in office").
   - `contract`: Permanent, Contract, Freelance, Fixed-term or Not stated. LinkedIn's "Full-time" on its own means Not stated, with `contractNote: "listed full-time"`.
   - `salary`: as written (e.g. `£45,000–£55,000`, `£430/day`).
   - `via`:
     - Agency: a recruiter acting for an unnamed client.
     - Direct: the employer itself.
     - Platform: Hackajob, Haystack or similar.
   - `region`: `north-west` or `remote-uk` (see Search scopes). For a remote role, check the posting really says fully remote and open to UK residents; "remote-first" with required office days in London is hybrid, so leave it out.
   - `kind`: Frontend, or Adjacent (full-stack or mobile with a large frontend part).
   - `clearance`: search the full description for clearance, cleared, vetting, BPSS, CTC, SC, DV, eSC, eDV, NPPV and nationality.
     - Use `None stated` when the posting doesn't mention clearance. Asking for "government experience" alone is not clearance.
     - Must already hold it → the level (`SC`, `DV`, …).
     - Must be eligible to get it → `eSC / eDV – eligible to obtain` or `Eligible to obtain`.
     - Clearance is mentioned but no level → `Clearance required – level not stated`.
     - `clearanceNote` gives the wording in short form.

5. **Filter.** Keep only North West England postings (`north-west`) or fully remote roles open to UK residents (`remote-uk`), following the rules under Search scopes. Leave out duplicates (the same role and company on another board: keep the one with more detail), trainee or course ads, hybrid/office roles outside the North West, and EU-only or US-only remote roles.

   **Not a real vacancy.** Some advertisers (SThree is one) post ads only to collect candidates, with no role behind them. On the full text from step 3, reject the posting when it says so explicitly. The phrases that count are the `NOT_A_VACANCY` list in `scripts/verify-jobs.mjs`, and that file is the only place they are defined. The list covers wording such as "does not represent a live vacancy", "not a live role", a speculative advert or application, "building a talent pool" or "talent pipeline", "register your interest" in future roles, "for future opportunities" said about the advert itself, "example of the roles we recruit for", and "this is a general application". Such postings are never candidates. A real role that tells people not to send speculative CVs or general applications stays in. Vague recruiter boilerplate stays in, including a "register your interest" button on a real job and "we keep a database of candidates".

6. **Merge, verify and close**: write every posting found in steps 2–5 (open ones only, with the same field set and their stable `id`) to a temp file such as `/tmp/candidates.json` (a JSON array). Then run `node scripts/verify-jobs.mjs --candidates /tmp/candidates.json`. The script matches postings by `id`:
   - **Known id**: the fresh field values replace the old ones, but `firstSeen` is **kept** and never overwritten.
   - **Id in `closed`** (the posting came back): it moves back to `jobs` with its original `firstSeen`. It isn't counted as new.
   - **Unknown id**: `firstSeen` = now, and the id goes into `newSinceLastRun`.
   - A posting already in `jobs` but missing from this run's search results is **not** closed just because search missed it. It stays until its own URL shows it's closed.
   - `newSinceLastRun` is replaced on every run. It lists only the ids first found in that run, and is `[]` if there are none.
   - It then re-fetches **due** posting URLs, not every open one. Due means: a new candidate this run, a role that just reopened, an id in `scripts/excluded.json`, or an open role whose `lastChecked` is missing or more than 20 hours ago. Newest candidates go first, then the oldest `lastChecked`. `--full` treats every open role as due. The scheduled runs do not pass `--full`.
   - LinkedIn checks stop after `--time-budget-min` (default **15**). The clock includes the fetch, the 3–5 second gap, and the 20 second wait after a 429. `--max-checks N` caps how many posting URLs are fetched. Roles past either limit stay as they are, with the same `lastChecked`. Other boards are not on that 15 minute clock.
   - A fetched posting **moves** to `closed` (with `closedAt` = now and a `closedReason`) on HTTP 404/410, a redirect away from the job id (Reed/Totaljobs), closed wording such as "No longer accepting applications", or an explicit not-a-real-vacancy phrase from `NOT_A_VACANCY`. The reason for that last case is `Advert says it is not a live vacancy ("…")`, quoting the matched words. A fetch that was made, including a 429 or a timeout, sets `lastChecked` so the same URL is not hammered again inside 20 hours. The role stays open when the check did not show it was closed.
   - Each check prints one line as it starts and one with the result, both flushed immediately, and the same lines go to `scripts/.verify-jobs.progress`. A run the box kills still leaves that file. `scripts/.verify-jobs.lock` holds the pid. If that pid is alive, a second run exits instead of starting another LinkedIn scrape. A lock whose pid is dead is removed.
   - Entries in `closed` older than 30 days (by `closedAt`) are removed.
   - It sets `updatedAt` to the current ISO time, recounts `sources.counts`, and writes the file atomically. `lastChecked` is stored on the role and is never shown in the UI.
   - `--no-fetch` runs only the merge and the due-selection, for testing offline. It does not fetch and does not stamp `lastChecked`.
   - Use `--dry-run` to see the results without writing `jobs.json`.

7. **Validate against the schema** before publishing, with a local ajv 8 + ajv-formats install (`npm i --prefix /tmp/ajvv ajv@8 ajv-formats@3`, then validate with `Ajv2020` + `addFormats`). If it fails, **don't publish**. Keep the last good file.

8. **Publish only `jobs.json`.** Copy it to the host, or commit it to the Pages branch. Hosting options:
   - GitHub Pages: commit `jobs.json` to the deployed branch. With the included Actions workflow, a push redeploys in about 1 minute. Or use a scheduled workflow (`on: schedule: cron: '0 * * * *'`) that runs steps 6–7 itself.
   - Netlify/Cloudflare: upload the file again with their CLI.

9. **Report**: new postings (`newSinceLastRun`), postings moved to `closed` (with the reason), reopened postings and unverifiable ones, plus the new `updatedAt`.

## How the site uses these fields
- **AI usage**: see "AI usage rating" below.
- **Region**: a "Region" filter (All / North West / Remote UK), a region label on each role, and North West / Remote UK counts in the summary. Roles without `region` count under All only.
- **New badge**: shown only for ids listed in `newSinceLastRun`, i.e. roles that were not in the previous refresh. Known roles are unmarked on the next refresh. There's also a "New only" filter, a "Newest discovered" sort (by `firstSeen`) and a "New this refresh" count in the summary.
- **Recently closed**: a collapsed section listing `closed` (newest `closedAt` first), with the reason and the source link.
- **`lastChecked`**: when the posting URL was last fetched. The UI must never show it.

## Notes
- Run times are UTC (`updatedAt` ends in `Z`). The site shows them in UK time.
- Posted dates are `YYYY-MM-DD`. For a relative date such as "3 days ago", work it out from the run date.
- Salary sorting treats day rates as × 220 working days.


## How roles are found (`foundVia`) and LinkedIn pacing

- Every candidate carries an optional `foundVia` array saying how the run found it, for example `"LinkedIn search: Manchester"`, `"LinkedIn search: remote UK"`, `"Reed search"`, `"Totaljobs search"`, `"outsideir35.org.uk"`, `"Tavily"` or `"Tavily extract"`. `verify-jobs.mjs` merges it with earlier values, so it grows over time. It is stored only. The UI must never show it. Existing roles have no `foundVia` until a later run finds them again; don't invent it.
- LinkedIn is fetched **one page at a time** with a 3-5 second pause between pages, in the run's searches and in the posting checks. No parallel batches on LinkedIn. After a 429, wait 20 seconds and retry once, then keep the role open and log it. Other sources can still run in parallel with each other.
- **Stay under about 35 minutes.** The box kills the routine at roughly 45 minutes, and a verify that rechecked every LinkedIn role through a string of 429s used 35 minutes by itself. A scheduled run should finish in about 35: the searches are newest-first and stop at the first page that is all known ids or older than `updatedAt`, and `verify-jobs.mjs` is left on its defaults (20 hour window, 15 minute LinkedIn budget, no `--full`). The first runs after `lastChecked` exists will spend that 15 minutes clearing the oldest unchecked LinkedIn roles, then later runs only recheck what is older than 20 hours plus that run's new candidates. Do not start a second verify while `scripts/.verify-jobs.lock` names a live pid. If a run is killed, read `scripts/.verify-jobs.progress` before trying again.

## AI usage rating (`aiLevel`, `aiNote`)

Every role carries an optional `aiLevel` (integer 0-5) and `aiNote` (short string). They describe how much the job is expected to **use AI tools to do the work**, judged subjectively from the posting's full description. They do not describe whether the product being built is an AI product. A frontend role on an AI product with no mention of AI tooling stays at 0. Mention the product side in `aiNote` only if it affects the rating.

| Level | Label (UI) | Meaning |
|---|---|---|
| 0 | AI: not stated | The posting says nothing about AI tools or usage. This is the default; don't guess. |
| 1 | No AI / not allowed | The posting says AI tools are not used or not permitted. |
| 2 | AI optional | AI tools are mentioned as optional or a nice-to-have (e.g. "familiarity with Copilot"). |
| 3 | AI-assisted | AI coding tools are a normal part of the daily workflow (Copilot, Cursor, Claude Code used routinely; "AI-enabled team"). |
| 4 | AI-first | Engineers are expected to work mainly through AI tools/agents, build AI-driven workflows, "AI-native"; humans steer and refine. |
| 5 | Agent-led | Agents and sub-agents do most of the work; humans mainly review and verify. |

- `aiNote` says why, quoting or closely paraphrasing the posting (about 160 characters at most). It is `""` only for level 0 when the posting is silent. If the description couldn't be fetched, use level 0 with `aiNote: "Description not re-read yet"` so a later run fills it in.
- **For every new or changed candidate, the run must read the full description (step 3) and set `aiLevel` and `aiNote`.** Known roles keep their earlier rating: `verify-jobs.mjs` copies the previous `aiLevel`/`aiNote` onto a known (or reopened) id when the candidate doesn't carry them, and a candidate that does carry them replaces the old values. So only include them on a known role when its description has changed or it still has "Description not re-read yet".
- The site shows a 0-5 dot scale with the label on each role, the note as a secondary line (and tooltip), an "AI usage" minimum-level filter and an "AI usage (highest)" sort.

### Claude mentions (`claudeMention`)

- For every new or changed role, also search the full description for Claude (Claude, Claude Code, Claude API, Opus, Sonnet, "Anthropic's Claude"). Plain "Anthropic" with no link to Claude doesn't count, and nor do unrelated words.
- If found, set `claudeMention` to a short quote or close paraphrase (about 120 characters at most). Omit the field when there is no mention.
- It is kept through the merge like `aiLevel`: a candidate carrying a fresh `aiLevel` is treated as a fresh read, so give it `claudeMention` too if there is one; a candidate without `aiLevel` keeps the earlier `claudeMention`.
- The site shows a small "Claude" tag next to the AI badge, with the quote as a tooltip.

- LinkedIn postings marked "No longer accepting applications" or "Not currently accepting applications" count as closed and must be excluded. Their wording is not always present on the public guest page, so when a posting's text or the user reports it, treat the role as closed.

- `scripts/excluded.json` lists role ids to keep out (id → reason): the script closes them and ignores them if a search finds them again. Add an id there when the user reports a role as closed or unwanted, and when a posting is dropped because it is not a real vacancy, so a later search cannot bring it back.
