/**
 * PAW Binding Editor Hook
 *
 * @fileoverview The Roles view's editing state, kept out of the component: the
 * declared models to choose from, whether a write is in flight, and the reason
 * the last one was refused. A write goes to the daemon and the new binding then
 * arrives on the next live snapshot, so this holds no optimistic copy of the
 * bindings — only the models (which the snapshot does not carry) and the write
 * status. A page with no daemon behind it has a null client and is not editable.
 *
 * @module @paw/gui/application/hooks/useBindingEditor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { ConfigClient, ConfigWrite } from '../../infrastructure/configClient.js';

/**
 * The Roles view's editing surface.
 *
 * @interface BindingEditor
 * @property {readonly string[]} models - The declared models to bind to.
 * @property {boolean} pending - Whether a write is in flight.
 * @property {string | null} error - Why the last write was refused, or null.
 * @property {boolean} editable - Whether there is a daemon to write to.
 * @property {(role: string, model: string) => void} bind - Bind a role to a model.
 * @property {(role: string) => void} unbind - Clear a role's binding.
 */
export interface BindingEditor {
  readonly models: readonly string[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly editable: boolean;
  bind(role: string, model: string): void;
  unbind(role: string): void;
}

/**
 * Drive the Roles view's edits against a config client.
 *
 * @param {ConfigClient | null} client - The client, or null on a static page.
 * @returns {BindingEditor} The editing surface.
 */
export function useBindingEditor(client: ConfigClient | null): BindingEditor {
  const [models, setModels] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client !== null) {
      void client.models().then(setModels, () => setError('could not read the declared models'));
    }
  }, [client]);

  const run = useCallback((write: Promise<ConfigWrite>): void => {
    setPending(true);
    setError(null);
    void write.then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.reason ?? 'the edit was refused');
      }
    });
  }, []);

  const bind = useCallback(
    (role: string, model: string): void => {
      if (client !== null) {
        run(client.bind(role, model));
      }
    },
    [client, run],
  );

  const unbind = useCallback(
    (role: string): void => {
      if (client !== null) {
        run(client.unbind(role));
      }
    },
    [client, run],
  );

  return { models, pending, error, editable: client !== null, bind, unbind };
}
