/**
 * Subsystem View Tests
 *
 * @fileoverview The non-swarm subsystems: the Overview built from real host
 * facts, the role bindings and their three verdicts, the enforcement ledger full
 * and empty, and the honest stand-in for what no daemon report backs yet.
 *
 * @module @paw/gui/test/unit/presentation/views
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Rail } from '../../../src/presentation/chrome/rail.js';
import { OverviewView, formatMb } from '../../../src/presentation/views/overviewView.js';
import { PendingView } from '../../../src/presentation/views/pendingView.js';
import { RolesView } from '../../../src/presentation/views/rolesView.js';
import { SectionOutlet } from '../../../src/presentation/views/sectionOutlet.js';
import { ViolationsView } from '../../../src/presentation/views/violationsView.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

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
  it('shows each binding with its verdict', () => {
    renderInConsole(<RolesView />);
    expect(screen.getByText('3 declared')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('optional')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('(unbound)')).toBeInTheDocument();
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
