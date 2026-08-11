/**
 * Pending view.
 *
 * @fileoverview Stand-in view rendered until daemon control API returns a
 * report for the subsystem. Lists the missing subsystems: Gates, Keys, log
 * stream. Renders placeholder text; daemon control API data replaces it.
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
 * @property {string} title - Name of subsystem.
 */
export interface PendingViewProps {
  readonly title: string;
}

/**
 * Subsystem wait on daemon control API.
 *
 * @param {PendingViewProps} props - View props.
 * @returns {JSX.Element} View.
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
