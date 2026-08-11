/**
 * PAW live session contract.
 *
 * @fileoverview Shape of live console session: socket it need, what daemon
 * supply, its life state, registry that hold them. Pure type over
 * `@paw/core`; behavior live in `application/session*`. Socket adapter and
 * daemon reference these contract. No import machine.
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
 * Socket, as session need it.
 *
 * @interface WsSessionPort
 * @property {(text: string) => void} send - Send one frame text.
 * @property {(code: number, reason: string) => void} close - Close with code.
 * @property {() => number} bufferedAmount - Byte queued, not yet write.
 */
export interface WsSessionPort {
  send(text: string): void;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}

/**
 * What session need from daemon around it.
 *
 * @interface SessionDeps
 * @property {string} token - Credential client must show.
 * @property {() => number} clock - Epoch millisecond; stamp frame, drive window and staleness.
 * @property {(plan: string | null) => Promise<PawSnapshot>} snapshot - Full state for plan.
 * @property {() => readonly string[]} plans - Plans repository hold.
 * @property {(message: string) => void} warn - Report non-fatal condition.
 * @property {(path: string, mode: InitMode) => void} [onAttach] - Hand attach request to whoever start daemon; omit and refuse it.
 * @property {(path: string) => void} [onScope] - Point daemon at repository; omit when already scoped.
 * @property {(settings: RunSettings) => void} [onRelease] - Hand release request to whoever start daemon; omit and refuse it. Like attach, nothing run, nothing spend, til operator approve in terminal.
 * @property {string} [scopeCeiling] - Directory scope request no escape; missing ceiling refuse every request.
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
 * Phase of session lifecycle.
 *
 * @typedef {'pre-auth' | 'live' | 'closed'} SessionState
 */
export type SessionState = 'pre-auth' | 'live' | 'closed';

/**
 * One connected client.
 *
 * @interface LiveSession
 * @property {() => SessionState} state - Where it sit.
 * @property {() => string | null} watching - Which plan it watch.
 * @property {(raw: string) => Promise<void>} receive - Handle one client frame.
 * @property {Function} emit - Offer published slice.
 * @property {(nowMs: number) => void} tick - Advance timer.
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
 * Notified when session authenticates or fails to. Registry holds count; the
 * socket cannot read it.
 *
 * @interface SessionWatcher
 * @property {() => void} onAuthenticated - Session authenticated.
 * @property {() => void} onAuthFailed - Session failed to authenticate.
 * @property {() => void} onClosed - Session closed.
 */
export interface SessionWatcher {
  onAuthenticated(): void;
  onAuthFailed(): void;
  onClosed(): void;
}

/**
 * Every open session, plus the live count the upgrade gate reads.
 *
 * @interface SessionRegistry
 * @property {Function} open - Register new socket as session.
 * @property {() => number} live - How many authenticate.
 * @property {() => number} preAuth - How many no yet.
 * @property {() => number} failedAuths - How many credential refuse, for report.
 * @property {() => readonly string[]} watched - Every plan live session watch, dedup.
 * @property {Function} broadcast - Offer slice to every live session.
 * @property {(nowMs: number) => void} tick - Advance every session timer.
 * @property {() => void} shutdown - Close every session on daemon shutdown.
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
