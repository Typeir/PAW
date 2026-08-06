/**
 * Console Context Tests
 *
 * @fileoverview Proves the provider hands out state, dispatch, and wire health,
 * and that a panel mounted outside it fails loud instead of rendering an empty
 * console.
 *
 * @module @paw/gui/test/unit/application/consoleContext
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ConsoleProvider,
  DEFAULT_POLL_MS,
  useConsoleDispatch,
  useConsoleState,
  useLiveError,
} from '../../../src/application/context/consoleContext.js';
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
  return (
    <div>
      <span data-testid='section'>{state.section}</span>
      <span data-testid='error'>{error ?? 'none'}</span>
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
});
