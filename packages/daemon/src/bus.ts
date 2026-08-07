/**
 * PAW Daemon Event Bus
 *
 * @fileoverview One typed publish/subscribe point, so a source publishes a slice
 * without knowing who is listening and a listener subscribes without knowing who
 * produces. This is the backend twin of the console's context: sources and
 * sessions are wired to the bus once, in `runDaemon`, rather than every consumer
 * re-implementing "poll this and notify those".
 *
 * Two behaviours are deliberate and both exist because the listeners are
 * WebSocket sessions.
 *
 * **A listener that throws does not stop the others.** Delivery continues to
 * every remaining listener and the failure is reported through the injected
 * `onError`. A control daemon whose whole fan-out dies because one socket was
 * closed mid-publish is a daemon that goes silent for everyone.
 *
 * **Unsubscribing during a publish is safe.** Delivery iterates a copy of the
 * listener set, which is exactly the case that arises when a session closes
 * itself in response to an event it just received.
 *
 * Pure — a `Map` of `Set`s and nothing else — so the fan-out rules are unit
 * tested rather than observed on a live socket.
 *
 * @module @paw/daemon/bus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LiveTopic, LiveTopicMap } from '@paw/core';

/**
 * What a subscriber is handed when its topic changes.
 */
export type LiveListener<T extends LiveTopic> = (data: LiveTopicMap[T]) => void;

/**
 * Told when a listener throws, so the failure is reported rather than swallowed
 * and rather than taking the publish down with it.
 */
export type BusErrorReporter = (topic: LiveTopic, error: unknown) => void;

/**
 * The typed fan-out point.
 *
 * @interface LiveBus
 * @property {Function} subscribe - Listen to a topic; returns the unsubscribe.
 * @property {Function} publish - Deliver a slice's new value to every listener.
 * @property {(topic: LiveTopic) => number} listenerCount - How many are listening, for tests and limits.
 */
export interface LiveBus {
  subscribe<T extends LiveTopic>(topic: T, listener: LiveListener<T>): () => void;
  publish<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  listenerCount(topic: LiveTopic): number;
}

/**
 * Build a bus.
 *
 * @param {BusErrorReporter} onError - Told when a listener throws.
 * @returns {LiveBus} The bus.
 */
export function createBus(onError: BusErrorReporter): LiveBus {
  const listeners = new Map<LiveTopic, Set<LiveListener<LiveTopic>>>();

  return {
    subscribe: <T extends LiveTopic>(topic: T, listener: LiveListener<T>): (() => void) => {
      const existing = listeners.get(topic) ?? new Set<LiveListener<LiveTopic>>();
      existing.add(listener as LiveListener<LiveTopic>);
      listeners.set(topic, existing);
      return () => {
        existing.delete(listener as LiveListener<LiveTopic>);
        if (existing.size === 0) {
          listeners.delete(topic);
        }
      };
    },

    publish: <T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void => {
      const subscribed = listeners.get(topic);
      if (subscribed === undefined) {
        return;
      }
      for (const listener of [...subscribed]) {
        try {
          listener(data);
        } catch (error: unknown) {
          onError(topic, error);
        }
      }
    },

    listenerCount: (topic: LiveTopic): number => listeners.get(topic)?.size ?? 0,
  };
}
