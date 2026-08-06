/**
 * Chrome Tests
 *
 * @fileoverview The window's frame: the titlebar's daemon pill and theme toggle,
 * and the rail's counts and daemon foot. The pill's `live` state comes from the
 * snapshot, so an idle daemon must not pulse.
 *
 * @module @paw/gui/test/unit/presentation/chrome
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import { ConsoleWindow } from '../../../src/presentation/chrome/consoleWindow.js';
import { Rail } from '../../../src/presentation/chrome/rail.js';
import { TitleBar } from '../../../src/presentation/chrome/titleBar.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

describe('TitleBar', () => {
  it('pulses and reports the daemon when it is live', () => {
    const { container } = renderInConsole(<TitleBar />);
    expect(screen.getByText('pawd live · 2h14m · pid 4242')).toBeInTheDocument();
    expect(container.querySelector('.pulse')).toBeInTheDocument();
  });

  it('draws no window chrome in a browser tab', () => {
    const { container } = renderInConsole(<TitleBar />);
    expect(container.querySelector('.lights')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close window' })).toBeNull();
  });

  it('draws the window controls in a desktop shell, and they drive the window', async () => {
    const controls = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() };
    const { container } = render(
      <ConsoleProvider snapshot={makeSnapshot()} controls={controls}>
        <TitleBar />
      </ConsoleProvider>,
    );
    expect(container.querySelector('.lights')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Minimise window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Maximise window' }));
    expect(controls.close).toHaveBeenCalledOnce();
    expect(controls.minimize).toHaveBeenCalledOnce();
    expect(controls.maximize).toHaveBeenCalledOnce();
  });

  it('reports an idle daemon without a pulse', () => {
    const snapshot = makeSnapshot();
    const { container } = renderInConsole(
      <TitleBar />,
      makeSnapshot({ daemon: { ...snapshot.daemon, live: false } }),
    );
    expect(screen.getByText('pawd idle · 2h14m · pid 4242')).toBeInTheDocument();
    expect(container.querySelector('.pulse')).toBeNull();
  });

  it('toggles the document theme', async () => {
    renderInConsole(<TitleBar />);
    const toggle = screen.getByRole('button', { name: 'Toggle colour theme' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ConsoleWindow', () => {
  it('is a page in a browser tab, with no window frame', () => {
    const { container } = renderInConsole(<ConsoleWindow />);
    expect(container.querySelector('[data-shell]')).toHaveAttribute('data-shell', 'web');
    expect(container.querySelector('header')).toBeInTheDocument();
    expect(container.querySelector('nav')).toBeInTheDocument();
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  it('is a window in the desktop shell', () => {
    const { container } = render(
      <ConsoleProvider
        snapshot={makeSnapshot()}
        controls={{ minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() }}>
        <ConsoleWindow />
      </ConsoleProvider>,
    );
    expect(container.querySelector('[data-shell]')).toHaveAttribute('data-shell', 'desktop');
  });
});

describe('Rail', () => {
  it('counts open violations, gates, roles, and keys', () => {
    renderInConsole(<Rail />);
    expect(screen.getByRole('navigation', { name: 'Subsystems' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Violations/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /^Gates/ })).toHaveTextContent('11');
    expect(screen.getByRole('button', { name: /^Roles/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /^Keys/ })).toHaveTextContent('1');
  });

  it('shows the daemon socket, memory, and protocol in the foot', () => {
    renderInConsole(<Rail />);
    expect(screen.getByText('127.0.0.1:8971', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('100 MB', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('v1', { exact: false })).toBeInTheDocument();
  });
});
