/**
 * Pending View
 *
 * @fileoverview The honest stand-in for a subsystem the daemon does not yet
 * report — Gates, Keys, and the log stream. It says what is missing instead of
 * filling the panel with a convincing table, because a console that invents
 * gates is worse than one that admits it has none to show.
 *
 * @module @paw/gui/presentation/views/pendingView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Props for {@link PendingView}.
 *
 * @interface PendingViewProps
 * @property {string} title - The subsystem's name.
 */
export interface PendingViewProps {
  readonly title: string;
}

/**
 * A subsystem awaiting a daemon control API.
 *
 * @param {PendingViewProps} props - The view props.
 * @returns {JSX.Element} The view.
 */
export function PendingView({ title }: PendingViewProps) {
  return (
    <>
      <Crumb title={title} />
      <Card>
        <Placeholder>— {title} — a live pawd control API will back this view —</Placeholder>
      </Card>
    </>
  );
}
