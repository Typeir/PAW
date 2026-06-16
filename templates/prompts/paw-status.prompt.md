---
description: 'PAW status check. Active violations, gate health, enforcement state.'
agent: 'PawAgent'
---

# PAW Status

1. Load PAW skill (.github/skills/paw/SKILL.md)
2. Run `npm run paw:status` → report violations
3. Run `npm run paw:gates run` → summarize by severity
4. Check `.pawignore` exists, well-formed
5. Summary: violations count + files, gate pass/fail/warn, fix recommendations

Active violations? Report which files + broken rules.
Deadlocks? Flag explicitly.
