/**
 * Toast System
 *
 * @fileoverview Transient notice. Port from Ikuisuus `ui/pushNotification`; shows
 * success/error feedback the console does not display. {@link ToastProvider} hold queue, portal
 * to body. Anything below fire one through {@link useToast}. Each type get a default
 * lifetime. Stack capped at max; excess toasts are dropped. Dismiss animate out on timer,
 * not animation event — so whole thing deterministic under fake timers, need no real
 * layout. Client-only (PAW ship bundle, not SSR), portal straight to `document.body`
 * with no mount guard. Throw, not no-op, when used outside provider.
 *
 * @module @paw/gui/presentation/atoms/toast
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { CloseLight } from './closeLight.js';
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
 * Severity of toast. Set icon, colour, default lifetime.
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/**
 * Where toaster sit.
 */
export type ToastPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/**
 * Options when fire toast.
 *
 * @interface ToastOptions
 * @property {string} [title] - Optional bold heading above message.
 * @property {number} [duration] - Milliseconds before auto-dismiss; 0 keep it till dismissed.
 * @property {boolean} [dismissible] - Show close button? Default true.
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
 * @property {ToastType} type - Severity.
 * @property {ReactNode} message - Body.
 * @property {string} [title] - Heading.
 * @property {number} duration - Lifetime in ms; 0 sticky.
 * @property {boolean} dismissible - Shows close button?
 * @property {boolean} [exiting] - True while animate out before removal.
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
 * Imperative surface {@link useToast} return.
 *
 * @interface ToastApi
 * @property {(type: ToastType, message: ReactNode, options?: ToastOptions) => string} push - Fire toast; return id.
 * @property {(id: string) => void} dismiss - Dismiss one by id.
 * @property {() => void} dismissAll - Dismiss every toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} info - Shorthand for info toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} success - Shorthand for success toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} warning - Shorthand for warning toast.
 * @property {(message: ReactNode, options?: ToastOptions) => string} error - Shorthand for error toast.
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
 * Generate unique, deterministic toast id.
 *
 * @returns {string} Next id.
 */
function nextId(): string {
  sequence += 1;
  return `toast-${sequence}`;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Access toast API. Throw when used outside {@link ToastProvider}.
 *
 * @returns {ToastApi} Toast API.
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
 * @param {{ toast: Toast; onDismiss: () => void }} props - Toast and dismiss handler.
 * @returns {JSX.Element} Toast.
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
        <CloseLight small className='toast-x' label='Dismiss' onClick={onDismiss} />
      )}
    </div>
  );
}

/**
 * Props for {@link ToastProvider}.
 *
 * @interface ToastProviderProps
 * @property {ReactNode} children - Subtree that can fire toasts.
 * @property {ToastPosition} [position] - Where stack sit; default top-right.
 * @property {number} [max] - Most toasts kept at once; older ones drop.
 */
export interface ToastProviderProps {
  readonly children: ReactNode;
  readonly position?: ToastPosition;
  readonly max?: number;
}

/**
 * Provide toast API to subtree, render stack.
 *
 * @param {ToastProviderProps} props - Provider props.
 * @returns {JSX.Element} Provider.
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
