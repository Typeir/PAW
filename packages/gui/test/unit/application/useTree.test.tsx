/**
 * Tree Loading Tests
 *
 * @fileoverview Tree hook have three state — no daemon, load in flight, load
 * failed. Guarantee: tree arrive after panel close update nothing.
 *
 * @module @paw/gui/test/unit/application/useTree
 */

import type { TreeNode } from '@paw/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTree } from '../../../src/application/hooks/useTree.js';
import type { TreeSource } from '../../../src/infrastructure/snapshotSource.js';

const TREE: TreeNode[] = [{ name: 'a.md', path: 'a.md', isFile: true, children: [] }];

/**
 * Props for {@link Probe}.
 *
 * @interface ProbeProps
 * @property {TreeSource | null} source - Source under test.
 */
interface ProbeProps {
  readonly source: TreeSource | null;
}

/**
 * Probe show what hook report.
 *
 * @param {ProbeProps} props - Probe props.
 * @returns {JSX.Element} The probe.
 */
function Probe({ source }: ProbeProps) {
  const { tree, loading, error, available } = useTree(source);
  return (
    <div>
      <span data-testid='paths'>{tree.map((n) => n.path).join(',')}</span>
      <span data-testid='loading'>{String(loading)}</span>
      <span data-testid='error'>{error ?? 'none'}</span>
      <span data-testid='available'>{String(available)}</span>
    </div>
  );
}

describe('useTree', () => {
  it('asks nothing when there is no daemon behind the page', () => {
    render(<Probe source={null} />);
    expect(screen.getByTestId('available')).toHaveTextContent('false');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('paths')).toHaveTextContent('');
  });

  it('loads the tree once and reports it', async () => {
    const source = vi.fn(async () => TREE);
    render(<Probe source={source} />);
    await waitFor(() => expect(screen.getByTestId('paths')).toHaveTextContent('a.md'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed load and keeps the tree empty', async () => {
    render(
      <Probe
        source={async () => {
          throw new Error('connection refused');
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('connection refused'),
    );
    expect(screen.getByTestId('paths')).toHaveTextContent('');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('surfaces a non-Error rejection as text', async () => {
    render(<Probe source={async () => Promise.reject('socket closed')} />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('socket closed'));
  });

  it('ignores a tree that lands after the panel closed', async () => {
    let release: (nodes: TreeNode[]) => void = () => undefined;
    const view = render(
      <Probe
        source={async () =>
          new Promise<TreeNode[]>((resolve) => {
            release = resolve;
          })
        }
      />,
    );
    view.unmount();
    await act(async () => {
      release(TREE);
    });
    expect(screen.queryByTestId('paths')).toBeNull();
  });
});
