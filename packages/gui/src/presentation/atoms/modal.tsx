/**
 * Modal Stack
 *
 * @fileoverview A dialog that stacks, ported from Ikuisuus's `ui/modal` +
 * `useModalA11y`. It is declarative — `<Modal isOpen onClose>` — and the stack is a
 * module-level registry every open modal joins, so a second modal opened over a
 * first traps focus and answers Escape while the one beneath goes inert, and the
 * body scroll-lock is reference-counted: taken on the first modal, released on the
 * last. Focus is captured on open and returned on close; the trap is a hand-rolled
 * Tab handler (no dependency), which is exactly what makes it testable in jsdom,
 * where Tab does not move focus on its own. It portals to the body and animates in
 * with CSS, so nothing here waits on a real animation event.
 *
 * @module @paw/gui/presentation/atoms/modal
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** The open modals, oldest first; the last is on top. */
const stack: string[] = [];
let savedOverflow = '';

/**
 * Register a modal as open, locking body scroll on the first.
 *
 * @param {string} id - The modal's id.
 */
function pushModal(id: string): void {
  if (stack.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  stack.push(id);
}

/**
 * Unregister a modal, restoring body scroll when the last one closes.
 *
 * @param {string} id - The modal's id.
 */
function popModal(id: string): void {
  const index = stack.indexOf(id);
  if (index !== -1) {
    stack.splice(index, 1);
  }
  if (stack.length === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

/**
 * Whether a modal is the top of the stack — the only one that traps focus and
 * answers Escape.
 *
 * @param {string} id - The modal's id.
 * @returns {boolean} True when it is on top.
 */
function isTop(id: string): boolean {
  return stack[stack.length - 1] === id;
}

/**
 * The modal's width tier.
 */
export type ModalSize = 'sm' | 'md' | 'lg';

/**
 * Props for {@link Modal}.
 *
 * @interface ModalProps
 * @property {boolean} isOpen - Whether the modal is shown.
 * @property {() => void} onClose - Called on Escape, backdrop click, or the close button.
 * @property {string} [title] - An optional heading; when given, a labelled header with a close button is drawn.
 * @property {ModalSize} [size] - Width tier; defaults to `md`.
 * @property {ReactNode} children - The modal body.
 */
export interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly size?: ModalSize;
  readonly children: ReactNode;
}

/**
 * A stacking, focus-trapping modal dialog.
 *
 * @param {ModalProps} props - The modal props.
 * @returns {JSX.Element | null} The modal, or null when closed.
 */
export function Modal({ isOpen, onClose, title, size = 'md', children }: ModalProps) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    triggerRef.current = document.activeElement;
    pushModal(id);
    const content = contentRef.current!;
    const focusables = content.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables.length > 0 ? focusables[0] : content).focus();
    return () => {
      popModal(id);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, id]);

  if (!isOpen) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isTop(id)) {
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = contentRef.current!.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className='modal-overlay'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={onKeyDown}>
      <div
        ref={contentRef}
        className={`modal modal-${size}`}
        role='dialog'
        aria-modal='true'
        aria-labelledby={title !== undefined ? `${id}-title` : undefined}
        tabIndex={-1}>
        {title !== undefined && (
          <header className='modal-head'>
            <h2 id={`${id}-title`}>{title}</h2>
            <button type='button' className='modal-x' aria-label='Close' onClick={onClose}>
              <X size={16} aria-hidden='true' />
            </button>
          </header>
        )}
        <div className='modal-body'>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
