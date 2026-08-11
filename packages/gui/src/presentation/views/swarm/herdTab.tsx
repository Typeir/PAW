/**
 * Herd Tab
 *
 * @fileoverview Row per dispatched member, and what run spend.
 *
 * Split three tables ordered by need: running first, then failed, then settled.
 * One table ordered by member index would sort a running row under done rows —
 * batch dispatch means members do not finish in dispatch order.
 *
 * A group with empty rows does not render.
 *
 * Member cell is a real button; selecting it opens Plan tab editor for that
 * member via keyboard or screen reader. Before any release nothing dispatches
 * and budget reads zero, matching the daemon report.
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
 * Three groups the herd renders in, read in order.
 *
 * `skipped` sits with `done`; both are settled states that need no
 * interaction — a member resumed from a previous run is not an issue.
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
 * One group table of members.
 *
 * @param {object} props - Group and rows.
 * @param {string} props.title - Group heading.
 * @param {readonly MemberView[]} props.rows - Member in this group.
 * @param {(member: number) => void} props.onSelect - Scrub Plan tab to member.
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
 * Per-member herd tables, grouped by attention state.
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
        <Placeholder>— no run released through this console · release with --run or swarm run --ui —</Placeholder>
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
 * The run spend.
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
