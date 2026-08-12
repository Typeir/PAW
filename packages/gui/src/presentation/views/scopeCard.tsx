/**
 * Scope Card
 *
 * @fileoverview Console entry to grab a repository by route and pick a route
 * grabbed before. A route names where PAW may live, not a running daemon, so the
 * recent list carries no liveness; grabbing a route with no resident pawd still
 * shows files and reports no enforcement. Grabbing requires a live connection; a
 * page with no daemon behind it has no client and the card renders null.
 *
 * The list displays sorted by route, independent of recency. The green pip marks
 * whichever route matches the scope snapshot report; grabbing a route moves the
 * pip there without changing the list order.
 *
 * @module @paw/gui/presentation/views/scopeCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { isAbsoluteRoute, sameRoute } from '@paw/core';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useLiveStatus, useScope } from '../../application/context/consoleContext.js';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { Button } from '../atoms/button.js';
import { Card } from '../atoms/card.js';
import { CloseLight } from '../atoms/closeLight.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Scope picker: route input and recently-grabbed routes.
 *
 * @returns {JSX.Element | null} The card, or null on static page with no daemon.
 */
export function ScopeCard() {
  const { recent: client, grab } = useScope();
  const { mode } = useLiveStatus();
  const { root } = useConsoleData();
  const live = mode === 'live';
  const [routes, setRoutes] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client !== null) {
      void client.list().then(setRoutes, () => setError('could not read the recent routes'));
    }
  }, [client]);

  if (client === null) {
    return null;
  }

  const grabRoute = (path: string): void => {
    grab(path);
    setRoutes((current) =>
      current.some((entry) => sameRoute(entry, path)) ? current : [...current, path],
    );
  };

  const forget = (path: string): void => {
    void client
      .remove(path)
      .then(setRoutes, () => setError('could not remove the route'));
  };

  const shown = [...routes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const submit = (): void => {
    const path = draft.trim();
    if (path === '') {
      return;
    }
    if (!isAbsoluteRoute(path)) {
      setError('route must be an absolute path');
      return;
    }
    setError(null);
    grabRoute(path);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      submit();
    }
  };

  return (
    <Card variant='scope' title='Scope' meta={live ? 'grab a repository' : 'grab needs a live connection'}>
      <div className='pad'>
        {error !== null && <p className='ok crit'>{error}</p>}
        <div className='scope-grab'>
          <input
            className='scope-route'
            aria-label='Repository to grab'
            placeholder='path to a repository'
            value={draft}
            disabled={!live}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button primary disabled={!live} onClick={submit}>
            Grab
          </Button>
        </div>
        {shown.length === 0 ? (
          <Placeholder>— no recent routes —</Placeholder>
        ) : (
          <ul className='scope-recent'>
            {shown.map((route) => {
              const here = sameRoute(route, root);
              return (
                <li key={route}>
                  <button
                    type='button'
                    className='scope-recent-item'
                    disabled={!live}
                    aria-current={here ? 'true' : undefined}
                    onClick={() => grabRoute(route)}
                  >
                    <span className={here ? 'scope-dot here' : 'scope-dot'} aria-hidden='true' />
                    {route}
                  </button>
                  <CloseLight
                    small
                    className='scope-remove'
                    label={`Remove ${route} from recent routes`}
                    onClick={() => forget(route)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
