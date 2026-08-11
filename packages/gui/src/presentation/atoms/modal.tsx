/**
 * Modal stack.
 *
 * @fileoverview Dialog that stack. Port from Ikuisuus `ui/modal` + `useModalA11y`.
 * Declarative — `<Modal isOpen onClose>` — stack be module-level registry every
 * open modal join. Second modal open over first trap focus and answer Escape,
 * one beneath go inert. Body scroll-lock reference-counted: take on first modal,
 * release on last. Capture focus on open, return on close. Trap be hand-rolled Tab
 * handler, no dependency, so testable in jsdom, where Tab no move focus alone.
 * Portal to body, animate with CSS, nothing wait real animation event.
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

/** Open modals, oldest first; last on top. */
const stack: string[] = [];
let savedOverflow = '';

/**
 * Register modal open, lock body scroll on first.
 *
 * @param {string} id - Modal id.
 */
function pushModal(id: string): void {
  if (stack.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  stack.push(id);
}

/**
 * Unregister modal, restore body scroll when last close.
 *
 * @param {string} id - Modal id.
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
 * Whether modal be top of stack — only one that trap focus and answer Escape.
 *
 * @param {string} id - Modal id.
 * @returns {boolean} True when on top.
 */
function isTop(id: string): boolean {
  return stack[stack.length - 1] === id;
}

/**
 * Modal width tier.
 */
export type ModalSize = 'sm' | 'md' | 'lg';

/**
 * Props for {@link Modal}.
 *
 * @interface ModalProps
 * @property {boolean} isOpen - Whether modal show.
 * @property {() => void} onClose - Called on Escape, backdrop click, or close button.
 * @property {string} [title] - Optional heading; when given, draw labelled header with close button.
 * @property {ModalSize} [size] - Width tier; default `md`.
 * @property {ReactNode} children - Modal body.
 */
export interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly size?: ModalSize;
  readonly children: ReactNode;
}

/**
 * Stacking, focus-trapping modal dialog.
 *
 * @param {ModalProps} props - Modal props.
 * @returns {JSX.Element | null} Modal, or null when closed.
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
