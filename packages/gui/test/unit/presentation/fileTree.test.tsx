/**
 * File tree tests
 *
 * @fileoverview The ported selector, as operator use it: open dropdown,
 * expand folder, check file, check folder to take everything under it,
 * and watch half-chosen folder read half-chosen. Also ways dropdown
 * close — outside click and Escape — and way it not: choosing file
 * leave it open, because attach context multi-step act.
 *
 * @module @paw/gui/test/unit/presentation/fileTree
 */

import type { TreeNode } from '@paw/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FileTreeSelect } from '../../../src/presentation/atoms/fileTreeSelect.js';
import { toggleContext } from '../../../src/domain/context.js';

const TREE: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    isFile: false,
    children: [
      { name: 'a.ts', path: 'src/a.ts', isFile: true, children: [] },
      { name: 'b.ts', path: 'src/b.ts', isFile: true, children: [] },
    ],
  },
  { name: 'README.md', path: 'README.md', isFile: true, children: [] },
];

/**
 * Selector wired to real selection state; tests cover the same toggleContext
 * logic the console uses.
 *
 * @returns {JSX.Element} The harness.
 */
function Harness() {
  const [selected, setSelected] = useState<readonly string[]>([]);
  return (
    <>
      <FileTreeSelect
        tree={TREE}
        selected={selected}
        onToggle={(paths) => setSelected((prev) => toggleContext(prev, paths))}
      />
      <span data-testid='selection'>{selected.join(',')}</span>
    </>
  );
}

describe('FileTreeSelect', () => {
  it('summarises the selection on the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Select files/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByLabelText('Attach README.md'));
    expect(screen.getByRole('button', { name: /1 file\(s\) attached/ })).toBeInTheDocument();
  });

  it('stays open while an operator works through it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByLabelText('Attach README.md'));
    expect(screen.getByRole('list', { name: 'Repository files' })).toBeInTheDocument();
  });

  it('expands a folder to reveal its files, and collapses it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    expect(screen.queryByLabelText('Attach src/a.ts')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand src' }));
    expect(screen.getByLabelText('Attach src/a.ts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse src' }));
    expect(screen.queryByLabelText('Attach src/a.ts')).toBeNull();
  });

  it('takes a whole folder in one click, and gives it back in another', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    const folder = screen.getByLabelText('Attach everything in src');

    await user.click(folder);
    expect(screen.getByTestId('selection')).toHaveTextContent('src/a.ts,src/b.ts');
    expect(folder).toBeChecked();

    await user.click(folder);
    expect(screen.getByTestId('selection')).toHaveTextContent('');
  });

  it('shows a partly chosen folder as indeterminate, and filling it completes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByRole('button', { name: 'Expand src' }));
    await user.click(screen.getByLabelText('Attach src/a.ts'));

    const folder = screen.getByLabelText('Attach everything in src') as HTMLInputElement;
    expect(folder.indeterminate).toBe(true);
    expect(folder).not.toBeChecked();

    await user.click(folder);
    expect(screen.getByTestId('selection')).toHaveTextContent('src/a.ts,src/b.ts');
    expect(folder).toBeChecked();
  });

  it('closes on an outside click and on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Select files/ });

    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('list', { name: 'Repository files' })).toBeNull();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Repository files' })).toBeNull();
  });

  it('keeps the dropdown open when a click lands inside it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    await user.click(screen.getByRole('list', { name: 'Repository files' }));
    expect(screen.getByRole('list', { name: 'Repository files' })).toBeInTheDocument();
  });

  it('says when the repository has no files, and while it is still loading', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FileTreeSelect tree={[]} selected={[]} onToggle={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    expect(screen.getByText('No files found')).toBeInTheDocument();

    rerender(<FileTreeSelect tree={[]} selected={[]} onToggle={vi.fn()} loading />);
    expect(screen.getByRole('button', { name: /loading/ })).toBeDisabled();
    expect(screen.getByText('loading…', { selector: '.placeholder' })).toBeInTheDocument();
  });

  it('takes a caller’s own empty-state wording', async () => {
    const user = userEvent.setup();
    render(<FileTreeSelect tree={[]} selected={[]} onToggle={vi.fn()} empty='nothing here' />);
    await user.click(screen.getByRole('button', { name: /Select files/ }));
    expect(screen.getByText('nothing here')).toBeInTheDocument();
  });
});
