/**
 * Connectors view.
 *
 * @fileoverview Connector catalogue with each entry's enabled state and a
 * toggle. Toggling writes `.paw/config.json` through the daemon, so it needs
 * `--control`; a refusal shows the daemon's reason.
 *
 * @module @paw/gui/presentation/views/connectorsView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useEffect, useState } from 'react';
import { useConfigClient } from '../../application/context/consoleContext.js';
import type { ConnectorRow } from '../../infrastructure/configClient.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Catalogue of connectors, with a toggle per row.
 *
 * @returns {JSX.Element} View.
 */
export function ConnectorsView() {
  const client = useConfigClient();
  const [roster, setRoster] = useState<readonly ConnectorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (client !== null) {
      void client.connectors().then(setRoster, () => setError('could not read the connectors'));
    }
  }, [client]);

  useEffect(load, [load]);

  const toggle = (row: ConnectorRow): void => {
    if (client === null) {
      return;
    }
    setBusy(row.id);
    setError(null);
    void client.setConnector(row.id, !row.enabled).then((result) => {
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
      <Crumb title='Connectors' sub='.paw/config.json' />
      {error !== null && <p className='ok crit'>{error}</p>}
      <Card
        title='Catalogue'
        meta={roster === null ? '' : `${enabled} of ${roster.length} enabled`}>
        {roster === null || roster.length === 0 ? (
          <Placeholder>
            {client === null ? '— a live daemon backs this view —' : '— reading —'}
          </Placeholder>
        ) : (
          <ul className='connlist'>
            {roster.map((row) => (
              <li key={row.id} className={row.enabled ? 'connrow on' : 'connrow'}>
                <span className='conndot' aria-hidden='true' />
                <span className='connname'>{row.id}</span>
                <span className='connkind'>{row.kind}</span>
                <span className='conndesc'>{row.description}</span>
                <button
                  type='button'
                  className='btn'
                  disabled={busy === row.id}
                  aria-pressed={row.enabled}
                  onClick={() => toggle(row)}>
                  {row.enabled ? 'disable' : 'enable'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
