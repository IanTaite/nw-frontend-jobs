# Frontend Developer roles – North West England

An Angular 22 site (standalone components and signals) styled with Tailwind CSS 4. It loads `jobs.json` when the page opens, so new data shows up without a rebuild.

```bash
npm ci
npx ng serve                      # dev server on http://localhost:4200
npx ng build                      # outputs dist/jobs-site/browser (fully static)
node scripts/verify-jobs.mjs --candidates new.json   # merge by id (keeps firstSeen), re-check URLs, move closed ones to `closed`, stamp updatedAt
```

- `public/jobs.json`: the data (`updatedAt`, `sources`, `jobs[]`)
- `public/jobs.schema.json`: the JSON Schema
- `refresh-jobs.md`: how the hourly refresh works
- `.github/workflows/pages.yml`: GitHub Pages deploy (runs once the repo exists on GitHub)

`<base href="./">` is relative, so the build works at a domain root or under a sub-path such as `/<repo>/` on GitHub Pages.
