/**
 * File Tree Select Atom
 *
 * @fileoverview Repository browser. Port from Ikuisuus's `FileTreeSelect`. Combobox single-path picker changed to multi-select; the dropdown stays open so the operator can toggle multiple paths, because attaching context requires several toggles. Menu renders through a portal at body, anchored at a fixed position under the trigger, so parent card `overflow: hidden` never clips it; anchor re-measures on resize and capture-phase scroll. It holds only dropdown-local state — which directories are open, the anchor, and whether the menu shows — while selection lives in console state, which the rest of the console reads.
 *
 * @module @paw/gui/presentation/atoms/fileTreeSelect
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { TreeNode } from '@paw/core';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TreeRow } from './treeRow.js';

/**
 * Where the portal dropdown sit, in viewport coordinates.
 *
 * @interface DropAnchor
 * @property {number} top - Viewport top, under the trigger.
 * @property {number} left - Viewport left, flush with the trigger.
 * @property {number} width - Trigger width, so menu match it.
 */
interface DropAnchor {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}

/**
 * Props for {@link FileTreeSelect}.
 *
 * @interface FileTreeSelectProps
 * @property {readonly TreeNode[]} tree - Tree to browse.
 * @property {readonly string[]} selected - Paths already attached.
 * @property {(paths: readonly string[]) => void} onToggle - Toggle group of paths.
 * @property {boolean} [loading] - Tree still being fetched?
 * @property {string} [empty] - Message shown when no tree is available.
 */
export interface FileTreeSelectProps {
  readonly tree: readonly TreeNode[];
  readonly selected: readonly string[];
  readonly onToggle: (paths: readonly string[]) => void;
  readonly loading?: boolean;
  readonly empty?: string;
}

/**
 * Multi-select repository file picker.
 *
 * @param {FileTreeSelectProps} props - Picker props.
 * @returns {JSX.Element} Picker.
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
  const [anchor, setAnchor] = useState<DropAnchor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement | HTMLUListElement | null>(null);

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

  const measure = useCallback((): void => {
    const trigger = containerRef.current?.querySelector('.treetrigger');
    const rect = trigger?.getBoundingClientRect();
    if (rect) {
      setAnchor({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    // Menu render in a portal so parent card's overflow never clip it, and
    // follow the trigger through resize and any scrolling ancestor.
    measure();
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !dropRef.current?.contains(target)) {
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
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, measure]);

  const label =
    selected.length === 0 ? 'Select files…' : `${selected.length} file(s) attached`;

  const anchorStyle =
    anchor === null ? undefined : { top: anchor.top, left: anchor.left, width: anchor.width };

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

      {isOpen &&
        tree.length === 0 &&
        createPortal(
          <div
            className='treedropdown'
            style={anchorStyle}
            ref={(node) => {
              dropRef.current = node;
            }}>
            <p className='placeholder'>{loading ? 'loading…' : empty}</p>
          </div>,
          document.body,
        )}
      {isOpen &&
        tree.length > 0 &&
        createPortal(
          <ul
            className='treedropdown'
            aria-label='Repository files'
            style={anchorStyle}
            ref={(node) => {
              dropRef.current = node;
            }}>
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
