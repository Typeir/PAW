/**
 * Subsystem view test.
 *
 * @fileoverview Non-swarm subsystem. Overview built from real host fact. Role
 * binding show three verdict. Enforcement ledger show full and empty. Views
 * render a placeholder when no daemon reports yet.
 *
 * @module @paw/gui/test/unit/presentation/views
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import type { ConfigClient } from '../../../src/infrastructure/configClient.js';
import { Rail } from '../../../src/presentation/chrome/rail.js';
import { OverviewView, formatMb } from '../../../src/presentation/views/overviewView.js';
import { PendingView } from '../../../src/presentation/views/pendingView.js';
import { RolesView } from '../../../src/presentation/views/rolesView.js';
import { SectionOutlet } from '../../../src/presentation/views/sectionOutlet.js';
import { ViolationsView } from '../../../src/presentation/views/violationsView.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

/** Config client. Declared model and write outcome set per test. */
const configClient = (over: Partial<ConfigClient> = {}): ConfigClient => ({
  models: async () => ['fast', 'slow'],
  bind: async () => ({ ok: true }),
  unbind: async () => ({ ok: true }),
  ...over,
});

/** Render Roles view over config client. Make editable. */
const renderEditable = (client: ConfigClient) =>
  render(
    <ConsoleProvider snapshot={makeSnapshot()} config={client}>
      <RolesView />
    </ConsoleProvider>,
  );

describe('OverviewView', () => {
  it('shows the real host facts and the owned process table', () => {
    renderInConsole(<OverviewView />);
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('LAPTOP-TEST · win32 10.0.26200')).toBeInTheDocument();
    expect(screen.getByText('4242 (parent 17)')).toBeInTheDocument();
    expect(screen.getByText('v22.23.1')).toBeInTheDocument();
    expect(screen.getByText('C:\\paw')).toBeInTheDocument();
    expect(screen.getByText('worker.exe')).toBeInTheDocument();
    expect(screen.getByText('2 owned by PAW')).toBeInTheDocument();
    expect(screen.getByText('read from this machine')).toBeInTheDocument();
  });

  it('names the repository’s config and plans', () => {
    renderInConsole(<OverviewView />);
    expect(screen.getByText('.paw/config.json')).toBeInTheDocument();
    expect(
      screen.getByText('plans/demo.swarm.mjs, plans/other.swarm.mjs'),
    ).toBeInTheDocument();
  });

  it('says when the repository has neither a config nor a plan', () => {
    renderInConsole(<OverviewView />, makeSnapshot({ configPath: '', plans: [] }));
    expect(screen.getAllByText('(none found)')).toHaveLength(2);
  });

  it('says the host facts have no daemon behind them on a static page', () => {
    const base = makeSnapshot();
    renderInConsole(
      <OverviewView />,
      makeSnapshot({ daemon: { ...base.daemon, live: false } }),
    );
    expect(screen.getByText('no daemon attached')).toBeInTheDocument();
  });

  it('reports config problems and a blocked doctor', () => {
    renderInConsole(<OverviewView />);
    expect(screen.getByText('1 problems')).toBeInTheDocument();
    expect(screen.getByText('no models declared')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('reports a sound config, a ready doctor, and no processes', () => {
    renderInConsole(
      <OverviewView />,
      makeSnapshot({
        processes: [],
        doctor: { ok: true, config: [], roles: [] },
      }),
    );
    expect(screen.getByText('config resolves')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('— no processes reported —')).toBeInTheDocument();
  });

  it('rounds resident memory to whole megabytes', () => {
    expect(formatMb(100 * 1024 * 1024)).toBe('100 MB');
  });
});

describe('RolesView', () => {
  it('shows each binding read-only when there is no daemon to edit', () => {
    renderInConsole(<RolesView />);
    expect(screen.getByText('3 declared')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('optional')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('(unbound)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Model for memory.draft' })).toBeNull();
  });

  it('binds a role to a chosen model over the client', async () => {
    const bind = vi.fn(async () => ({ ok: true }));
    renderEditable(configClient({ bind }));
    await userEvent.click(screen.getByRole('button', { name: 'Model for memory.draft' }));
    await userEvent.click(await screen.findByRole('option', { name: 'fast' }));
    expect(bind).toHaveBeenCalledWith('memory.draft', 'fast');
  });

  it('unbinds a role when (unbound) is chosen', async () => {
    const unbind = vi.fn(async () => ({ ok: true }));
    renderEditable(configClient({ unbind }));
    await userEvent.click(screen.getByRole('button', { name: 'Model for lore.author' }));
    await userEvent.click(await screen.findByRole('option', { name: '(unbound)' }));
    expect(unbind).toHaveBeenCalledWith('lore.author');
  });

  it('surfaces why the declared models could not be read', async () => {
    renderEditable(
      configClient({
        models: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(await screen.findByText('could not read the declared models')).toBeInTheDocument();
  });
});

describe('ViolationsView', () => {
  it('separates a direct violation from one whose fix lives elsewhere', () => {
    renderInConsole(<ViolationsView />);
    expect(screen.getByText('2 open')).toBeInTheDocument();
    expect(screen.getByText('crit')).toBeInTheDocument();
    expect(screen.getByText('warn')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
  });

  it('says so when the ledger is clean', () => {
    renderInConsole(<ViolationsView />, makeSnapshot({ violations: [] }));
    expect(screen.getByText('none open')).toBeInTheDocument();
    expect(screen.getByText('no open violations')).toBeInTheDocument();
  });
});

describe('PendingView', () => {
  it('names what a daemon control API would back', () => {
    renderInConsole(<PendingView title='Gates' />);
    expect(screen.getByRole('heading', { name: 'Gates' })).toBeInTheDocument();
    expect(
      screen.getByText('— Gates — a live pawd control API will back this view —'),
    ).toBeInTheDocument();
  });
});

describe('SectionOutlet', () => {
  it('opens on the Swarm subsystem', () => {
    renderInConsole(<SectionOutlet />);
    expect(screen.getByRole('heading', { name: 'Swarm', level: 1 })).toBeInTheDocument();
  });

  it.each(['Overview', 'Roles', 'Violations', 'Gates', 'Keys', 'Logs'])(
    'switches to the %s subsystem from the rail',
    async (name) => {
      renderInConsole(
        <>
          <Rail />
          <SectionOutlet />
        </>,
      );
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      expect(screen.getByRole('heading', { name, level: 1 })).toBeInTheDocument();
    },
  );
});
