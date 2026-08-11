/**
 * PAW Binding Editor Hook
 *
 * @fileoverview Roles view editing state, live outside component: declared
 * models pick from, write maybe in flight, reason last one refused. Write go
 * to daemon, new binding come on next live snapshot, so hook hold no
 * optimistic copy of bindings — only models (snapshot not carry them) and
 * write status. Page with no daemon behind it get null client, not editable.
 *
 * @module @paw/gui/application/hooks/useBindingEditor
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { ConfigClient, ConfigWrite } from '../../infrastructure/configClient.js';

/**
 * Roles view editing surface.
 *
 * @interface BindingEditor
 * @property {readonly string[]} models - Declared models bind to.
 * @property {boolean} pending - Write in flight.
 * @property {string | null} error - Why last write refused, or null.
 * @property {boolean} editable - Daemon there to write to.
 * @property {(role: string, model: string) => void} bind - Bind role to model.
 * @property {(role: string) => void} unbind - Clear role binding.
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
 * Drive Roles view edits against config client.
 *
 * @param {ConfigClient | null} client - The client, or null on static page.
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
