/**
 * Console Context Tests
 *
 * @fileoverview Proves the provider hands out state, dispatch, and wire health,
 * and that a panel mounted outside it fails loud instead of rendering an empty
 * console.
 *
 * @module @paw/gui/test/unit/application/consoleContext
 */

import { encodeEnvelope } from '@paw/core';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleProvider,
  DEFAULT_POLL_MS,
  useConsoleDispatch,
  useConsoleState,
  useLiveError,
  useLiveStatus,
  useScope,
} from '../../../src/application/context/consoleContext.js';
import type { SocketHandlers, SocketLike } from '../../../src/infrastructure/liveSocket.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

/**
 * A probe that shows the state it can see and can move it.
 *
 * @returns {JSX.Element} The probe.
 */
function Probe() {
  const state = useConsoleState();
  const dispatch = useConsoleDispatch();
  const error = useLiveError();
  const { mode } = useLiveStatus();
  return (
    <div>
      <span data-testid='section'>{state.section}</span>
      <span data-testid='error'>{error ?? 'none'}</span>
      <span data-testid='mode'>{mode}</span>
      <span data-testid='pid'>{state.data.host.pid}</span>
      <span data-testid='procs'>{state.data.processes.length}</span>
      <button type='button' onClick={() => dispatch({ type: 'section', section: 'roles' })}>
        go
      </button>
    </div>
  );
}

describe('ConsoleProvider', () => {
  it('boots from a snapshot and dispatches into the reducer', async () => {
    renderInConsole(<Probe />);
    expect(screen.getByTestId('section')).toHaveTextContent('swarm');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByTestId('section')).toHaveTextContent('roles');
  });

  it('reports a healthy wire when nothing has failed', () => {
    renderInConsole(<Probe />);
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('polls three seconds apart by default', () => {
    expect(DEFAULT_POLL_MS).toBe(3000);
  });

  it('fails loud when a panel is mounted outside the provider', () => {
    expect(() => render(<Probe />)).toThrow('useConsoleState() used outside <ConsoleProvider>');
  });

  it('fails loud for dispatch and wire health outside the provider', () => {
    const Dispatcher = (): null => {
      useConsoleDispatch();
      return null;
    };
    const Health = (): null => {
      useLiveError();
      return null;
    };
    expect(() => render(<Dispatcher />)).toThrow('useConsoleDispatch() used outside');
    expect(() => render(<Health />)).toThrow('useLiveError() used outside');
  });

  it('accepts an explicit poll interval', () => {
    const { container } = render(
      <ConsoleProvider snapshot={makeSnapshot()} source={null} intervalMs={50}>
        <Probe />
      </ConsoleProvider>,
    );
    expect(container.querySelector('[data-testid="section"]')).toHaveTextContent('swarm');
  });

  it('folds live slices into the console and stops polling while the wire is up', () => {
    let handlers: SocketHandlers | null = null;
    const socket: SocketLike = {
      send: () => undefined,
      close: () => undefined,
      listen: (registered) => {
        handlers = registered;
      },
    };
    const poll = vi.fn(async () => makeSnapshot());

    render(
      <ConsoleProvider
        snapshot={makeSnapshot()}
        source={poll}
        connect={() => socket}
        token='a-credential'>
        <Probe />
      </ConsoleProvider>,
    );

    act(() => handlers?.open());
    act(() => handlers?.message(encodeEnvelope('hello', makeSnapshot(), 1)));
    expect(screen.getByTestId('mode')).toHaveTextContent('live');

    // Two frames in one tick. Reading React state in the fold would apply the
    // second to the data as it was before the first, and silently lose one.
    act(() => {
      handlers?.message(encodeEnvelope('host', { ...makeSnapshot().host, pid: 111 }, 2));
      handlers?.message(encodeEnvelope('processes', [{ pid: 9, ppid: 1, name: 'w' }], 3));
    });

    expect(screen.getByTestId('pid')).toHaveTextContent('111');
    expect(screen.getByTestId('procs')).toHaveTextContent('1');
    // While the socket is live the console makes no requests at all.
    expect(poll).not.toHaveBeenCalled();
  });

  it('fails loud when connection status is read outside the provider', () => {
    const Status = (): null => {
      useLiveStatus();
      return null;
    };
    expect(() => render(<Status />)).toThrow('useLiveStatus() used outside');
  });

  it('fails loud when the scope picker is read outside the provider', () => {
    const Scoped = (): null => {
      useScope();
      return null;
    };
    expect(() => render(<Scoped />)).toThrow('useScope() used outside');
  });
});
