/**
 * Toast System
 *
 * @fileoverview Transient notifications, ported from Ikuisuus's `ui/pushNotification`
 * — the bread-and-butter "it worked / it did not" surface the console lacks. A
 * {@link ToastProvider} holds the queue and portals it to the body; anything below
 * fires one through {@link useToast}. Each type has a sensible default lifetime,
 * the stack is capped so a burst cannot bury the screen, and dismissal animates out
 * on a timer rather than an animation event — so the whole thing is deterministic
 * under fake timers and needs no real layout. It is client-only (PAW ships a
 * bundle, not SSR), so it portals straight to `document.body` with no mount guard,
 * and it throws rather than no-ops when used outside a provider, because a
 * notification that silently goes nowhere is worse than a loud mistake.
 *
 * @module @paw/gui/presentation/atoms/toast
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The severity of a toast, which sets its icon, colour, and default lifetime.
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/**
 * Where the toaster sits.
 */
export type ToastPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/**
 * Options when firing a toast.
 *
 * @interface ToastOptions
 * @property {string} [title] - An optional bold heading above the message.
 * @property {number} [duration] - Milliseconds before auto-dismiss; 0 keeps it until dismissed.
 * @property {boolean} [dismissible] - Whether to show the close button; defaults to true.
 */
export interface ToastOptions {
  readonly title?: string;
  readonly duration?: number;
  readonly dismissible?: boolean;
}

/**
 * One live toast.
 *
 * @interface Toast
 * @property {string} id - Stable id.
 * @property {ToastType} type - The severity.
 * @property {ReactNode} message - The body.
 * @property {string} [title] - The heading.
 * @property {number} duration - Lifetime in ms; 0 is sticky.
 * @property {boolean} dismissible - Whether it shows a close button.
 * @property {boolean} [exiting] - True while animating out before removal.
 */
export interface Toast {
  readonly id: string;
  readonly type: ToastType;
  readonly message: ReactNode;
  readonly title?: string;
  readonly duration: number;
  readonly dismissible: boolean;
  readonly exiting?: boolean;
}

/**
 * The imperative surface {@link useToast} returns.
 *
 * @interface ToastApi
 * @property {(type: ToastType, message: ReactNode, options?: ToastOptions) => string} push - Fire a toast; returns its id.
 * @property {(id: string) => void} dismiss - Dismiss one by id.
 * @property {() => void} dismissAll - Dismiss every toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} info - Shorthand for an info toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} success - Shorthand for a success toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} warning - Shorthand for a warning toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} error - Shorthand for an error toast.
 */
export interface ToastApi {
  readonly push: (type: ToastType, message: ReactNode, options?: ToastOptions) => string;
  readonly dismiss: (id: string) => void;
  readonly dismissAll: () => void;
  readonly info: (message: ReactNode, options?: ToastOptions) => string;
  readonly success: (message: ReactNode, options?: ToastOptions) => string;
  readonly warning: (message: ReactNode, options?: ToastOptions) => string;
  readonly error: (message: ReactNode, options?: ToastOptions) => string;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

const ICON: Record<ToastType, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

const EXIT_MS = 200;
const DEFAULT_MAX = 5;

let sequence = 0;

/**
 * Mint a unique, deterministic toast id.
 *
 * @returns {string} The next id.
 */
function nextId(): string {
  sequence += 1;
  return `toast-${sequence}`;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Access the toast API. Throws when used outside a {@link ToastProvider}, because a
 * notification with nowhere to go is a bug, not a no-op.
 *
 * @returns {ToastApi} The toast API.
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

/**
 * One rendered toast.
 *
 * @param {{ toast: Toast; onDismiss: () => void }} props - The toast and its dismiss handler.
 * @returns {JSX.Element} The toast.
 */
function ToastItem({ toast, onDismiss }: { readonly toast: Toast; readonly onDismiss: () => void }) {
  const Icon = ICON[toast.type];
  return (
    <div className={toast.exiting === true ? `toast ${toast.type} exiting` : `toast ${toast.type}`} role='status'>
      <Icon size={15} className='toast-ico' aria-hidden='true' />
      <div className='toast-body'>
        {toast.title !== undefined && <p className='toast-title'>{toast.title}</p>}
        <p className='toast-msg'>{toast.message}</p>
      </div>
      {toast.dismissible && (
        <button type='button' className='toast-x' aria-label='Dismiss' onClick={onDismiss}>
          <X size={13} aria-hidden='true' />
        </button>
      )}
    </div>
  );
}

/**
 * Props for {@link ToastProvider}.
 *
 * @interface ToastProviderProps
 * @property {ReactNode} children - The subtree that can fire toasts.
 * @property {ToastPosition} [position] - Where the stack sits; defaults to top-right.
 * @property {number} [max] - Most toasts kept at once; older ones drop.
 */
export interface ToastProviderProps {
  readonly children: ReactNode;
  readonly position?: ToastPosition;
  readonly max?: number;
}

/**
 * Provide the toast API to a subtree and render the stack.
 *
 * @param {ToastProviderProps} props - The provider props.
 * @returns {JSX.Element} The provider.
 */
export function ToastProvider({ children, position = 'top-right', max = DEFAULT_MAX }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const push = useCallback(
    (type: ToastType, message: ReactNode, options: ToastOptions = {}): string => {
      const id = nextId();
      const duration = options.duration ?? DEFAULT_DURATION[type];
      const toast: Toast = {
        id,
        type,
        message,
        title: options.title,
        duration,
        dismissible: options.dismissible ?? true,
      };
      setToasts((list) => {
        const next = [...list, toast];
        return next.length > max ? next.slice(next.length - max) : next;
      });
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss, max],
  );

  const dismissAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setToasts((list) => list.map((t) => ({ ...t, exiting: true })));
    setTimeout(() => setToasts([]), EXIT_MS);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      dismissAll,
      info: (message, options) => push('info', message, options),
      success: (message, options) => push('success', message, options),
      warning: (message, options) => push('warning', message, options),
      error: (message, options) => push('error', message, options),
    }),
    [push, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className={`toaster ${position}`} role='region' aria-label='Notifications'>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
