/**
 * PAW Enforcement RPC Methods
 *
 * @fileoverview Socket methods resident daemon answer for enforcement:
 * hook.dispatch, violations.list, violations.prune, and — when control
 * enabled — daemon.status and daemon.stop. One daemon serve them over socket
 * and, later, HTTP surface, against single store.
 *
 * @module @paw/daemon/application/enforcementMethods
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import {
  PAW_EVENT_TYPES,
  RPC_PROTOCOL_VERSION,
  dispatchHook,
  type DispatchHookDeps,
  type HookDispatch,
  type PawEventType,
} from '@paw/core';

const EVENTS: ReadonlySet<string> = new Set(PAW_EVENT_TYPES);

/**
 * Narrow untrusted RPC params into {@link HookDispatch}, or null when malformed:
 * need host, known event, object payload.
 *
 * @param {unknown} params - Method params off wire.
 * @returns {HookDispatch | null} Dispatch, or null.
 */
export function toDispatch(params: unknown): HookDispatch | null {
  const p = (params ?? {}) as { host?: unknown; event?: unknown; payload?: unknown };
  if (typeof p.host !== 'string' || typeof p.event !== 'string' || !EVENTS.has(p.event)) {
    return null;
  }
  const payload =
    typeof p.payload === 'object' && p.payload !== null
      ? (p.payload as Record<string, unknown>)
      : {};
  return { host: p.host, event: p.event as PawEventType, payload };
}

/**
 * What methods need beyond dispatch deps.
 *
 * @interface EnforcementMethodOptions
 * @property {string} projectRoot - Root reported by daemon.status.
 * @property {() => void} resetIdle - Called on every method to defer idle timer.
 * @property {() => Promise<void>} close - Close server, for daemon.stop.
 * @property {{ pid: number; now: () => number; onStop: () => void }} [control] - Enable daemon.status/stop.
 */
export interface EnforcementMethodOptions {
  readonly projectRoot: string;
  readonly resetIdle: () => void;
  readonly close: () => Promise<void>;
  readonly control?: { pid: number; now: () => number; onStop: () => void };
}

/**
 * Build enforcement RPC method table against store and dispatch deps.
 *
 * @param {DispatchHookDeps} deps - Store, gates, connectors, policy.
 * @param {EnforcementMethodOptions} opts - Lifecycle callbacks and control.
 * @returns {Record<string, (params: unknown) => Promise<unknown>>} Methods.
 */
export function enforcementMethods(
  deps: DispatchHookDeps,
  opts: EnforcementMethodOptions,
): Record<string, (params: unknown) => Promise<unknown>> {
  const methods: Record<string, (params: unknown) => Promise<unknown>> = {
    'hook.dispatch': async (params: unknown): Promise<unknown> => {
      opts.resetIdle();
      const req = toDispatch(params);
      return req === null ? { continue: true } : dispatchHook(deps, req);
    },
    'violations.list': async (): Promise<unknown> => {
      opts.resetIdle();
      return { violations: await deps.store.outstanding() };
    },
    'violations.prune': async (params: unknown): Promise<unknown> => {
      opts.resetIdle();
      const file = (params as { file?: unknown })?.file;
      return { cleared: await deps.store.prune(typeof file === 'string' ? file : null) };
    },
  };
  const control = opts.control;
  if (control) {
    const startedAt = control.now();
    methods['daemon.status'] = async () => ({
      pid: control.pid,
      uptimeMs: control.now() - startedAt,
      protocolVersion: RPC_PROTOCOL_VERSION,
      health: 'ok',
      projectRoot: opts.projectRoot,
    });
    methods['daemon.stop'] = async () => {
      setTimeout(() => {
        void opts.close().then(control.onStop);
      }, 50).unref();
      return { stopping: true };
    };
  }
  return methods;
}
