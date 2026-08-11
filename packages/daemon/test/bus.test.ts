/**
 * Event Bus Tests
 *
 * @fileoverview Tests fan-out rules. Delivery reaches every listener on a topic. A throwing listener must not stop delivery to the others. A listener that unsubscribes mid-delivery must not skip the next listener. Delivery iterates a snapshot captured at publish time; a listener subscribing during that publish sees the next event only.
 *
 * @module @paw/daemon/test/bus
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { HostInfo } from '@paw/core';
import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../src/domain/bus.js';

const HOST: HostInfo = {
  pid: 42,
  ppid: 7,
  uptimeSec: 90,
  rssBytes: 1024,
  hostname: 'box',
  platform: 'linux',
  release: '6.1',
  cpus: 8,
  node: 'v22.0.0',
  cwd: '/paw',
};

describe('createBus', () => {
  it('delivers a slice to everyone listening for it', () => {
    const bus = createBus(vi.fn());
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe('host', first);
    bus.subscribe('host', second);

    bus.publish('host', HOST);

    expect(first).toHaveBeenCalledWith(HOST);
    expect(second).toHaveBeenCalledWith(HOST);
  });

  it('delivers nothing to a topic nobody asked about', () => {
    const bus = createBus(vi.fn());
    const listener = vi.fn();
    bus.subscribe('host', listener);

    bus.publish('processes', []);

    expect(listener).not.toHaveBeenCalled();
    expect(bus.listenerCount('processes')).toBe(0);
  });

  it('publishes to an empty bus without complaint', () => {
    const onError = vi.fn();
    createBus(onError).publish('host', HOST);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops delivering to a listener that unsubscribed', () => {
    const bus = createBus(vi.fn());
    const listener = vi.fn();
    const stop = bus.subscribe('host', listener);

    stop();
    bus.publish('host', HOST);

    expect(listener).not.toHaveBeenCalled();
    expect(bus.listenerCount('host')).toBe(0);
  });

  it('forgets a topic once its last listener leaves, and keeps the others', () => {
    const bus = createBus(vi.fn());
    const stopFirst = bus.subscribe('host', vi.fn());
    bus.subscribe('host', vi.fn());
    bus.subscribe('processes', vi.fn());

    stopFirst();
    expect(bus.listenerCount('host')).toBe(1);
    expect(bus.listenerCount('processes')).toBe(1);
  });

  it('survives an unsubscribe called twice', () => {
    const bus = createBus(vi.fn());
    const stop = bus.subscribe('host', vi.fn());
    stop();
    expect(() => stop()).not.toThrow();
    expect(bus.listenerCount('host')).toBe(0);
  });
});

describe('a bus under duress', () => {
  it('keeps delivering after a listener throws, and reports which topic broke', () => {
    const onError = vi.fn();
    const bus = createBus(onError);
    const after = vi.fn();
    const boom = new Error('socket already closed');

    bus.subscribe('host', () => {
      throw boom;
    });
    bus.subscribe('host', after);

    bus.publish('host', HOST);

    // A throwing listener must not stop delivery to other listeners.
    expect(after).toHaveBeenCalledWith(HOST);
    expect(onError).toHaveBeenCalledWith('host', boom);
  });

  it('lets a listener unsubscribe itself mid-delivery without skipping the next one', () => {
    const bus = createBus(vi.fn());
    const later = vi.fn();
    const stop = bus.subscribe('host', () => stop());
    bus.subscribe('host', later);

    bus.publish('host', HOST);

    expect(later).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('host')).toBe(1);
  });

  it('does not deliver to a listener that subscribed during the same publish', () => {
    const bus = createBus(vi.fn());
    const late = vi.fn();
    bus.subscribe('host', () => {
      bus.subscribe('host', late);
    });

    bus.publish('host', HOST);

    // Delivery iterates a snapshot of listeners captured at publish time; a listener registered mid-publish is invoked on the next publish only.
    expect(late).not.toHaveBeenCalled();
    expect(bus.listenerCount('host')).toBe(2);
  });
});
