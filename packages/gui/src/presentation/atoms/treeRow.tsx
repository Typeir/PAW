/**
 * Tree Row Atom
 *
 * @fileoverview One row of the file tree, recursive over its children — the
 * Ikuisuus `FileTreeSelectRow`, changed from picking one path to checking many.
 * A file's checkbox toggles that file; a folder's toggles every file beneath it
 * and reads back as checked, indeterminate, or empty, so a half-chosen folder
 * looks half-chosen. Expansion state is the caller's, which keeps this row pure
 * and lets the whole tree share one open set.
 *
 * @module @paw/gui/presentation/atoms/treeRow
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { coverage, filesUnder } from '../../domain/context.js';

/**
 * Props for {@link TreeRow}.
 *
 * @interface TreeRowProps
 * @property {TreeNode} node - The node to render.
 * @property {number} depth - How deep it sits, for indentation.
 * @property {ReadonlySet<string>} expanded - Paths of the open directories.
 * @property {(path: string) => void} onExpand - Open or close a directory.
 * @property {readonly string[]} selected - The current selection.
 * @property {(paths: readonly string[]) => void} onToggle - Toggle a group of paths.
 */
export interface TreeRowProps {
  readonly node: TreeNode;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly onExpand: (path: string) => void;
  readonly selected: readonly string[];
  readonly onToggle: (paths: readonly string[]) => void;
}

/**
 * A file or directory row, with its children when open.
 *
 * @param {TreeRowProps} props - The row props.
 * @returns {JSX.Element} The row.
 */
export function TreeRow({
  node,
  depth,
  expanded,
  onExpand,
  selected,
  onToggle,
}: TreeRowProps) {
  const files = filesUnder(node);
  const held = coverage(selected, files);
  const indent = { paddingLeft: `${depth * 16 + 8}px` };

  const box = (
    <input
      type='checkbox'
      className='treebox'
      checked={held === 'all'}
      ref={(el) => {
        if (el) {
          el.indeterminate = held === 'some';
        }
      }}
      onChange={() => onToggle(files)}
      aria-label={`${node.isFile ? 'Attach' : 'Attach everything in'} ${node.path}`}
    />
  );

  if (node.isFile) {
    return (
      <li className='treerow' style={indent}>
        {box}
        <span className='ico' aria-hidden='true'>
          <FileText size={13} />
        </span>
        <span className='nodename'>{node.name}</span>
      </li>
    );
  }

  const isOpen = expanded.has(node.path);
  return (
    <>
      <li className='treerow' style={indent}>
        {box}
        <button
          type='button'
          className='treetoggle'
          onClick={() => onExpand(node.path)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.path}`}>
          <span className='ico' aria-hidden='true'>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className='ico' aria-hidden='true'>
            {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
          <span className='nodename'>{node.name}/</span>
        </button>
      </li>
      {isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onExpand={onExpand}
            selected={selected}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}
