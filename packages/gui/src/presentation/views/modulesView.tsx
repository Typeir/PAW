/**
 * Modules view.
 *
 * @fileoverview Module catalogue as a bento grid, one tile per module: enabled
 * state, whether the package resolves, and the connectors it carries. Toggling
 * writes `.paw/config.json` through the daemon, so a daemon started `--read-only`
 * refuses it; a refusal shows the daemon's reason.
 *
 * @module @paw/gui/presentation/views/modulesView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useEffect, useState } from 'react';
import { useConfigClient } from '../../application/context/consoleContext.js';
import type { ModuleRow } from '../../infrastructure/configClient.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Tile classes for one module's enabled and resolved state.
 *
 * @param {ModuleRow} row - The module.
 * @returns {string} Class list.
 */
function tileClass(row: ModuleRow): string {
  return ['bentotile', row.enabled ? 'on' : '', row.resolved ? 'ready' : '']
    .filter((token) => token !== '')
    .join(' ');
}

/**
 * Catalogue of federated modules, one tile each.
 *
 * @returns {JSX.Element} View.
 */
export function ModulesView() {
  const client = useConfigClient();
  const [roster, setRoster] = useState<readonly ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (client !== null) {
      void client.modules().then(setRoster, () => setError('could not read the modules'));
    }
  }, [client]);

  useEffect(load, [load]);

  const toggle = (row: ModuleRow): void => {
    if (client === null) {
      return;
    }
    setBusy(row.id);
    setError(null);
    void client.setModule(row.id, !row.enabled).then((result) => {
      setBusy(null);
      if (result.ok) {
        load();
        return;
      }
      setError(result.reason ?? 'refused');
    });
  };

  const enabled = roster === null ? 0 : roster.filter((row) => row.enabled).length;

  return (
    <>
      <Crumb title='Modules' sub='.paw/config.json' />
      {error !== null && <p className='ok crit'>{error}</p>}
      <Card title='Catalogue' meta={roster === null ? '' : `${enabled} of ${roster.length} enabled`}>
        {roster === null || roster.length === 0 ? (
          <Placeholder>
            {client === null ? '— a live daemon backs this view —' : '— reading —'}
          </Placeholder>
        ) : (
          <ul className='bento'>
            {roster.map((row) => (
              <li key={row.id} className={tileClass(row)}>
                <div className='bentohead'>
                  <span className='bentodot' aria-hidden='true' />
                  <h3 className='bentoname'>{row.id}</h3>
                  <span className='bentostate'>
                    {row.resolved ? 'installed' : 'not installed'}
                  </span>
                </div>
                <p className='bentodesc'>{row.description}</p>
                <div className='bentofoot'>
                  {row.requiredBy.length === 0 ? (
                    <span className='bentonone'>carries nothing</span>
                  ) : (
                    <ul className='bentocarries' aria-label={`connectors ${row.id} carries`}>
                      {row.requiredBy.map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type='button'
                    className='btn'
                    disabled={busy === row.id}
                    aria-pressed={row.enabled}
                    onClick={() => toggle(row)}>
                    {row.enabled ? 'disable' : 'enable'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
