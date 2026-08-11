/**
 * Code Card
 *
 * @fileoverview Displays the swarm plan module from disk in a highlighted code block. The plan's `brief` sets the instructions given to every member.
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
 * Reads the plan's stored source text and renders it in a code block.
 *
 * @returns {JSX.Element} Card.
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
