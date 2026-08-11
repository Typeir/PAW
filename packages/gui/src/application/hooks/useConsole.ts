/**
 * PAW Console Selectors
 *
 * @fileoverview One hook per slice panel need. A component calls `usePlan()`
 * directly; no ancestor threads the plan down. Every hook here reads a
 * pure selector in `domain/consoleState`; rule stay testable without React,
 * hook stays a lookup into the state.
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
 * Everything console render.
 *
 * @returns {ConsoleData} Loaded data.
 */
export function useConsoleData(): ConsoleData {
  return useConsoleState().data;
}

/**
 * Plan under authorship.
 *
 * @returns {PlanView} Plan.
 */
export function usePlan(): PlanView {
  return useConsoleState().data.plan;
}

/**
 * Active rail subsystem.
 *
 * @returns {Section} Section.
 */
export function useSection(): Section {
  return useConsoleState().section;
}

/**
 * Active tab within Swarm view.
 *
 * @returns {Tab} Tab.
 */
export function useTab(): Tab {
  return useConsoleState().tab;
}

/**
 * Scrubbed member index.
 *
 * @returns {number} Member index.
 */
export function useMember(): number {
  return useConsoleState().member;
}

/**
 * Whether brief editor hold unsaved edit.
 *
 * @returns {boolean} True when draft present.
 */
export function useHasDraft(): boolean {
  return useConsoleState().draft !== null;
}

/**
 * Brief text editor show.
 *
 * @returns {string} Effective brief.
 */
export function useBrief(): string {
  return effectiveBrief(useConsoleState());
}

/**
 * Member row for the member selected by `useMember()`.
 *
 * @returns {MemberView | undefined} Row, or undefined.
 */
export function useMemberView(): MemberView | undefined {
  return currentMemberView(useConsoleState());
}

/**
 * Repository file selected to include in every member's brief.
 *
 * @returns {readonly string[]} Selected paths, sorted.
 */
export function useContextSelection(): readonly string[] {
  return useConsoleState().context;
}

/**
 * Every plan served repository hold.
 *
 * @returns {readonly string[]} Plan paths, sorted.
 */
export function usePlans(): readonly string[] {
  return useConsoleState().data.plans;
}

/**
 * Which plan console look at, as daemon last report it.
 *
 * @returns {string | null} Plan path, or null when none selected.
 */
export function useSelectedPlan(): string | null {
  return useConsoleState().data.selectedPlan;
}
