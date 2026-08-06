/**
 * Herd Tab
 *
 * @fileoverview One row per dispatched member, and what a run has spent. The
 * member cell is a real button, so choosing one scrubs the Plan tab's editor to
 * that member from a mouse, a keyboard, or a screen reader without a line of
 * hand-rolled key handling — a failure in the herd is one press from the brief
 * that produced it. Before a release the table is empty and the budget reads
 * zero: the daemon reports what happened, and nothing has.
 *
 * @module @paw/gui/presentation/views/swarm/herdTab
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleData } from '../../../application/hooks/useConsole.js';
import { useConsoleActions } from '../../../application/hooks/useConsoleActions.js';
import { Card } from '../../atoms/card.js';
import { DataTable, type Column } from '../../atoms/dataTable.js';
import { Figure } from '../../atoms/figure.js';
import { Placeholder } from '../../atoms/placeholder.js';
import { StateChip } from '../../atoms/stateChip.js';

const HERD_COLUMNS: readonly Column[] = [
  { key: 'idx', label: '#' },
  { key: 'member', label: 'member' },
  { key: 'level', label: 'level', right: true },
  { key: 'state', label: 'state' },
];

/**
 * The per-member herd table.
 *
 * @returns {JSX.Element} The card.
 */
function HerdTable() {
  const { run } = useConsoleData();
  const { select } = useConsoleActions();
  const meta = `${run.done} done · ${run.running} run · ${run.failed} fail`;
  if (run.members.length === 0) {
    return (
      <Card title='Herd' meta={meta}>
        <Placeholder>— no members dispatched yet —</Placeholder>
      </Card>
    );
  }
  return (
    <Card title='Herd' meta={meta}>
      <DataTable columns={HERD_COLUMNS}>
        {run.members.map((row) => (
          <tr key={row.member} className={row.state === 'running' ? 'running' : undefined}>
            <td className='idx'>{row.member}</td>
            <td className='path'>
              <button
                type='button'
                className='rowbtn'
                aria-label={`Select member ${row.member}, ${row.key}`}
                onClick={() => select(row.member)}>
                {row.key}
              </button>
            </td>
            <td className='r note'>{row.level === null ? '—' : `lvl ${row.level}`}</td>
            <td>
              <StateChip state={row.state} />
            </td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

/**
 * The run's spend.
 *
 * @returns {JSX.Element} The card.
 */
function BudgetCard() {
  const { budget } = useConsoleData();
  return (
    <Card title='Budget' meta='this run'>
      <div className='pad budget'>
        <Figure value={String(budget.tokensIn)} caption='tokens in' />
        <Figure value={String(budget.tokensOut)} caption='tokens out' />
        <Figure value={`$${budget.spendUsd.toFixed(2)}`} caption='spend' cost />
      </div>
    </Card>
  );
}

/**
 * The Herd tab.
 *
 * @returns {JSX.Element} The tab body.
 */
export function HerdTab() {
  return (
    <>
      <HerdTable />
      <BudgetCard />
    </>
  );
}
