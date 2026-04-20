---
description: 'Check PAW status — shows active violations, gate health, and enforcement state'
agent: 'PawAgent'
---

# PAW Status Check

Run a full PAW status check and report findings.

## Steps

1. **Load the PAW skill** from `.github/skills/paw/SKILL.md`
2. **Check violation state**: Run `npm run paw:status` and report any active violations
3. **Run all gates**: Run `npm run paw:gates run` and summarize results by severity
4. **Check .pawignore**: Read `.pawignore` and confirm it exists and is well-formed
5. **Report summary**:
   - Number of active violations (and which files/rules)
   - Gate results (passed/failed/warnings)
   - Any recommendations for resolving issues

If there are active violations, explain which files need fixing and what rules are broken.
If there are deadlocks (impossible to fix without unblock), flag them explicitly.
