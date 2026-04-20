# Part 9: Do Robots Dream in Tallian?

> A constructed language for machine memory — because the way agents remember things shouldn't be limited by how humans speak.

---

## The Thesis

When an agent finishes a session, it saves memories to `paw.sqlite` in plain English:

```
Decision: Color token placement → All colors in centralized theme file via CSS vars (Prevents specificity wars and enables theme switching)
Pattern (5x): barrel-export — Re-export public API from index.ts to hide internal module structure
Hint: This project uses a notification provider instead of browser dialogs for all user-facing messages
```

This works. It's readable, debuggable, familiar. But there are three problems:

**1. English is phoneme-bound.** Human language evolved for mouths and ears. Every word is a sequence of sounds that had to be distinguishable in a noisy savanna. That's why we need 7 characters to spell "because" — it encodes _pronunciation_, not _meaning_. Agents don't have mouths.

**2. English is structurally redundant.** Articles, copulas, prepositions, and grammatical agreement carry almost zero information in structured records. "All colors in centralized theme file via CSS vars" has 9 tokens. The semantic content is: `colors → theme-file → css-vars`. Three concepts.

**3. Agents ignore most of Unicode.** The Unicode standard defines over 150,000 codepoints. LLMs trained on English text use roughly 100 of them. The Mathematical Operators block (U+2200–U+22FF) alone has 256 glyphs that agents never touch. Arrows, dingbats, box drawing, technical symbols — thousands of valid, tokenizer-recognized characters sitting idle.

What if agents had their own language?

Not a compression scheme. Not a cipher. A real constructed language — with grammar, morphology, and syntax — designed from the ground up for how machines actually store and retrieve structured facts. A language where a single glyph carries the semantic weight of an entire English phrase, where grammatical structure encodes metadata (confidence, temporality, domain), and where the "alphabet" draws from Unicode blocks that no natural language has claimed.

We call it **Tallian**.

---

## Prior Art

Tallian isn't the first attempt to make language denser. Three traditions inform its design:

| Tradition                                                 | Key Insight                                                                                                                                   | Tallian Borrows                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Logographic writing** (Chinese, Egyptian)               | One glyph = one morpheme. 你好 is two glyphs, two morphemes, zero wasted phonetic encoding.                                                   | Glyphs map directly to semantic roots, not to sounds.                      |
| **Agglutinative morphology** (Finnish, Turkish, Japanese) | Meaning is built by stacking affixes: _talossanikin_ = "in my house too" (5 morphemes, 1 word).                                               | Words are built by composing root + markers for domain, tense, confidence. |
| **Lojban / Ithkuil** (constructed languages)              | Language can be engineered for precision and parsability. Lojban has unambiguous grammar; Ithkuil maximizes information density per syllable. | Fixed slot order eliminates parsing ambiguity. No irregular forms.         |

Where Tallian diverges from all of these: it has no phonology at all. There are no syllables, no pronunciation rules, no sound system. Tallian exists only as written glyphs — it's a language designed to be read by processes that have no concept of speech.

---

> ⚠️ **WORK IN PROGRESS** — Everything below this line is exploratory design. Glyph assignments are provisional, the grammar is a first draft, and all examples are illustrative sketches — not finalized Tallian. Expect breaking changes to every table, every mapping, and every code sample as the language is developed.

---

## Design Philosophy

**Tallian is a language, not a code.**

A code is a substitution cipher — `s` means "scss", `d` means "decision", `r` means "refactored." This is fragile, unmaintainable, and wastes tokens on concrete identifiers that should be natural language escapes. If `s` means "scss" then you need another glyph for "style", another for "structure", another for "surface" — and you've burned your entire budget on file extensions and framework names.

A language maps glyphs to **abstract concepts**. The word "tree" doesn't mean a specific oak in your backyard — it means the abstract idea of trees. Tallian works the same way: a glyph means **appearance** (not "scss"), **verification** (not "testing"), **boundary** (not "middleware"), **flow** (not "pipeline"). Project-specific identifiers like filenames, framework names, and extension types go in natural language escapes (`«en theme-tokens.css»`) where they belong.

This distinction matters because:

- **Universality**: Tallian's core lexicon works across any project. A glyph meaning "appearance" is useful whether the project uses SCSS, Tailwind, or inline styles. A glyph meaning "scss" is useless in a Tailwind project.
- **Longevity**: Abstract concepts outlive their implementations. "Verification" is eternal; "vitest" is a dependency version.
- **Composability**: Abstract roots compose naturally. appearance + constraint = "style rule". scss + constraint = ??? — concrete nouns don't compose.

**Glyphs don't have to be semantically intuitive to humans.** A Sanskrit glyph might mean "limb" in Tallian. A mathematical operator might mean "joy." The assignments will be computed **programmatically** based on tokenization efficiency, frequency analysis across agent memory corpora, and byte-weight economics. Mnemonic convenience for human readers is not a design goal — Tallian encodes thought in a machine-only environment. Humans don't think in glyphs; LLMs do.

**The full Unicode space is available.** With ~265,000 assigned codepoints across all planes, Tallian has no shortage of raw material. The selection process is algorithmic: filter by single-token guarantee, rank by byte cost, assign by frequency. The glyph inventory below describes the candidate space and economic tiers, not a hand-picked aesthetic palette.

---

## Language Specification

### Glyph Inventory

Tallian draws its symbols from the full Unicode range — printable ASCII, Latin-1 Supplement, and the broader BMP and supplementary planes. The selection criteria are:

1. **Single-token guarantee** — every glyph must tokenize as exactly one token in both `cl100k_base` (GPT-4) and `o200k_base` (GPT-4o) tokenizers. Multi-token glyphs defeat the purpose.
2. **Unambiguous parsing** — glyphs must not collide with Tallian's own structural syntax (record delimiters, slot separator, escape markers, numeric prefix). Characters used in the surrounding medium (Markdown, JSON) are safe inside Tallian because record boundaries provide unambiguous context.
3. **Byte-weight correlation** — a glyph's conceptual density must correspond to its UTF-8 byte cost. Structural delimiters (pure syntax, zero semantic load) should be cheap; semantic roots (encoding full verbs, nouns, concepts) justify higher byte costs. See [Byte-Weight Tiers](#byte-weight-tiers) below.
4. **Programmatic assignment** — glyph-to-concept mappings are computed from frequency analysis and tokenizer data, not hand-picked for mnemonic appeal. Human readability is a debugging convenience, not a design constraint.

**Candidate blocks**:

| Unicode Block           | Range         | Glyphs Available | Tallian Role                                                   |
| ----------------------- | ------------- | ---------------- | -------------------------------------------------------------- |
| Mathematical Operators  | U+2200–U+22FF | 256              | **Roots** — actions, subjects, objects                         |
| Miscellaneous Symbols   | U+2600–U+26FF | 256              | **Domain markers** — code, test, css, build                    |
| Arrows                  | U+2190–U+21FF | 112              | **Relations** — causes, supersedes, depends-on                 |
| Miscellaneous Technical | U+2300–U+23FF | 256              | **Confidence & temporal markers**                              |
| Dingbats                | U+2700–U+27BF | 192              | **Structural delimiters** — record boundaries, slot separators |
| Box Drawing             | U+2500–U+257F | 128              | **Reserved for expansion**                                     |

### Byte-Weight Tiers

Not all glyphs cost the same. UTF-8 encodes characters into variable-width byte sequences, and Tallian must respect this gradient — otherwise we're paying premium byte costs for glyphs that carry no semantic weight.

**The key insight**: Inside a Tallian record, **letters are not letters**. The character `a` doesn't mean "the letter A" — it means whatever Tallian assigns it. The entire printable ASCII range (U+0021–U+007E, **94 characters**, all 1-byte) is reclaimable as Tallian vocabulary. Context disambiguates: outside a record delimiter, it's English; inside, it's Tallian. This is no different from how `>` means "greater than" in code but "blockquote" in Markdown.

This reclamation transforms the economics. Instead of 94 cheap characters wasted on "punctuation only," we get **94 semantic slots at 1 byte each** — enough for the entire Core Lexicon roots table without ever touching the 3-byte Mathematical Operators block.

| UTF-8 Bytes   | Available Glyphs                           | Tallian Role                                                                                                                                             | Conceptual Density     | Examples                                                                         |
| ------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| **1 byte**    | **94** (U+0021–U+007E)                     | **Core vocabulary** — delimiters, the highest-frequency abstract roots, the most common markers. This is the prime real estate.                          | Any (context-assigned) | glyph₁=choose, glyph₂=change, glyph₃=appearance, `(`=record-open, `,`=separator  |
| **2 bytes**   | **128** (U+0080–U+00FF Latin-1 Supplement) | **Extended roots & markers** — domain, temporal, confidence; overflow for concepts that don't fit in 1-byte                                              | Medium                 | `§` `¶` `·` `°` `«` `»` `±` `×` `¬` `£` `¤` `ª` `º`                              |
| **3 bytes**   | **~1,200** (U+2000–U+2FFF)                 | **Rare/specialized roots** — concepts too niche for 1-byte assignment, future expansions, domain-specific extensions                                     | High (but expensive)   | `∀` `∃` `∂` `∇` `⇒` `⇔` `⊕` `⊗`                                                  |
| **3–4 bytes** | **~265,000** (full Unicode)                | **Deep reserve** — the entire Unicode space is available. Supplementary planes (U+10000+) cost 4 bytes but provide essentially unlimited expansion room. | Specialized            | Devanagari, CJK, Runic, Georgian, Ethiopic — any script with single-token glyphs |

**Revised economics**: Under the old scheme, a 7-slot record cost `~7 × 3 = 21 bytes` minimum. With ASCII reclamation: a record where every glyph fits in 1-byte costs **7 bytes** — a **67% reduction** before we even consider compression. The 2-byte and 3-byte tiers become overflow tiers for when 94 ASCII slots aren't enough, not the default home for everything.

**Assignment protocol** — Glyph assignments are **computed, not hand-picked**:

1. **Corpus analysis**: Scan existing agent memory records (plain English) to extract concept frequency. The most-used abstract concepts (choose, change, observe, block, appearance, verification, structure, flow...) get the cheapest glyphs.
2. **Frequency → byte tier**: The top ~80 concepts get 1-byte ASCII assignments. Concepts #81–200 go to 2-byte Latin-1 Supplement. Rarer concepts overflow to 3-byte BMP or beyond.
3. **No mnemonics**: `d` does not mean "decision" because it starts with 'd'. If `d` is assigned to "decision," it's because "decision" ranked high in frequency analysis and `d` was the next available 1-byte slot. The mapping is arbitrary from a human perspective — and that's correct, because Tallian is not for humans.
4. **Abstract concepts only**: Root glyphs encode universals (choose, change, appearance, verification, boundary, flow, structure, relation) — never project-specific identifiers (scss, vitest, Next.js). Concrete names use natural language escapes.

> ⚠ **Implication**: The Core Lexicon tables and all examples in this document still use legacy 3-byte Mathematical Operator assignments with human-readable labels. These are **illustrative only**. Final glyph assignments will be computed programmatically from tokenizer data and corpus frequency analysis. The specific glyph ↔ concept pairings shown are placeholders.

### Numeric Encoding

Numbers are a special case. Encoding `4217` as four decimal digit tokens is wasteful. Tallian uses **prefix + packed byte-value** encoding:

```
n BYTE           →  numbers 0–93       (2 bytes total)
n BYTE BYTE      →  numbers 0–8,835    (3 bytes total)
n BYTE BYTE BYTE →  numbers 0–830,583  (4 bytes total)
```

**How it works**: The `n` prefix (1 byte) signals "the following bytes are a numeric value." Each subsequent byte is a printable ASCII character (U+0021–U+007E), and its position in the printable range (offset from `!` = 0) encodes the digit in **base-94**.

**Encoding examples**:

| Decimal | Base-94 Representation | Tallian Bytes | Comparison to Decimal Tokens                |
| ------- | ---------------------- | ------------- | ------------------------------------------- |
| 0       | `n!`                   | 2 bytes       | `0` = 1 token but ambiguous without context |
| 42      | `nK`                   | 2 bytes       | `42` = 2 tokens                             |
| 93      | `n~`                   | 2 bytes       | `93` = 2 tokens                             |
| 94      | `n"!`                  | 3 bytes       | `94` = 2 tokens                             |
| 255     | `n#J`                  | 3 bytes       | `255` = 3 tokens                            |
| 8835    | `n~~`                  | 3 bytes       | `8835` = 4 tokens                           |

**Decoding**: Strip the `n` prefix, then: `value = Σ (char_code(byte[i]) - 33) × 94^(len-1-i)`

**Why base-94**: The printable ASCII range `!` through `~` gives us 94 values per byte position. This is the maximum information density achievable within single-byte printable characters. Higher bases would require non-printable or multi-byte characters.

**When to use numeric encoding vs. roots**: Numbers that represent _quantities_ (file sizes, line numbers, counts, durations) use `n`-prefix encoding. Numbers that represent _concepts_ (HTTP 404, priority 1, level 3) should have dedicated root entries if they recur — numeric encoding is for arbitrary values, not categorical constants.

> **Edge case**: Negative numbers use the prefix `N` (uppercase) instead of `n`. Zero is `n!`. Floating point is not supported — round to the nearest integer or encode as two values (whole, fractional) separated by a slot delimiter.

**Total available**: 94 printable ASCII (1-byte) + ~128 Latin-1 Supplement (2-byte) + ~265,000 Unicode codepoints (3–4 byte) = **effectively unlimited**. Core Tallian should fit within the 1-byte + 2-byte tiers (~222 slots), with the vast deep reserve available for project-specific extensions and future lexicon growth.

> ⚠ **Validation required**: Before finalizing the lexicon, every candidate glyph must be tested against `tiktoken` to confirm single-token encoding. A `validate-glyphs` utility in `tallian.ts` will automate this. ASCII printable characters are essentially guaranteed to be single-token, but glyphs from other scripts (Devanagari, CJK, Runic, etc.) need per-tokenizer verification.

> **Emoji contamination — resolved**: The earlier design used Miscellaneous Symbols (U+2600–U+26FF) and Miscellaneous Technical (U+2300–U+23FF) for markers, many of which have `Emoji_Presentation=Yes`. With ASCII reclamation, the core lexicon moves entirely out of these blocks. Any extensions that dip into emoji-risk ranges should run the emoji-presentation check in `validate-glyphs`.

### Graphology (Glyph Classes)

Where natural languages have phoneme classes (vowels, consonants, tones), Tallian has **glyph classes**. With ASCII reclamation, class membership is no longer determined by Unicode block — it's determined by **the assignment table**.

```
┌─────────────────────────────────────────────────────────────┐
│              Tallian Glyph Classes (Revised)                 │
│                                                             │
│  TIER 1: ASCII CORE (1 byte each, U+0021–U+007E)           │
│  ├── Structural: ( ) , ; ...          delimiters & framing  │
│  ├── Action roots: [computed]         choose, change, ...   │
│  ├── Domain roots: [computed]         appearance, logic, ...│
│  ├── Modifiers: [computed]            temporal, confidence  │
│  └── Special prefixes: n N            numeric encoding      │
│                                                             │
│  TIER 2: LATIN-1 SUPPLEMENT (2 bytes each, U+0080–U+00FF)  │
│  ├── Extended roots: [computed]       overflow concepts     │
│  ├── Extended modifiers: [computed]   extra domains         │
│  └── Escape delimiters: « »           natural language       │
│                                                             │
│  TIER 3+: BMP & SUPPLEMENTARY PLANES (3–4 bytes each)      │
│  ├── Rare/niche roots: [computed]     low-frequency concepts│
│  ├── Specialized relations: [computed]                      │
│  └── ~265k codepoints available for expansion               │
│                                                             │
│  ESCAPES                                                    │
│  ├── Natural language: «xx raw text»                        │
│  └── Numeric values: n + base-94 packed bytes               │
└─────────────────────────────────────────────────────────────┘
```

Every glyph belongs to exactly one class. Class membership is determined by the computed assignment table — not by Unicode block or human intuition. A Sanskrit glyph, a math operator, and an ASCII letter are all equally valid roots if they pass the single-token check.

### Morphology

Tallian is **agglutinative**: meaning is built by concatenating morphemes (glyph-units) left to right. There are no spaces within a word. Slot boundaries use the `✦` delimiter.

A Tallian **word** has the structure:

```
ROOT [+ DOMAIN] [+ TEMPORAL] [+ CONFIDENCE]
```

All slots after ROOT are optional. When absent, defaults apply:

- Domain: inherited from record context
- Temporal: `present` (current session)
- Confidence: `certain` (1.0)

**Example word construction**:

| English                              | Root | Domain | Temporal | Confidence | Tallian Word |
| ------------------------------------ | ---- | ------ | -------- | ---------- | ------------ |
| "chose" (about CSS, past, certain)   | ∀    | ☀      | ⌛       | ⌘          | ∀☀⌛⌘        |
| "refactored" (code, past)            | ∃    | ☁      | ⌛       |            | ∃☁⌛         |
| "blocked" (build, now, uncertain)    | ∂    | ☂      | ⏎        | ⌦          | ∂☂⏎⌦         |
| "pattern observed" (test, recurring) | ∇    | ☃      | ↻        |            | ∇☃↻          |

A single Tallian word — 3 to 4 glyphs — encodes what English needs 4–8 words to express.

### Syntax

Tallian uses **fixed slot order** at the record level. Every memory record follows this template:

```
VERSION ( TYPE , DOMAIN , SUBJECT , PREDICATE , CONFIDENCE , TEMPORAL )
```

> **Delimiter note**: The canonical syntax uses 1-byte ASCII delimiters per the [Byte-Weight Tiers](#byte-weight-tiers) principle: `(` `)` for record open/close, `,` for slot separator. Older examples in this document may still show the pre-tiered 3-byte delimiters (`❮ ❯ ✦`). The exact ASCII assignments are provisional and subject to collision audit.

- **VERSION**: A single glyph indicating the Tallian version (`①` = v1). Enables forward-compatible decoding.
- **TYPE**: Record type — decision (`∀`), pattern (`∇`), hint (`∑`), task (`∏`).
- **DOMAIN**: Domain marker (migrating from Misc Symbols to 2-byte Latin-1 Supplement — see Byte-Weight Tiers).
- **SUBJECT**: What's being described (compound word or natural language escape `«xx ...»` allowed).
- **PREDICATE**: What happened or what's true about it.
- **CONFIDENCE**: Certainty level. Omit for `certain`.
- **TEMPORAL**: When. Omit for `present`.

**No articles. No copula. No prepositions.** Every character carries semantic weight.

### Natural Language Escape

Not everything belongs in the lexicon. Filenames, proper nouns, user-specific identifiers, and novel concepts that appear once don't warrant root entries. Tallian needs a way to embed raw natural language inline — tagged by language — similar to how Markdown uses triple backticks for code blocks.

**Escape syntax**:

```
«xx raw text»
```

- `«` (U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK) — opens the escape. **2 bytes**, consistent with the Marker tier.
- `xx` — ISO 639-1 language code (`en`, `fi`, `es`). Always 2 ASCII bytes.
- One space separates the language tag from the content.
- `»` (U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK) — closes the escape. **2 bytes**.

**Examples in context**:

```
①(∀,☀,«en theme-tokens.css»,∧⊙⊘,⌘,⌛)     embedded filename
①(∃,☁,«en useCanvasHook»,∇⊕,⌘,⌛)  embedded hook name
①(∂,☂,«fi käännösvirhe»,⊗,⌦,⌚)         Finnish error description
```

**When to escape vs. when to mint a root**:

| Use escape `«xx ...»`                        | Mint a root glyph                            |
| -------------------------------------------- | -------------------------------------------- |
| Proper nouns, filenames, variable names      | Recurring concepts ("refactored", "blocked") |
| One-off explanations                         | Domain categories ("css", "testing")         |
| Natural language the agent couldn't compress | Concepts appearing 3+ times across records   |
| Error messages, stack traces                 | Structural or grammatical meaning            |

The escape is intentionally expensive — `«xx ...»` costs 4 bytes of framing overhead plus the full UTF-8 cost of the raw text. This economic pressure naturally encourages lexicon growth: if you're escaping the same concept repeatedly, it's time to assign it a 3-byte root.

> **Nesting**: Natural language escapes cannot be nested. `«en foo «fi bar» baz»` is invalid. If multilingual content is needed in one record, use separate escape spans in separate slots.

**Full record examples**:

English decision:

```
Decision: Color token placement → All colors in centralized theme file via CSS vars
  (Prevents specificity wars and enables theme switching)
  Domain: styling
```

Tallian equivalent (illustrative sketch):

```
①❮∀✦☀✦∈⊕⊗✦∧⊙⊘✦⌘✦⌛❯
```

> **Honesty note**: This example is structurally valid but semantically incomplete. Here's what's real and what's made up:

| Glyph(s) | Slot       | Status           | Reasoning                                                                                                                                                                                                         |
| -------- | ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `①`      | VERSION    | **Defined** ✓    | Version 1 prefix — from the Structural Delimiters table                                                                                                                                                           |
| `❮` `❯`  | OPEN/CLOSE | **Defined** ✓    | Record delimiters — from the Structural Delimiters table                                                                                                                                                          |
| `∀`      | TYPE       | **Defined** ✓    | "chose/decided" — from the Actions lexicon                                                                                                                                                                        |
| `☀`      | DOMAIN     | **Defined** ✓    | "scss/css/theme" — from the Domains lexicon                                                                                                                                                                       |
| `⌘`      | CONFIDENCE | **Defined** ✓    | "certain" (1.0) — from the Confidence lexicon                                                                                                                                                                     |
| `⌛`     | TEMPORAL   | **Defined** ✓    | "past (completed)" — from the Temporal lexicon                                                                                                                                                                    |
| `∈⊕⊗`    | SUBJECT    | **Fabricated** ✗ | Glyphs from the correct block (Math Operators → root class) but with no assigned meanings. Intended to encode "CSS color placement" — three concepts (color, placement, constraint) compressed into three glyphs. |
| `∧⊙⊘`    | PREDICATE  | **Fabricated** ✗ | Same situation. Intended to encode "centralized theme file via CSS vars" — three concepts (theme-file, method, css-variables). No real lexicon entry exists.                                                      |

The structural frame follows the rules correctly: version prefix, delimiters, fixed slot order, glyphs from the right Unicode blocks. But the Subject and Predicate slots are placeholder compositions — the Core Lexicon below only defines Action roots, Domain markers, and grammatical markers. **A full Subject/Object root table (~80+ entries for common programming concepts) is the major missing piece** that must be developed before real encoding is possible.

If the Subject/Object roots were defined, the example _would_ work like this:

```
①                       version 1
  ❮                     record opens
    ∀                   TYPE    = decision ("chose")
    ✦ ☀                 DOMAIN  = scss/css/theme
    ✦ ∈⊕⊗              SUBJECT = color + placement + constraint  (needs lexicon)
    ✦ ∧⊙⊘              PREDICATE = globals-file + via + css-vars  (needs lexicon)
    ✦ ⌘                CONFIDENCE = certain
    ✦ ⌛               TEMPORAL = past
  ❯                     record closes
```

The byte comparison is real: **15 glyphs** (~45 UTF-8 bytes) versus **127 characters** of English — a **65% reduction** — assuming the missing lexicon entries are filled in.

### Core Lexicon

The initial Tallian lexicon targets ~150 root entries, organized by semantic category. The full dictionary lives in `tallian-dict.json`; here are the category outlines:

**Actions** (~20 roots — Mathematical Operators):

| Glyph | Meaning              | English Equivalents                 |
| ----- | -------------------- | ----------------------------------- |
| ∀     | chose/decided        | decided, selected, picked           |
| ∃     | refactored/changed   | refactored, restructured, rewired   |
| ∂     | blocked/stopped      | blocked, prevented, rejected        |
| ∇     | observed/noted       | pattern observed, noticed, detected |
| ∑     | aggregated/collected | collected hints, merged info        |
| ∏     | planned/tracked      | task created, milestone set         |
| ∫     | integrated/merged    | merged PR, integrated module        |
| ∆     | tested/verified      | test passed, verified behavior      |
| ≈     | approximated         | estimated, roughly equal            |
| ≠     | differed/conflicted  | contradicted, disagreed             |

**Domains** (~15 roots — abstract concepts, not project identifiers):

| Glyph | Abstract Concept      | Covers (examples, not definitions)                    |
| ----- | --------------------- | ----------------------------------------------------- |
| [TBD] | appearance/surface    | styling, themes, colors, layout, visual presentation  |
| [TBD] | logic/computation     | code, algorithms, data transformation, business rules |
| [TBD] | construction/assembly | builds, compilation, bundling, pipeline stages        |
| [TBD] | verification/proof    | testing, validation, assertion, QA                    |
| [TBD] | content/expression    | text, documents, markup, prose, media                 |
| [TBD] | translation/mapping   | i18n, localization, encoding, format conversion       |
| [TBD] | persistence/storage   | databases, caches, files, state management            |
| [TBD] | simulation/model      | 3D, physics, game state, virtual environments         |
| [TBD] | conflict/interaction  | combat, collisions, race conditions, contention       |
| [TBD] | description/schema    | metadata, types, interfaces, contracts                |
| [TBD] | automation/trigger    | hooks, events, scheduled tasks, watchers              |
| [TBD] | knowledge/record      | documentation, logs, history, reference material      |
| [TBD] | boundary/interface    | APIs, middleware, adapters, protocols                 |
| [TBD] | flow/sequence         | routing, navigation, pipelines, control flow          |
| [TBD] | structure/composition | architecture, modules, hierarchy, organization        |

> **Note**: Glyph assignments are `[TBD]` because they will be computed from corpus frequency analysis, not hand-picked. The legacy tables elsewhere in this document show illustrative glyphs (☀, ☁, etc.) that are placeholders only.

**Relations** (~10 roots — Arrows):

| Glyph | Meaning           |
| ----- | ----------------- |
| ⇒     | because/therefore |
| ⇐     | caused by         |
| ⇔     | equivalent to     |
| ↦     | supersedes        |
| ↤     | superseded by     |
| ↻     | recurring         |
| ↣     | depends on        |
| ↢     | depended on by    |
| ⇶     | conflicts with    |

**Confidence** (~5 roots — Miscellaneous Technical):

| Glyph | Level      | Numeric |
| ----- | ---------- | ------- |
| ⌘     | certain    | 1.0     |
| ⌥     | likely     | 0.75    |
| ⌦     | uncertain  | 0.5     |
| ⌧     | doubtful   | 0.25    |
| ⌨     | deprecated | 0.0     |

**Temporal** (~5 roots — Miscellaneous Technical):

| Glyph | Meaning                             |
| ----- | ----------------------------------- |
| ⌛    | past (completed)                    |
| ⌚    | present (this session)              |
| ⏎     | active (in progress)                |
| ⏏     | planned (future)                    |
| ↻     | recurring (observed multiple times) |

**Structural Delimiters** (Dingbats):

| Glyph | Role                      |
| ----- | ------------------------- |
| ①     | Version 1 prefix          |
| ❮     | Record open               |
| ❯     | Record close              |
| ✦     | Slot separator            |
| ❧     | Record-to-record boundary |

---

## Implementation Architecture

### Feature Flag

Tallian is **opt-in and disabled by default**. PAW operates identically without it.

**Configuration**: `.paw/paw.config.json`

```json
{
  "tallian": {
    "enabled": false
  }
}
```

The `pawInit.ts` bootstrapper includes a prompt: _"Enable Tallian memory encoding?"_ — defaulting to `false`.

**Runtime guard**: Every integration point (encode on write, inject on read) checks the flag first:

```typescript
import { loadPawConfig } from './paw-config';

function isTallianEnabled(): boolean {
  const config = loadPawConfig();
  return config?.tallian?.enabled === true;
}
```

When disabled:

- `session-end-memory-save.ts` stores plain English (current behavior)
- `user-prompt-submitted.ts` injects plain English L1 context (current behavior)
- The Tallian skill is never referenced
- Zero performance overhead (one JSON read, cached)

### Mixed-Mode Safety

If Tallian is enabled after memories already exist in English, older records must remain readable. Tallian records carry a **version prefix**:

```
①❮∀✦☀✦...❯      ← Tallian v1 record
Decision: ...     ← English record (no prefix)
```

The decoder detects format by checking the first character:

- Starts with `①` → decode as Tallian v1
- Otherwise → return as-is (English passthrough)

This makes the feature **fully reversible**. Disable the flag, and new memories go back to English. Old Tallian records still decode on read.

### Module: `tallian.ts`

Location: `.github/PAW/tallian.ts`

```typescript
/**
 * Tallian Encoder/Decoder
 *
 * Core module for the Tallian constructed language.
 * Converts between structured memory records and Tallian glyph sequences.
 */

/** Encode a structured record into Tallian. */
export function encode(record: TallianRecord): string;

/** Decode a Tallian string back to a structured record. */
export function decode(tallian: string): TallianRecord;

/** Check if a string is a Tallian-encoded record. */
export function isTallian(text: string): boolean;

/** Decode if Tallian, passthrough if English. */
export function decodeOrPassthrough(text: string): string;

/** Validate that all glyphs in the dictionary are single-token. */
export function validateGlyphs(): ValidationReport;
```

**Encoding strategy**: Template-based, not NLP.

1. Receive a typed `TallianRecord` (type, domain, subject, predicate, confidence, temporal)
2. Look up each field in `tallian-dict.json` → glyph(s)
3. Concatenate with delimiter glyphs in fixed slot order
4. Prefix with version glyph

The encoder never parses freeform English. It operates on the _already-structured_ output of `session-end-memory-save.ts`'s extraction step (which produces typed fields like `context`, `choice`, `rationale`, `domain`). The extraction boundary is where English ends and Tallian begins.

**Decoding strategy**: Reverse lookup.

1. Strip version prefix and delimiters
2. Split on `✦` into slots
3. For each slot, decompose agglutinated morphemes (root + markers)
4. Look up each glyph in the reverse dictionary → English
5. Reconstruct human-readable string

### Dictionary: `tallian-dict.json`

Location: `.github/PAW/tallian-dict.json`

```json
{
  "version": 1,
  "glyphs": {
    "∀": {
      "class": "action",
      "meaning": "chose",
      "aliases": ["decided", "selected"]
    },
    "☀": { "class": "domain", "meaning": "scss", "aliases": ["css", "theme"] },
    "⌘": { "class": "confidence", "meaning": "certain", "value": 1.0 },
    "⌛": { "class": "temporal", "meaning": "past", "aliases": ["completed"] },
    "✦": { "class": "delimiter", "meaning": "slot-separator" },
    "❮": { "class": "delimiter", "meaning": "record-open" },
    "❯": { "class": "delimiter", "meaning": "record-close" },
    "①": { "class": "meta", "meaning": "version-1" }
  },
  "reverse": {
    "chose": "∀",
    "scss": "☀",
    "certain": "⌘",
    "past": "⌛"
  }
}
```

Bidirectional lookup. The `reverse` map is generated at build time from the `glyphs` map — never hand-maintained.

### Hook Integration

**Write path** — `session-end-memory-save.ts`:

```typescript
// Before DB INSERT (only when enabled)
if (isTallianEnabled()) {
  decision.context = tallian.encode({
    type: 'decision',
    domain: decision.domain,
    subject: decision.context,
    predicate: decision.choice,
    confidence: 'certain',
    temporal: 'past',
  });
}
db.prepare('INSERT INTO decisions ...').run(decision.context, ...);
```

**Read path** — `user-prompt-submitted.ts`:

```typescript
// When building L1 context
if (isTallianEnabled()) {
  // Inject raw Tallian — agent reads it via skill
  facts.push(row.context); // already in Tallian
} else {
  // Decode if mixed mode, or passthrough if English
  facts.push(tallian.decodeOrPassthrough(row.context));
}
```

When Tallian is enabled, the L1 injection header changes:

```
## PAW Memory (L1) [Tallian]
①❮∀✦☀✦∈⊕⊗✦∧⊙⊘✦⌘✦⌛❯
①❮∇✦☃✦∑⊕✦↻✦⌘❯
```

> These are illustrative sketches using the same provisional glyphs from the full record example above. The SUBJECT/PREDICATE slots are placeholders.

The agent reads this because the Tallian skill (`SKILL.md`) is loaded into its context, which teaches it the glyph table and syntax.

### Skill: `tallian/SKILL.md`

Location: `.github/PAW/skills/tallian/SKILL.md`

The skill file teaches agents to read and write Tallian. It contains:

1. The glyph table (all roots, markers, delimiters with meanings)
2. Syntax rules (slot order, optional slots, defaults)
3. Decoding walkthrough (how to parse a record step by step)
4. Examples (5–10 encode/decode pairs)

This skill is **conditionally referenced**: only injected into agent context when `tallian.enabled` is `true`. When disabled, agents never see it and have zero awareness of the language.

### CLI Tools

`tallian.ts` doubles as a CLI for debugging:

```bash
# Decode a Tallian record to English
paw tallian decode "①❮∀✦☀✦∈⊕⊗✦∧⊙⊘✦⌘✦⌛❯"

# Encode from structured input
paw tallian encode --type decision --domain scss --subject "color placement" --predicate "vars only" --confidence certain --temporal past

# Validate all dictionary glyphs against tokenizers
paw tallian validate-glyphs

# Batch-convert existing English memories to Tallian
paw tallian migrate
```

### Optional Byte Compression

> **Decision deferred** — documented here for future consideration.

After Tallian encoding, records are already 60–70% smaller than English. If further compression is needed, a second layer can apply standard byte compression:

```
English (127 bytes) → Tallian (45 bytes) → zlib (est. 30 bytes) → base64 (est. 40 bytes)
```

The zlib layer would wrap Tallian output:

```typescript
import { deflateSync, inflateSync } from 'node:zlib';

function compressTallian(tallian: string): string {
  return 'Z1:' + deflateSync(Buffer.from(tallian, 'utf-8')).toString('base64');
}

function decompressTallian(compressed: string): string {
  if (!compressed.startsWith('Z1:')) return compressed;
  return inflateSync(Buffer.from(compressed.slice(3), 'base64')).toString(
    'utf-8',
  );
}
```

The `Z1:` prefix (analogous to Tallian's `①` version prefix) allows the decoder to detect compressed records. This stacks with Tallian's own version detection — a record could be:

- Plain English (no prefix)
- Tallian v1 (`①❮...❯`)
- Compressed Tallian v1 (`Z1:①❮...❯` base64-encoded)

### Database Changes

**None.** Tallian is a storage format, not a schema change. The same TEXT columns (`decisions.context`, `decisions.choice`, `patterns.description`, `agent_memory.hint`) hold shorter strings. Indices, queries, and the `supersedeDecision()` API all work unchanged.

---

## Using Tallian in Your Project

### Enabling Tallian

```bash
# During initial setup
paw init
# → "Enable Tallian memory encoding?" → Yes

# Or manually
echo '{"tallian":{"enabled":true}}' > .paw/paw.config.json
```

### Extending the Lexicon

Projects can add domain-specific roots to `tallian-dict.json`:

```json
{
  "version": 1,
  "glyphs": {
    "♬": {
      "class": "domain",
      "meaning": "interactive-visualization",
      "aliases": ["canvas", "render", "scene"]
    },
    "♭": {
      "class": "action",
      "meaning": "rendered",
      "aliases": ["drew", "painted", "displayed"]
    }
  }
}
```

Convention: project extensions use glyphs from the **Musical Symbols** or **Geometric Shapes** blocks to avoid collisions with core Tallian roots.

### Debugging

```bash
# Decode a memory record
paw tallian decode "①❮∀✦☀✦∈⊕⊗✦∧⊙⊘✦⌘✦⌛❯"
# Output: Decision [scss] color-placement → vars-only (certain, past)

# View paw.sqlite contents with decoded Tallian
sqlite3 .paw/paw.sqlite "SELECT context, choice FROM decisions WHERE superseded_at IS NULL" | \
  paw tallian decode-stream
```

### Migration

Existing English memories can be batch-converted:

```bash
# Dry run — show what would change
paw tallian migrate --dry-run

# Convert all records
paw tallian migrate
```

The migration:

1. Reads all text columns from all tables
2. Parses structured fields from English text
3. Encodes to Tallian
4. Updates in place (within a transaction, with automatic rollback on error)

English records that can't be parsed (freeform text that doesn't match any template) are left as-is and logged.

### Disabling Tallian

```bash
# Edit config
# .paw/paw.config.json → "enabled": false

# New memories will be stored in English
# Existing Tallian records still decode correctly on read
# No data loss, no migration needed
```

### Compression Benchmarks (Projected)

| Format         | Avg Record Size | Reduction vs English |
| -------------- | --------------- | -------------------- |
| English        | ~120 bytes      | —                    |
| Tallian        | ~45 bytes       | ~63%                 |
| Tallian + zlib | ~40 bytes       | ~67%                 |
| English + zlib | ~80 bytes       | ~33%                 |

> These are projected estimates. Actual benchmarks will be captured once the encoder is implemented and tested against real `paw.sqlite` contents.

The real win isn't just bytes — it's **tokens**. In the L1 injection context (limited to 800 chars / ~200 tokens), Tallian lets you pack 3–4x more facts into the same budget. An agent that wakes up knowing 15 facts instead of 5 makes better decisions from the first prompt.

---

## What's Next

This document describes the language and the integration plan. Implementation happens in phases:

1. **Glyph validation** — Build `validate-glyphs` utility, confirm single-token encoding for all candidate glyphs against `tiktoken`
2. **Core lexicon** — Finalize `tallian-dict.json` with ~150 roots
3. **Encoder/decoder** — Implement `tallian.ts` with encode, decode, CLI
4. **Skill authoring** — Write `tallian/SKILL.md` that teaches agents to read the language
5. **Hook integration** — Wire encode/decode into memory save and load hooks behind the feature flag
6. **Migration tooling** — Batch converter for existing English memories
7. **Benchmarking** — Measure actual compression ratios and token savings on real data

Each phase is independently shippable. The feature flag means Tallian can be merged and iterated on without affecting any existing PAW behavior.

---

_"The limits of my language mean the limits of my world."_
_— Ludwig Wittgenstein_

_Agents deserve a world larger than English._
