/**
 * @fileoverview Cover Select atom full. Test closed trigger (selected label vs
 * placeholder), open and close by click and by keyboard, pick option by click
 * and by Enter, every nav key (Arrow/Home/End/Escape/Tab and one ignored key),
 * disabled short-circuit, searchable filter with empty state, and outside-click
 * close — so `select.tsx` reach 100% in jsdom without real layout or timers.
 *
 * @module @paw/gui/test/unit/presentation/select
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from '../../../src/presentation/atoms/select.js';

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

/**
 * Render a Select. Return its onChange spy, root, and trigger.
 *
 * @param props - Overrides for the Select.
 */
function setup(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn();
  const { container } = render(
    <Select ariaLabel='Plan' value='b' options={OPTIONS} onChange={onChange} {...props} />,
  );
  const scope = within(container);
  const root = container.querySelector('.selectwrap') as HTMLElement;
  const trigger = scope.getByRole('button', { name: 'Plan' });
  return { onChange, root, trigger, scope };
}

describe('Select (closed)', () => {
  it('shows the selected label, or the placeholder when nothing matches', () => {
    expect(setup().trigger).toHaveTextContent('Beta');
    expect(setup({ value: '' }).trigger).toHaveTextContent('Select…');
    expect(setup().trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores keys other than the open keys while closed', () => {
    const { root, scope } = setup();
    fireEvent.keyDown(root, { key: 'x' });
    expect(scope.queryByRole('listbox')).toBeNull();
  });

  it('opens on ArrowDown/Enter/Space, highlighting the current or first option', () => {
    for (const key of ['ArrowDown', 'Enter', ' ']) {
      const { root, scope } = setup();
      fireEvent.keyDown(root, { key });
      expect(scope.getByRole('option', { name: 'Beta' })).toHaveClass('hl');
      scope.getByRole('listbox');
    }
    const none = setup({ value: 'missing' });
    fireEvent.keyDown(none.root, { key: 'ArrowDown' });
    expect(none.scope.getByRole('option', { name: 'Alpha' })).toHaveClass('hl');
  });
});

describe('Select (open)', () => {
  it('opens and closes on trigger click and lists options with the selected marked', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects an option on click and closes', () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigates with the arrows, Home and End, and selects with Enter', () => {
    const { root, trigger, onChange } = setup({ value: 'a' });
    fireEvent.click(trigger);
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveClass('hl');
    fireEvent.keyDown(root, { key: 'ArrowUp' });
    fireEvent.keyDown(root, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveClass('hl');
    fireEvent.keyDown(root, { key: 'End' });
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveClass('hl');
    fireEvent.keyDown(root, { key: 'Home' });
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('highlights on hover, and ignores an unhandled key; Escape and Tab close', () => {
    const { root, trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Gamma' }));
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveClass('hl');
    fireEvent.keyDown(root, { key: 'q' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(root, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on an outside click but not on an inside one', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Select (searchable + disabled)', () => {
  it('filters options and shows an empty state; Enter does nothing with no match', () => {
    const { root, trigger, onChange } = setup({ searchable: true });
    fireEvent.click(trigger);
    const search = screen.getByRole('textbox', { name: 'Filter options' });
    fireEvent.change(search, { target: { value: 'gam' } });
    expect(screen.getByRole('option', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('no matches')).toBeInTheDocument();
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const { root, trigger } = setup({ disabled: true });
    expect(trigger).toBeDisabled();
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
