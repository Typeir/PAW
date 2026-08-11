/**
 * Select Atom
 *
 * @fileoverview Styled single-select dropdown, ported from Ikuisuus
 * `ui/filterSelect`, pared to what console need: controlled listbox with
 * optional type-to-filter, full keyboard operation, ARIA
 * `combobox`→`listbox`/`option` wiring. Announces to screen reader,
 * works without mouse, matches platform `<select>` semantics, styled to
 * match rest of instrument panel. Positions with plain absolute CSS (no
 * floating-ui). Closes on outside click or Escape — unit-testable in
 * jsdom. No `scrollIntoView`: untestable in jsdom, unnecessary for the
 * short lists this control renders.
 *
 * @module @paw/gui/presentation/atoms/select
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

/**
 * One selectable option.
 *
 * @interface SelectOption
 * @property {string} value - Option value, emit on select.
 * @property {string} label - Option visible label.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Props for {@link Select}.
 *
 * @interface SelectProps
 * @property {string} value - Current selected value (controlled).
 * @property {readonly SelectOption[]} options - Options to choose from.
 * @property {(value: string) => void} onChange - Call with chosen value.
 * @property {string} ariaLabel - Accessible name for control.
 * @property {string} [placeholder] - Shown when `value` match no option.
 * @property {boolean} [searchable] - Show filter box that narrow options.
 * @property {boolean} [disabled] - Disable control.
 * @property {string} [id] - Base id for listbox wiring.
 */
export interface SelectProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly searchable?: boolean;
  readonly disabled?: boolean;
  readonly id?: string;
}

/**
 * A styled single-select dropdown.
 *
 * @param {SelectProps} props - The select props.
 * @returns {JSX.Element} The select.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select…',
  searchable = false,
  disabled = false,
  id,
}: SelectProps) {
  const rid = useId();
  const listboxId = `${id ?? rid}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const filtered =
    searchable && query !== ''
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options;

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, close]);

  const pick = (next: string): void => {
    onChange(next);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setIsOpen(true);
        setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight((h) => Math.min(filtered.length - 1, h + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        break;
      case 'Home':
        event.preventDefault();
        setHighlight(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlight(filtered.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (filtered[highlight] !== undefined) {
          pick(filtered[highlight].value);
        }
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  return (
    <div className='selectwrap' ref={containerRef} onKeyDown={onKeyDown}>
      <button
        type='button'
        className='selecttrigger'
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (isOpen ? close() : setIsOpen(true))}>
        <span className='selectlabel'>{selectedLabel}</span>
        <ChevronDown size={13} className={isOpen ? 'chevron open' : 'chevron'} aria-hidden='true' />
      </button>
      {isOpen && (
        <div className='selectdropdown'>
          {searchable && (
            <input
              className='selectsearch'
              aria-label='Filter options'
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
            />
          )}
          <ul role='listbox' id={listboxId} aria-label={ariaLabel}>
            {filtered.length === 0 && <li className='selectempty'>no matches</li>}
            {filtered.map((option, index) => (
              <li
                key={option.value}
                role='option'
                aria-selected={option.value === value}
                className={index === highlight ? 'selectoption hl' : 'selectoption'}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option.value)}>
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
