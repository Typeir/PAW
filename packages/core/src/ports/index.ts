/**
 * PAW Core Ports
 *
 * @fileoverview Hexagonal ports `@paw/core` own — interfaces only. Every
 * side effect PAW do sit behind one: core define interface, driven
 * adapter in `packages/adapters/*` implement it, consumer wire adapter to
 * port at composition root. No runtime implementation here; coverage gate
 * exclude `src/ports/**`. Ports grow as use-cases migrate.
 *
 * @module @paw/core/ports
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ConfigDocument } from '../domain/config.js';
import type { PawEvent, PawEventType, PawResponse } from '../domain/event.js';
import type { HealthReport } from '../domain/gate.js';
import type { LintFinding } from '../domain/linters.js';
import type { Violation } from '../domain/violation.js';

/**
 * The driving adapter that connects PAW to a specific host (Copilot SDK,
 * Copilot CLI, VS Code extension, future Anthropic or Codex runtime) through
 * translation. Turn host native payload into canonical {@link PawEvent},
 * and canonical {@link PawResponse} back into host native output. PAW
 * loop never see host; different connector swap hosts, config pick.
 *
 * @interface HostConnector
 * @property {string} name - Connector id, matched against `PawConfig.connector`.
 * @property {(type: PawEventType) => (string | null)} eventName - Host native name for canonical event (e.g. `tool.pre` → `PreToolUse`), or null when host have no such event.
 * @property {(raw: unknown) => (PawEvent | null)} toEvent - Translate host payload to canonical event, or null when payload not PAW-relevant.
 * @property {(response: PawResponse) => unknown} fromResponse - Translate canonical response to host native output shape.
 */
export interface HostConnector {
  readonly name: string;
  eventName(type: PawEventType): string | null;
  toEvent(raw: unknown): PawEvent | null;
  fromResponse(response: PawResponse): unknown;
}

/**
 * Persistence for violations. Implementations: native SQLite binding, WASM
 * one where that binding blocked, in-memory fake for tests — swapping is
 * one adapter. Narrow to violations; other persisted concerns get own
 * port, see {@link ConfigPort}.
 *
 * @interface StorePort
 * @property {(sessionId: string | null) => Promise<Violation[]>} unresolvedFor - Unresolved violations in scope for session, plus project-scoped ones.
 * @property {(violations: readonly Violation[], sessionId: string | null) => Promise<void>} raise - Record new violations for file within session.
 * @property {(filePath: string, sessionId: string | null) => Promise<number>} resolveForFile - Mark file violations resolved; return number cleared.
 * @property {() => Promise<Violation[]>} outstanding - Every unresolved violation across all sessions; operator whole-repo view.
 * @property {(filePath: string | null) => Promise<number>} prune - Resolve outstanding violations across all sessions: one file when path given, otherwise all; return number cleared.
 */
export interface StorePort {
  unresolvedFor(sessionId: string | null): Promise<Violation[]>;
  raise(
    violations: readonly Violation[],
    sessionId: string | null,
  ): Promise<void>;
  resolveForFile(filePath: string, sessionId: string | null): Promise<number>;
  outstanding(): Promise<Violation[]>;
  prune(filePath: string | null): Promise<number>;
}

/**
 * Run project quality gates against set of files; return report the
 * detector reason over. Discovery, dynamic loading, context building, and
 * per-gate execution the adapter concern (legacy `pawGates` +
 * `gateContext`, ported). Bound to project root at composition root;
 * callers pass paths alone.
 *
 * @interface GateRunner
 * @property {(relativePaths: readonly string[]) => Promise<HealthReport>} runForFiles - Run every applicable gate against these project-relative paths.
 */
export interface GateRunner {
  runForFiles(relativePaths: readonly string[]): Promise<HealthReport>;
}

/**
 * Run the enabled linter connectors against files a tool just changed.
 * Findings become deferred violations, so a linter never denies a tool. Which
 * connectors are enabled, how each one executes, and what to do with a
 * whole-project tool too slow for the hook budget are all adapter concerns;
 * this port answers only with the findings ready now.
 *
 * @interface LinterRunner
 * @property {(relativePaths: readonly string[]) => Promise<readonly LintFinding[]>} runForFiles - Findings available now for these project-relative paths.
 */
export interface LinterRunner {
  runForFiles(relativePaths: readonly string[]): Promise<readonly LintFinding[]>;
}

/**
 * Persisted key-value settings that outlive process and belong to project
 * — foremost an enforcement override — persist across unrelated hook
 * invocations. Exclude engine choice, must be readable before store opens.
 *
 * @interface ConfigPort
 * @property {(key: string) => Promise<string | null>} getConfig - Read setting, or null when unset.
 * @property {(key: string, value: string) => Promise<void>} setConfig - Write setting, replace any current value.
 */
export interface ConfigPort {
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;
}

/**
 * Read and write repo `.paw/config.json` document whole. Bound to repo at
 * composition root. The one seam through which binding edit reach disk.
 *
 * @interface ConfigDocumentPort
 * @property {() => Promise<ConfigDocument>} read - Parse current document; repo with none reads as empty document.
 * @property {(config: ConfigDocument) => Promise<void>} write - Replace document on disk.
 */
export interface ConfigDocumentPort {
  read(): Promise<ConfigDocument>;
  write(config: ConfigDocument): Promise<void>;
}

/**
 * Most recent consumer routes, persisted for one console overall. A
 * route is repository the console scoped to; hold last few. Bound to
 * `$PAW_HOME` at composition root; console global.
 *
 * @interface RecentRoutesPort
 * @property {() => Promise<string[]>} list - Recent routes, newest first; empty when none recorded.
 * @property {(route: string) => Promise<string[]>} record - Promote route to front and persist; return new list.
 * @property {(route: string) => Promise<string[]>} remove - Forget route and persist; return new list.
 */
export interface RecentRoutesPort {
  list(): Promise<string[]>;
  record(route: string): Promise<string[]>;
  remove(route: string): Promise<string[]>;
}

/**
 * Spawn and manage child processes, cross-platform. Wrap Windows/POSIX
 * detach divergence.
 *
 * @interface ProcessPort
 * @property {(command: string, args: readonly string[], opts?: ProcessRunOptions) => Promise<ProcessResult>} run - Run command to completion.
 * @property {(command: string, args: readonly string[], opts?: ProcessRunOptions) => Promise<number>} spawnDetached - Spawn detached, unref'd child that outlive this process; return pid.
 */
export interface ProcessPort {
  run(
    command: string,
    args: readonly string[],
    opts?: ProcessRunOptions,
  ): Promise<ProcessResult>;
  spawnDetached(
    command: string,
    args: readonly string[],
    opts?: ProcessRunOptions,
  ): Promise<number>;
}

/**
 * Options for {@link ProcessPort} invocation.
 *
 * @interface ProcessRunOptions
 * @property {string} [cwd] - Working directory for child.
 * @property {Readonly<Record<string, string | undefined>>} [env] - Environment for child; default to parent.
 * @property {number} [timeoutMs] - Kill child after this many milliseconds.
 */
export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

/**
 * Outcome of {@link ProcessPort.run}.
 *
 * @interface ProcessResult
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 * @property {number} code - Process exit code.
 */
export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Read file text. The one seam through which swarm attached context
 * enter prompt: plan declare paths purely (`contextFiles`), the
 * application resolve them through this port at dispatch. Fail loud per
 * CONSTRAINTS.md Constraint 3; path that cannot read reject.
 *
 * @interface FileReaderPort
 * @property {(path: string) => Promise<string>} read - File text; reject when it cannot read.
 */
export interface FileReaderPort {
  read(path: string): Promise<string>;
}

/**
 * Read and write filesystem, for one flow that change it: attach
 * PAW to repository. Separate from {@link FileReaderPort}.
 *
 * @interface FileSystemPort
 * @property {(path: string) => Promise<string>} readText - Read file, or `''` when it not exist.
 * @property {(path: string, content: string) => Promise<void>} writeText - Write file, create or overwrite it.
 * @property {(path: string, content: string) => Promise<void>} appendText - Append to file, create it if absent.
 * @property {(dir: string) => Promise<void>} ensureDir - Create directory and parents if needed.
 * @property {(path: string) => Promise<void>} setExecutable - Set executable bit; no-op where platform got none.
 */
export interface FileSystemPort {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  appendText(path: string, content: string): Promise<void>;
  ensureDir(dir: string): Promise<void>;
  setExecutable(path: string): Promise<void>;
}

/**
 * Provider credentials. Never log, never echo, never return material to
 * any caller outside daemon model layer. Backends: OS keychain, encrypted
 * vault, external manager — see 13-decision-keyring.
 *
 * @interface SecretPort
 * @property {() => Promise<boolean>} available - Whether material can read right now (keychain reachable, vault unlocked).
 * @property {(name: string, value: string) => Promise<void>} set - Store or replace secret under stable name.
 * @property {(name: string) => Promise<string | null>} get - Retrieve material; only daemon model layer may call this.
 * @property {(name: string) => Promise<void>} remove - Remove secret.
 * @property {() => Promise<ReadonlyArray<{ name: string; fingerprint: string; updatedAt: string }>>} list - Names and non-sensitive metadata for display; never material.
 */
export interface SecretPort {
  available(): Promise<boolean>;
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
  list(): Promise<
    ReadonlyArray<{ name: string; fingerprint: string; updatedAt: string }>
  >;
}

/**
 * Inference, provider-agnostic. Resolved role hand model layer one of
 * these; credential fetch through {@link SecretPort} at egress, never
 * held by caller. Adapters: copilot-sdk, openai-compatible, ollama.
 *
 * @interface ModelPort
 * @property {(request: ModelRequest) => Promise<ModelResponse>} complete - Run single completion.
 */
export interface ModelPort {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * Single model completion request.
 *
 * @interface ModelRequest
 * @property {string} model - Provider-local model id to run.
 * @property {string} prompt - Full prompt to send.
 * @property {number} [maxOutputTokens] - Cap on generated tokens.
 * @property {readonly string[]} [availableTools] - Canonical tool names agent may use; undefined leave port on role default. Port map these to own SDK tool names.
 * @property {Readonly<Record<string, string>>} [systemSections] - Resolved system-prompt sections (id → content) member run with; undefined/empty leave port on model own system prompt. Port map these to system-message.
 */
export interface ModelRequest {
  readonly model: string;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly availableTools?: readonly string[];
  readonly systemSections?: Readonly<Record<string, string>>;
}

/**
 * Single model completion response.
 *
 * @interface ModelResponse
 * @property {string} content - Generated text.
 * @property {number} inputTokens - Tokens consumed by prompt.
 * @property {number} outputTokens - Tokens generated.
 */
export interface ModelResponse {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Everything PAW say, independent of how shown. `cli`, `tui`, and `gui`
 * are driving adapters that render this; one daemon backs three interfaces
 * (11-decision-electron-twin).
 *
 * @interface PresenterPort
 * @property {(message: string) => void} info - Emit informational line.
 * @property {(message: string) => void} success - Emit success line.
 * @property {(message: string) => void} warn - Emit warning line.
 * @property {(message: string) => void} error - Emit error line.
 * @property {(rows: ReadonlyArray<Readonly<Record<string, string | number>>>) => void} table - Emit table, one row per line.
 */
export interface PresenterPort {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  table(
    rows: ReadonlyArray<Readonly<Record<string, string | number>>>,
  ): void;
}

/**
 * Monotonic time, injected. Make time-dependent logic (staleness, heartbeats)
 * deterministic in tests. Real adapter wrap `Date.now`.
 *
 * @interface ClockPort
 * @property {() => number} now - Current time in milliseconds since epoch.
 */
export interface ClockPort {
  now(): number;
}
