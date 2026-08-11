/**
 * Context Card Tests
 *
 * @fileoverview Card turns selected files into a `--context` argument passed to
 * a thing operator run. Browse daemon tree, hold selection in console state,
 * print `--context` argument when a selection exists, show a message when no
 * daemon answers or tree fails to load.
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
 * Mount card with the given tree source.
 *
 * @param {TreeSource} source - Source that serves the tree.
 * @param {PawSnapshot} [snapshot] - Snapshot to boot from.
 * @returns {ReturnType<typeof render>} Render result.
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

  it('shows an alert when the tree fails to load', async () => {
    renderCard(async () => {
      throw new Error('connection refused');
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('tree unavailable');
    expect(alert).toHaveTextContent('connection refused');
  });
});
