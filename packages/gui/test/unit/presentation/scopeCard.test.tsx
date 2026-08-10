/**
 * Scope Card Tests
 *
 * @fileoverview The scope picker rendered over a live console: it lists the
 * routes it fetched, grabs a typed route and a clicked recent one as real scope
 * frames on the wire, ignores a blank route, reports a read failure, and shows a
 * placeholder when nothing has been grabbed. A page with no daemon behind it
 * renders nothing at all. So `scopeCard.tsx` reaches 100%.
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

/** A recent-routes client whose list is set per test. */
const recentClient = (over: Partial<RecentClient> = {}): RecentClient => ({
  list: async () => ['/work/a', '/work/b'],
  ...over,
});

/**
 * Render the card over a console driven to `live`, so a grab is a real frame.
 *
 * @param {RecentClient} recent - The recent-routes client.
 * @returns {{ sent: string[] }} The frames the socket received.
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

/** The path from the last frame the socket received. */
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

  it('grabs a typed route as a scope frame', async () => {
    const { sent } = renderLive(recentClient());
    await screen.findByRole('button', { name: '/work/a' });
    await userEvent.type(screen.getByLabelText('Repository to grab'), '/work/new');
    await userEvent.click(screen.getByRole('button', { name: 'Grab' }));
    expect(lastScope(sent)).toEqual({ v: 1, type: 'scope', path: '/work/new' });
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
});
