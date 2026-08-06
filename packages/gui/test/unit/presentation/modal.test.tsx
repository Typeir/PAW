/**
 * @fileoverview Covers the Modal exhaustively: closed it renders nothing and takes
 * no scroll lock; open it portals a labelled dialog, locks the body, and focuses
 * its first focusable (or itself when it has none); it closes on the button, on
 * Escape, and on a backdrop click but not a content click; Tab wraps at both ends
 * and does nothing in the middle or with no focusables; a non-Tab key is ignored;
 * stacked, only the top modal answers Escape; and the scroll lock is released when
 * it closes — so `modal.tsx` reaches 100% in jsdom, where the hand-rolled trap is
 * exactly what makes the keyboard testable.
 *
 * @module @paw/gui/test/unit/presentation/modal
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../../src/presentation/atoms/modal.js';

const overlay = (): HTMLElement => document.querySelector('.modal-overlay') as HTMLElement;

describe('Modal (closed)', () => {
  it('renders nothing and does not lock scroll', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Modal (open)', () => {
  it('portals a labelled dialog, locks scroll, focuses the first focusable, and closes on the button', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title='Details'>
        <button type='button'>inside</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses itself when it has no focusables, and swallows Tab there', () => {
    render(<Modal isOpen onClose={vi.fn()}>just text</Modal>);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    expect(screen.queryByRole('heading')).toBeNull();
    fireEvent.keyDown(overlay(), { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });

  it('closes on Escape and ignores an unrelated key', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose}>
        <button type='button'>x</button>
      </Modal>,
    );
    fireEvent.keyDown(overlay(), { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(overlay(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps Tab at both ends and leaves the middle alone', () => {
    render(
      <Modal isOpen onClose={vi.fn()}>
        <button type='button'>a</button>
        <button type='button'>b</button>
        <button type='button'>c</button>
      </Modal>,
    );
    const a = screen.getByRole('button', { name: 'a' });
    const b = screen.getByRole('button', { name: 'b' });
    const c = screen.getByRole('button', { name: 'c' });

    a.focus();
    fireEvent.keyDown(overlay(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(c);

    c.focus();
    fireEvent.keyDown(overlay(), { key: 'Tab' });
    expect(document.activeElement).toBe(a);

    b.focus();
    fireEvent.keyDown(overlay(), { key: 'Tab' });
    expect(document.activeElement).toBe(b);
  });

  it('closes on a backdrop click but not a content click', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose}>body</Modal>);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores scroll when it closes', () => {
    const { rerender } = render(<Modal isOpen onClose={vi.fn()}>body</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Modal isOpen={false} onClose={vi.fn()}>
        body
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Modal (stacked)', () => {
  it('lets only the top modal answer Escape', () => {
    const onLower = vi.fn();
    const onTop = vi.fn();
    render(
      <>
        <Modal isOpen onClose={onLower}>
          <button type='button'>lower</button>
        </Modal>
        <Modal isOpen onClose={onTop}>
          <button type='button'>top</button>
        </Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    const overlays = document.querySelectorAll('.modal-overlay');
    fireEvent.keyDown(overlays[0], { key: 'Escape' });
    expect(onLower).not.toHaveBeenCalled();
    fireEvent.keyDown(overlays[1], { key: 'Escape' });
    expect(onTop).toHaveBeenCalledOnce();
  });
});
