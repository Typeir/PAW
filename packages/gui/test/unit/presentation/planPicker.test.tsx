/**
 * Plan Picker Tests
 *
 * @fileoverview The picker lists every plan the repository holds. Selecting one
 * moves the console's selection; the next poll asks the daemon for that plan.
 * When the repository holds no plans, the picker reports that instead of
 * offering an empty control.
 *
 * @module @paw/gui/test/unit/presentation/planPicker
 */

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConsoleState } from '../../../src/application/context/consoleContext.js';
import { PlanPicker } from '../../../src/presentation/atoms/planPicker.js';
import { SwarmView } from '../../../src/presentation/views/swarm/swarmView.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

/**
 * Show which plan console ask daemon for next.
 *
 * @returns {JSX.Element} The probe.
 */
function Asking() {
  return <span data-testid='asking'>{useConsoleState().plan ?? 'none'}</span>;
}

describe('PlanPicker', () => {
  it('lists every plan in the repository and marks the selected one', () => {
    renderInConsole(<PlanPicker />);
    const trigger = screen.getByRole('button', { name: 'Swarm plan' });
    expect(trigger).toHaveTextContent('plans/demo.swarm.mjs');
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '— pick a plan —',
      'plans/demo.swarm.mjs',
      'plans/other.swarm.mjs',
    ]);
    expect(within(list).getByRole('option', { name: 'plans/demo.swarm.mjs' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves the console to another plan without a restart', () => {
    renderInConsole(
      <>
        <PlanPicker />
        <Asking />
      </>,
    );
    expect(screen.getByTestId('asking')).toHaveTextContent('plans/demo.swarm.mjs');
    fireEvent.click(screen.getByRole('button', { name: 'Swarm plan' }));
    fireEvent.click(screen.getByRole('option', { name: 'plans/other.swarm.mjs' }));
    expect(screen.getByTestId('asking')).toHaveTextContent('plans/other.swarm.mjs');
  });

  it('can go back to looking at no plan at all', () => {
    renderInConsole(
      <>
        <PlanPicker />
        <Asking />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Swarm plan' }));
    fireEvent.click(screen.getByRole('option', { name: '— pick a plan —' }));
    expect(screen.getByTestId('asking')).toHaveTextContent('none');
  });

  it('says so when the repository holds no plans', () => {
    renderInConsole(<PlanPicker />, makeSnapshot({ plans: [], selectedPlan: null }));
    expect(screen.getByText('no *.swarm.mjs in this repository')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Swarm plan' })).toBeNull();
  });
});

describe('SwarmView with no plan selected', () => {
  const unselected = makeSnapshot({
    selectedPlan: null,
    planName: '',
    planRole: '',
    memberTotal: 0,
    planSource: '',
    briefs: [],
    slugs: [],
    planFindings: [],
  });

  it('offers the picker instead of an empty plan', () => {
    renderInConsole(<SwarmView />, unselected);
    expect(screen.getByRole('button', { name: 'Swarm plan' })).toHaveTextContent('— pick a plan —');
    expect(screen.getByRole('heading', { name: 'No plan selected' })).toBeInTheDocument();
    expect(
      screen.getByText('— pick a plan to read its briefs and release its herd —'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByLabelText('Member brief')).toBeNull();
  });

  it('says a repository with no plans holds none', () => {
    renderInConsole(<SwarmView />, makeSnapshot({ ...unselected, plans: [] }));
    expect(screen.getByText('— this repository holds no *.swarm.mjs —')).toBeInTheDocument();
    expect(screen.getByText('0 in this repository')).toBeInTheDocument();
  });

  it('shows the plan again once one is selected', () => {
    renderInConsole(<SwarmView />);
    expect(screen.getByRole('heading', { name: 'plans/demo.swarm.mjs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
