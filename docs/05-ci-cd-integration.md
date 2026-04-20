# Part 5: CI/CD Integration

> Run the same quality gates in CI that agents run locally — same code, same thresholds, same report format.

---

## Principle: One Health Check, Multiple Surfaces

The QualityGate system from Part 2 runs identically in three contexts:

| Surface              | Trigger           | Mode                         | Blocks                |
| -------------------- | ----------------- | ---------------------------- | --------------------- |
| **postToolUse hook** | Every file edit   | Quick regex (not full gates) | Never (warnings only) |
| **sessionEnd hook**  | Conversation ends | `--changed-only`             | Yes, if critical      |
| **CI pipeline**      | Push / PR         | Full codebase                | Yes, if critical      |

The same `pawGates.ts` orchestrator, the same gate files, the same report format. No "CI-only" checks that diverge from local behavior.

---

## GitHub Actions Workflow

### Minimal Pipeline

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive # If using content submodules
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run pre-init:ci # Build prerequisites (if applicable)
      - run: npm test # Runs pretest → test:enforce → vitest

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  health-check:
    runs-on: ubuntu-latest
    needs: [test, lint] # Run after test + lint (always, even on failure)
    if: always()
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run pre-init:ci
      - run: npm run health:check # Full codebase, not --changed-only
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: health-report
          path: temp/health-report.json
```

### Key Design Choices

**Three parallel jobs** (test, lint, health-check):

- `test` and `lint` run in parallel for speed
- `health-check` runs after both (`needs: [test, lint]`) but `if: always()` ensures it runs even if test/lint fail — you want the full picture

**Full codebase in CI**: No `--changed-only` flag. CI is the backstop that catches everything, including tech debt that accumulated across multiple PRs.

**Artifact upload**: The JSON health report is uploaded as a build artifact for debugging and trend analysis.

---

## npm Scripts Integration

Wire the health check system into your `package.json` scripts:

```json
{
  "scripts": {
    "health:check": "node .paw/hooks/health-check.mjs",
    "health:check:changed": "npm run health:check -- --changed-only",

    "test": "vitest run",
    "pretest": "npm run test:enforce",
    "test:enforce": "node .paw/hooks/enforce-coverage.mjs",
    "test:coverage": "vitest run --coverage",

    "lint": "next lint",

    "pre-init": "npm run compress-assets && npm run generate-metadata && npm run merge-locales",
    "pre-init:ci": "npm run generate-metadata && npm run merge-locales"
  }
}
```

**pretest hook**: `npm test` automatically runs `test:enforce` first. This check verifies that test files exist for all source files. If any are missing, the test run is blocked before tests even execute.

---

## Test Enforcement Gate

The test enforcement script is a lightweight gate that runs before your test suite:

```typescript
// tests/scripts/enforce-coverage.ts
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC_DIR = 'src';
const TEST_DIRS = ['tests/unit', 'tests/integration'];
const EXCLUDE = [
  '.d.ts',
  '.config.ts',
  '/index.ts',
  '.module.scss',
  '.stories.ts',
  '.test.ts',
];

function findSourceFiles(dir: string): string[] {
  // Recursively find .ts/.tsx files, excluding patterns above
  // ...
}

function hasTestFile(sourcePath: string): boolean {
  const relative = path.relative(SRC_DIR, sourcePath);
  const base = relative.replace(/\.(ts|tsx)$/, '');
  return TEST_DIRS.some(
    (testDir) =>
      existsSync(path.join(testDir, `${base}.test.ts`)) ||
      existsSync(path.join(testDir, `${base}.test.tsx`)),
  );
}

const sourceFiles = findSourceFiles(SRC_DIR);
const missing = sourceFiles.filter((f) => !hasTestFile(f));

if (missing.length > 0) {
  console.error(`❌ ${missing.length} source file(s) missing tests:`);
  for (const file of missing) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

console.log(`✅ All ${sourceFiles.length} source files have test coverage`);
```

---

## Health Report as CI Gate

The health check orchestrator exits with code 1 if any critical gate fails. This naturally integrates with CI:

```yaml
- run: npm run health:check
  # Exit code 1 → step fails → job fails → PR blocked
```

For more nuanced control, parse the JSON report:

```yaml
- name: Run health check
  id: health
  run: |
    npm run health:check 2>&1 | tee health-output.txt
    # Extract JSON report
    sed -n '/---JSON_REPORT_START---/,/---JSON_REPORT_END---/p' health-output.txt \
      | sed '1d;$d' > temp/health-report.json

- name: Check for critical failures
  if: always()
  run: |
    HAS_CRITICAL=$(jq '.summary.has_critical' temp/health-report.json)
    if [ "$HAS_CRITICAL" = "true" ]; then
      echo "::error::Critical health check failures found"
      jq '.gates[] | select(.passed == false) | .gate' temp/health-report.json
      exit 1
    fi
```

---

## Badge Generation

Generate a Shields-compatible badge from test results:

```typescript
// scripts/generate-badge.ts
import { readFileSync, writeFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('vitest-report.json', 'utf-8'));
const total = report.numTotalTests;
const passed = report.numPassedTests;
const allPassed = passed === total;

writeFileSync(
  'temp/test-badge.json',
  JSON.stringify({
    schemaVersion: 1,
    label: 'tests',
    message: `${passed}/${total} passing`,
    color: allPassed ? 'brightgreen' : 'red',
  }),
);
```

Serve via a JSON endpoint or commit to repo for Shields badge:

```markdown
![Tests](https://img.shields.io/endpoint?url=https://your-host/test-badge.json)
```

---

## PR Comments (Optional)

Post health check results as PR comments for visibility:

```yaml
- name: Comment health results on PR
  if: github.event_name == 'pull_request' && always()
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const report = JSON.parse(fs.readFileSync('temp/health-report.json', 'utf-8'));
      const status = report.overall === 'PASS' ? '✅' : '❌';
      const body = `## ${status} Health Check: ${report.overall}

      | Gate | Result | Findings |
      |------|--------|----------|
      ${report.gates.map(g =>
        `| ${g.gate} | ${g.passed ? '✅' : '❌'} | ${g.findings.length} |`
      ).join('\n')}

      **Total findings**: ${report.summary.totalFindings}
      `;
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body,
      });
```

---

## Pipeline Topology

```
┌──────┐  ┌──────┐
│ test │  │ lint │     ← Parallel
└──┬───┘  └──┬───┘
   │         │
   └────┬────┘
        ▼
 ┌──────────────┐
 │ health-check │     ← Runs after both, even on failure
 └──────┬───────┘
        │
        ▼
 ┌──────────────┐
 │ deploy       │     ← Only if all gates pass
 │ (optional)   │
 └──────────────┘
```

---

## Next: [Part 6 — Reference Architecture](./06-reference-architecture.md)
