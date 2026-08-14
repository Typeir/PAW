# Part 15: Connectors and the Local Clone

> PAW owns the work model. A connector connects to existing scrum software; it does not define the
> shape of the data. The model is a graded DAG with a per-scope ladder, stored as files on disk and
> indexed into SQLite. The clone accepts anything and refuses nothing. Agents never call a retrieval
> tool — a hook feeds them context from a table computed in advance.

---

## 1. Terms

This document uses one term for each concept. Do not substitute synonyms.

| Term | Definition |
| --- | --- |
| **Backend** | An external work-tracking product. Rally and Taiga are backends. |
| **Adapter** | The code that maps one backend to the model. One adapter per backend. |
| **Model** | PAW's own work model. Defined in section 4. Owned by PAW, not by any backend. |
| **Node** | One entity in the model. A node has a rung and a kind. |
| **Rung** | The level of a node in the ladder. An integer. Lower is deeper. |
| **Ladder** | The ordered list of kinds for a scope. Declared in configuration. |
| **Scope** | A partition of work, expressed as a materialized path. |
| **Clone** | The local copy of backend data, held as files plus a derived index. |
| **Index** | The SQLite database derived from the files. Rebuildable. |
| **Projection** | Model data written back to a backend, with loss. |
| **L1 line** | The context block that a hook injects into an agent. |

---

## 2. Overview

```
  backends              adapters            model + clone                consumers
  ┌──────────┐         ┌─────────┐    ┌───────────────────────┐      ┌───────────────┐
  │ Rally    │◀─WSAPI─▶│ rally   │    │  nodes/   (files)     │      │ agent swarm   │
  │ Taiga    │◀─REST──▶│ taiga   │───▶│  edges/   (files)     │      │   ↓ hook      │
  │ (future) │◀───────▶│ ...     │    │  .git     (history)   │─────▶│ L1 assembler  │
  └──────────┘         └─────────┘    │      ↓ index pass     │      │   ↓           │
                                      │  clone.db  (derived)  │      │ pawd socket   │
       ▲                              │    node · field       │      └───────────────┘
       │                              │    edge · coverage    │
       │ projection (write path)      │    vector · knn_cache │      ┌───────────────┐
       └──────────────────────────────│    l1_line            │─────▶│ console GUI   │
                                      └───────────────────────┘      └───────────────┘
```

Files hold the truth. The index holds a derived copy. Delete the index and the indexer rebuilds it
from the files. Section 9 defines both.

---

## 3. Design rules

These rules constrain every later section. Break a rule only with a written reason.

1. **PAW owns the model.** No backend defines the canonical shape. A backend supplies data.
2. **The clone is canonical.** A backend holds a copy of some of it.
3. **Files are durable. The index is derived.** The indexer can rebuild the index at any time.
4. **Accept everything. Refuse nothing.** See section 6.
5. **Retrieval is involuntary.** An agent does not call a retrieval tool. A hook injects context.
6. **The serve path does no computation.** The indexer renders the L1 line in advance.
7. **The clone holds only what someone touched.** The cloner does not mirror a whole backend.
8. **No native binary dependencies.** See section 9.1.

---

## 4. The model

### 4.1 Shape

The model is a **graded directed acyclic graph**, not a tree.

- Every node has a **rung**, an integer.
- Every edge points from a higher rung to a lower rung.
- An edge may skip rungs. A task may hang directly from an initiative.
- A node may have more than one parent. The graph is **convergent and divergent**.

A tree is a DAG with in-degree at most one. The model drops that constraint. Real work converges: one
story serves two initiatives, one test case covers three stories, one defect belongs to a feature and
to a release.

### 4.2 Why not a tree

Single-parent is not a property of the work. Single-parent is a property of **aggregation
arithmetic**. If a story belongs to two initiatives, and a report sums story points per initiative,
the total exceeds the real total. Trackers force single-parent to keep that sum correct.

PAW does not produce that sum. PAW therefore does not need the constraint.

Consequence to record: any rollup over the model must either deduplicate by node identity, or state
that it double-counts. The model does not hide this.

### 4.3 The ladder

The model names no rungs. A scope declares its ladder in configuration:

```jsonc
"ladder": ["initiative", "feature", "story", "task"]
```

The rung index maps to the kind. An adapter with fewer rungs maps onto a subset. An adapter with more
rungs collapses or pads. The Rally-to-Taiga depth mismatch is therefore a configuration difference,
not adapter code.

A node whose kind is unknown gets rung `null` and kind `unranked`. See section 6.

### 4.4 The axes

The ladder is one partition. Work tracking has more than one. Each axis is a separate edge namespace.

| Axis | Namespace | Example | Traversed |
| --- | --- | --- | --- |
| Structural | `ladder` | initiative → feature → story | Yes. Rollup and scope queries. |
| Temporal | `cycle` | sprint 14 contains story 88 | Yes. Cycle queries. |
| Categorical | field | `channel = web` | No. A field, not an edge. |
| Lateral | `link` | A blocks B, A covers B | Yes. Dependency queries. |

The temporal axis is not a rung. A cycle does not nest inside an initiative, and an initiative does
not nest inside a cycle. The two partitions are orthogonal. Modelling the cycle as a rung is the
error that makes trackers hard to use.

The lateral namespace holds edges that are not partitions at all. `blocks` can cross the whole graph.
`blocks` can form a cycle. The indexer detects a cycle and breaks it for traversal. The indexer does
not reject the data.

### 4.5 Scope

Every node holds a `scope_path`. The value is a materialized path, for example
`/cxb/payments/checkout`.

- Descendants: `scope_path LIKE '/cxb/payments/%'`
- Ancestors: split the path and query each prefix.

This reproduces the Rally `projectScopeUp` and `projectScopeDown` behaviour. Taiga has no project
hierarchy. The model supplies the hierarchy for every backend.

### 4.6 Identity

Every node holds a `refs` array of namespaced strings:

```
["rally:12345", "taiga:us:88", "paw:node:7f3a"]
```

- One namespace per backend.
- The cloner never writes an unnamespaced reference.
- Two nodes that share a reference are the same node. The indexer merges them.
- The Taiga adapter writes `refs` into `external_reference`. That field is an array of text, so the
  format survives a round trip.

`refs` is the identity spine. Nothing addresses a node by path. A path states location. A reference
states identity. Moving a node changes its path and never changes its identity.

---

## 5. Fields

### 5.1 Typology

Every field in every scrum product falls in one cell of this space.

| Attribute | Values |
| --- | --- |
| `shape` | `text` (freeform) · `enum` (closed set) · `scalar` (typed: date, number, url, bool) · `ref` (pointer) · `keyed` (map of pointer to value) |
| `card` | `single` · `multi` · `keyed` |
| `writable` | `true` · `false` (derived or computed by the backend) |

Notes on the shapes:

- `enum` and `scalar` are both non-freeform, and they need different adapter work. An `enum` needs
  **value mapping** between backends. A `scalar` needs **format coercion**.
- `keyed` exists because Taiga stores story points as a map of role id to value. Rally custom field
  sets do the same. `keyed` is neither single nor multi.
- `writable: false` marks fields such as `total_points`, `total_comments`, `is_closed`, and every
  Taiga `*_extra_info` blob. A write to one of these fails.

### 5.2 Constraints belong to the adapter

`required` and `optional` are **not** properties of a field. They are properties of a (field,
backend) pair. The same field is required in one backend and optional in another. Taiga status ids
differ per project inside one Taiga instance.

- The model holds the **value and its shape**.
- The adapter descriptor holds the **constraints**.
- `required` means "this backend rejects a create without this field". It is write-path metadata.
  The read path ignores it.

If constraints live on the model field, the model silently becomes the intersection of every
backend's strictness. That is the failure this design exists to avoid.

### 5.3 Storage shape

Every field is stored in one uniform structure:

```jsonc
{
  "key": "channel",
  "shape": "enum",
  "card": "multi",
  "value": ["web"],          // canonical tokens, or [] when unmapped
  "raw": "Web Channel",      // verbatim from the backend, never discarded
  "resolved": false          // false = raw kept, mapping failed
}
```

Two rules earn their place:

**`value` is always an array.** `single` means length at most one. This removes a class of adapter
defect. Taiga alone ships both `assigned_to` (single) and `assigned_users` (multi) for one concept.

**`raw` is never discarded.** An unmapped Rally status stores `value: []`, `raw: "Pending Triage"`,
`resolved: false`. Nothing fails. Nothing is lost. An agent still reads the string.

### 5.4 Pointers split two ways

A `ref` is structurally an edge. Not every pointer belongs in the edge tables. The test is whether a
traversal walks it.

| Pointer | Home | Reason |
| --- | --- | --- |
| parent, blocks, covers, cycle membership | Edge namespace | Walked by rollup, scope, and the L1 assembler. |
| assignee, reporter, watchers, owner | `ref` field | Never traversed. Read only. |

Keep them apart. Otherwise the edge tables become mostly assignee rows and every graph query pays
for it.

### 5.5 Enum mapping

There is no universal status vocabulary. A scope declares its canonical tokens in configuration next
to the ladder. A scope that declares none runs on `raw` forever. That is a valid configuration.

The mapping key is `(backend, project, native_id)`. Taiga status ids are per project, so the project
component is mandatory.

---

## 6. The tolerance policy

PAW does not validate a human's work. A badly scoped task is not an error. Most tasks are badly
scoped. A harness that refuses to show an agent a badly scoped task is useless.

Two things are separate, and only one is optional.

**Semantic validation is out of scope.** Is the scope right, is the parent correct, are points
estimated, does the title follow a convention. None of this is PAW's concern. The backend may
complain. A human may complain. PAW does not.

**Structural totality is mandatory.** The model's own traversals depend on it. A cycle is an infinite
loop in rollup. A dangling reference renders a null into an L1 line.

The policy is therefore: **permissive at ingest, total at read.** Never reject. Never crash.

| Input | Behaviour |
| --- | --- |
| Unknown kind or rung | Store rung `null`, kind `unranked`. Serve the node normally. |
| Parent reference that resolves to nothing | Keep the reference. Mark the node `orphan`. Serve it. |
| Cycle in a `link` or `ladder` namespace | Detect at index time. Break it for traversal. Leave the data unchanged. |
| Missing required field | Absent. Do not default. Do not invent. |
| Unmappable enum value | `value: []`, `raw` kept, `resolved: false`. |
| Field the model has never seen | Store it with `shape: "text"`. Do not drop it. |
| Malformed payload from an adapter | Store the payload under `raw`. Mark the node `degraded`. |

Garbage in, garbage out, defined behaviour throughout.

---

## 7. The read path and the write path

### 7.1 Read

The cloner pulls from an adapter and writes node files. The cloner is the only writer to node files.

### 7.2 Write

An agent does not edit the clone. An agent appends an **intent**:

```sql
CREATE TABLE intent (
  id          INTEGER PRIMARY KEY,
  node_ref    TEXT NOT NULL,
  op          TEXT NOT NULL,   -- create | patch | link | comment
  payload     TEXT NOT NULL,   -- JSON
  state       TEXT NOT NULL,   -- pending | sent | applied | rejected | failed
  version     TEXT,            -- backend OCC token held at write time
  detail      TEXT,            -- backend response on rejection
  created_at  TEXT NOT NULL
);
```

The pipeline runs in four steps:

1. The agent appends an intent with state `pending`.
2. The adapter sends the intent. The adapter sets state `sent`.
3. The backend accepts or rejects.
4. The cloner pulls the changed node and reconciles. The cloner sets state `applied`.

**A rejection is a normal terminal state, not an error.** The backend is the police, not PAW. When a
backend rejects a write for a missing required field or a stale version, the adapter records state
`rejected` and writes the backend's own message into `detail`. The pipeline surfaces the rejection to
the agent as data.

One retry is permitted, and only for a stale version: refetch, reapply, send once. A second failure
sets `rejected`. Nothing retries in a loop.

The clone never holds a value that a backend refused.

---

## 8. Discovery-based federated incrementation

### 8.1 The coverage ledger

```sql
CREATE TABLE coverage (
  node_ref   TEXT PRIMARY KEY,
  depth      TEXT NOT NULL,   -- stub | summary | full
  revision   TEXT,
  cloned_at  TEXT,
  checked_at TEXT,
  dirty      INTEGER NOT NULL DEFAULT 0
);
```

The ledger answers two questions. What does the clone hold? What does the clone **not** hold? The
second question matters more. An agent reasoning over a partial clone must be able to ask for the
gaps.

### 8.2 Depth

| Depth | Content |
| --- | --- |
| `stub` | Reference, subject, and scope. Created when another node links to this one. |
| `summary` | The list-endpoint fields. |
| `full` | Description, all fields, history, notes, attachment metadata. |

The cloner promotes a node when an agent or an operator touches it.

### 8.3 The miss path

A cache miss starts a clone:

1. A hook requests the L1 line for an artifact.
2. The index holds no line.
3. The hook returns an empty line. The hook does not block.
4. The hook enqueues the artifact for a background clone.
5. The cloner clones the artifact. The indexer computes the line.
6. The next request returns a full line.

A swarm shares one clone. A miss by one agent warms the line for every other agent.

---

## 9. Storage

### 9.1 Constraint: no native binaries

The target deployment forbids native and prebuilt binary dependencies. This rules out
`better-sqlite3`, `sqlite-vec`, and every loadable SQLite extension.

The driver is **`node:sqlite`**. It ships inside the Node runtime, so nothing enters the dependency
manifest and no `.node` artifact needs signing or an Electron ABI rebuild. `DatabaseSync` supplies
the synchronous API the serve path wants.

Two consequences follow, and section 10 absorbs both:

- Node compiles SQLite **without FTS5**. There is no BM25 in the engine.
- Loadable extensions are unavailable in practice, so there is no vector index in the engine.

> **Verify before building.** `node:sqlite` availability inside the desktop shell tracks the Node
> version that Electron bundles. Check the shell's Node version first.

### 9.2 Files are durable

The clone is a directory tree under version control:

```
clone/
  nodes/<scope-path>/<ref>.json      one file per node
  edges/ladder.jsonl                 parent edges
  edges/cycle.jsonl                  cycle membership
  edges/link.jsonl                   blocks, covers, relates
  config/scope.json                  ladder, enums, adapter mapping
```

The filesystem is a tree. The model is a DAG. The layout is therefore a **spanning tree of the DAG**:
one canonical parent decides a node's directory, and every remaining edge is a line in an edge file.
This is the standard DAG decomposition. It also avoids symlinks, which need elevated privileges on
Windows.

Files buy four things:

- **Git history.** Work items get diff, blame, and merge for free.
- **Co-change mining over work items.** `git log --name-only` yields the same coupling signal for
  tickets that it yields for code. Section 10.2 consumes it.
- **One hook mechanism.** Tickets are files, so the file-open hook covers code and tickets with no
  second code path.
- **Recovery.** Delete the index. Rebuild it.

### 9.3 The index is derived

```sql
CREATE TABLE node (
  ref        TEXT PRIMARY KEY,
  scope_path TEXT NOT NULL,
  rung       INTEGER,
  kind       TEXT NOT NULL,
  state      TEXT NOT NULL,          -- ok | orphan | unranked | degraded
  fields     BLOB NOT NULL,          -- always written through jsonb(?)

  status TEXT GENERATED ALWAYS AS (fields ->> '$.status.value[0]') VIRTUAL,
  cycle  TEXT GENERATED ALWAYS AS (fields ->> '$.cycle.value[0]')  VIRTUAL
);
CREATE INDEX node_status ON node(status);
CREATE INDEX node_scope  ON node(scope_path);
CREATE INDEX node_rung   ON node(rung);
```

Rules for the field blob:

- Write through `jsonb(?)`. A plain string stores text JSON and silently loses the benefit.
- Never read the raw BLOB. SQLite states that JSONB is internal and that applications must use the
  JSON functions only. Read through `json(fields)` or `->>`.
- Promote a hot path to a **VIRTUAL** generated column. `ALTER TABLE ADD COLUMN` accepts VIRTUAL and
  rejects STORED, so a new hot path is one statement and no table rebuild.
- Patch with `jsonb_set`. Do not rewrite a whole document to change one field.

Because `value` is always an array, containment queries use `json_each`:

```sql
SELECT n.ref FROM node n, json_each(n.fields, '$.channel.value')
WHERE json_each.value = 'web';
```

---

## 10. Retrieval

### 10.1 Everything is computed at index time

An agent opens a file. PAW does not embed a query. The artifact already holds a vector. Retrieval is
a key lookup, not a search.

This was chosen for latency. It also removes the need for any search feature in the engine, which is
what makes section 9.1 survivable. Record it as a reason, not a coincidence.

| Concern | Where it runs |
| --- | --- |
| Cosine distance | Indexer, in JavaScript, over `Float32Array` |
| BM25 | Indexer, in JavaScript, over an inverted index |
| Serving | One indexed row read |

Vector rules:

- Store a vector as a `Float32Array` in a BLOB column.
- Normalize to unit length on write. Cosine then equals the dot product.
- Record `model_id`, `dim`, and `normalized` on every vector row.
- Refuse to compare vectors from two different models.
- Store a content hash per chunk. An unchanged chunk does not trigger a new embedding.
- Compute incrementally: dirty nodes against all nodes, never all against all.

Lexical rules:

- Use a pure-JavaScript BM25 implementation. No native dependency.
- The lexical index is a build-time artifact like the vector index.

### 10.2 Channels

Semantic distance is one input and not the strongest one. The assembler reads four channels:

| Channel | Source | Strength |
| --- | --- | --- |
| `cochange` | Files and nodes changed in the same commit. Mined from `git log --name-only`. | Highest for code and, because of section 9.2, now available for work items too. |
| `graph` | Import graph and call graph, plus model edges. | Exact, not statistical. |
| `tracker` | The node and the review that last touched the file. | Exact. |
| `lexical` | BM25. Catches identifiers, references, and stack frames that embeddings miss. | High for exact strings. |
| `semantic` | Cosine distance. | Fallback where edges are sparse. |

The indexer materializes every channel into one table:

```sql
CREATE TABLE knn_cache (
  ref       TEXT NOT NULL,
  neighbour TEXT NOT NULL,
  channel   TEXT NOT NULL,
  rank      INTEGER NOT NULL,
  score     REAL NOT NULL,
  PRIMARY KEY (ref, channel, rank)
);
```

The assembler allocates a fixed number of slots per channel. It does not rank channels together.
Fixed slots guarantee diversity and make a poor line easy to diagnose.

### 10.3 Chunking

A node is not a document. The indexer chunks by event: the description is one chunk, each note is one
chunk, each status transition is one chunk. The assembler retrieves chunks and returns the parent
node.

---

## 11. L1 memory

### 11.1 Principle

An agent does not request context. A hook injects context. The trigger is the tool call the agent
already made.

### 11.2 Triggers

| Hook point | Injected content | Priority |
| --- | --- | --- |
| Pre-write, pre-edit | Constraints: the decision record for the module, the test that covers it, the review note that rejected the same change before. | **Highest.** |
| Post-failure | The previous fix for the same error fingerprint. | High. |
| Pre-read | Neighbours across the five channels. | Medium. |
| Task start | The node, its cycle, and its notes. | Medium. |

A wrong read costs one more read. A wrong write costs a defect. The write hook carries more value.

### 11.3 The serve path

```
tool call ──▶ hook ──▶ unix socket ──▶ pawd ──▶ in-memory map ──▶ rendered string
```

The daemon holds rendered lines in memory. The hook does not touch the disk. Target: under one
millisecond. `pawd` already owns a socket and serves a repository; the L1 store is one more slice.
See Part 12.

### 11.4 Residency

The assembler must not inject the same content twice.

```sql
CREATE TABLE residency (
  agent_id    TEXT NOT NULL,
  node_ref    TEXT NOT NULL,
  injected_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, node_ref)
);
```

- Inject only on a residency miss.
- A context compaction clears the rows for that agent.
- The daemon reports hit rate and miss rate per agent.

Without residency tracking the hook repeats content, spends the budget, and degrades the agent.
Residency tracking is the difference between L1 memory and a repeated preamble.

### 11.5 Budget and provenance

The assembler enforces a token ceiling per line. The starting value is 1200 tokens. The indexer
counts tokens when it renders the line.

Every injected block is fenced:

```
<paw:l1 src="rally:12345" rev="2026-08-14T09:12:00Z" why="cochange" stale="false">
...content...
</paw:l1>
```

An agent that cannot see provenance treats injected text as current file content. That causes
defects. The fence prevents them.

### 11.6 Utility telemetry

The daemon records whether an agent used an injected node. A used node is one the agent later read,
edited, or named. The daemon downweights a channel whose injections go unused, per repository.

Hit rate does not measure value. Utility does.

---

## 12. Adapters

### 12.1 Contract

An adapter supplies six things:

1. A **ladder declaration**: how many rungs the backend has, and which kind each holds.
2. A **field descriptor set**: for each backend field, its `shape`, `card`, `writable`, and whether
   the backend requires it on create.
3. A **read** implementation: list, get, and history.
4. A **delta** implementation: what changed since a watermark.
5. A **write** implementation: apply an intent, and report a rejection with the backend's message.
6. An **identity** rule: how to build and parse its `refs` namespace.

An adapter does not decide model shape. An adapter maps into the model and reports what it could not
map.

### 12.2 Status

| Adapter | State | Notes |
| --- | --- | --- |
| `rally` | Primary target | Read first. Write later. See Appendix A. |
| `taiga` | Peer | Not canonical. See Appendix B. |
| `tenzu` | Candidate | Evaluate before the model freezes. |

---

## 13. Configuration

### 13.1 Scope configuration

```jsonc
{
  "scope": "/cxb/payments/checkout",
  "extends": "scope:/cxb/payments",

  "ladder": ["initiative", "feature", "story", "task"],

  "enums": {
    "status": ["todo", "doing", "review", "done", "blocked"]
  },

  "adapters": [
    {
      "kind": "rally",
      "project": "...",
      "scopeUp": false,
      "scopeDown": true,
      "ladder_map": {
        "Initiative": 3, "Feature": 2,
        "HierarchicalRequirement": 1, "Task": 0
      },
      "field_map": {
        "c_Channel": { "key": "channel", "shape": "enum", "card": "single" },
        "ScheduleState": { "key": "status", "shape": "enum", "card": "single",
                           "values": { "Defined": "todo", "In-Progress": "doing",
                                       "Completed": "review", "Accepted": "done" } }
      }
    }
  ],

  "identity": { "refs": ["rally:{ObjectID}", "paw:node:{uid}"] }
}
```

A scope inherits from a parent scope through `extends`. Projects inside one scope share a field
vocabulary. Declare `channel` once at the scope level.

An enum value with no mapping is not an error. See section 6.

---

## 14. The Connectors view

### 14.1 Requirement

The console sidebar holds a **Connectors** item. The view lists the supported connectors. A click
installs a connector on the current PAW scope. A confirmation modal precedes the install.

### 14.2 Behaviour

| Step | Behaviour |
| --- | --- |
| List | `pawd` serves the connector catalogue: id, name, state, required credentials. |
| State | Each entry shows `available`, `installed`, or `needs-credentials` **for the current scope**. |
| Click | The console opens the modal. The console sends no request yet. |
| Modal | The modal names the scope path in full, the backend, the configuration file the install writes, and the credential the install requires. |
| Confirm | The console posts the install request. `pawd` writes the scope configuration. |
| Result | The console refreshes the entry state from the daemon. The console does not assume success. |

### 14.3 Constraints

- An install writes scope configuration. An install changes no global state.
- An install is reversible. An uninstall removes the configuration and leaves the clone in place.
- The daemon rejects an install for a scope it did not itself discover. This matches the
  plan-selection rule in Part 12.
- The modal states the scope path in full. Installing on the wrong scope is the main foreseeable
  operator error.

---

## 15. Non-goals

- A backlinked Markdown knowledge base. The clone is not a note vault.
- An agent-callable retrieval tool. Retrieval stays involuntary.
- A full mirror of any backend. The cloner clones what someone touched.
- Validation of a human's scoping, estimation, or hierarchy discipline.
- A universal status vocabulary.
- Correct portfolio rollup arithmetic. See section 4.2.
- A replacement web interface for any backend.

---

## 16. Open items

| Item | Decision needed |
| --- | --- |
| Model package boundary | A git submodule, or `packages/model` in the existing monorepo. A submodule only pays if the model ships independently. |
| Embedding model | Local, through a pure-JavaScript or WASM runtime. The harness must start with no API key. |
| Shard boundary | One clone per top-level scope, or one per container. Depends on node counts at CaixaBank. |
| Electron Node version | Confirm the bundled Node exposes `node:sqlite`. Blocks section 9.1. |
| Rally write path | Read-only first. Confirm whether write access is available and wanted. |
| L1 budget | 1200 tokens is a starting value. Tune against utility telemetry. |
| Tenzu | Evaluate the API before the model freezes. |

---

## Appendix A: Rally

The Rally adapter is the primary target. These facts shape it.

| Capability | Detail |
| --- | --- |
| Query | `query=((State = Open) AND (LastUpdateDate > "2026-08-01"))`. Real predicates on any field. |
| Field selection | `fetch=FormattedID,Name,Project`. Returns only named fields. |
| Page size | Up to 2000 for WSAPI 2.x. Default 20. `start` begins at 1. |
| Scoping | `project`, plus `projectScopeUp` and `projectScopeDown`. Both default to **true**. Set them explicitly. |
| Lookback API | Immutable snapshots: `_ValidFrom`, `_ValidTo`, `_PreviousValues`, `_SnapshotNumber`. MongoDB-style operators. `__At` for point-in-time queries. |

**Delta strategy.** Query the Lookback API for `_ValidFrom > watermark`. The response holds changed
entities with their previous values. The Rally adapter needs less delta code than the Taiga adapter.

**Ladder.** Rally has a configurable PortfolioItem hierarchy above `HierarchicalRequirement`, and
`HierarchicalRequirement` nests into itself. Map portfolio levels to rungs by configuration. Map a
nested story to a `ladder` edge between two nodes of the same rung — this is legal, because section
4.1 permits it only if the edge still points downward; encode nested stories as a rung decrement.

**Test artifacts.** TestSet, TestCase, TestCaseStep, and TestCaseResult map to four rungs directly.
The model holds them natively. No projection is required on the read path.

Note: the Rally App SDK and legacy custom pages reach end of life on **31 October 2026**. WSAPI and
the Lookback API are unaffected.

---

## Appendix B: Taiga

Taiga is one adapter. It is not canonical. These are its limits and the workarounds the adapter owns.

### B.1 API facts

Verified against `taigaio/taiga-doc` and `taigaio/taiga-back` 6.10.2.

| Fact | Consequence |
| --- | --- |
| No `modified_date` filter on any list endpoint. | Use webhooks, then the project timeline. See B.2. |
| No field selection; `*_extra_info` always returned. | Full pulls are expensive. Use the exporter for a cold start. |
| `external_reference` is an array of text. | Carries the `refs` spine. |
| `Task.user_story` is nullable; `Task.milestone` is independent. | An orphan task is a legal, useful state. |
| A bulk milestone update on a story overwrites its tasks' milestones. | Re-assert the task cycle after a story event. |
| Custom attribute values are a separate resource with a separate version. | A custom field write costs a second request. |
| Custom attributes are not filterable in the list API. | Index them in the clone. |
| Every modifying request needs `version`. The check is field-aware. | Store `version`. Concurrent writes to different fields both succeed. |
| Comments are history entries with a non-empty `comment`. | Read notes from the history endpoint. |
| Epic ↔ UserStory is many to many. | Confirms section 4.1. Taiga itself is not a tree. |

### B.2 Delta strategy

- **Primary — webhooks.** `POST /api/v1/webhooks {project, name, url, key}`. Verify
  `X-TAIGA-WEBHOOK-SIGNATURE`: HMAC-**SHA1** hex digest over the raw body. Requires
  `WEBHOOKS_ENABLED = True`. `WEBHOOKS_BLOCK_PRIVATE_ADDRESS` can block a loopback endpoint.
  Webhooks do not cover epics.
- **Secondary — timeline.** `GET /api/v1/timeline/project/{id}`. Holds `event_type`, `object_id`,
  `created`, `values_diff`. Page newest to oldest, stop at the watermark. Covers epics.
- **Cold start — exporter.** `GET /api/v1/exporter/{projectId}`. Whole project in one JSON file.
  Synchronous servers return 200 and a URL; asynchronous servers return 202 and an `export_id`.
- **Recovery — webhook logs.** List and resend past deliveries after an outage.

### B.3 The projection squeeze

The model holds four test rungs. Taiga holds two levels of containment. A write to Taiga is
therefore lossy, and the loss is the adapter's problem, not the model's.

| Model | Taiga carrier |
| --- | --- |
| `test_set` | UserStory tagged `testset` |
| `test_case` | Task under that story — gives a native parent link and a native cycle link |
| `test_step` | `multiline` custom attribute, Markdown table |
| `test_result` | Comment on the task, plus a `last_result` dropdown attribute |

A test case maps to a Task and not to a UserStory because **Taiga has no story-to-story relation**. A
Task supplies `?user_story=` and `?milestone=` as real list filters.

Known losses: a Task holds one parent story, so a shared test case projects as N tasks carrying the
same `rally:` reference; and a story that changes cycle drags its tasks, so the adapter re-asserts.

Set Taiga task statuses to `Not Run`, `In Progress`, `Pass`, `Fail`, `Blocked`. The task board then
works as a test execution board with no extra code.

### B.4 Extension, not fork

If the Taiga adapter ever needs server-side help, ship an additive Django application in its own
repository and append it to `INSTALLED_APPS`. Do not fork.

- `taiga-back` is **MPL-2.0** (file-level copyleft). An additive application is not a modification.
- `taiga-front` is **AGPL-3.0** (network copyleft). Do not fork the front end.

This is now a minor adapter concern rather than an architectural decision, because Taiga is no longer
canonical.

### B.5 Upstream status

Taiga 6 is in planned maintenance. Kaleidos transferred operations to Taiga Cloud Services in March
2024, and transferred the rewrite to the French cooperative BIRU in mid-2024. BIRU renamed it Tenzu.
Tenzu reached a first stable release in September 2025 and received NLnet NGI0 Commons funding in
February 2026.

Pin the Taiga version. Track upstream. Evaluate Tenzu as a peer adapter.
