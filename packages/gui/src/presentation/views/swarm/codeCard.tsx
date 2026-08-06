/**
 * Code Card
 *
 * @fileoverview The plan module as it is on disk, highlighted. This is the
 * console's centrepiece: a swarm plan is a small program whose `brief` decides
 * what every member is told, and reading it next to the brief it produces is how
 * an author sees the branch a member fell down.
 *
 * @module @paw/gui/presentation/views/swarm/codeCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { usePlan, useSelectedPlan } from '../../../application/hooks/useConsole.js';
import { Card } from '../../atoms/card.js';
import { CodeBlock } from '../../atoms/codeBlock.js';

/**
 * The plan-source card.
 *
 * @returns {JSX.Element} The card.
 */
export function CodeCard() {
  const plan = usePlan();
  const selected = useSelectedPlan();
  return (
    <Card
      title={selected ?? `${plan.name}.swarm.mjs`}
      meta={`role ${plan.role} · ${plan.total} members`}>
      <CodeBlock
        source={plan.source}
        highlightLine={plan.highlightLine}
        label='Swarm plan source'
      />
    </Card>
  );
}
