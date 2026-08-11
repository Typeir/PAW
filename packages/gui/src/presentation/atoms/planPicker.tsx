/**
 * Plan Picker Atom
 *
 * @fileoverview Which repo plan console look at. One daemon serve one
 * workspace, so plan be selection here not launch argument — pick other,
 * re-read from disk on next poll, no restart, no second console. Ported
 * {@link Select} carry it: styled, filterable listbox that read to screen
 * reader and drive from keyboard, matching rest of console and retaining
 * native `<select>` accessibility.
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
 * Repo plan list, as picker.
 *
 * @returns {JSX.Element} The picker, or note when repo hold no plans.
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
