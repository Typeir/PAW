/**
 * Context Card Tests
 *
 * @fileoverview The card that turns a file selection into something an operator
 * can run: it browses the daemon's tree, holds the selection in console state,
 * prints the `--context` argument that reproduces it, and says plainly when
 * there is no daemon to ask or the tree could not be fetched.
 *
 * @module @paw/gui/test/unit/presentation/contextCard
 */

import type { PawSnapshot, TreeNode } from '@paw/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import type { TreeSource } from '../../../src/infrastructure/snapshotSource.js';
import { ContextCard } from '../../../src/presentation/views/swarm/contextCard.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

const TREE: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    isFile: false,
    children: [{ name: 'a.ts', path: 'src/a.ts', isFile: true, children: [] }],
  },
  { name: 'style.md', path: 'style.md', isFile: true, children: [] },
];

/**
 * Mount the card with a tree source behind it.
 *
 * @param {TreeSource} source - The source to serve the tree.
 * @param {PawSnapshot} [snapshot] - The snapshot to boot from.
 * @returns {ReturnType<typeof render>} The render result.
 */
function renderCard(source: TreeSource, snapshot: PawSnapshot = makeSnapshot()) {
  return render(
    <ConsoleProvider snapshot={snapshot} treeSource={source}>
      <ContextCard />
    </ConsoleProvider>,
  );
}

describe('ContextCard', () => {
  it('says there is nothing to browse without a daemon', () => {
    renderInConsole(<ContextCard />);
    expect(screen.getByText('— a running pawd serves the repository tree —')).toBeInTheDocument();
    expect(screen.getByText('nothing attached')).toBeInTheDocument();
  });

  it('browses the daemon’s tree and attaches a file', async () => {
    const user = userEvent.setup();
    renderCard(async () => TREE);

    await waitFor(() => expect(screen.getByRole('button', { name: /Select files/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByLabelText('Attach style.md'));

    expect(screen.getByText('1 attached')).toBeInTheDocument();
    expect(screen.getByText('--context style.md')).toBeInTheDocument();
  });

  it('detaches a file from its chip and clears the whole selection', async () => {
    const user = userEvent.setup();
    renderCard(async () => TREE);
    await waitFor(() => expect(screen.getByRole('button', { name: /Select files/ })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByLabelText('Attach everything in src'));
    await user.click(screen.getByLabelText('Attach style.md'));
    expect(screen.getByText('2 attached')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detach style.md' }));
    expect(screen.getByText('1 attached')).toBeInTheDocument();
    expect(screen.getByText('--context src/a.ts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByText('nothing attached')).toBeInTheDocument();
  });

  it('says the tree is unavailable rather than showing an empty repository', async () => {
    renderCard(async () => {
      throw new Error('connection refused');
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('tree unavailable');
    expect(alert).toHaveTextContent('connection refused');
  });
});
