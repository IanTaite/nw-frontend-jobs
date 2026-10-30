# Hourly refresh of `jobs.json`

The site loads `jobs.json` when the page opens (`HttpClient`, with a `?t=` cache-buster), so you only need to replace that one file on the host. You don't need to rebuild the Angular app.

- Data file: `public/jobs.json` (copied to `dist/jobs-site/browser/jobs.json` by `ng build`)
- Schema: `public/jobs.schema.json` (JSON Schema 2020-12)
- Checker: `scripts/verify-jobs.mjs`

## Each hourly run

1. **Load** the current `jobs.json`. Each posting's `id` (`<source>-<board job id>`, e.g. `reed-57481500`) stays the same between runs, so it's the key for merging old and new data. Never edit `firstSeen` by hand. The script owns it.

2. **Re-search the sources** for postings from the last 30 days:
   - **Tavily** (`user-Tavily` → `tavily_search`). Example queries:
     - "frontend developer" Manchester OR Liverpool OR Cheshire OR Lancashire site:reed.co.uk
     - the same query with site:totaljobs.com, site:cwjobs.co.uk and site:uk.linkedin.com/jobs/view
     - the same query with "front end developer", "angular developer", "react developer" and "vue developer"
   - **Direct board pages** (curl with a browser user agent). These are more complete than search results:
     - Reed: the search page's `__NEXT_DATA__` JSON. The detail pages give `jobContractType`, `inferredJobLocationType` and `isAgency`.
     - Totaljobs and CWJobs: `__PRELOADED_STATE__["app-unifiedResultlist"]`.
     - LinkedIn: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=frontend%20developer&location=North%20West%20England&f_TPR=r2592000`.
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
   - `kind`: Frontend, or Adjacent (full-stack or mobile with a large frontend part).
   - `clearance`: search the full description for clearance, cleared, vetting, BPSS, CTC, SC, DV, eSC, eDV, NPPV and nationality.
     - Use `None stated` when the posting doesn't mention clearance. Asking for "government experience" alone is not clearance.
     - Must already hold it → the level (`SC`, `DV`, …).
     - Must be eligible to get it → `eSC / eDV – eligible to obtain` or `Eligible to obtain`.
     - Clearance is mentioned but no level → `Clearance required – level not stated`.
     - `clearanceNote` gives the wording in short form.

5. **Filter.** Keep only North West England postings (Greater Manchester, Merseyside, Cheshire, Lancashire, Cumbria) or UK-wide remote ones. Leave out duplicates (the same role and company on another board: keep the one with more detail), trainee or course ads, and EU-only remote roles.

6. **Merge, verify and close**: write every posting found in steps 2–5 (open ones only, with the same field set and their stable `id`) to a temp file such as `/tmp/candidates.json` (a JSON array). Then run `node scripts/verify-jobs.mjs --candidates /tmp/candidates.json`. The script matches postings by `id`:
   - **Known id**: the fresh field values replace the old ones, but `firstSeen` is **kept** and never overwritten.
   - **Id in `closed`** (the posting came back): it moves back to `jobs` with its original `firstSeen`. It isn't counted as new.
   - **Unknown id**: `firstSeen` = now, and the id goes into `newSinceLastRun`.
   - A posting already in `jobs` but missing from this run's search results is **not** closed just because search missed it. It stays until its own URL shows it's closed.
   - `newSinceLastRun` is replaced on every run. It lists only the ids first found in that run, and is `[]` if there are none.
   - It then re-fetches every open posting's URL and **moves** a posting to the `closed` array (with `closedAt` = now and a `closedReason`) on HTTP 404/410, a redirect away from the job id (Reed/Totaljobs), or closed wording such as "No longer accepting applications".
   - A posting it can't check (blocked or timed out) is kept and logged. It isn't dropped on a guess.
   - Entries in `closed` older than 30 days (by `closedAt`) are removed.
   - It sets `updatedAt` to the current ISO time, recounts `sources.counts`, and writes the file atomically.
   - `--no-fetch` runs only the merge step, for testing offline.
   - Use `--dry-run` to see the results without writing anything.

7. **Validate against the schema** before publishing: `npx ajv-cli@5 validate --spec=draft2020 -c ajv-formats -s public/jobs.schema.json -d public/jobs.json`. If it fails, **don't publish**. Keep the last good file.

8. **Publish only `jobs.json`.** Copy it to the host, or commit it to the Pages branch. Hosting options:
   - GitHub Pages: commit `jobs.json` to the deployed branch. With the included Actions workflow, a push redeploys in about 1 minute. Or use a scheduled workflow (`on: schedule: cron: '0 * * * *'`) that runs steps 6–7 itself.
   - Netlify/Cloudflare: upload the file again with their CLI.

9. **Report**: new postings (`newSinceLastRun`), postings moved to `closed` (with the reason), reopened postings and unverifiable ones, plus the new `updatedAt`.

## How the site uses these fields
- **New badge**: shown only for ids listed in `newSinceLastRun`, i.e. roles that were not in the previous refresh. Known roles are unmarked on the next refresh. There's also a "New only" filter, a "Newest discovered" sort (by `firstSeen`) and a "New this refresh" count in the summary.
- **Recently closed**: a collapsed section listing `closed` (newest `closedAt` first), with the reason and the source link.

## Notes
- Run times are UTC (`updatedAt` ends in `Z`). The site shows them in UK time.
- Posted dates are `YYYY-MM-DD`. For a relative date such as "3 days ago", work it out from the run date.
- Salary sorting treats day rates as × 220 working days.
