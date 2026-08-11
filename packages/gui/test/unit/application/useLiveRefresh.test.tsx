/**
 * Live refresh tests.
 *
 * @fileoverview Drive poll loop on fake timers. Static page poll nothing. Healthy source fold each snapshot in. Failing source show reason and keep last data. Tree unmount mid-flight, neither update nor leak interval.
 *
 * @module @paw/gui/test/unit/application/useLiveRefresh
 */

import type { PawSnapshot } from '@paw/core';
import { act, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveRefresh, type SnapshotSource } from '../../../src/application/hooks/useLiveRefresh.js';
import type { ConsoleData } from '../../../src/domain/console.types.js';
import { makeSnapshot } from '../../fixtures.js';

/**
 * Props for {@link Poller}.
 *
 * @interface PollerProps
 * @property {SnapshotSource | null} source - Source under test.
 */
interface PollerProps {
  readonly source: SnapshotSource | null;
  readonly plan?: string | null;
}

/**
 * Probe show last plan name it got and last error.
 *
 * @param {PollerProps} props - Probe props.
 * @returns {JSX.Element} The probe.
 */
function Poller({ source, plan = 'plans/demo.swarm.mjs' }: PollerProps) {
  const [name, setName] = useState('none');
  const onSnapshot = useCallback((data: ConsoleData) => setName(data.plan.name), []);
  const error = useLiveRefresh(source, 1000, plan, onSnapshot);
  return (
    <div>
      <span data-testid='plan'>{name}</span>
      <span data-testid='error'>{error ?? 'healthy'}</span>
    </div>
  );
}

/**
 * Advance fake clock past one poll, let microtasks settle.
 */
async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLiveRefresh', () => {
  it('polls nothing when there is no source', async () => {
    render(<Poller source={null} />);
    await tick();
    expect(screen.getByTestId('plan')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('healthy');
  });

  it('reads once on mount and hands each snapshot to the console', async () => {
    const source = vi.fn(async (): Promise<PawSnapshot> => makeSnapshot({ planName: 'live' }));
    render(<Poller source={source} />);
    await act(async () => undefined);
    expect(source).toHaveBeenCalledWith('plans/demo.swarm.mjs');
    expect(screen.getByTestId('plan')).toHaveTextContent('live');

    await tick();
    expect(source.mock.calls.length).toBeGreaterThan(1);
  });

  it('re-reads at once when the operator picks another plan', async () => {
    const source = vi.fn(async (plan: string | null): Promise<PawSnapshot> =>
      makeSnapshot({ planName: plan === 'plans/other.swarm.mjs' ? 'other' : 'demo' }),
    );
    const view = render(<Poller source={source} />);
    await act(async () => undefined);
    expect(screen.getByTestId('plan')).toHaveTextContent('demo');

    view.rerender(<Poller source={source} plan='plans/other.swarm.mjs' />);
    await act(async () => undefined);
    expect(source).toHaveBeenLastCalledWith('plans/other.swarm.mjs');
    expect(screen.getByTestId('plan')).toHaveTextContent('other');
  });

  it('surfaces a failed poll and recovers when the daemon returns', async () => {
    let fail = true;
    const source = vi.fn(async (): Promise<PawSnapshot> => {
      if (fail) {
        throw new Error('connection refused');
      }
      return makeSnapshot({ planName: 'back' });
    });
    render(<Poller source={source} />);
    await tick();
    expect(screen.getByTestId('error')).toHaveTextContent('connection refused');
    fail = false;
    await tick();
    expect(screen.getByTestId('error')).toHaveTextContent('healthy');
    expect(screen.getByTestId('plan')).toHaveTextContent('back');
  });

  it('surfaces a non-Error rejection as text', async () => {
    const source = vi.fn(async (): Promise<PawSnapshot> => Promise.reject('socket closed'));
    render(<Poller source={source} />);
    await tick();
    expect(screen.getByTestId('error')).toHaveTextContent('socket closed');
  });

  it('ignores a snapshot that lands after unmount', async () => {
    let release: (snapshot: PawSnapshot) => void = () => undefined;
    const source = vi.fn(
      async (): Promise<PawSnapshot> =>
        new Promise<PawSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<Poller source={source} />);
    await act(async () => undefined);
    view.unmount();
    const seen = source.mock.calls.length;
    await act(async () => {
      release(makeSnapshot({ planName: 'late' }));
    });
    expect(screen.queryByTestId('plan')).toBeNull();
    expect(source).toHaveBeenCalledTimes(seen);
  });

  it('ignores a failure that lands after unmount', async () => {
    let reject: (reason: Error) => void = () => undefined;
    const source = vi.fn(
      async (): Promise<PawSnapshot> =>
        new Promise<PawSnapshot>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const view = render(<Poller source={source} />);
    await act(async () => undefined);
    view.unmount();
    const seen = source.mock.calls.length;
    await act(async () => {
      reject(new Error('too late'));
    });
    expect(source).toHaveBeenCalledTimes(seen);
  });

  it('stops polling once unmounted', async () => {
    const source = vi.fn(async (): Promise<PawSnapshot> => makeSnapshot());
    const view = render(<Poller source={source} />);
    await tick();
    const seen = source.mock.calls.length;
    view.unmount();
    await tick();
    expect(source).toHaveBeenCalledTimes(seen);
  });
});
