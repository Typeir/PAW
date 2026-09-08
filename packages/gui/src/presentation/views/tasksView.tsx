/**
 * Tasks view.
 *
 * @fileoverview The work-model graph the repository's `.paw/tasks.json`
 * describes, one row per task, indented by longest distance from a root. Each
 * row names its parents and children, so a task with two parents reads as one
 * row and not two. Edges the kernel refused are listed under the graph.
 *
 * @module @paw/gui/presentation/views/tasksView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useEffect, useState } from 'react';
import { useConfigClient } from '../../application/context/consoleContext.js';
import type { TaskGraphView } from '../../infrastructure/configClient.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

const INDENT_PX = 18;

/**
 * Ids as a list, or an em dash when there are none.
 *
 * @param {readonly string[]} ids - Task ids.
 * @returns {string} Rendered text.
 */
function edgeText(ids: readonly string[]): string {
  return ids.length === 0 ? '—' : ids.join(', ');
}

/**
 * The repository's task graph, with the edges the kernel refused.
 *
 * @returns {JSX.Element} View.
 */
export function TasksView() {
  const client = useConfigClient();
  const [view, setView] = useState<TaskGraphView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client !== null) {
      void client.tasks().then(setView, () => setError('could not read the task graph'));
    }
  }, [client]);

  if (client === null || view === null) {
    return (
      <>
        <Crumb title='Tasks' sub='.paw/tasks.json' />
        {error !== null && <p className='ok crit'>{error}</p>}
        <Card title='Graph'>
          <Placeholder>
            {client === null ? '— a live daemon backs this view —' : '— reading —'}
          </Placeholder>
        </Card>
      </>
    );
  }

  if (!view.enabled) {
    return (
      <>
        <Crumb title='Tasks' sub='.paw/tasks.json' />
        <Card title='Graph'>
          <Placeholder>
            — enable the paw-agile module to read this repository&rsquo;s tasks —
          </Placeholder>
        </Card>
      </>
    );
  }

  return (
    <>
      <Crumb title='Tasks' sub='.paw/tasks.json' />
      <Card title='Graph' meta={`${view.rows.length} tasks`}>
        {view.rows.length === 0 ? (
          <Placeholder>— this repository describes no tasks —</Placeholder>
        ) : (
          <ul className='tasklist'>
            {view.rows.map((row) => (
              <li
                key={row.id}
                className={row.parents.length > 1 ? 'taskrow converged' : 'taskrow'}
                style={{ paddingLeft: `${10 + row.depth * INDENT_PX}px` }}>
                <span className='taskdot' aria-hidden='true' />
                <span className='taskid'>{row.id}</span>
                <span className='tasktitle'>
                  {row.title}
                  {row.orphan && <em className='taskorphan'> orphan</em>}
                </span>
                <span className='taskedge' title='parents'>
                  ↑ {edgeText(row.parents)}
                </span>
                <span className='taskedge' title='children'>
                  ↓ {edgeText(row.children)}
                </span>
                <span className='taskroll'>{row.rollup}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {view.loops.length > 0 && (
        <Card title='Loops' meta={`${view.loops.length} declared, not walked`}>
          <ul className='refusallist loops'>
            {view.loops.map((edge) => (
              <li key={`${edge.parent}->${edge.child}`}>
                {edge.parent} → {edge.child}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view.dangling.length > 0 && (
        <Card title='Dangling' meta={`${view.dangling.length} naming an absent task`}>
          <ul className='refusallist loops'>
            {view.dangling.map((edge) => (
              <li key={`${edge.parent}->${edge.child}`}>
                {edge.parent} → {edge.child}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view.refusals.length > 0 && (
        <Card title='Refused' meta={`${view.refusals.length}`}>
          <ul className='refusallist'>
            {view.refusals.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
