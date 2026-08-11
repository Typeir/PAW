/**
 * State Chip Atom
 *
 * @fileoverview Pill carry member state in herd. State-to-colour and label map
 * live here alone. `running` show amber and blink in every place member state
 * show. Nowhere else get own idea what failure look like.
 *
 * @module @paw/gui/presentation/atoms/stateChip
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { MemberViewState } from '@paw/core';

/**
 * Chip class and label for each member state.
 */
const CHIP: Record<MemberViewState, { readonly cls: string; readonly label: string }> = {
  done: { cls: 'done', label: 'done' },
  skipped: { cls: 'idle', label: 'skip' },
  running: { cls: 'run', label: 'run' },
  failed: { cls: 'fail', label: 'fail' },
};

/**
 * Props for {@link StateChip}.
 *
 * @interface StateChipProps
 * @property {MemberViewState} state - Member state to show.
 */
export interface StateChipProps {
  readonly state: MemberViewState;
}

/**
 * Member-state pill.
 *
 * @param {StateChipProps} props - Chip props.
 * @returns {JSX.Element} Chip.
 */
export function StateChip({ state }: StateChipProps) {
  const chip = CHIP[state];
  return (
    <span className={`chip ${chip.cls}`}>
      <span className='d' />
      {chip.label}
    </span>
  );
}
