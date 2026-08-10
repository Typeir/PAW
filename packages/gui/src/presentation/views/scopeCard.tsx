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
 * The list is shown in a stable order, not by recency, and the green pip marks
 * whichever route matches the scope the snapshot reports — so grabbing one moves
 * the pip to it rather than reshuffling the list under a pip that never moves.
 *
 * @module @paw/gui/presentation/views/scopeCard
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { sameRoute } from '@paw/core';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useLiveStatus, useScope } from '../../application/context/consoleContext.js';
import { useConsoleData } from '../../application/hooks/useConsole.js';
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

  const shown = [...routes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
