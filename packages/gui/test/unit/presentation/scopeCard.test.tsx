/**
 * Scope Card Test
 *
 * @fileoverview Scope picker over live console: list fetched routes, send grab
 * of typed route and clicked recent route as scope frame, show grabbed route
 * in recent list without reload, ignore blank route, report read failure, show
 * placeholder when nothing grabbed. Page with no daemon renders nothing.
 * Covers `scopeCard.tsx` at 100%.
 *
 * @module @paw/gui/test/unit/presentation/scopeCard
 */

import { encodeEnvelope, parseClientMessage } from '@paw/core';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import type { RecentClient } from '../../../src/infrastructure/recentClient.js';
import type { SocketHandlers, SocketLike } from '../../../src/infrastructure/liveSocket.js';
import { ScopeCard } from '../../../src/presentation/views/scopeCard.js';
import { makeSnapshot } from '../../fixtures.js';

/** Recent-routes client. List set per test. */
const recentClient = (over: Partial<RecentClient> = {}): RecentClient => ({
  list: async () => ['/work/a', '/work/b'],
  remove: async (route) => ['/work/a', '/work/b'].filter((entry) => entry !== route),
  ...over,
});

/**
 * Render card over a console connected to `live`, so a grab sends a scope frame.
 *
 * @param {RecentClient} recent - Recent-routes client.
 * @returns {{ sent: string[] }} Frames socket received.
 */
function renderLive(recent: RecentClient): { sent: string[] } {
  const sent: string[] = [];
  let handlers: SocketHandlers | null = null;
  const socket: SocketLike = {
    send: (text: string) => sent.push(text),
    close: () => undefined,
    listen: (registered) => {
      handlers = registered;
    },
  };
  render(
    <ConsoleProvider snapshot={makeSnapshot()} connect={() => socket} token='cred' recent={recent}>
      <ScopeCard />
    </ConsoleProvider>,
  );
  act(() => handlers?.open());
  act(() => handlers?.message(encodeEnvelope('hello', makeSnapshot(), 1)));
  return { sent };
}

/** Path from last frame socket received. */
const lastScope = (sent: string[]): unknown => parseClientMessage(sent[sent.length - 1]);

describe('ScopeCard', () => {
  it('renders nothing on a static page with no daemon', () => {
    const { container } = render(
      <ConsoleProvider snapshot={makeSnapshot()}>
        <ScopeCard />
      </ConsoleProvider>,
    );
    expect(container.querySelector('.scope-grab')).toBeNull();
  });

  it('lists the recently-grabbed routes', async () => {
    renderLive(recentClient());
    expect(await screen.findByRole('button', { name: '/work/a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '/work/b' })).toBeInTheDocument();
  });

  it('pips the route matching the current scope, not the newest', async () => {
    // Fixture snapshot scoped to C:\code\demo. List it second to prove the pip
    // follows scope.
    renderLive(recentClient({ list: async () => ['/work/other', 'C:\\code\\demo'] }));
    const current = await screen.findByRole('button', { name: 'C:\\code\\demo' });
    const other = screen.getByRole('button', { name: '/work/other' });
    expect(current.querySelector('.scope-dot')).toHaveClass('here');
    expect(other.querySelector('.scope-dot')).not.toHaveClass('here');
  });

  it('disables grabbing until the console has a live connection', async () => {
    render(
      <ConsoleProvider snapshot={makeSnapshot()} recent={recentClient()}>
        <ScopeCard />
      </ConsoleProvider>,
    );
    expect(await screen.findByRole('button', { name: '/work/a' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grab' })).toBeDisabled();
    expect(screen.getByLabelText('Repository to grab')).toBeDisabled();
    expect(screen.getByText('grab needs a live connection')).toBeInTheDocument();
  });

  it('grabs a typed route as a scope frame', async () => {
    const { sent } = renderLive(recentClient());
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.type(screen.getByLabelText('Repository to grab'), '/work/new');
    await userEvent.click(screen.getByRole('button', { name: 'Grab' }));
    expect(lastScope(sent)).toEqual({ v: 1, type: 'scope', path: '/work/new' });
  });

  it('adds a grabbed route to the recent list without a reload', async () => {
    renderLive(recentClient());
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.type(screen.getByLabelText('Repository to grab'), '/work/fresh');
    await userEvent.click(screen.getByRole('button', { name: 'Grab' }));
    expect(await screen.findByRole('button', { name: '/work/fresh' })).toBeInTheDocument();
  });

  it('grabs a recent route when it is clicked', async () => {
    const { sent } = renderLive(recentClient());
    await userEvent.click(await screen.findByRole('button', { name: '/work/a' }));
    expect(lastScope(sent)).toEqual({ v: 1, type: 'scope', path: '/work/a' });
  });

  it('grabs on Enter in the route field', async () => {
    const { sent } = renderLive(recentClient());
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.type(screen.getByLabelText('Repository to grab'), '/work/typed{Enter}');
    expect(lastScope(sent)).toEqual({ v: 1, type: 'scope', path: '/work/typed' });
  });

  it('does not grab a blank route', async () => {
    const { sent } = renderLive(recentClient({ list: async () => [] }));
    await screen.findByText('— no recent routes —');
    const before = sent.length;
    await userEvent.click(screen.getByRole('button', { name: 'Grab' }));
    expect(sent).toHaveLength(before);
  });

  it('reports why the recent routes could not be read', async () => {
    renderLive(
      recentClient({
        list: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(await screen.findByText('could not read the recent routes')).toBeInTheDocument();
  });

  it('shows a placeholder when nothing has been grabbed yet', async () => {
    renderLive(recentClient({ list: async () => [] }));
    expect(await screen.findByText('— no recent routes —')).toBeInTheDocument();
  });

  it('refuses a relative route with a reason, sending no frame', async () => {
    const { sent } = renderLive(recentClient({ list: async () => [] }));
    await screen.findByText('— no recent routes —');
    const before = sent.length;
    await userEvent.type(screen.getByLabelText('Repository to grab'), 'repo/sub{Enter}');
    expect(await screen.findByText('route must be an absolute path')).toBeInTheDocument();
    expect(sent).toHaveLength(before);
  });

  it('removes a route through the client and shows the shrunken list', async () => {
    renderLive(recentClient());
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove /work/a from recent routes' }));
    expect(await screen.findByRole('button', { name: '/work/b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '/work/a' })).toBeNull();
  });

  it('reports when a route cannot be removed', async () => {
    renderLive(
      recentClient({
        remove: async () => {
          throw new Error('offline');
        },
      }),
    );
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove /work/b from recent routes' }));
    expect(await screen.findByText('could not remove the route')).toBeInTheDocument();
  });
});
