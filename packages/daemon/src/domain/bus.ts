/**
 * PAW Daemon Event Bus
 *
 * @fileoverview One typed publish/subscribe point. Source publish slice, no know who listen. Listener subscribe, no know who produce. Wire source and session to bus once, in `runDaemon`.
 *
 * **Listener throw no stop others.** Delivery keep go to every remaining listener. Failure go through injected `onError`.
 *
 * **Unsubscribe during publish safe.** Delivery iterate copy of listener set. This case when session unsubscribe self while handle event.
 *
 * Pure: `Map` of `Set`s.
 *
 * @module @paw/daemon/bus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LiveTopic, LiveTopicMap } from '@paw/core';

/**
 * What subscriber get when topic change.
 */
export type LiveListener<T extends LiveTopic> = (data: LiveTopicMap[T]) => void;

/**
 * Told when listener throw.
 */
export type BusErrorReporter = (topic: LiveTopic, error: unknown) => void;

/**
 * Typed fan-out point.
 *
 * @interface LiveBus
 * @property {Function} subscribe - Listen to topic; return unsubscribe.
 * @property {Function} publish - Give slice new value to every listener.
 * @property {(topic: LiveTopic) => number} listenerCount - How many listen, for tests and limits.
 */
export interface LiveBus {
  subscribe<T extends LiveTopic>(topic: T, listener: LiveListener<T>): () => void;
  publish<T extends LiveTopic>(topic: T, data: LiveTopicMap[T]): void;
  listenerCount(topic: LiveTopic): number;
}

/**
 * Build bus.
 *
 * @param {BusErrorReporter} onError - Told when listener throw.
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
