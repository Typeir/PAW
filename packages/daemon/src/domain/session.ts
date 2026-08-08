/**
 * PAW Live Session Contracts
 *
 * @fileoverview The shapes a live console session is described by — the socket it
 * needs, what the daemon around it supplies, where it is in its life, and the
 * registry that holds them all. Pure types over `@paw/core`: the behaviour lives
 * in `application/session*`, and lifting the contracts here lets the socket
 * adapter and the daemon reference them without pulling the machine in.
 *
 * @module @paw/daemon/domain/session
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  InitMode,
  LiveTopic,
  LiveTopicMap,
  PawSnapshot,
  RunSettings,
} from '@paw/core';

/**
 * The socket, as a session needs it.
 *
 * @interface WsSessionPort
 * @property {(text: string) => void} send - Send one frame of text.
 * @property {(code: number, reason: string) => void} close - Close with a code.
 * @property {() => number} bufferedAmount - Bytes queued and not yet written.
 */
export interface WsSessionPort {
  send(text: string): void;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}

/**
 * What a session needs from the daemon around it.
 *
 * @interface SessionDeps
 * @property {string} token - The credential a client must present.
 * @property {() => number} clock - Epoch milliseconds; stamps frames and drives windows and staleness.
 * @property {(plan: string | null) => Promise<PawSnapshot>} snapshot - The full state for a plan.
 * @property {() => readonly string[]} plans - The plans the repository holds.
 * @property {(message: string) => void} warn - Report something without dying of it.
 * @property {(path: string, mode: InitMode) => void} [onAttach] - Hand an attach request to whoever started the daemon; omit to refuse it.
 * @property {(path: string) => void} [onScope] - Point the daemon at a repository; omit when it is already scoped.
 * @property {(settings: RunSettings) => void} [onRelease] - Hand a release request to whoever started the daemon; omit to refuse it. Like attach, nothing runs and nothing is spent until the operator approves in the terminal.
 * @property {string} [scopeCeiling] - The directory a scope request may not escape; a missing ceiling refuses every request.
 */
export interface SessionDeps {
  readonly token: string;
  clock(): number;
  snapshot(plan: string | null): Promise<PawSnapshot>;
  plans(): readonly string[];
  warn(message: string): void;
  onAttach?(path: string, mode: InitMode): void;
  onScope?(path: string): void;
  onRelease?(settings: RunSettings): void;
  readonly scopeCeiling?: string;
}

/**
 * Where a session is in its life.
 *
 * @typedef {'pre-auth' | 'live' | 'closed'} SessionState
 */
export type SessionState = 'pre-auth' | 'live' | 'closed';

/**
 * One connected client.
 *
 * @interface LiveSession
 * @property {() => SessionState} state - Where it is.
 * @property {() => string | null} watching - Which plan it is watching.
 * @property {(raw: string) => Promise<void>} receive - Handle one client frame.
 * @property {Function} emit - Offer it a published slice.
 * @property {(nowMs: number) => void} tick - Advance its timers.
 * @property {(code: number, reason: string) => void} close - Close it.
 */
export interface LiveSession {
  state(): SessionState;
  watching(): string | null;
  receive(raw: string): Promise<void>;
  emit<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  tick(nowMs: number): void;
  close(code: number, reason: string): void;
}

/**
 * Told when a session authenticates or fails to, so the registry can hold the
 * counts one socket cannot see.
 *
 * @interface SessionWatcher
 * @property {() => void} onAuthenticated - The session proved itself.
 * @property {() => void} onAuthFailed - It did not.
 * @property {() => void} onClosed - It is gone.
 */
export interface SessionWatcher {
  onAuthenticated(): void;
  onAuthFailed(): void;
  onClosed(): void;
}

/**
 * Every open session, and the counts the upgrade gate reads.
 *
 * @interface SessionRegistry
 * @property {Function} open - Register a new socket as a session.
 * @property {() => number} live - How many have authenticated.
 * @property {() => number} preAuth - How many have not yet.
 * @property {() => number} failedAuths - How many credentials have been refused, for reporting.
 * @property {() => readonly string[]} watched - Every plan a live session is watching, deduplicated.
 * @property {Function} broadcast - Offer a slice to every live session.
 * @property {(nowMs: number) => void} tick - Advance every session's timers.
 * @property {() => void} shutdown - Close every session, because the daemon is going away.
 */
export interface SessionRegistry {
  open(port: WsSessionPort, openedOn: string | null): LiveSession;
  live(): number;
  preAuth(): number;
  failedAuths(): number;
  watched(): readonly string[];
  broadcast<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  tick(nowMs: number): void;
  shutdown(): void;
}
