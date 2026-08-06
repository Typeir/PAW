/**
 * Plan Picker Atom
 *
 * @fileoverview Which of the repository's plans the console is looking at. One
 * daemon serves a workspace, so the plan is a selection here rather than a
 * launch argument — picking another re-reads it from disk on the next poll,
 * with no restart and no second console. The ported {@link Select} carries it: a
 * styled, filterable listbox that reads to a screen reader and drives from the
 * keyboard, so it matches the rest of the console without giving up what the
 * platform `<select>` gave for free.
 *
 * @module @paw/gui/presentation/atoms/planPicker
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleActions } from '../../application/hooks/useConsoleActions.js';
import { usePlans, useSelectedPlan } from '../../application/hooks/useConsole.js';
import { Select } from './select.js';

/**
 * The repository's plan list, as a picker.
 *
 * @returns {JSX.Element} The picker, or a note when the repository holds no plans.
 */
export function PlanPicker() {
  const plans = usePlans();
  const selected = useSelectedPlan();
  const { selectPlan } = useConsoleActions();

  if (plans.length === 0) {
    return <span className='sub'>no *.swarm.mjs in this repository</span>;
  }

  return (
    <Select
      ariaLabel='Swarm plan'
      searchable
      value={selected ?? ''}
      options={[
        { value: '', label: '— pick a plan —' },
        ...plans.map((plan) => ({ value: plan, label: plan })),
      ]}
      onChange={(value) => selectPlan(value === '' ? null : value)}
    />
  );
}
