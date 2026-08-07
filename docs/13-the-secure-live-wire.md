# Part 13: The Secure Live Wire

> The console and the daemon talk over TLS and one WebSocket. Every certificate is real, every gate
> refuses by default, and nothing was made easier by making it weaker. This part is the reasoning,
> not just the shape — for each decision, what it costs and what it would cost not to.

---

## Why this exists

The first console polled `GET /api/state` every three seconds over plain HTTP and called it live. It
worked, and three separate things were wrong with it.

It was **a crutch**. Polling is what you build when you cannot push. The daemon knows the instant a
plan file changes or a member lands; making the console ask repeatedly whether anything happened is
strictly worse than telling it.

It was **wasteful**. Each poll rebuilt the entire snapshot — every brief, every resume key, the
plan doctor — for a value that was almost always byte-identical to the last one. For a plan with a
few hundred members that is over eight hundred template renders every three seconds, per open
console, to produce no news.

It was **unauthenticated plaintext on a socket that reports the operator's process table**. Any page
in the operator's browser could reach it, and anything on the machine could read it.

The rest of this document is what replaced it.

---

## 1. Identity: a CA that is safe to trust

TLS on loopback needs a certificate, and a certificate needs an issuer the browser believes. The
honest options are a self-signed leaf the operator clicks past every time, or a local CA the
operator installs once. Clicking past a warning is a habit, and habits generalise — so PAW issues a
CA.

Asking someone to install a root certificate is a serious request. A CA that could mint a
certificate for `mail.google.com` and sit in a developer's trust store for a decade is not something
to leave behind casually. So the CA is **constrained at issuance**, three ways:

| Constraint | Extension | What it stops |
| ---------- | --------- | ------------- |
| Loopback names only | **critical** Name Constraints (2.5.29.30) permitting `DNS:localhost`, `IP:127.0.0.0/8`, `IP:::1/128` | A stolen key forging a certificate for any site on the internet |
| No sub-CAs | `BasicConstraints(cA, pathLen: 0)`, critical | A stolen key minting a CA of its own, which name constraints alone would not prevent |
| TLS servers only | **critical** `ExtendedKeyUsage([serverAuth])` | A stolen key signing code-signing or S/MIME certificates — RFC 5280 applies a name-constraint subtree only to name forms that are *present*, so a certificate with no SAN is unconstrained by the row above |

The extension is marked **critical** deliberately: a non-critical constraint is one a verifier is
permitted to ignore, which would leave a general-purpose CA in the store. `@peculiar/x509` ships no
class for Name Constraints, so the value is an ASN.1 `NameConstraints` structure serialised by hand
and wrapped in the generic `Extension`. That is verified rather than assumed —
`nodeIdentity.integration.test.ts` parses the issued certificate, asserts the extension is present
*and* critical, decodes the permitted subtrees, and checks the raw DER contains `06 03 55 1d 1e 01
01 ff` (the OID followed by `BOOLEAN TRUE`). A CA without name constraints does not ship.

**The CA signs a short-lived leaf rather than serving directly.** The CA lives ten years, the leaf
ninety days and renews at thirty. Rotating the server certificate therefore never asks the operator
to touch their trust store again — which is the whole reason for two tiers.

### Where it lives, and who can read it

`.paw/` is a *repository* install directory; a TLS identity is machine state. One operator on one
machine has one CA, and a key inside a repo is one stray `git add` from being published. So the
identity lives in PAW's home — `%LOCALAPPDATA%\paw`, `~/Library/Application Support/paw`, or
`${XDG_DATA_HOME:-~/.local/share}/paw` — with `PAW_HOME` overriding.

Private keys are written with a restrictive mode **and then read back**. A umask, an inherited ACL,
or a filesystem that does not carry POSIX modes at all can each leave a file wider than the write
asked for, and every one of those failures is silent. So `secretFile.ts` hardens and verifies:
`chmod 600` then `stat`, or `icacls /inheritance:r /grant:r <user>:F` then parse the listing back and
assert no other principal appears. If the permissions that landed are not the permissions demanded,
**the daemon refuses to serve**. On a shared machine a readable key is another user's licence to
impersonate the operator's console.

This is checked on **every** boot, not only the one that writes the keys — a key lives for months,
and a restore, a copy, or a stray `chmod` in between is exactly what the write-time check cannot
see.

### Trust, on the operator's terms

`paw trust` installs the CA into a per-user store: `certutil -user -addstore Root` on Windows, the
login keychain with `-p ssl` on macOS, the NSS database on Linux. Nothing is ever elevated —
requesting administrator to install a CA is asking for a habit nobody should have. `-p ssl` matters:
without it, Security.framework treats the trust setting as unrestricted and the CA becomes trusted
for code signing and S/MIME too.

`--dry-run` prints the exact commands and the fingerprint first, and the fingerprint is printed
either way so it can be compared against whatever dialog the OS raises. The identity is marked
trusted **only after the commands actually succeeded** — a flag set on intent would silence the
warning while the browser kept refusing.

Linux has no single trust store, and the plan says so rather than pretending: the NSS step runs, and
the system bundle and Firefox are listed as manual with the exact commands.

---

## 2. The gates

Three gates, answering three different attackers. Each exists because the others do not cover its
case.

| Gate | Stops | Why the others do not cover it |
| ---- | ----- | ------------------------------ |
| **Token** — 256 bits, minted per boot, compared in constant time | Another process on the machine | Origin means nothing to a non-browser |
| **Origin** allow-list, deny-by-default | A page the operator happens to have open | A page can send requests to loopback, and a WebSocket handshake is exempt from CORS entirely |
| **Host** allow-list | DNS rebinding | A rebound page *is* same-origin as far as the browser is concerned |

The token is compared by hashing both sides with SHA-256 and then `timingSafeEqual`. Hashing first
is not decoration: `timingSafeEqual` throws on a length mismatch, and that throw would itself be a
length oracle.

TLS makes rebinding fail at the handshake as well — the browser negotiates for `evil.example` and
the leaf is valid for loopback names only. Both layers are tested separately, and reaching the Host
gate in a test now requires forcing the client to validate against the real name, because TLS
refuses the rebind first.

CORS is **deny-by-default**: no `Access-Control-Allow-Origin` at all unless the origin is on the
list, and `Access-Control-Allow-Credentials` is never sent. There is no cookie and no session to
ride, which is what makes CSRF structurally impossible against a bearer-token API.

`Strict-Transport-Security` is deliberately **absent**. HSTS is keyed by host across every port, so
sending it for `localhost` would force https onto every other development server on the operator's
machine — a footgun aimed at the whole workstation to protect a socket that is already TLS-only.

### What is deliberately *not* here

**There is no lockout after repeated failed authentications.** An earlier version had one; it was a
denial of service. On loopback the daemon cannot attribute a socket to a peer, so a global cooldown
lets any local process lock the operator out of their own console — and a pre-auth *timeout* counted
as a failure, so it could be triggered without sending a single byte of protocol. Against a 256-bit
credential behind a four-socket pre-auth cap, the guessing it prevented was not a threat and the
lockout was. Failures are counted and reported to the operator's terminal instead.

This is the general shape of the rule: **a mitigation that a stranger can trigger against the
operator is worse than the attack it mitigates**, when the attack was already impractical.

---

## 3. The wire

Subprotocol `paw.live.v1`, offered by the client and required by the server. A client that does not
offer it is refused before the upgrade — it is either a different version or something that found
the port and started talking.

### Frames are atomic

The host slice ticks once a second per open console, so the envelope's own overhead is paid several
thousand times an hour for as long as a console is open. The wire form is therefore one-character
keys and two-character topic codes:

```
server → client   {"v":1,"t":"ho","a":1786060800000,"d":{…}}
client → server   {"v":1,"m":"a","k":"<credential>"}      auth
                  {"v":1,"m":"w","p":"plans/lore.swarm.mjs"}   watch
```

23 bytes per frame against the spelled-out form, and the saving is per frame rather than per
session. **The compact form exists only in `core/src/domain/liveWire.ts`** — one table read in both
directions, so a topic cannot be encoded as one thing and decoded as another. Everything above that
file reads `topic: 'host'`, because a codebase that speaks in two-letter codes is a codebase nobody
can grep.

| Topic | Code | Payload | Emitted when |
| ----- | ---- | ------- | ------------ |
| `hello` | `he` | `PawSnapshot` | after auth, after every `watch`, after any resync |
| `host` | `ho` | `HostInfo` | every second — also the liveness signal |
| `processes` | `ps` | `HostProcess[]` | the owned subtree changed |
| `plans` | `pl` | `PlansSlice` | the repository listing changed |
| `planDetail` | `pd` | `PlanSlice` | the watched plan's mtime changed |
| `doctor` | `dr` | `DoctorReport` | the config file changed |
| `run` / `budget` | `rn` / `bg` | `RunProgress` / `BudgetSummary` | a member started or settled |
| `tree` | `tr` | `TreeNode[]` | the listing changed |
| `log` | `lg` | `LogEntry[]` | the daemon reported something |
| `error` | `er` | `LiveError` | a recoverable problem |

### The parsers are allow-lists, not validators

`parseClientMessage` builds a **new object** out of the two or three fields it recognises and returns
null for everything else. It never returns the caller's parsed JSON. A validator that checks some
fields and passes the object through carries whatever else was in it — prototype keys, extra
properties a later refactor starts trusting — into the daemon. Nothing crosses this boundary that
was not named in that file.

### The resync rule

There is no replay buffer and no delta patching. Every payload is the **full new value of that
slice**, and any doubt — a reconnect, a drained buffer, a watch switch — is answered by a fresh
`hello`. State drift is structurally impossible; the cost is bounded by snapshot size, which the
slice cache caps.

### Handshake, in order

1. **Pre-upgrade, while it is still plain HTTP** — the cheap place to refuse, where a "no" costs a
   socket close instead of a session, a timer and a buffer:
   `Host` not allow-listed → 400 · `Origin` present but not allow-listed, or `null` → 403 ·
   subprotocol not offered → 400 · at capacity → 429.
   The request's identity is judged **before** the daemon's capacity, so a rebinding page is told 400
   whether or not the daemon is busy — otherwise the answer becomes a probe.
2. **Post-upgrade** — up to 2 seconds for a single `auth` frame of at most 4KB. **No byte of data is
   sent before it arrives.** Not a `hello`, not an error body, not a topic name.
3. On success: `hello`, and the session registers on the bus.

The token is not checked in step 1 because a browser cannot set headers on a WebSocket handshake, and
putting a credential in the URL would write it into every log that records a request line.

### Close codes, and why they are distinct

| Code | Meaning | What a console does |
| ---- | ------- | ------------------- |
| `4400` | malformed frame, oversize, rate exceeded… no: see below | retry |
| `4401` | the credential was refused | **stop** — polling would be refused too |
| `4403` | origin not allowed | stop |
| `4429` | too many sessions, or too many messages | back off and retry |
| `1013` | the client stopped reading | retry |
| `1001` | the daemon is shutting down | retry from the top of the backoff |

Collapsing these is what produces a console that reconnects forever against a daemon that will never
accept it — or one that gives up on a problem that would have cleared. Two cases earn their
distinction specifically:

- A **pre-auth timeout closes 4400, not 4401.** A slow socket is not a rejected credential, and a
  console told 4401 latches into a terminal locked-out state for the life of the page.
- **Exceeding the message rate closes 4429, not 4400** — back off, rather than give up.

### Backpressure

A client that stops reading is dropped, not queued for. Past 1MB buffered the session is marked
stale and events are skipped; on draining below 64KB it gets a fresh `hello` rather than the events
it missed; past 5MB, or 30 seconds stale, it is closed. `sendHello` checks the buffer too — a
snapshot is the largest frame this protocol sends and a client can request one per `watch`, so
without that check a rate limit on *messages* leaves the memory they cost unbounded.

### Heartbeat

Ping every 15s, terminate if no pong within 10s. **Terminate, not close**: a client that has stopped
answering pings is not going to complete a closing handshake either, and waiting for one leaks the
session. The client watches from its side too — `host` ticks every second, so silence for five
seconds means the wire is dead in a way no close event is going to report.

---

## 4. The daemon, rewired

```
runDaemon()
 ├─ identity   load / issue / rotate      → tls material, fingerprint, trust advice
 ├─ bus        typed publish/subscribe    → one fan-out point, listener failures isolated
 ├─ cache      slice cache + compose      → briefs rendered once per file version
 ├─ sources    host 1s · ps/listing/config/plan 3s, each diffing before it publishes
 ├─ sessions   auth machine, limits, backpressure, watch registry
 ├─ log        bounded ring, published as it is written
 └─ listen(httpHandler, socketHooks, tls, port, host)
```

Two properties of the bus are deliberate, and both exist because the listeners are sockets. **A
listener that throws does not stop the others** — delivery continues and the failure is reported —
because a control daemon whose whole fan-out dies with one closed socket goes silent for everyone.
And **unsubscribing during a publish is safe**, since delivery iterates a copy; that is exactly the
case that arises when a session closes itself in response to an event it just received.

Sessions filter what they are sent: the bus carries one plan's `planDetail` to every session, and
sessions watch different plans, so a frame whose `selectedPlan` is not this session's is dropped.
Sending it on would show a console the briefs of a plan it did not select — wrong data, rendered as
though it were right.

`ws` and `@peculiar/x509` are exact-pinned and imported **only** by `nodeRuntime`. The acceptance
check is a grep: `grep -rn "from 'ws'" src/ | grep -v nodeRuntime` → 0.

---

## 5. The console, rewired

One hook owns the connection and is used exactly once, by the provider. Everything below reads
console state through the existing hooks and never learns whether that state arrived over a socket
or a poll — the transport is invisible above `application/`.

```
static          artifact page, no daemon. Terminal; nothing is attempted.
connecting      socket opening
authenticating  credential sent, waiting for the first frame
live            receiving slices
degraded        socket down, polling instead, retrying underneath
locked-out      credential refused. Terminal — retrying cannot fix it.
```

Retry is exponential with **full jitter** — `random() × min(cap, base × 2ⁿ)` — because several
consoles opened against one daemon would otherwise reconnect in lockstep after a restart and arrive
as a thundering herd on the socket it just re-opened.

`liveSocket.ts` is the only file that says `new WebSocket`, and it builds a `wss://` URL or none at
all. A console served over plain http, or in an environment with no WebSocket, gets `null` and polls
— slower, and it never puts the credential on a wire anything on the machine can read. There is no
`ws://` fallback at any scheme for any reason; the repo greps clean for it.

The hook holds every injected callback in a ref and its effect depends on none of them. A caller
passing an inline factory — the normal thing to write — would otherwise re-run the effect on every
render of its parent, and each run closes a socket and opens another: a reconnect loop driven by
unrelated re-renders, and a silent one.

---

## 6. Threat model

| Actor | Capability | Defence |
| ----- | ---------- | ------- |
| Drive-by web page | Can send requests to loopback; can open WebSockets (no CORS on the handshake); cannot read cross-origin responses | Token on `/api/*`; Origin allow-list at upgrade; first-frame auth before any data; CORS deny-by-default |
| DNS-rebinding page | Believes it is same-origin after the rebind | **TLS kills it structurally** — the handshake is for a name the leaf does not carry. Belt and braces: server-side `Host` allow-list |
| Other local users | Can bind the port when `pawd` is down; can try to read key files | An impersonator cannot present a CA-chained leaf; keys are ACL'd owner-only and **verified on every boot** |
| Local process, same user | Can connect to the socket directly | 256-bit token; four-socket pre-auth cap; per-session rate limit |
| CA key thief | Could mint certificates | Name constraints → loopback names only; critical serverAuth EKU → TLS servers only; `pathLen: 0` → no sub-CAs; and only *this user's* store trusts it |
| Same-user malware | Reads memory, files, keystrokes | **Out of scope** — it already owns the session. Stated so nobody pretends a loopback daemon defends against it |

Accepted residuals, documented rather than fixed: the token appears in terminal scrollback; the token
is visible in the URL bar until `history.replaceState` runs; the CA is trusted user-wide, bounded by
its name constraints and EKU.

---

## 7. What is enforced

- 100% statements, branches, functions and lines, every package. The build is red at 99.9.
- `grep -rn "from 'ws'" packages/*/src | grep -v nodeRuntime` → 0
- `grep -rn "ws://" packages/*/src` → 0
- `grep -rn "new WebSocket" packages/gui/src | grep -v infrastructure/liveSocket` → 0
- The CA's Name Constraints extension is asserted present, critical, and correctly encoded against
  the raw DER — not against a library's opinion of it.
- The session machine is asserted to send **nothing at all** on every pre-auth path, by checking
  `send` was never called rather than by checking what was sent. A test that inspects the frame has
  already accepted that a frame went out.
