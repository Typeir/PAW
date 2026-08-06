/**
 * PAW Console Selectors
 *
 * @fileoverview One hook per slice a panel actually needs, so a component reads
 * `usePlan()` instead of receiving a plan through four ancestors that do not care
 * about it. Every hook here is a thin read over the pure selectors in
 * `domain/consoleState`: the rules stay testable without React, and the hooks
 * stay a lookup rather than a second place where console logic accumulates.
 *
 * @module @paw/gui/application/hooks/useConsole
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { MemberView } from '@paw/core';
import type { ConsoleData, PlanView, Section, Tab } from '../../domain/console.types.js';
import {
  currentMemberView,
  effectiveBrief,
} from '../../domain/consoleState.js';
import { useConsoleState } from '../context/consoleContext.js';

/**
 * Everything the console renders.
 *
 * @returns {ConsoleData} The loaded data.
 */
export function useConsoleData(): ConsoleData {
  return useConsoleState().data;
}

/**
 * The plan under authorship.
 *
 * @returns {PlanView} The plan.
 */
export function usePlan(): PlanView {
  return useConsoleState().data.plan;
}

/**
 * The active rail subsystem.
 *
 * @returns {Section} The section.
 */
export function useSection(): Section {
  return useConsoleState().section;
}

/**
 * The active tab within the Swarm view.
 *
 * @returns {Tab} The tab.
 */
export function useTab(): Tab {
  return useConsoleState().tab;
}

/**
 * The scrubbed member index.
 *
 * @returns {number} The member index.
 */
export function useMember(): number {
  return useConsoleState().member;
}

/**
 * Whether the brief editor holds an unsaved edit.
 *
 * @returns {boolean} True when a draft is present.
 */
export function useHasDraft(): boolean {
  return useConsoleState().draft !== null;
}

/**
 * The brief text the editor shows.
 *
 * @returns {string} The effective brief.
 */
export function useBrief(): string {
  return effectiveBrief(useConsoleState());
}

/**
 * The herd row for the scrubbed member, if the run dispatched it.
 *
 * @returns {MemberView | undefined} The row, or undefined.
 */
export function useMemberView(): MemberView | undefined {
  return currentMemberView(useConsoleState());
}

/**
 * The repository files selected to ride along with every member's brief.
 *
 * @returns {readonly string[]} The selected paths, sorted.
 */
export function useContextSelection(): readonly string[] {
  return useConsoleState().context;
}

/**
 * Every plan the served repository holds.
 *
 * @returns {readonly string[]} The plan paths, sorted.
 */
export function usePlans(): readonly string[] {
  return useConsoleState().data.plans;
}

/**
 * Which plan the console is looking at, as the daemon last reported it.
 *
 * @returns {string | null} The plan path, or null when none is selected.
 */
export function useSelectedPlan(): string | null {
  return useConsoleState().data.selectedPlan;
}
