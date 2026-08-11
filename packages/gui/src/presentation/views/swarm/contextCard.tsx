/**
 * Context Card
 *
 * @fileoverview Pick repo files whose contents attach to every member brief.
 * Tree comes from daemon `/api/tree` and serves only the pointed repo.
 * Selection lives in console state; the command bar's release carries it in
 * `RunSettings.context`, and the `--context` line below shows the same selection
 * as a CLI argument for a manually run herd. The two paths read one selection.
 *
 * @module @paw/gui/presentation/views/swarm/contextCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useConsoleActions } from '../../../application/hooks/useConsoleActions.js';
import { useContextSelection } from '../../../application/hooks/useConsole.js';
import { useTree } from '../../../application/hooks/useTree.js';
import { useTreeSource } from '../../../application/context/consoleContext.js';
import { contextArgument } from '../../../domain/context.js';
import { Button } from '../../atoms/button.js';
import { Card } from '../../atoms/card.js';
import { FileTreeSelect } from '../../atoms/fileTreeSelect.js';
import { Placeholder } from '../../atoms/placeholder.js';

/**
 * Attached-context picker.
 *
 * @returns {JSX.Element} The card.
 */
export function ContextCard() {
  const selected = useContextSelection();
  const { toggleContext, clearContext } = useConsoleActions();
  const { tree, loading, error, available } = useTree(useTreeSource());

  const meta = selected.length === 0 ? 'nothing attached' : `${selected.length} attached`;

  if (!available) {
    return (
      <Card title='Attached context' meta={meta}>
        <Placeholder>— a running pawd serves the repository tree —</Placeholder>
      </Card>
    );
  }

  return (
    <Card title='Attached context' meta={meta}>
      <div className='pad'>
        {error !== null && (
          <p className='banner' role='alert'>
            <span className='lead'>tree unavailable</span>
            <span className='detail'>{error}</span>
          </p>
        )}
        <FileTreeSelect
          tree={tree}
          selected={selected}
          onToggle={toggleContext}
          loading={loading}
        />
        {selected.length > 0 && (
          <>
            <ul className='chips'>
              {selected.map((path) => (
                <li key={path}>
                  <button
                    type='button'
                    className='chip idle'
                    onClick={() => toggleContext([path])}
                    aria-label={`Detach ${path}`}>
                    <span className='d' />
                    {path} ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className='srcline'>
              <span>run it with</span>
              <code>{contextArgument(selected)}</code>
              <Button align='push' onClick={clearContext}>
                clear
              </Button>
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
