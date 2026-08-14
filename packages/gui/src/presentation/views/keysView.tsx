/**
 * Keys view.
 *
 * @fileoverview Provider and binding roster. Providers come key-free from
 * `/api/providers` — name, wire type, endpoint, default model, and the
 * credential's length only; a broken env file shows its parse reason. Bindings
 * come from `/api/config`. A static page has no client and renders the
 * placeholder.
 *
 * @module @paw/gui/presentation/views/keysView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useEffect, useState } from 'react';
import { useConfigClient } from '../../application/context/consoleContext.js';
import type { ConfigBindings, ProviderRow } from '../../infrastructure/configClient.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * One provider row: identity columns, or the parse failure.
 *
 * @param {{ row: ProviderRow }} props - The row.
 * @returns {JSX.Element} Table row.
 */
function Provider({ row }: { readonly row: ProviderRow }) {
  if (row.error !== undefined) {
    return (
      <tr>
        <td>{row.name}</td>
        <td className='crit' colSpan={4}>
          {row.error}
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{row.name}</td>
      <td>{row.type}</td>
      <td className='dim'>{row.baseUrl}</td>
      <td>{row.model ?? '—'}</td>
      <td className='dim'>{`hidden · ${row.keyChars} chars`}</td>
    </tr>
  );
}

/**
 * Providers and model bindings.
 *
 * @returns {JSX.Element} View.
 */
export function KeysView() {
  const client = useConfigClient();
  const [roster, setRoster] = useState<readonly ProviderRow[] | null>(null);
  const [bindings, setBindings] = useState<ConfigBindings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client !== null) {
      void client.providers().then(setRoster, () => setError('could not read the provider roster'));
      void client.bindings().then(setBindings, () => setError('could not read the bindings'));
    }
  }, [client]);

  return (
    <>
      <Crumb title='Keys' sub='.paw/*.provider.env · .paw/config.json' />
      {error !== null && <p className='ok crit'>{error}</p>}
      <Card title='Providers' meta={roster === null ? '' : `${roster.length} configured`}>
        {roster === null || roster.length === 0 ? (
          <Placeholder>
            {client === null
              ? '— a live daemon backs this view —'
              : roster === null
                ? '— reading —'
                : '— no .paw/*.provider.env in this repository —'}
          </Placeholder>
        ) : (
          <table className='keytable'>
            <thead>
              <tr>
                <th>provider</th>
                <th>wire</th>
                <th>endpoint</th>
                <th>default model</th>
                <th>key</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <Provider key={row.name} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title='Bindings' meta='.paw/config.json'>
        {bindings === null ? (
          <Placeholder>
            {client === null ? '— a live daemon backs this view —' : '— reading —'}
          </Placeholder>
        ) : (
          <dl className='keybindings'>
            <dt>models</dt>
            <dd>{bindings.models.length === 0 ? '—' : bindings.models.join(' · ')}</dd>
            {Object.entries(bindings.roles).map(([role, model]) => (
              <div key={role} className='keyrole'>
                <dt>{role}</dt>
                <dd>{model}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </>
  );
}
