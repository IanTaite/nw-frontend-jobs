#!/usr/bin/env node
// postinstall hook: downloads the Playwright browsers used by `pnpm e2e`.
// Skipped when CI is set (e.g. the GitHub Pages deploy only builds, so it doesn't need them);
// a CI job that runs e2e should call `pnpm exec playwright install --with-deps` itself.
import { execSync } from 'node:child_process';

if (process.env.CI) {
  console.log('CI is set; skipping Playwright browser install.');
} else {
  execSync('playwright install', { stdio: 'inherit' });
}
