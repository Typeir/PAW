/**
 * PAW Core Ports
 *
 * @fileoverview The hexagonal ports `@paw/core` owns — interfaces only. Every
 * side effect PAW performs is behind one of these: core defines the interface,
 * a driven adapter in `packages/adapters/*` implements it, and a consumer wires
 * the adapter to the port at its composition root. Nothing here has a runtime
 * implementation, which is why the coverage gate excludes `src/ports/**` — there
 * is no executable code to cover. Ports start small and grow only as the
 * use-case that needs them is migrated.
 *
 * @module @paw/core/ports
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { PawEvent, PawResponse } from '../domain/event.js';
import type { Violation } from '../domain/violation.js';

/**
 * A host connector — the driving adapter that bolts PAW onto a specific host
 * (the Copilot SDK, the Copilot CLI, a VS Code extension, a future Anthropic or
 * Codex runtime) through translation, not through hardcoded semantics. It turns
 * the host's native payload into a canonical {@link PawEvent} and a canonical
 * {@link PawResponse} back into the host's native output. PAW's loop never sees
 * the host; swapping hosts is a different connector, selected by config.
 *
 * @interface HostConnector
 * @property {string} name - Connector id, matched against `PawConfig.connector`.
 * @property {(raw: unknown) => (PawEvent | null)} toEvent - Translate a host payload to a canonical event, or null when the payload is not PAW-relevant.
 * @property {(response: PawResponse) => unknown} fromResponse - Translate a canonical response to the host's native output shape.
 */
export interface HostConnector {
  readonly name: string;
  toEvent(raw: unknown): PawEvent | null;
  fromResponse(response: PawResponse): unknown;
}

/**
 * Persistence for violations, decisions, memories, and the config KV. The one
 * writer in the daemon owns a single instance; readers get a read-only view.
 * Implementations: sql.js today, a real binding later — swapping is one adapter.
 *
 * @interface StorePort
 * @property {(sessionId: string | null) => Promise<Violation[]>} unresolvedFor - Unresolved violations in scope for a session, plus project-scoped ones.
 * @property {(violations: readonly Violation[], sessionId: string | null) => Promise<void>} raise - Record new violations for a file within a session.
 * @property {(filePath: string, sessionId: string | null) => Promise<number>} resolveForFile - Mark a file's violations resolved; returns the number cleared.
 */
export interface StorePort {
  unresolvedFor(sessionId: string | null): Promise<Violation[]>;
  raise(
    violations: readonly Violation[],
    sessionId: string | null,
  ): Promise<void>;
  resolveForFile(filePath: string, sessionId: string | null): Promise<number>;
}

/**
 * Spawn and manage child processes, cross-platform. Wraps the Windows/POSIX
 * detach divergence so the call sites that hand-roll it collapse to one.
 *
 * @interface ProcessPort
 * @property {(command: string, args: readonly string[], opts?: ProcessRunOptions) => Promise<ProcessResult>} run - Run a command to completion.
 * @property {(command: string, args: readonly string[], opts?: ProcessRunOptions) => Promise<number>} spawnDetached - Spawn a detached, unref'd child that outlives this process; returns its pid.
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
 * Options for a {@link ProcessPort} invocation.
 *
 * @interface ProcessRunOptions
 * @property {string} [cwd] - Working directory for the child.
 * @property {Readonly<Record<string, string | undefined>>} [env] - Environment for the child; defaults to the parent's.
 * @property {number} [timeoutMs] - Kill the child after this many milliseconds.
 */
export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

/**
 * Outcome of a {@link ProcessPort.run}.
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
 * Reads a file's text. The one seam through which a swarm's attached context
 * enters a prompt: a plan declares paths purely (`contextFiles`), and the
 * application resolves them through this port at dispatch. Fails loud per
 * CONSTRAINTS.md Constraint 3 — a path that cannot be read rejects, because a
 * brief that silently lost its context is a brief that quietly asks the model
 * the wrong question.
 *
 * @interface FileReaderPort
 * @property {(path: string) => Promise<string>} read - The file's text; rejects when it cannot be read.
 */
export interface FileReaderPort {
  read(path: string): Promise<string>;
}

/**
 * Provider credentials. Never logs, never echoes, and never returns material to
 * any caller outside the daemon's model layer. Backends: OS keychain, encrypted
 * vault, external manager — see 13-decision-keyring.
 *
 * @interface SecretPort
 * @property {() => Promise<boolean>} available - Whether material can be read right now (keychain reachable, vault unlocked).
 * @property {(name: string, value: string) => Promise<void>} set - Store or replace a secret under a stable name.
 * @property {(name: string) => Promise<string | null>} get - Retrieve material; only the daemon's model layer may call this.
 * @property {(name: string) => Promise<void>} remove - Remove a secret.
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
 * Inference, provider-agnostic. A resolved role hands the model layer one of
 * these; the credential is fetched through {@link SecretPort} at egress, never
 * held by the caller. Adapters: copilot-sdk, openai-compatible, ollama.
 *
 * @interface ModelPort
 * @property {(request: ModelRequest) => Promise<ModelResponse>} complete - Run a single completion.
 */
export interface ModelPort {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * A single model completion request.
 *
 * @interface ModelRequest
 * @property {string} model - Provider-local model id to run.
 * @property {string} prompt - The full prompt to send.
 * @property {number} [maxOutputTokens] - Cap on generated tokens.
 */
export interface ModelRequest {
  readonly model: string;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
}

/**
 * A single model completion response.
 *
 * @interface ModelResponse
 * @property {string} content - The generated text.
 * @property {number} inputTokens - Tokens consumed by the prompt.
 * @property {number} outputTokens - Tokens generated.
 */
export interface ModelResponse {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Everything PAW says, independent of how it is shown. `cli`, `tui`, and `gui`
 * are the driving adapters that render this — the seam that lets one daemon back
 * three faces (11-decision-electron-twin).
 *
 * @interface PresenterPort
 * @property {(message: string) => void} info - Emit an informational line.
 * @property {(message: string) => void} success - Emit a success line.
 * @property {(message: string) => void} warn - Emit a warning line.
 * @property {(message: string) => void} error - Emit an error line.
 * @property {(rows: ReadonlyArray<Readonly<Record<string, string | number>>>) => void} table - Emit a table, one row per line.
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
 * Monotonic time, injected so time-dependent logic (staleness, heartbeats) is
 * deterministic in tests. The real adapter wraps `Date.now`.
 *
 * @interface ClockPort
 * @property {() => number} now - Current time in milliseconds since the epoch.
 */
export interface ClockPort {
  now(): number;
}
