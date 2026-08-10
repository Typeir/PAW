/**
 * Scope Card
 *
 * @fileoverview Grab a repository for the one console to look at: type a route
 * and grab it, or pick one the console grabbed before. A route is a place PAW may
 * be installed, not a daemon that is running, so the recent list carries no
 * liveness — grabbing one with no resident pawd still shows its files and simply
 * reports no enforcement. The grab is a live-wire frame; a page with no daemon
 * behind it has no client and the card renders nothing.
 *
 * @module @paw/gui/presentation/views/scopeCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { promoteRoute } from '@paw/core';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useScope } from '../../application/context/consoleContext.js';
import { Button } from '../atoms/button.js';
import { Card } from '../atoms/card.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * The scope picker: a route input and the recently-grabbed routes.
 *
 * @returns {JSX.Element | null} The card, or null on a static page with no daemon.
 */
export function ScopeCard() {
  const { recent: client, grab } = useScope();
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
    setRoutes((current) => promoteRoute(current, path));
  };

  const submit = (): void => {
    const path = draft.trim();
    if (path !== '') {
      grabRoute(path);
      setDraft('');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      submit();
    }
  };

  return (
    <Card title='Scope' meta='grab a repository'>
      <div className='pad'>
        {error !== null && <p className='ok crit'>{error}</p>}
        <div className='scope-grab'>
          <input
            className='scope-route'
            aria-label='Repository to grab'
            placeholder='path to a repository'
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button primary onClick={submit}>
            Grab
          </Button>
        </div>
        {routes.length === 0 ? (
          <Placeholder>— no recent routes —</Placeholder>
        ) : (
          <ul className='scope-recent'>
            {routes.map((route) => (
              <li key={route}>
                <button
                  type='button'
                  className='scope-recent-item'
                  onClick={() => grabRoute(route)}
                >
                  {route}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
