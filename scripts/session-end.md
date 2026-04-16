# Session End Checklist

Run these steps at the end of every dev session.

---

## 1. Update CHANGELOG.md

Open `CHANGELOG.md` in the project root. Add a new section at the top:

```
## YYYY-MM-DD — <short theme for the session>

### Bugs fixed
- **`file.ts` — description** (`commit-hash`)
  Root cause and what changed.

### Features added
- **Feature name** (`commit-hash`)
  What it does and why.

### Files changed this session
| File | Changes |
|---|---|
| `path/to/file.ts` | What changed |
```

Tips:
- Get commit hashes with `git log --oneline` 
- One entry per distinct bug or feature — not per commit
- Lead each bug entry with the root cause, not just the symptom

---

## 2. Commit and push

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for YYYY-MM-DD session"
git push origin dev
```

---

## 3. Print session summary for Claude Project Knowledge

Run this in the project root to print a structured summary ready to paste:

```bash
node -e "
const { execSync } = require('child_process');

// Get commits since last session marker or last 20
const log = execSync('git log --oneline -20').toString().trim();
const lines = log.split('\n');

// Files changed across recent commits
const files = execSync('git diff --name-only HEAD~' + Math.min(lines.length, 10) + ' HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD').toString().trim();

const date = new Date().toISOString().slice(0,10);

console.log('='.repeat(60));
console.log('SESSION SUMMARY — ' + date);
console.log('='.repeat(60));
console.log('');
console.log('RECENT COMMITS:');
lines.slice(0, 10).forEach(l => console.log('  ' + l));
console.log('');
console.log('FILES TOUCHED:');
files.split('\n').filter(Boolean).forEach(f => console.log('  ' + f));
console.log('');
console.log('PASTE INTO PROJECT KNOWLEDGE:');
console.log('-'.repeat(60));
console.log('Branch: dev');
console.log('Last session: ' + date);
console.log('');
console.log('Key files and current state:');
files.split('\n').filter(Boolean).forEach(f => console.log('  - ' + f));
console.log('');
console.log('Recent changes:');
lines.slice(0, 10).forEach(l => console.log('  ' + l));
console.log('-'.repeat(60));
"
```

---

## What to paste into Claude Project Knowledge

After running step 3, copy the block between the dashes and add it as a note in the Claude project. Include:

- **Branch and date** — so future sessions know where things stand
- **Any pending work** — bugs discovered but not fixed, features half-done, known issues
- **Any non-obvious state** — env vars required, DB schema changes that need migration, API plan limits hit
- **Score thresholds in use** — e.g. high conviction ≥75, per-category minimums (tech≥20, iv≥15, entry≥15, mom≥8)

Example note to add:

```
Last session: YYYY-MM-DD
Branch: dev (N commits ahead of last noted state)

Scoring pipeline: fully operational. opportunityScore 0–100, components:
  technicalScore 0–35, ivScore 0–25, entryScore 0–25, momentumScore 0–15, vwapScore 0–10
High conviction: score ≥75 AND tech≥20, iv≥15, entry≥15, mom≥8

Known issues / next up:
  - <anything left unresolved>

Env vars required: POLYGON_API_KEY, DATABASE_URL
DB: screener_cache table must exist (run pnpm --filter @workspace/db push)
```
