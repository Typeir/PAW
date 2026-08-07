/**
 * Herd Tab
 *
 * @fileoverview One row per dispatched member, and what a run has spent.
 *
 * Split into three tables rather than one, ordered by what an operator needs to
 * see: what is still running, then what failed, then what settled. A single
 * table ordered by member index buries the two rows somebody is actually
 * watching among ninety that already worked — and a batch dispatch makes that
 * worse, because members no longer finish in order.
 *
 * A group with nothing in it is not rendered at all: an empty "failed" table is
 * a quiet lie about how much there is to look at.
 *
 * The member cell is a real button, so choosing one scrubs the Plan tab's editor
 * to that member from a mouse, a keyboard, or a screen reader without a line of
 * hand-rolled key handling — a failure in the herd is one press from the brief
 * that produced it. Before a release nothing is dispatched and the budget reads
 * zero: the daemon reports what happened, and nothing has.
 *
 * @module @paw/gui/presentation/views/swarm/herdTab
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { MemberView, MemberViewState } from '@paw/core';
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
 * The three groups the herd is shown in, in the order they are read.
 *
 * `skipped` sits with `done` because both are settled and neither wants
 * attention — a member resumed from a previous run is not a problem to solve.
 */
const GROUPS: readonly {
  readonly id: string;
  readonly title: string;
  readonly states: readonly MemberViewState[];
}[] = [
  { id: 'running', title: 'In progress', states: ['running'] },
  { id: 'failed', title: 'Failed', states: ['failed'] },
  { id: 'settled', title: 'Settled', states: ['done', 'skipped'] },
];

/**
 * One group's table of members.
 *
 * @param {object} props - The group and its rows.
 * @param {string} props.title - The group's heading.
 * @param {readonly MemberView[]} props.rows - Members in this group.
 * @param {(member: number) => void} props.onSelect - Scrub the Plan tab to a member.
 * @returns {JSX.Element} The group.
 */
function HerdGroup({
  title,
  rows,
  onSelect,
}: {
  readonly title: string;
  readonly rows: readonly MemberView[];
  readonly onSelect: (member: number) => void;
}) {
  return (
    <section className='herd-group' aria-label={`${title}, ${rows.length} member(s)`}>
      <h4 className='herd-group-title'>
        {title} <span className='herd-group-count'>{rows.length}</span>
      </h4>
      <DataTable columns={HERD_COLUMNS}>
        {rows.map((row) => (
          <tr
            key={row.member}
            className={row.state === 'running' ? 'running' : undefined}>
            <td className='idx'>{row.member}</td>
            <td className='path'>
              <button
                type='button'
                className='rowbtn'
                aria-label={`Select member ${row.member}, ${row.key}`}
                onClick={() => onSelect(row.member)}>
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
    </section>
  );
}

/**
 * The per-member herd tables, grouped by what needs attention first.
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

  const groups = GROUPS.map((group) => ({
    ...group,
    rows: run.members.filter((row) => group.states.includes(row.state)),
  })).filter((group) => group.rows.length > 0);

  return (
    <Card title='Herd' meta={meta}>
      <div className='herd-groups'>
        {groups.map((group) => (
          <HerdGroup
            key={group.id}
            title={group.title}
            rows={group.rows}
            onSelect={select}
          />
        ))}
      </div>
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
