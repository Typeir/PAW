/**
 * Console E2E
 *
 * @fileoverview The whole console, driven the way an operator drives it: mount
 * it on a snapshot, walk the rail, scrub with the keyboard, jump from a herd row
 * to its brief, and — the point of the rewrite — watch it take a fresh snapshot
 * off the wire and re-render the real host facts, then say so out loud when the
 * daemon stops answering. No panel is stubbed; this is the app.
 *
 * @module @paw/gui/test/e2e/console.e2e
 */

import type { PawSnapshot } from '@paw/core';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot, renderConsole } from '../fixtures.js';

describe('the console', () => {
  it('opens on the swarm plan of the snapshot it was given', () => {
    renderConsole();
    expect(screen.getByRole('heading', { name: 'Swarm', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'plans/demo.swarm.mjs' })).toBeInTheDocument();
    expect(screen.getByLabelText('Member brief')).toHaveValue('brief 1/4: alpha <&>"\'');
  });

  it('walks the rail through every subsystem', async () => {
    const user = userEvent.setup();
    renderConsole();
    for (const name of ['Overview', 'Violations', 'Gates', 'Roles', 'Keys', 'Logs', 'Swarm']) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      expect(screen.getByRole('heading', { name, level: 1 })).toBeInTheDocument();
    }
  });

  it('shows the real host and the owned processes on Overview', async () => {
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(screen.getByText('LAPTOP-TEST · win32 10.0.26200')).toBeInTheDocument();
    expect(screen.getByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText('worker.exe')).toBeInTheDocument();
  });

  it('scrubs members with the arrow keys and stops at the ends', async () => {
    const user = userEvent.setup();
    renderConsole();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('member 2 / 4')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByText('member 1 / 4')).toBeInTheDocument();
  });

  it('does not scrub from the herd tab', async () => {
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByRole('tab', { name: /Herd/ }));
    await user.keyboard('{ArrowRight}');
    await user.click(screen.getByRole('tab', { name: /Plan/ }));
    expect(screen.getByText('member 1 / 4')).toBeInTheDocument();
  });

  it('jumps from a herd row to that member’s brief', async () => {
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByRole('tab', { name: /Herd/ }));
    await user.click(screen.getByRole('button', { name: 'Select member 3, delta' }));
    await user.click(screen.getByRole('tab', { name: /Plan/ }));
    expect(screen.getByLabelText('Member brief')).toHaveValue('brief 4/4: delta');
  });

  it('mounts the stylesheet with the page', () => {
    const { container } = renderConsole();
    expect(container.querySelector('style[data-paw="styles"]')?.textContent).toContain(
      '[data-shell]',
    );
  });
});

describe('the live wire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-renders each poll and warns when the daemon goes away', async () => {
    const base = makeSnapshot();
    let answer: () => Promise<PawSnapshot> = async () =>
      makeSnapshot({
        planName: 'moved-on',
        daemon: { ...base.daemon, uptimeLabel: '9h99m', rssMb: 512 },
      });
    const source = (): Promise<PawSnapshot> => answer();

    // A daemon behind the page but no socket to it: the console falls back to
    // polling rather than sitting on its boot snapshot.
    renderConsole(makeSnapshot(), source, 1000);
    expect(screen.getByText('pawd live · 2h14m · pid 4242')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('pawd live · 9h99m · pid 4242')).toBeInTheDocument();
    expect(screen.getByText('run 2026-08-05T15-40-02')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('live wire down — polling');
    expect(screen.queryByRole('alert')).toBeNull();

    answer = async () => {
      throw new Error('fetch failed');
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('live wire down — polling');
    expect(banner).toHaveTextContent('fetch failed');
    // The last snapshot stays on screen, labelled, rather than being cleared.
    expect(screen.getByText('pawd live · 9h99m · pid 4242')).toBeInTheDocument();
  });
});
