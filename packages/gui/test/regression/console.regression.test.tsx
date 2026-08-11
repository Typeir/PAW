/**
 * Console regression.
 *
 * @fileoverview Visual regression tier from CONSTRAINTS.md Constraint 1: golden
 * snapshot of rendered DOM for every console surface — each rail subsystem, each
 * swarm tab, console with a clean ledger. A test fails when the rendered DOM
 * differs from the golden snapshot; an intended change updates the golden in
 * the same commit. The window renders without a stylesheet so the golden is DOM
 * structure only.
 *
 * @module @paw/gui/test/regression/console.regression
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsoleWindow } from '../../src/presentation/chrome/consoleWindow.js';
import { makeSnapshot, renderInConsole } from '../fixtures.js';

describe('console surfaces', () => {
  it.each(['Overview', 'Violations', 'Gates', 'Roles', 'Keys', 'Logs'])(
    'renders the %s subsystem',
    async (name) => {
      const { container } = renderInConsole(<ConsoleWindow />);
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      expect(container.innerHTML).toMatchSnapshot();
    },
  );

  it.each(['Plan', 'Herd', 'Logs'])('renders the swarm %s tab', async (tab) => {
    const { container } = renderInConsole(<ConsoleWindow />);
    await userEvent.click(screen.getByRole('tab', { name: new RegExp(tab) }));
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders a console with a clean ledger and an idle daemon', () => {
    const base = makeSnapshot();
    const { container } = renderInConsole(
      <ConsoleWindow />,
      makeSnapshot({
        violations: [],
        daemon: { ...base.daemon, live: false },
        run: { ...base.run, members: [] },
      }),
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});
