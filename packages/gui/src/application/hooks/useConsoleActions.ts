/**
 * PAW Console Actions
 *
 * @fileoverview The verbs a panel may perform, bound once to the reducer. A
 * button calls `goto('roles')` rather than assembling an action object, so the
 * action union stays an implementation detail of the state module and the
 * callbacks keep a stable identity across renders.
 *
 * @module @paw/gui/application/hooks/useConsoleActions
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useMemo } from 'react';
import type { Section, Tab } from '../../domain/console.types.js';
import { useConsoleDispatch } from '../context/consoleContext.js';

/**
 * The console's verbs.
 *
 * @interface ConsoleActions
 * @property {(section: Section) => void} goto - Select a rail subsystem.
 * @property {(tab: Tab) => void} showTab - Select a tab within the Swarm view.
 * @property {(member: number) => void} select - Scrub to a member.
 * @property {(delta: number) => void} step - Scrub by a relative amount.
 * @property {(text: string) => void} edit - Replace the brief draft.
 * @property {() => void} reset - Drop the brief draft.
 * @property {(paths: readonly string[]) => void} toggleContext - Attach or detach a group of files.
 * @property {() => void} clearContext - Detach everything.
 * @property {(plan: string | null) => void} selectPlan - Look at another of the repository's plans.
 */
export interface ConsoleActions {
  readonly goto: (section: Section) => void;
  readonly showTab: (tab: Tab) => void;
  readonly select: (member: number) => void;
  readonly step: (delta: number) => void;
  readonly edit: (text: string) => void;
  readonly reset: () => void;
  readonly toggleContext: (paths: readonly string[]) => void;
  readonly clearContext: () => void;
  readonly selectPlan: (plan: string | null) => void;
}

/**
 * Bind the console's verbs to the reducer.
 *
 * @returns {ConsoleActions} The bound actions.
 */
export function useConsoleActions(): ConsoleActions {
  const dispatch = useConsoleDispatch();
  return useMemo(
    () => ({
      goto: (section: Section) => dispatch({ type: 'section', section }),
      showTab: (tab: Tab) => dispatch({ type: 'tab', tab }),
      select: (member: number) => dispatch({ type: 'select', member }),
      step: (delta: number) => dispatch({ type: 'step', delta }),
      edit: (text: string) => dispatch({ type: 'edit', text }),
      reset: () => dispatch({ type: 'reset' }),
      toggleContext: (paths: readonly string[]) => dispatch({ type: 'context-toggle', paths }),
      clearContext: () => dispatch({ type: 'context-clear' }),
      selectPlan: (plan: string | null) => dispatch({ type: 'select-plan', plan }),
    }),
    [dispatch],
  );
}
