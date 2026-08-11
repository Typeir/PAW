/**
 * PAW Console Actions
 *
 * @fileoverview Verbs panel do. Bind once to reducer. Button call `goto('roles')`, caller builds no action object. State module encapsulates the action union type. Callbacks hold stable identity across renders.
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
 * Console verbs.
 *
 * @interface ConsoleActions
 * @property {(section: Section) => void} goto - Choose rail subsystem.
 * @property {(tab: Tab) => void} showTab - Choose tab in Swarm view.
 * @property {(member: number) => void} select - Scrub to member.
 * @property {(delta: number) => void} step - Scrub relative amount.
 * @property {(text: string) => void} edit - Swap brief draft.
 * @property {() => void} reset - Throw away brief draft.
 * @property {(paths: readonly string[]) => void} toggleContext - Attach or detach group of files.
 * @property {() => void} clearContext - Detach all files.
 * @property {(plan: string | null) => void} selectPlan - Look at other plan of repo.
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
 * Tie console verbs to reducer.
 *
 * @returns {ConsoleActions} Bound actions.
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
