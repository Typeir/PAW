/**
 * State Chip Atom
 *
 * @fileoverview The pill that carries a member's state in the herd. The mapping
 * from state to colour and label lives here alone, so `running` is amber and
 * blinking in every place a member state is shown and nowhere gets its own idea
 * of what failure looks like.
 *
 * @module @paw/gui/presentation/atoms/stateChip
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { MemberViewState } from '@paw/core';

/**
 * The chip class and label for each member state.
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
 * @property {MemberViewState} state - The member state to show.
 */
export interface StateChipProps {
  readonly state: MemberViewState;
}

/**
 * A member-state pill.
 *
 * @param {StateChipProps} props - The chip props.
 * @returns {JSX.Element} The chip.
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
