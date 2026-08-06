/**
 * File Tree Select Atom
 *
 * @fileoverview The repository browser, ported from Ikuisuus's `FileTreeSelect`
 * and changed from a combobox that picks one path to a picker that checks many:
 * the dropdown stays open while an operator works through it, because attaching
 * context is a multi-step act. It owns only what is local to a dropdown — which
 * directories are open, and whether it is showing — while the selection itself
 * lives in console state, where the rest of the console can see it.
 *
 * @module @paw/gui/presentation/atoms/fileTreeSelect
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TreeRow } from './treeRow.js';

/**
 * Props for {@link FileTreeSelect}.
 *
 * @interface FileTreeSelectProps
 * @property {readonly TreeNode[]} tree - The tree to browse.
 * @property {readonly string[]} selected - The paths already attached.
 * @property {(paths: readonly string[]) => void} onToggle - Toggle a group of paths.
 * @property {boolean} [loading] - Whether the tree is still being fetched.
 * @property {string} [empty] - What to say when there is no tree to show.
 */
export interface FileTreeSelectProps {
  readonly tree: readonly TreeNode[];
  readonly selected: readonly string[];
  readonly onToggle: (paths: readonly string[]) => void;
  readonly loading?: boolean;
  readonly empty?: string;
}

/**
 * A multi-select repository file picker.
 *
 * @param {FileTreeSelectProps} props - The picker props.
 * @returns {JSX.Element} The picker.
 */
export function FileTreeSelect({
  tree,
  selected,
  onToggle,
  loading = false,
  empty = 'No files found',
}: FileTreeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const onExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const label =
    selected.length === 0 ? 'Select files…' : `${selected.length} file(s) attached`;

  return (
    <div className='treeselect' ref={containerRef}>
      <button
        type='button'
        className='treetrigger'
        disabled={loading}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}>
        <span className='pathlabel'>{loading ? 'loading…' : label}</span>
        <ChevronDown size={13} className={isOpen ? 'chevron open' : 'chevron'} aria-hidden='true' />
      </button>

      {isOpen && tree.length === 0 && (
        <div className='treedropdown'>
          <p className='placeholder'>{loading ? 'loading…' : empty}</p>
        </div>
      )}
      {isOpen && tree.length > 0 && (
        <ul className='treedropdown' aria-label='Repository files'>
          {tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onExpand={onExpand}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
