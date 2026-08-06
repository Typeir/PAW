# PAW — Non-Negotiable Constraints

These two constraints govern the PAW restoration (the `paw/core` library split and the `pawd`
daemon). They are **hard rules**: a change that violates either is not "lower quality", it is
**rejected**. Both are mechanically enforced by a gate — see §Enforcement.

They are enforced on the `feat/hex-tdd-restoration` branch and forward. Legacy flat modules
(`pawDb.ts`, `hooks/`, top-level `paw*.ts`) are exempt only until they are migrated into `packages/`;
migrating a module means bringing it into compliance, not carrying its debt across.

---

## Constraint 1 — Test-Driven. 100% coverage. No excuses.

**TDD is the process, not a suggestion.** Write the failing test first. Watch it fail. Then write the
code that makes it pass. A commit that adds behaviour with no test that would have failed without it
is a defect regardless of whether the behaviour works.

**100% coverage is the floor, measured four ways:** statements, branches, functions, lines. The
coverage gate fails the build below 100% on any of the four. This is not aspirational — the threshold
is set to 100 and CI is red at 99.9.

- An exclusion (`/* c8 ignore */`, `coverage` exclude glob) is a **reviewed exception**, not an
  escape hatch. It carries a one-line justification in the file, and unjustified exclusions fail the
  hex/quality gate. The default answer to "this line is hard to cover" is "then the design is hard to
  test — fix the design."
- Coverage of untested branches is a lie you tell yourself. Branch coverage at 100% is the rule that
  makes it honest.

**Three test tiers. All three are required for a feature to be done.**

| Tier | What it proves | Scope | Bar |
| ---- | -------------- | ----- | --- |
| **UNIT** | one module's logic, every branch | pure, no real I/O — ports are faked | fast (<50ms/test), 100% coverage of the module |
| **E2E** | a consumer works against core end to end | `cli` / `tui` / `gui` driving real `core` with real or realistic adapters | asserts observable behaviour, exit codes, emitted state |
| **REGRESSION (with screenshots)** | a visual surface did not change unintentionally | every rendered surface — `tui` frames, `gui` screens | golden-image diff; an intended change updates the golden **on purpose**, in the same commit |

- **UNIT** owns the coverage number. The core library is 100% unit-covered by construction.
- **E2E** may not chase 100% line coverage of the whole system, but every user-facing path a consumer
  exposes has at least one E2E that exercises it against a real core.
- **REGRESSION** is not optional for anything a human looks at. A `tui` panel or a `gui` view without a
  screenshot regression is unfinished. Screenshots are committed as golden images; the diff is the
  test. "It looked fine when I ran it" is not a test.

**A feature is done when:** the failing test came first, all three tiers are green, and coverage reads
100/100/100/100. Not before.

---

## Constraint 2 — `core` is a library. `cli`, `tui`, `gui` consume it. DDD / hexagonal.

**`packages/core` is the whole of PAW's logic, and it is pure.** Domain, ports, and application
use-cases live here. It imports **nothing** but `node:*` built-ins and its own modules. It has no
knowledge that a CLI, a TUI, or a GUI exists. If `core` cannot be exercised with every port faked and
no process spawned, no file touched, and no network reached, it is not pure and the design is wrong.

**The layers, and the one-way dependency rule:**

```
        consumers                 driven adapters              the library
  packages/cli   ┐                packages/adapters/*          packages/core
  packages/tui   ├─ depend on ──▶ implement core's ports ──▶   domain + ports + application
  packages/gui   │                (store, process, secret,     (pure; ports are interfaces
  packages/daemon┘                 model, presenter)            core defines)

  import direction:   consumers ──▶ adapters ──▶ core       (never the reverse)
```

- **Ports are interfaces `core` owns.** Every side effect — SQLite, spawn, keychain, model calls,
  rendering — is behind a port. `core` defines the interface; an adapter implements it; a consumer
  wires the adapter to the port at its composition root.
- **Adapters implement ports and live outside `core`** (`packages/adapters/*`). An adapter may import
  `core` (to get the interface and domain types). `core` may never import an adapter.
- **Consumers add no domain logic.** `cli` / `tui` / `gui` / `daemon` parse input, compose adapters,
  call an application use-case, and present the result. Business rules that leak into a consumer
  belong in `core`.
- **DDD, not anemic bags.** `Violation`, `Gate`, `Role`, `SwarmPlan`, `Brief` are modelled as
  entities / value objects / aggregates **with behaviour**. A `Violation` knows how to resolve and
  escalate itself; it is not a struct that some service mutates from outside. Use-cases in
  `application/` orchestrate domain through ports — they hold no rules of their own beyond sequencing.

**The forbidden import, stated plainly:** a file under `packages/core/` that imports from
`packages/cli`, `packages/tui`, `packages/gui`, `packages/adapters`, or any third-party package other
than through a port, is a **build failure**. `@paw/core` depends on no one.

---

## Constraint 3 — Fail loudly. No silent failures. Ever.

**PAW goes up in flames rather than shipping broken behaviour.** The concern is not that PAW looks
good in a demo; it is that PAW is reliable to six nines, and a system that hides its own breakage
cannot be. So when the code breaks, it crashes — visibly, immediately, with a message that says what
broke.

- **No empty catch. No swallow-and-continue.** The legacy hooks all end in
  `.catch(() => writeHookOutput({ continue: true }))`, and the legacy memory worker swallows every
  error by design. That is the exact anti-pattern this constraint exists to kill. A caught error is
  one of three things, never a silent fourth:
  1. **rethrown** — the default; let it propagate and crash loudly;
  2. **turned into a first-class visible result** — a `deny`, a doctor finding with `ok: false`, a
     surfaced event or log the operator sees;
  3. **a documented, tested degradation for a KNOWN condition** — and even then it is **loud**.
- **Known-condition degradation is loud, or it is a silent failure.** "Daemon absent → fail-open"
  (decision doc 10) emits a `paw-daemon-unreachable` violation; "optional role unbound → skip"
  returns a signal the caller **must** surface as a logged skip. A degradation no one is told about
  is the thing this rule forbids.
- **Adapters never fail open.** A store that cannot write **throws**. A model call that errors
  **throws**. A spawn that fails **throws**. The adapter reports the truth and lets the caller decide,
  visibly — it never papers over.
- **A `null` / empty return is not a hiding place.** Returning `null` for a real failure, where the
  caller then quietly moves on, is a silent failure wearing a type. Reserve `null` for the documented,
  handled, logged degradations above.

**Why:** a quality gate that fails open on its own error is worse than no gate — it certifies broken
code as clean. The only honest posture for enforcement is: if PAW itself is broken, PAW says so and
stops, rather than waving the work through.

---

## Enforcement

All three constraints are gates, because [PAW's own thesis](./README.md) is that a rule which is not
mechanically enforced is advice.

| Gate | Fails the build when | Runs in |
| ---- | -------------------- | ------- |
| `coverage` | statements / branches / functions / lines < 100% | every `packages/*` test run + CI |
| `hexagonal` | a `core` file imports an adapter, a consumer, or a bare third-party package; an unjustified coverage exclusion exists | pre-commit + CI |
| `no-silent-catch` | an empty `catch`, or a `catch` whose body neither rethrows nor produces a surfaced result | pre-commit + CI |
| `tdd-order` (advisory) | a source file changed with no corresponding test change in the same commit | CI warning, reviewed |
| `regression` | a golden screenshot differs and was not updated in the same commit | CI for `tui` / `gui` |

The `hexagonal` and `coverage` gates are themselves `packages/core`-authored `QualityGate`s, dogfooding
the system on itself. See the build order in
[the decision manifest](../../.ignore/research/byoksdk/17-hardening-worked-examples.md#9-the-build-order-this-scenario-implies).

---

*Companion to the decision record in `.ignore/research/byoksdk/` (docs 09–19). This file is the
short, binding form; those docs are the reasoning.*
